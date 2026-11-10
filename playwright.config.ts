import { defineConfig, devices } from '@playwright/test'
import { appLanguage, ports } from './languages/app-language.ts'

/** English Reader or Polish Reader (specs/014-shared-core): the build, its port and the language of the test data. */
const language = appLanguage()
const port = ports[language].e2e

export default defineConfig({
  testDir: 'tests/e2e',
  tsconfig: language === 'pl' ? './tsconfig.pl.json' : './tsconfig.json',
  timeout: 60_000,
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list']],
  use: {
    ...devices['iPad Pro 11'],
    baseURL: `http://localhost:${port}`,
    locale: 'uk-UA',
    trace: 'retain-on-failure',
  },
  projects: [
    { name: 'webkit-ipad', use: { browserName: 'webkit' }, testIgnore: /offline\.spec/ },
    { name: 'chromium-offline', use: { browserName: 'chromium', serviceWorkers: 'allow' }, testMatch: /offline\.spec/ },
  ],
  webServer: {
    command: `npx vite build --mode test --outDir dist-test/${language} && npx vite preview --outDir dist-test/${language} --port ${port} --strictPort`,
    url: `http://localhost:${port}`,
    env: { APP_LANG: language },
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
})
