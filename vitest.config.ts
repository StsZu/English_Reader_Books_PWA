import { defineConfig } from 'vitest/config'
import preact from '@preact/preset-vite'

export default defineConfig({
  plugins: [preact()],
  define: { __TEST_MODE__: 'true', __APP_VERSION__: JSON.stringify('27.10.2026 13:05 · test') },
  test: {
    environment: 'happy-dom',
    setupFiles: ['tests/setup.ts'],
    include: ['tests/unit/**/*.test.{ts,tsx}', ...(process.env.LIVE ? ['tests/live/**/*.test.ts'] : []), ...(process.env.GOLDEN ? ['tests/golden/**/*.test.ts'] : [])],
    coverage: { include: ['src/core/**'], reporter: ['text-summary'] },
  },
})
