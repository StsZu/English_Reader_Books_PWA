// Imports and the start cleanup across tabs (specs/015-reader-book-container, R021): a tab that starts during an
// import waits for it; an import stopped at any phase leaves nothing after the next start; other books are untouched.
import { createHash } from 'node:crypto'
import { File as NodeFile } from 'node:buffer'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { Chapter } from '../../src/core/model/book.ts'
import { editionHash, PACKAGE_FORMAT, PACKAGE_VERSION, type ReaderPackage } from '../../src/core/prepared/package.ts'
import { importPrepared } from '../../src/core/prepared/import.ts'
import { cleanupAtStart, setLocksForTests } from '../../src/core/prepared/coordination.ts'
import { journalEntries, listTracks, loadSync, trackFile } from '../../src/core/audiobook/store.ts'
import { addBook, resetAll, storedBookIDs } from '../../src/core/storage/library.ts'
import { TranslationStore } from '../../src/core/ai/translation.ts'
import { sourceLanguage } from '../../src/core/language.ts'
import { preparedText } from '../fixtures/language.ts'
import { makeLocks } from '../fixtures/locks.ts'

const chapters: Chapter[] = [{ title: preparedText.heading, paragraphs: [
  { kind: 'heading', sentences: [preparedText.heading] }, { kind: 'text', sentences: [...preparedText.sentences] },
] }]
const audio = new Uint8Array([1, 2, 3, 4, 5])
const file = (name: string, bytes: Uint8Array | string) => new NodeFile([bytes], name) as unknown as File

async function files() {
  const pkg: ReaderPackage = {
    format: PACKAGE_FORMAT, version: PACKAGE_VERSION, packageId: 'p', edition: await editionHash(chapters),
    language: sourceLanguage, translationLanguage: 'uk', book: { title: 'T', author: 'A', format: 'txt', chapters },
    translations: { '0-0': ['Один'], '0-1': ['Перше.', 'Друге.'] },
    tracks: [{ id: 'a', name: '01.mp3', size: 5, sha256: createHash('sha256').update(audio).digest('hex') }],
    sync: { '0-0': [null], '0-1': [['a', 1, 2], ['a', 2, 3]] },
  }
  return [file('b.reader.json', JSON.stringify(pkg)), file('01.mp3', audio)]
}

beforeEach(async () => {
  setLocksForTests(makeLocks())
  await resetAll()
})
afterEach(() => setLocksForTests(undefined))

describe('prepared import across tabs (R021)', () => {
  for (const stop of ['checked', 'tracks', 'sync', 'translations']) {
    it(`a start in another tab during the phase «${stop}» waits; the import ends whole`, async () => {
      let resume!: () => void
      const paused = new Promise<void>((r) => { resume = r })
      let reached!: (id: string) => void
      const atPhase = new Promise<string>((r) => { reached = r })
      const running = importPrepared(await files(), new Date(), {
        afterPhase: async (phase, id) => { if (phase === stop) { reached(id); await paused } },
      })
      const bookId = await atPhase
      let cleaned = false
      const other = cleanupAtStart().then(() => { cleaned = true })
      await new Promise((r) => setTimeout(r, 20))
      expect(cleaned).toBe(false)                                     // the other tab waits for the lock
      resume()
      const result = await running
      await other
      expect(result.summary.id).toBe(bookId)
      const tracks = await listTracks(bookId)
      expect(tracks).toHaveLength(1)
      expect(await trackFile(tracks[0].id)).not.toBeNull()
      expect(await loadSync(bookId)).not.toBeNull()
      expect(await new TranslationStore(bookId).translationForKey('0-1')).toEqual(['Перше.', 'Друге.'])
      expect(await journalEntries()).toEqual([])
    })
  }

  for (const stop of ['checked', 'tracks', 'sync', 'translations']) {
    it(`a failure at «${stop}» removes what the import wrote; other books stay`, async () => {
      const keep = await addBook({ id: 'keep', title: 'Keep', author: '', format: 'txt', importedAt: new Date().toISOString(), chapters })
      let bookId = ''
      await expect(importPrepared(await files(), new Date(), {
        afterPhase: async (phase, id) => { bookId = id; if (phase === stop) throw new Error('write failed') },
      })).rejects.toThrow('write failed')
      expect(await storedBookIDs()).toEqual([keep.id])
      expect(await listTracks(bookId)).toEqual([])
      expect(await loadSync(bookId)).toBeNull()
      expect(await journalEntries()).toEqual([])
    })

    it(`a tab closed at «${stop}» (the import never ends) leaves nothing after the next start; other books stay`, async () => {
      const keep = await addBook({ id: 'keep', title: 'Keep', author: '', format: 'txt', importedAt: new Date().toISOString(), chapters })
      let reached!: (id: string) => void
      const atPhase = new Promise<string>((r) => { reached = r })
      void importPrepared(await files(), new Date(), {
        afterPhase: async (phase, id) => { if (phase === stop) { reached(id); await new Promise(() => {}) } },
      })
      const bookId = await atPhase
      expect((await journalEntries()).map((e) => [e.bookId, e.phase])).toEqual([[bookId, stop]])
      setLocksForTests(makeLocks())                                 // the closed tab released its lock
      await cleanupAtStart()
      expect(await listTracks(bookId)).toEqual([])
      expect(await loadSync(bookId)).toBeNull()
      expect(await new TranslationStore(bookId).translationForKey('0-1')).toBeUndefined()
      expect(await journalEntries()).toEqual([])
      expect(await storedBookIDs()).toEqual([keep.id])
    })
  }

  it('without Web Locks the import is refused before anything is written', async () => {
    setLocksForTests(null)
    await expect(importPrepared(await files())).rejects.toThrow('Web Locks')
    expect(await storedBookIDs()).toEqual([])
  })
})
