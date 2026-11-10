// What must stay the same for the reader after the merge of English Reader and Polish Reader (specs/014-shared-core, S6):
// the names of the databases and settings, the app name and the installed PWA. Runs for each language (APP_LANG).
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { appName, databaseName, settingsPrefix, sourceLanguage } from '../../src/core/language.ts'

/** The values before the merge (English_Reader_Books_PWA and Polish_Reader_Books_PWA, 2026-11-10). */
const before = {
  en: { appName: 'English Reader', databaseName: 'english-reader', settingsPrefix: 'er.' },
  pl: { appName: 'Polish Reader', databaseName: 'polish-reader', settingsPrefix: 'pr.' },
} as const

describe(`app identity (${sourceLanguage})`, () => {
  const expected = before[sourceLanguage as keyof typeof before]

  it('is one of the two apps and matches the build language', () => {
    expect(expected).toBeDefined()
    expect(sourceLanguage).toBe(process.env.APP_LANG ?? 'en')
  })

  it('keeps the names of the storage and the settings', () => {
    expect({ appName, databaseName, settingsPrefix }).toEqual(expected)
  })

  it('keeps the installed PWA: name, start and scope of the manifest', () => {
    const manifest = JSON.parse(readFileSync(`languages/${sourceLanguage}/public/manifest.webmanifest`, 'utf8')) as Record<string, unknown>
    expect(manifest).toMatchObject({ name: expected.appName, short_name: expected.appName, start_url: './', scope: './' })
  })
})
