import { describe, expect, test } from 'vitest'
import { serverFnTestHarnessPlugin } from '../src/vitest'

describe('serverFnTestHarnessPlugin', () => {
  test('injects module and export metadata for imported server function references', async () => {
    const plugin = serverFnTestHarnessPlugin({
      importSources: ['../src'],
    })

    const transform =
      typeof plugin.transform === 'function'
        ? plugin.transform
        : plugin.transform?.handler

    const result = await transform?.call(
      {} as never,
      `
        import { createServerFnTestHarness } from '../src'
        import { greet as greetFn } from './fixtures/greet.functions'

        const harness = await createServerFnTestHarness(greetFn)
      `,
      '/repo/tests/example.test.ts',
    )

    expect(result).toBeTruthy()
    const transformedCode =
      result && typeof result === 'object' ? result.code : result

    expect(transformedCode).toContain(
      'module: new URL("./fixtures/greet.functions", import.meta.url)',
    )
    expect(transformedCode).toContain('exportName: "greet"')
  })
})
