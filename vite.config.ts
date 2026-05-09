import { tanstackViteConfig } from '@tanstack/vite-config'
import { defineConfig, mergeConfig } from 'vitest/config'
import packageJson from './package.json'
import { serverFnTestHarnessPlugin } from './src/vitest'

const config = defineConfig({
  plugins: [
    serverFnTestHarnessPlugin({
      importSources: ['../src', '../src/index', '../src/server-functions'],
    }),
  ],
  test: {
    name: packageJson.name,
    dir: './tests',
    watch: false,
    environment: 'node',
    typecheck: { enabled: true },
  },
})

export default mergeConfig(
  config,
  tanstackViteConfig({
    entry: ['./src/index.ts', './src/vitest.ts'],
    srcDir: './src',
    tsconfigPath: './tsconfig.build.json',
    cjs: false,
  }),
)
