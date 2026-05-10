import { createRequire } from 'node:module'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

export type ServerFnInfo = {
  functionName: string
  functionId: string
}

type StartCompilerConstructor = new (opts: any) => {
  compile: (opts: { code: string; id: string }) => Promise<
    | {
        code: string
      }
    | undefined
  >
}

type RequestResponseRuntime = {
  getResponse: () => Response
  requestHandler: (
    handler: (request: Request, requestOpts: any) => Promise<Response>,
  ) => (request: Request, requestOpts: any) => Promise<Response> | Response
}

let startCompilerPromise: Promise<StartCompilerConstructor> | undefined
let requestResponseRuntimePromise: Promise<RequestResponseRuntime> | undefined

export async function loadStartCompiler(): Promise<StartCompilerConstructor> {
  startCompilerPromise ??= importPrivateModule<{
    StartCompiler: StartCompilerConstructor
  }>('@tanstack/start-plugin-core', 'dist/esm/start-compiler/compiler.js').then(
    (mod) => mod.StartCompiler,
  )

  return startCompilerPromise
}

export async function loadRequestResponseRuntime() {
  requestResponseRuntimePromise ??= importPrivateModule<RequestResponseRuntime>(
    '@tanstack/start-server-core',
    'dist/esm/request-response.js',
  )

  return requestResponseRuntimePromise
}

async function importPrivateModule<T>(packageName: string, relativePath: string): Promise<T> {
  const require = createRequire(import.meta.url)
  const packageJsonPath = require.resolve(`${packageName}/package.json`)
  const packageRoot = path.dirname(packageJsonPath)
  const modulePath = path.join(packageRoot, relativePath)

  return import(pathToFileURL(modulePath).href) as Promise<T>
}
