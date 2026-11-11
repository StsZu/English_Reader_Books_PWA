// Prepared book: real failures injected into IndexedDB opening (specs/013-prepared-book, S9) — a transient error must not
// leave the sentence-time or audio database broken for the rest of the session, and a failed import must leave nothing.
import { File as NodeFile } from 'node:buffer'
import { createHash } from 'node:crypto'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const failing = new Set<string>()
vi.mock('idb', async (original) => {
  const actual = await original<typeof import('idb')>()
  return {
    ...actual,
    openDB: (...args: Parameters<typeof actual.openDB>) => {
      if (failing.has(args[0])) {
        failing.delete(args[0])
        return Promise.reject(new DOMException('injected transient failure', 'UnknownError'))
      }
      return actual.openDB(...args)
    },
  }
})

const { closeAudioDB, listTracks, loadSync, saveSync } = await import('../../src/core/audiobook/store.ts')
const { DB_NAME } = await import('../../src/core/storage/db.ts')

const drop = (name: string) => new Promise<void>((resolve, reject) => {
  const request = indexedDB.deleteDatabase(name)
  request.onsuccess = () => resolve()
  request.onerror = () => reject(request.error)
})

beforeEach(async () => {
  failing.clear()
  await closeAudioDB()
})

describe('a transient failure while opening a database', () => {
  it('of the sentence-time database: the next call opens it and finds the data', async () => {
    await saveSync('book-1', { '0-0': [['t', 1, 2]] })
    await closeAudioDB()
    failing.add(`${DB_NAME}-sync`)
    await expect(loadSync('book-1')).rejects.toThrow('injected transient failure')
    expect(await loadSync('book-1')).toEqual({ '0-0': [['t', 1, 2]] })
  })

  it('of the audio database during the copy of 013 sentence times: the next call copies them, version 2 stays', async () => {
    await closeAudioDB()
    await drop(`${DB_NAME}-sync`)
    await drop(`${DB_NAME}-audio`)
    const { openDB } = await import('idb')
    const old = await openDB(`${DB_NAME}-audio`, 2, {
      upgrade(database) {
        for (const store of ['tracks', 'files', 'positions', 'sync']) database.createObjectStore(store)
      },
    })
    await old.put('tracks', [{ id: 't', name: 'a.mp3', size: 1, type: 'audio/mpeg', duration: null }], 'book-2')
    await old.put('sync', { '0-0': [['t', 1, 2]] }, 'book-2')
    old.close()
    failing.add(`${DB_NAME}-audio`)
    await expect(loadSync('book-2')).rejects.toThrow('injected transient failure')
    expect(await loadSync('book-2')).toEqual({ '0-0': [['t', 1, 2]] })
    expect((await listTracks('book-2')).map((t) => t.name)).toEqual(['a.mp3'])
    await closeAudioDB()
    const audio = await openDB(`${DB_NAME}-audio`)
    expect(audio.version).toBe(2)
    audio.close()
  })
})

describe('a real failure in the middle of an import', () => {
  it('removes what was already written, leaves the library as it was, and the next import works', async () => {
    const { importPrepared } = await import('../../src/core/prepared/import.ts')
    const { books, resetAll } = await import('../../src/core/storage/library.ts')
    const { TranslationStore } = await import('../../src/core/ai/translation.ts')
    const { editionHash, PACKAGE_FORMAT, PACKAGE_VERSION } = await import('../../src/core/prepared/package.ts')
    const { sourceLanguage } = await import('../../src/core/language.ts')
    await resetAll()
    const audio = new Uint8Array([1, 2, 3])
    const chapters = [{ title: 'A', paragraphs: [{ kind: 'text' as const, sentences: ['A.', 'B.'] }] }]
    const pkg = {
      format: PACKAGE_FORMAT, version: PACKAGE_VERSION, packageId: 'p', edition: await editionHash(chapters),
      language: sourceLanguage, translationLanguage: 'uk', book: { title: 'T', author: 'A', format: 'txt', chapters },
      translations: { '0-0': ['А.', 'Б.'] },
      tracks: [{ id: 'x', name: '01.mp3', size: audio.length, sha256: createHash('sha256').update(audio).digest('hex') }],
      sync: { '0-0': [['x', 0, 1], ['x', 1, 2]] },
    }
    const files = () => [
      new NodeFile([JSON.stringify(pkg)], 'p.reader.json', { type: 'application/json' }) as unknown as File,
      new NodeFile([audio], '01.mp3', { type: 'audio/mpeg' }) as unknown as File,
    ]
    // The tracks are written, then the sentence-time database fails to open.
    await closeAudioDB()
    failing.add(`${DB_NAME}-sync`)
    await expect(importPrepared(files())).rejects.toThrow('injected transient failure')
    expect(books.value).toEqual([])
    const { audioBookIDs } = await import('../../src/core/audiobook/store.ts')
    expect(await audioBookIDs()).toEqual([])
    const { db } = await import('../../src/core/storage/db.ts')
    expect(await (await db()).getAllKeys('translations')).toEqual([])
    const result = await importPrepared(files())
    expect(books.value.map((b) => b.id)).toEqual([result.summary.id])
    expect(await new TranslationStore(result.summary.id).translationForKey('0-0')).toEqual(['А.', 'Б.'])
    expect(await loadSync(result.summary.id)).not.toBeNull()
  })
})
