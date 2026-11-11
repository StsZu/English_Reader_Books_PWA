// A repeated import is a recognisable copy and leaves the older book and its place alone (R024); the package's source
// is kept only in its known shape (R025). Synthetic data in the language of the build.
import { createHash } from 'node:crypto'
import { File as NodeFile } from 'node:buffer'
import { beforeEach, describe, expect, it } from 'vitest'
import type { Chapter } from '../../src/core/model/book.ts'
import { editionHash, PACKAGE_FORMAT, PACKAGE_VERSION } from '../../src/core/prepared/package.ts'
import { importPrepared, sourceOf } from '../../src/core/prepared/import.ts'
import { addBook, loadBook, resetAll } from '../../src/core/storage/library.ts'
import { loadPosition, savePosition } from '../../src/core/storage/positions.ts'
import { listTracks } from '../../src/core/audiobook/store.ts'
import { sourceLanguage } from '../../src/core/language.ts'
import { preparedText } from '../fixtures/language.ts'

const chapters: Chapter[] = [{ title: preparedText.heading, paragraphs: [
  { kind: 'heading', sentences: [preparedText.heading] }, { kind: 'text', sentences: [...preparedText.sentences] },
] }]
const audio = new Uint8Array([7, 7, 7])

async function files(source?: unknown) {
  const pkg = {
    format: PACKAGE_FORMAT, version: PACKAGE_VERSION, packageId: 'p', edition: await editionHash(chapters),
    language: sourceLanguage, translationLanguage: 'uk', book: { title: 'Same book', author: 'A', format: 'txt', chapters },
    translations: { '0-0': ['Один'], '0-1': ['Перше.', 'Друге.'] },
    tracks: [{ id: 'a', name: '01.mp3', size: 3, sha256: createHash('sha256').update(audio).digest('hex') }],
    sync: { '0-0': [null], '0-1': [['a', 1, 2], ['a', 2, 3]] }, ...(source === undefined ? {} : { source }),
  }
  return [new NodeFile([JSON.stringify(pkg)], 'b.reader.json') as unknown as File, new NodeFile([audio], '01.mp3') as unknown as File]
}

beforeEach(async () => {
  await resetAll()
})

describe('repeated import (R024)', () => {
  it('makes «Title (2)», «Title (3)»; the older book, its place and its audio stay as they were', async () => {
    const first = await importPrepared(await files())
    await savePosition(first.summary.id, { chapter: 0, paragraph: 1 })
    const firstTracks = await listTracks(first.summary.id)
    const second = await importPrepared(await files())
    const third = await importPrepared(await files())
    expect([first.summary.title, second.summary.title, third.summary.title]).toEqual(['Same book', 'Same book (2)', 'Same book (3)'])
    expect(new Set([first.summary.id, second.summary.id, third.summary.id]).size).toBe(3)
    expect(await loadPosition(first.summary.id)).toEqual({ chapter: 0, paragraph: 1 })
    expect(await loadPosition(second.summary.id)).toBeNull()
    expect(await listTracks(first.summary.id)).toEqual(firstTracks)
    expect((await loadBook(first.summary.id))?.title).toBe('Same book')
  })

  it('stays distinct when a plain import takes the title while a prepared import is between its phases', async () => {
    let release!: () => void
    let paused!: () => void
    const reached = new Promise<void>((resolve) => { paused = resolve })
    const gate = new Promise<void>((resolve) => { release = resolve })
    const prepared = importPrepared(await files(), new Date(), {
      afterPhase: async (name) => { if (name === 'checked') { paused(); await gate } },
    })
    await reached
    // A plain EPUB/TXT import does not take the import lock: it adds «Same book» and «Same book (2)» meanwhile.
    const plain = (id: string, title: string) => addBook({ id, title, author: 'A', format: 'txt', importedAt: new Date().toISOString(), chapters })
    await plain('plain-1', 'Same book')
    await plain('plain-2', 'Same book (2)')
    release()
    const result = await prepared
    expect(result.summary.title).toBe('Same book (3)')
    expect((await loadBook(result.summary.id))?.title).toBe('Same book (3)')
    expect((await loadBook('plain-1'))?.title).toBe('Same book')
    expect((await loadBook('plain-2'))?.title).toBe('Same book (2)')
  })
})

describe('source of a package (R025)', () => {
  it('is kept with the book in its known shape', async () => {
    const source = { title: 'Lesson', url: 'https://example.org/v?id=1', author: 'Author',
      contentRights: { basis: 'licence', licence: 'CC BY 4.0', confirmed: true }, acquisition: { method: 'author-download', detail: 'from the author', confirmed: true } }
    const result = await importPrepared(await files(source))
    expect((await loadBook(result.summary.id))?.source).toEqual(source)
  })

  it('drops unknown fields and values, and keeps no source when nothing is valid', async () => {
    expect(sourceOf({ title: 'T', script: '<b>x</b>', contentRights: { basis: 'stolen', confirmed: true },
      acquisition: { method: 'user-file', confirmed: 'yes' } })).toEqual({ source: { title: 'T' } })
    expect(sourceOf({ contentRights: { basis: 'own' } })).toEqual({})
    expect(sourceOf(null)).toEqual({})
    expect(sourceOf('text')).toEqual({})
    const result = await importPrepared(await files({ weird: 1 }))
    expect((await loadBook(result.summary.id))?.source).toBeUndefined()
  })
})
