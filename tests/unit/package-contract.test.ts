// The shape of `sync` and `translations` and the keys of both, checked before anything is written
// (specs/015-reader-book-container, review 2026-11-11: a package without `sync`, or with a non-canonical key,
// passed validatePackage and made importPrepared write audio and then fail).
import { createHash } from 'node:crypto'
import { File as NodeFile } from 'node:buffer'
import { beforeEach, describe, expect, it } from 'vitest'
import { openDB } from 'idb'
import type { Chapter } from '../../src/core/model/book.ts'
import { editionHash, PACKAGE_FORMAT, PACKAGE_VERSION, validatePackage } from '../../src/core/prepared/package.ts'
import { importPrepared } from '../../src/core/prepared/import.ts'
import { closeAudioDB, journalEntries } from '../../src/core/audiobook/store.ts'
import { DB_NAME } from '../../src/core/storage/db.ts'
import { resetAll, storedBookIDs } from '../../src/core/storage/library.ts'
import { sourceLanguage } from '../../src/core/language.ts'
import { preparedText } from '../fixtures/language.ts'

const chapters: Chapter[] = [{ title: preparedText.heading, paragraphs: [
  { kind: 'heading', sentences: [preparedText.heading] }, { kind: 'text', sentences: [...preparedText.sentences] },
] }]
const audio = new Uint8Array([1, 2, 3])

async function pkg(over: Record<string, unknown> = {}) {
  return {
    format: PACKAGE_FORMAT, version: PACKAGE_VERSION, packageId: 'p', edition: await editionHash(chapters),
    language: sourceLanguage, translationLanguage: 'uk', book: { title: 'T', author: 'A', format: 'txt', chapters },
    translations: { '0-0': ['Один'], '0-1': ['Перше.', 'Друге.'] },
    tracks: [{ id: 'a', name: '01.mp3', size: 3, sha256: createHash('sha256').update(audio).digest('hex') }],
    sync: { '0-0': [null], '0-1': [['a', 1, 2], ['a', 2, 3]] },
    ...over,
  }
}

async function audioTracks(): Promise<number> {
  await closeAudioDB()
  const database = await openDB(`${DB_NAME}-audio`)
  const count = database.objectStoreNames.contains('tracks') ? await database.count('tracks') : 0
  database.close()
  return count
}

beforeEach(async () => {
  await resetAll()
})

describe('package contract: sync and translations', () => {
  it('a whole package and an untimed one (sync: {}) are valid', async () => {
    expect(await validatePackage(await pkg())).toEqual([])
    expect(await validatePackage(await pkg({ sync: {} }))).toEqual([])
  })

  for (const [name, over, message] of [
    ['sync missing', { sync: undefined }, /поле sync/],
    ['sync null', { sync: null }, /поле sync/],
    ['sync a list', { sync: [] }, /поле sync/],
    ['translations missing', { translations: undefined }, /поле translations/],
    ['a sync key with an extra part', { sync: { '0-0': [null], '0-0-extra': [['nonexistent-track', -1, -2]] } }, /0-0-extra/],
    ['a key with a leading zero', { sync: { '00-1': [['a', 1, 2], ['a', 2, 3]] } }, /00-1/],
    ['a translation key with an extra part', { translations: { '0-0': ['Один'], '0-1': ['Перше.', 'Друге.'], '0-1-x': ['?'] } }, /0-1-x/],
    ['a key of a paragraph that is not there', { sync: { '0-5': [null] } }, /0-5/],
  ] as Array<[string, Record<string, unknown>, RegExp]>) {
    it(`refused: ${name}`, async () => {
      const value = await pkg(over)
      for (const [k, v] of Object.entries(over)) if (v === undefined) delete (value as Record<string, unknown>)[k]
      const problems = await validatePackage(value)
      expect(problems.join(' ')).toMatch(message)
    })
  }

  it('the import refuses such a package before writing anything', async () => {
    const bad = await pkg({ sync: { '0-0': [null], '0-0-extra': [['nonexistent-track', -1, -2]] } })
    const files = [new NodeFile([JSON.stringify(bad)], 'b.reader.json') as unknown as File, new NodeFile([audio], '01.mp3') as unknown as File]
    await expect(importPrepared(files)).rejects.toThrow(/0-0-extra/)
    const missing = await pkg()
    delete (missing as Record<string, unknown>).sync
    await expect(importPrepared([new NodeFile([JSON.stringify(missing)], 'm.reader.json') as unknown as File, files[1]])).rejects.toThrow(/поле sync/)
    expect(await storedBookIDs()).toEqual([])
    expect(await journalEntries()).toEqual([])
    expect(await audioTracks()).toBe(0)
  })
})
