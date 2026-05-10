import { access, readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import babel from '@babel/core'
import { createMiddleware, createServerFn } from '@tanstack/start-client-core'
import { createClientRpc } from '@tanstack/start-client-core/client-rpc'
import { runWithStartContext } from '@tanstack/start-storage-context'
import { createServerRpc } from '@tanstack/start-server-core/createServerRpc'
import { handleLocalServerAction } from './local-server-action'
import { loadRequestResponseRuntime, loadStartCompiler } from './private-adapter'
import type { CustomFetch } from '@tanstack/start-client-core'
import type { PluginObj } from '@babel/core'
import type { ServerFnInfo } from './private-adapter'

type ModuleExports = Record<string, any>
type ServerFnRecord = Record<string, ServerFnInfo>

interface ResolvedServerFnSource {
  code: string
  id: string
  root: string
}

type CreateServerFnTestHarnessSource =
  | {
      code: string
      id?: string
      root?: string
      module?: never
    }
  | {
      module: string | URL
      root?: string
      code?: never
      id?: never
    }

export type CreateServerFnTestHarnessMetadata = CreateServerFnTestHarnessSource & {
  exportName: string
}

export type CreateServerFnTestHarnessOptions = CreateServerFnTestHarnessMetadata & {
  serverFnBase?: string
  origin?: string
  requestContext?: Record<string, unknown>
}

export interface ServerFnTestHarness<TFn extends (...args: Array<any>) => any> {
  functionId: string
  call: (...args: Parameters<TFn>) => ReturnType<TFn>
  fetch: CustomFetch
}

const TSS_SERVERFN_SPLIT_PARAM = 'tss-serverfn-split'

export async function createServerFnTestHarness<
  TFn extends (...args: Array<any>) => any = (...args: Array<any>) => any,
>(serverFn: TFn, metadata: CreateServerFnTestHarnessOptions): Promise<ServerFnTestHarness<TFn>>
export async function createServerFnTestHarness<
  TFn extends (...args: Array<any>) => any = (...args: Array<any>) => any,
>(serverFn: TFn): Promise<ServerFnTestHarness<TFn>>
export async function createServerFnTestHarness<
  TFn extends (...args: Array<any>) => any = (...args: Array<any>) => any,
>(opts: CreateServerFnTestHarnessOptions): Promise<ServerFnTestHarness<TFn>>
export async function createServerFnTestHarness<
  TFn extends (...args: Array<any>) => any = (...args: Array<any>) => any,
>(
  serverFnOrOptions: TFn | CreateServerFnTestHarnessOptions,
  metadata?: CreateServerFnTestHarnessOptions,
): Promise<ServerFnTestHarness<TFn>> {
  const opts = resolveHarnessOptions(serverFnOrOptions, metadata)
  const source = await resolveServerFnSource(opts)
  const root = source.root
  const id = source.id
  const serverFnBase = opts.serverFnBase ?? '/_serverFn/'
  const origin = opts.origin ?? 'http://test.local'
  const requestContext = opts.requestContext ?? {}
  const serverFnsById: ServerFnRecord = {}

  const clientCode = await compileClientCode({
    code: source.code,
    id,
    root,
    onServerFnsById: (next) => Object.assign(serverFnsById, next),
  })

  const providerCode = await compileProviderCode({
    code: source.code,
    id,
    root,
    serverFnsById,
  })

  const serverFnInfo = findServerFnInfo(serverFnsById, opts.exportName)
  const providerModule = evaluateCompiledModule(providerCode, [serverFnInfo.functionName])

  const getServerFnById = (functionId: string, _access: { origin: 'client' | 'server' }) => {
    if (functionId !== serverFnInfo.functionId) {
      throw new Error(`Unknown server function id: ${functionId}`)
    }

    return Promise.resolve(providerModule[serverFnInfo.functionName])
  }

  const fetch: CustomFetch = async (url, requestInit) => {
    const { getResponse, requestHandler } = await loadRequestResponseRuntime()
    const requestUrl = new URL(String(url), origin)
    const serverFnId = requestUrl.pathname.slice(serverFnBase.length).split('/')[0]

    if (!requestUrl.pathname.startsWith(serverFnBase) || !serverFnId) {
      throw new Error(`Invalid server function URL: ${requestUrl.href}`)
    }

    const request = new Request(requestUrl, requestInit)
    const handler = requestHandler(async (serverRequest) => {
      return runWithStartContext(
        {
          getRouter: () => Promise.resolve({} as any),
          request: serverRequest,
          startOptions: {},
          contextAfterGlobalMiddlewares: requestContext,
          executedRequestMiddlewares: new Set(),
          handlerType: 'serverFn',
        },
        () =>
          handleLocalServerAction({
            request: serverRequest,
            context: requestContext,
            serverFnId,
            getServerFnById,
            getResponse,
          }),
      )
    })

    return handler(request, { context: requestContext })
  }

  const previousServerFnBase = process.env.TSS_SERVER_FN_BASE
  process.env.TSS_SERVER_FN_BASE = serverFnBase
  try {
    const clientModule = evaluateCompiledModule(clientCode, [opts.exportName])
    const clientFn = clientModule[opts.exportName] as TFn | undefined

    if (typeof clientFn !== 'function') {
      throw new Error(`Compiled client export is not a function: ${opts.exportName}`)
    }

    return {
      functionId: serverFnInfo.functionId,
      fetch,
      call: ((firstArg?: any, ...rest: Array<any>) => {
        const callOptions =
          firstArg && typeof firstArg === 'object' ? { ...firstArg, fetch } : { fetch }

        return clientFn(callOptions, ...rest)
      }) as ServerFnTestHarness<TFn>['call'],
    }
  } finally {
    if (previousServerFnBase === undefined) {
      delete process.env.TSS_SERVER_FN_BASE
    } else {
      process.env.TSS_SERVER_FN_BASE = previousServerFnBase
    }
  }
}

function resolveHarnessOptions<TFn extends (...args: Array<any>) => any>(
  serverFnOrOptions: TFn | CreateServerFnTestHarnessOptions,
  metadata?: CreateServerFnTestHarnessOptions,
) {
  if (metadata) {
    return metadata
  }

  if (typeof serverFnOrOptions === 'function') {
    throw new Error(
      'createServerFnTestHarness(serverFn) requires the Vitest plugin. ' +
        'Add serverFnTestHarnessPlugin() to your Vitest config, or pass explicit metadata as the second argument.',
    )
  }

  return serverFnOrOptions
}

async function resolveServerFnSource(
  opts: CreateServerFnTestHarnessOptions,
): Promise<ResolvedServerFnSource> {
  if (typeof opts.code === 'string') {
    const root = opts.root ?? '/test'

    return {
      code: opts.code,
      id: opts.id ?? `${root}/src/server-functions.ts`,
      root,
    }
  }

  const modulePath = await resolveModulePath(opts.module)
  const root = opts.root ?? process.cwd()

  return {
    code: await readFile(modulePath, 'utf8'),
    id: modulePath,
    root,
  }
}

async function resolveModulePath(moduleId: string | URL) {
  const modulePath = moduleId instanceof URL ? fileURLToPath(moduleId) : path.resolve(moduleId)

  try {
    await access(modulePath)
    return modulePath
  } catch {
    // Try known source extensions below.
  }

  for (const extension of ['.ts', '.tsx', '.js', '.jsx', '.mjs']) {
    const candidate = `${modulePath}${extension}`
    try {
      await access(candidate)
      return candidate
    } catch {
      // Try the next extension.
    }
  }

  return modulePath
}

async function compileClientCode(opts: {
  code: string
  id: string
  root: string
  onServerFnsById: (serverFnsById: ServerFnRecord) => void
}) {
  const compiler = await createCompiler({
    env: 'client',
    root: opts.root,
    lookupKinds: new Set(['ServerFn', 'Middleware']),
    getKnownServerFns: () => ({}),
    onServerFnsById: opts.onServerFnsById,
  })

  const result = await compiler.compile({
    code: opts.code,
    id: opts.id,
  })

  if (!result) {
    throw new Error('No client server function transform was produced')
  }

  return result.code
}

async function compileProviderCode(opts: {
  code: string
  id: string
  root: string
  serverFnsById: ServerFnRecord
}) {
  const compiler = await createCompiler({
    env: 'server',
    root: opts.root,
    lookupKinds: new Set(['ServerFn']),
    getKnownServerFns: () => opts.serverFnsById,
  })

  const result = await compiler.compile({
    code: opts.code,
    id: `${opts.id}?${TSS_SERVERFN_SPLIT_PARAM}`,
  })

  if (!result) {
    throw new Error('No provider server function transform was produced')
  }

  return result.code
}

async function createCompiler(opts: {
  env: 'client' | 'server'
  root: string
  lookupKinds: Set<'ServerFn' | 'Middleware'>
  getKnownServerFns: () => ServerFnRecord
  onServerFnsById?: (serverFnsById: ServerFnRecord) => void
}) {
  const StartCompiler = await loadStartCompiler()

  return new StartCompiler({
    env: opts.env,
    envName: opts.env === 'client' ? 'client' : 'ssr',
    root: opts.root,
    framework: 'react',
    providerEnvName: 'ssr',
    mode: 'build',
    loadModule: async () => {},
    lookupKinds: opts.lookupKinds,
    lookupConfigurations: [
      {
        libName: '@tanstack/react-start',
        rootExport: 'createServerFn',
        kind: 'Root',
      },
      {
        libName: '@tanstack/react-start',
        rootExport: 'createMiddleware',
        kind: 'Root',
      },
    ],
    resolveId: (id: string) => Promise.resolve(id),
    getKnownServerFns: opts.getKnownServerFns,
    onServerFnsById: opts.onServerFnsById,
  })
}

function findServerFnInfo(serverFnsById: ServerFnRecord, exportName: string) {
  const functionName = `${exportName}_createServerFn_handler`
  const serverFnInfo = Object.values(serverFnsById).find((d) => d.functionName === functionName)

  if (!serverFnInfo) {
    throw new Error(`Server function export not found: ${exportName}`)
  }

  return serverFnInfo
}

function evaluateCompiledModule(code: string, exportNames: Array<string>) {
  const runtime = {
    createClientRpc,
    createMiddleware,
    createServerFn,
    createServerRpc,
  }
  const names = Object.keys(runtime)
  const values = Object.values(runtime)
  const transformed = transpileTypescript(code)
    .replace(/^\s*import\s+[^;]+;?\s*$/gm, '')
    .replace(/\bexport\s+const\s+/g, 'const ')
    .replace(/\bexport\s+\{[^}]*\};?/g, '')

  const returnStatement = `return { ${exportNames
    .map((name) => `${JSON.stringify(name)}: ${name}`)
    .join(', ')} }`

  return new Function(...names, `${transformed}\n${returnStatement}`)(...values) as ModuleExports
}

function transpileTypescript(code: string) {
  const result = babel.transformSync(code, {
    babelrc: false,
    configFile: false,
    filename: 'server-functions-test-harness.ts',
    parserOpts: {
      plugins: ['typescript'],
    },
    plugins: [stripTypescriptSyntaxPlugin],
  })

  return result?.code ?? code
}

function stripTypescriptSyntaxPlugin(): PluginObj {
  return {
    visitor: {
      TSTypeAnnotation(path) {
        path.remove()
      },
      TSTypeParameterDeclaration(path) {
        path.remove()
      },
      TSTypeParameterInstantiation(path) {
        path.remove()
      },
      TSInterfaceDeclaration(path) {
        path.remove()
      },
      TSTypeAliasDeclaration(path) {
        path.remove()
      },
      TSAsExpression(path) {
        path.replaceWith(path.node.expression)
      },
      TSSatisfiesExpression(path) {
        path.replaceWith(path.node.expression)
      },
      TSNonNullExpression(path) {
        path.replaceWith(path.node.expression)
      },
      ImportDeclaration(path) {
        if (path.node.importKind === 'type') {
          path.remove()
          return
        }

        path.node.specifiers = path.node.specifiers.filter(
          (specifier) => !('importKind' in specifier && specifier.importKind === 'type'),
        )
      },
      ExportNamedDeclaration(path) {
        if (path.node.exportKind === 'type') {
          path.remove()
        }
      },
    },
  }
}
