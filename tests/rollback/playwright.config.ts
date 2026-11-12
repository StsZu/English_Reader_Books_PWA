// R031 only (specs/015-reader-book-container): a rollback check run by tests/rollback/run.sh, never by `npm run test:e2e`.
import { defineConfig } from '@playwright/test'

const language = process.env.APP_LANG === 'pl' ? 'pl' : 'en'

export default defineConfig({
  testDir: '.',
  tsconfig: language === 'pl' ? '../../tsconfig.pl.json' : '../../tsconfig.json',
  timeout: 180_000,
  workers: 1,
  retries: 0,
  reporter: [['list']],
  outputDir: process.env.R031_OUT ?? '../../build/r031-out',
})
