// Import of a one-file prepared book (specs/015-reader-book-container, R023): the same result as the folder import,
// nothing written when the container, the package or its language is wrong. Synthetic archives only.
import { createHash } from 'node:crypto'
import { File as NodeFile } from 'node:buffer'
import { beforeEach, describe, expect, it } from 'vitest'
import type { Chapter } from '../../src/core/model/book.ts'
import { editionHash, PACKAGE_FORMAT, PACKAGE_VERSION } from '../../src/core/prepared/package.ts'
import { importContainer, importPreparedSelection } from '../../src/core/prepared/import.ts'
import { CONTAINER_MIMETYPE } from '../../src/core/prepared/container.ts'
import { listTracks, loadSync, trackFile } from '../../src/core/audiobook/store.ts'
import { loadBook, resetAll, storedBookIDs } from '../../src/core/storage/library.ts'
import { TranslationStore } from '../../src/core/ai/translation.ts'
import { sourceLanguage } from '../../src/core/language.ts'
import { preparedText } from '../fixtures/language.ts'
import { zipArchive } from '../fixtures/zip-writer.ts'

// The global File of happy-dom does not take node Blob parts; the import builds Files from slices of the chosen one.
globalThis.File = NodeFile as unknown as typeof File

const language: string = sourceLanguage
const chapters: Chapter[] = [{ title: preparedText.heading, paragraphs: [
  { kind: 'heading', sentences: [preparedText.heading] }, { kind: 'text', sentences: [...preparedText.sentences] },
] }]
const mp3 = new Uint8Array([3, 1, 4, 1, 5, 9, 2, 6])
const sha = (b: Uint8Array) => createHash('sha256').update(b).digest('hex')

async function container(over: { language?: string; audio?: Uint8Array } = {}) {
  const pkg = {
    format: PACKAGE_FORMAT, version: PACKAGE_VERSION, packageId: 'c', edition: await editionHash(chapters),
    language: over.language ?? language, translationLanguage: 'uk',
    book: { title: 'Container book', author: 'A', format: 'txt', chapters },
    translations: { '0-0': ['Один'], '0-1': ['Перше.', 'Друге.'] },
    tracks: [{ id: 'a', name: '01.mp3', size: mp3.length, sha256: sha(mp3) }],
    sync: { '0-0': [null], '0-1': [['a', 1, 2], ['a', 2, 3]] },
    source: { title: 'Synthetic', contentRights: { basis: 'own', confirmed: true }, acquisition: { method: 'user-file', confirmed: true } },
  }
  const meta = JSON.stringify({ format: 'reader-book-container', version: 1, package: 'book.reader.json',
    audio: [{ path: 'audio/01.mp3', size: mp3.length, sha256: sha(mp3) }] })
  return zipArchive([['mimetype', CONTAINER_MIMETYPE, false], ['container.json', meta, true],
    ['book.reader.json', JSON.stringify(pkg), true], ['audio/01.mp3', over.audio ?? mp3, false]])
}
const file = (name: string, bytes: Uint8Array) => new NodeFile([bytes], name) as unknown as File

beforeEach(async () => {
  await resetAll()
})

describe(`one-file prepared book (${sourceLanguage})`, () => {
  for (const name of ['book.polenuk', 'book.zip']) {
    it(`${name} becomes a book with its translation, audio and time`, async () => {
      const result = await importPreparedSelection([file(name, await container())])
      const id = result.summary.id
      expect(result).toMatchObject({ sentences: 3, untimed: 1 })
      expect((await loadBook(id))?.title).toBe('Container book')
      const tracks = await listTracks(id)
      expect(tracks.map((t) => t.name)).toEqual(['01.mp3'])
      const stored = await trackFile(tracks[0].id)
      expect(new Uint8Array(await stored!.arrayBuffer())).toEqual(mp3)
      expect((await loadSync(id))?.['0-1']).toEqual([[tracks[0].id, 1, 2], [tracks[0].id, 2, 3]])
      expect(await new TranslationStore(id).translationForKey('0-1')).toEqual(['Перше.', 'Друге.'])
    })
  }

  it('a container of the other language is refused and the library stays as it was', async () => {
    const other = language === 'en' ? 'pl' : 'en'
    await expect(importContainer(file('other.polenuk', await container({ language: other })))).rejects.toThrow(/Книжку не імпортовано.*підготовлено для мови/)
    expect(await storedBookIDs()).toEqual([])
  })

  it('a damaged container or another MP3 inside is refused before anything is written', async () => {
    const good = await container()
    await expect(importContainer(file('cut.polenuk', good.slice(0, good.length - 40)))).rejects.toThrow(/Книжку не імпортовано/)
    await expect(importContainer(file('swap.polenuk', await container({ audio: new Uint8Array([9, 9, 9, 9, 9, 9, 9, 9]) })))).rejects.toThrow()
    expect(await storedBookIDs()).toEqual([])
  })

  it('a container mixed with other files is refused; a folder package still imports as before', async () => {
    await expect(importPreparedSelection([file('a.polenuk', await container()), file('01.mp3', mp3)])).rejects.toThrow(/або один файл .polenuk/)
    expect(await storedBookIDs()).toEqual([])
  })
})
