# tanstack-start-testing-library

> Warning: this is a highly experimental package. It depends on TanStack Start
> private compiler/runtime APIs and can break on TanStack Start upgrades.

Test TanStack Start `createServerFn` functions end to end from Vitest without
starting an HTTP server. The harness exercises middleware, validation, request
parsing, serialization, and the handler through an in-memory `fetch`.

## Setup

```ts
// vitest.config.ts
import { defineConfig } from 'vitest/config'
import { serverFnTestHarnessPlugin } from 'tanstack-start-testing-library/vitest'

export default defineConfig({
  plugins: [serverFnTestHarnessPlugin()],
  test: {
    environment: 'node',
  },
})
```

## Usage

```ts
import { expect, test } from 'vitest'
import { createServerFnTestHarness } from 'tanstack-start-testing-library'
import { greet } from './server-functions'

test('greet', async () => {
  const harness = await createServerFnTestHarness(greet)

  await expect(harness.call({ data: { name: 'tanner' } })).resolves.toEqual({
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
