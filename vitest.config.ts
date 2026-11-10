import { defineConfig } from 'vitest/config'
import { fileURLToPath } from 'node:url'
import preact from '@preact/preset-vite'
import { appLanguage } from './languages/app-language.ts'

const language = appLanguage()
const path = (relative: string) => fileURLToPath(new URL(relative, import.meta.url))

export default defineConfig({
  plugins: [preact()],
  define: { __TEST_MODE__: 'true', __APP_VERSION__: JSON.stringify('27.10.2026 13:05 · test') },
  resolve: {
    alias: {
      '#language': path(`./src/languages/${language}.ts`),
      '#test-language': path(`./tests/languages/${language}/fixtures.ts`),
    },
  },
  test: {
    environment: 'happy-dom',
    setupFiles: ['tests/setup.ts'],
    include: [
      'tests/unit/**/*.test.{ts,tsx}', `tests/languages/${language}/*.test.ts`,
      ...(process.env.LIVE ? ['tests/live/**/*.test.ts', `tests/languages/${language}/*.live.test.ts`] : []),
      ...(process.env.GOLDEN && language === 'en' ? ['tests/golden/**/*.test.ts'] : []),
    ],
    exclude: process.env.LIVE ? [] : ['**/*.live.test.ts', '**/node_modules/**'],
    coverage: { include: ['src/core/**'], reporter: ['text-summary'] },
  },
})
