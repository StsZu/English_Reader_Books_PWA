import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 60_000,
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list']],
  use: {
    ...devices['iPad Pro 11'],
    baseURL: 'http://localhost:4174',
    locale: 'uk-UA',
    trace: 'retain-on-failure',
  },
  projects: [
    { name: 'webkit-ipad', use: { browserName: 'webkit' }, testIgnore: /offline\.spec/ },
    { name: 'chromium-offline', use: { browserName: 'chromium', serviceWorkers: 'allow' }, testMatch: /offline\.spec/ },
  ],
  webServer: {
    command: 'npx vite build --mode test && npx vite preview --outDir dist-test --port 4174 --strictPort',
    url: 'http://localhost:4174',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
})
