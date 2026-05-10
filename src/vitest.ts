import babel from '@babel/core'
import type { PluginObj } from '@babel/core'
import type { Plugin } from 'vite'

export interface ServerFnTestHarnessPluginOptions {
  importSources?: Array<string>
}

const defaultImportSources = [
  'tanstack-start-testing-library',
  'tanstack-start-testing-library/server-functions',
]

export function serverFnTestHarnessPlugin(opts: ServerFnTestHarnessPluginOptions = {}): Plugin {
  const importSources = new Set([...defaultImportSources, ...(opts.importSources ?? [])])

  return {
    name: 'tanstack-start-testing-library:server-fn-harness',
    enforce: 'pre',
    transform(code, id) {
      if (!/\.[cm]?[jt]sx?$/.test(id)) {
        return null
      }

      if (!code.includes('createServerFnTestHarness')) {
        return null
      }

      const result = babel.transformSync(code, {
        babelrc: false,
        configFile: false,
        filename: id,
        parserOpts: {
          plugins: ['typescript', 'jsx'],
          sourceType: 'module',
        },
        plugins: [createTransformPlugin(importSources)],
        sourceMaps: true,
      })

      if (!result?.code || result.code === code) {
        return null
      }

      return {
        code: result.code,
        map: result.map,
      }
    },
  }
}

function createTransformPlugin(importSources: Set<string>): PluginObj {
  return {
    visitor: {
      Program(programPath) {
        const harnessBindings = new Set<string>()
        const importedServerFns = new Map<
          string,
          {
            exportName: string
            source: string
          }
        >()

        for (const statement of programPath.get('body')) {
          if (!statement.isImportDeclaration()) {
            continue
          }

          const source = statement.node.source.value
          for (const specifier of statement.get('specifiers')) {
            if (!specifier.isImportSpecifier()) {
              continue
            }

            const imported = specifier.node.imported
            const importedName = imported.type === 'Identifier' ? imported.name : imported.value
            const localName = specifier.node.local.name

            if (importedName === 'createServerFnTestHarness' && importSources.has(source)) {
              harnessBindings.add(localName)
              continue
            }

            importedServerFns.set(localName, {
              exportName: importedName,
              source,
            })
          }
        }

        if (!harnessBindings.size) {
          return
        }

        programPath.traverse({
          CallExpression(callPath) {
            const callee = callPath.node.callee

            if (
              callee.type !== 'Identifier' ||
              !harnessBindings.has(callee.name) ||
              callPath.node.arguments.length !== 1
            ) {
              return
            }

            const [firstArg] = callPath.node.arguments
            if (firstArg?.type !== 'Identifier') {
              return
            }

            const serverFnImport = importedServerFns.get(firstArg.name)
            if (!serverFnImport) {
              return
            }

            callPath.node.arguments.push({
              type: 'ObjectExpression',
              properties: [
                {
                  type: 'ObjectProperty',
                  key: {
                    type: 'Identifier',
                    name: 'module',
                  },
                  value: {
                    type: 'NewExpression',
                    callee: {
                      type: 'Identifier',
                      name: 'URL',
                    },
                    arguments: [
                      {
                        type: 'StringLiteral',
                        value: serverFnImport.source,
                      },
                      {
                        type: 'MemberExpression',
                        object: {
                          type: 'MetaProperty',
                          meta: {
                            type: 'Identifier',
                            name: 'import',
                          },
                          property: {
                            type: 'Identifier',
                            name: 'meta',
                          },
                        },
                        property: {
                          type: 'Identifier',
                          name: 'url',
                        },
                        computed: false,
                      },
                    ],
                  },
                  computed: false,
                  shorthand: false,
                },
                {
                  type: 'ObjectProperty',
                  key: {
                    type: 'Identifier',
                    name: 'exportName',
                  },
                  value: {
                    type: 'StringLiteral',
                    value: serverFnImport.exportName,
                  },
                  computed: false,
                  shorthand: false,
                },
              ],
            })
          },
        })
      },
    },
  }
}
