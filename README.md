# tanstack-start-testing-library

Experimental test harness for TanStack Start server functions.

This package intentionally depends on TanStack Start private compiler/runtime
contracts. Keep supported TanStack versions narrow and run the package tests
when upgrading TanStack Start.

## Vitest Setup

```ts
import { defineConfig } from 'vitest/config'
import { serverFnTestHarnessPlugin } from 'tanstack-start-testing-library/vitest'

export default defineConfig({
  plugins: [serverFnTestHarnessPlugin()],
  test: {
    environment: 'node',
  },
})
```

## Reference-Based Usage

```ts
import { expect, test } from 'vitest'
import { createServerFnTestHarness } from 'tanstack-start-testing-library'
import { greet } from './server-functions'

test('greet', async () => {
  const harness = await createServerFnTestHarness(greet)

  await expect(
    harness.call({ data: { name: 'tanner' } }),
  ).resolves.toEqual({
    message: 'TANNER',
  })
})
```

The Vitest plugin rewrites the function-reference call with source metadata.
Without the plugin, pass explicit metadata:

```ts
const harness = await createServerFnTestHarness(greet, {
  module: new URL('./server-functions.ts', import.meta.url),
  exportName: 'greet',
})
```

The harness compiles the server function for the client and server provider
paths, then calls it through an in-memory `fetch` implementation that exercises
middleware, validation, request parsing, serialization, and the handler.
