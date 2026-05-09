import { describe, expect, test } from 'vitest'
import { createServerFnTestHarness } from '../src'
import { greet } from './fixtures/greet.functions'

describe('createServerFnTestHarness', () => {
  test('runs a server function through middleware, validator, and handler with explicit metadata', async () => {
    const harness = await createServerFnTestHarness<typeof greet>({
      module: new URL('./fixtures/greet.functions.ts', import.meta.url),
      exportName: 'greet',
    })

    await expect(
      harness.call({ data: { name: 'tanner' } }),
    ).resolves.toEqual({
      message: 'TANNER:client-value:server-value',
    })
  })

  test('runs a server function from a reference when the Vitest plugin injects metadata', async () => {
    const harness = await createServerFnTestHarness(greet)

    await expect(
      harness.call({ data: { name: 'tanner' } }),
    ).resolves.toEqual({
      message: 'TANNER:client-value:server-value',
    })
  })
})
