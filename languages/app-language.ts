// Which app a command builds or tests (specs/014-shared-core): `APP_LANG=en` (English Reader, default) or `APP_LANG=pl`
// (Polish Reader). Used by vite.config.ts, vitest.config.ts and playwright.config.ts.
import { readFileSync } from 'node:fs'

export type AppLanguage = 'en' | 'pl'

export function appLanguage(): AppLanguage {
  const value = process.env.APP_LANG ?? 'en'
  if (value !== 'en' && value !== 'pl') throw new Error(`APP_LANG must be en or pl, not «${value}»`)
  return value
}

/** Ports of each app, so both can run side by side (the same ports as before the merge). */
export const ports: Record<AppLanguage, { dev: number; preview: number; e2e: number }> = {
  en: { dev: 5173, preview: 4173, e2e: 4174 },
  pl: { dev: 5174, preview: 4177, e2e: 4176 },
}

/** The app name from the language's manifest: the title of index.html. */
export function appTitle(language: AppLanguage): string {
  const url = new URL(`./${language}/public/manifest.webmanifest`, import.meta.url)
  return (JSON.parse(readFileSync(url, 'utf8')) as { name: string }).name
}
