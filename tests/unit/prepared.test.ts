// Prepared book (specs/013-prepared-book, D0): package checks, sentence at a time, import. Synthetic data only.
import { createHash } from 'node:crypto'
import { File as NodeFile } from 'node:buffer'
import { beforeEach, describe, expect, it } from 'vitest'
import type { Chapter } from '../../src/core/model/book.ts'
import {
  buildSyncIndex, editionHash, PACKAGE_FORMAT, PACKAGE_VERSION, sentenceAt, validatePackage, type ReaderPackage,
} from '../../src/core/prepared/package.ts'
import { importPrepared } from '../../src/core/prepared/import.ts'
import { listTracks, loadSync } from '../../src/core/audiobook/store.ts'
import { TranslationStore } from '../../src/core/ai/translation.ts'
import { books, loadBook, removeOrphanTranslations, resetAll } from '../../src/core/storage/library.ts'
import { Sha256, sha256File } from '../../src/core/util/sha256.ts'

const chapters: Chapter[] = [{
  title: 'One',
  paragraphs: [
    { kind: 'heading', sentences: ['One'] },
    { kind: 'text', sentences: ['The cat sat.', 'The mouse ran.'] },
  ],
}]

const audio = new Uint8Array([1, 2, 3, 4, 5])
const sha = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex')
const file = (name: string, bytes: Uint8Array | string, type = 'audio/mpeg') => new NodeFile([bytes], name, { type }) as unknown as File

async function makePackage(): Promise<ReaderPackage> {
  return {
    format: PACKAGE_FORMAT,
    version: PACKAGE_VERSION,
    packageId: 'test',
    edition: await editionHash(chapters),
    language: 'en',
    translationLanguage: 'uk',
    book: { title: 'Test', author: 'Author', format: 'txt', chapters },
    translations: { '0-0': ['Один'], '0-1': ['Кіт сидів.', 'Миша бігла.'] },
    tracks: [{ id: 'a', name: '01.mp3', size: audio.length, sha256: sha(audio) }],
    sync: { '0-0': [null], '0-1': [['a', 2, 4], ['a', 4.2, 6]] },
  }
}

describe('validatePackage', () => {
  it('accepts a complete package', async () => {
    expect(await validatePackage(await makePackage())).toEqual([])
  })

  it('rejects another file', async () => {
    expect(await validatePackage({ format: 'reader-backup' })).toEqual(['Це не файл підготовленої книжки.'])
  })

  it('rejects time made for another edition of the text', async () => {
    const pkg = await makePackage()
    pkg.book.chapters = [{ ...chapters[0], paragraphs: [chapters[0].paragraphs[0], { kind: 'text', sentences: ['The cat sat. The mouse ran.'] }] }]
    pkg.translations['0-1'] = ['Кіт сидів. Миша бігла.']
    pkg.sync['0-1'] = [['a', 2, 6]]
    expect(await validatePackage(pkg)).toEqual(['Текст не збігається з редакцією, для якої зроблено переклад і час.'])
  })

  it('edition depends on text and sentence boundaries only', async () => {
    const copy = JSON.parse(JSON.stringify(chapters)) as Chapter[]
    expect(await editionHash(copy)).toBe(await editionHash(chapters))
    copy[0].paragraphs[1].sentences = ['The cat sat. The mouse ran.']
    expect(await editionHash(copy)).not.toBe(await editionHash(chapters))
  })

  it('reports a missing or uneven translation and broken time', async () => {
    const pkg = await makePackage()
    delete pkg.translations['0-0']
    pkg.translations['0-1'] = ['Кіт сидів.']
    pkg.sync['0-1'] = [['b', 2, 4], ['a', 6, 5]]
    expect(await validatePackage(pkg)).toEqual([
      'Немає перекладу для абзаців: 1.',
      'Переклад не відповідає реченням в абзацах: 1.',
      'Час речень пошкоджено в абзацах: 1.',
    ])
  })
})

describe('sentenceAt', () => {
  const index = buildSyncIndex({ '0-0': [['x', 0, 1]], '0-1': [['x', 3, 5], ['x', 5.3, 8], null] })
  const at = (time: number) => {
    const ref = sentenceAt(index, 'x', time)
    return ref ? `${ref.paragraph.paragraph}:${ref.sentence}` : null
  }

  it('finds the sentence heard at the time', () => {
    expect(at(0)).toBe('0:0')
    expect(at(3)).toBe('1:0')
    expect(at(5.3)).toBe('1:1')
    expect(at(7.9)).toBe('1:1')
  })

  it('keeps the sentence in a short pause and highlights nothing in a long one', () => {
    expect(at(5.1)).toBe('1:0')
    expect(at(1.5)).toBe('0:0')
    expect(at(2.5)).toBeNull()
    expect(at(9.5)).toBeNull()
  })

  it('knows nothing about another track', () => {
    expect(sentenceAt(index, 'y', 3)).toBeNull()
  })
})

describe('importPrepared', () => {
  beforeEach(async () => {
    await resetAll()
  })

  const packageFile = async (pkg: ReaderPackage) => file('test.reader.json', JSON.stringify(pkg), 'application/json')

  it('adds the book with its translation, audio and time', async () => {
    const result = await importPrepared([await packageFile(await makePackage()), file('01.mp3', audio)])
    expect(result).toMatchObject({ sentences: 3, untimed: 1 })
    const id = result.summary.id
    expect(books.value.map((b) => b.id)).toEqual([id])
    expect((await loadBook(id))?.chapters).toEqual(chapters)
    expect(await new TranslationStore(id).translationForKey('0-1')).toEqual(['Кіт сидів.', 'Миша бігла.'])
    const tracks = await listTracks(id)
    expect(tracks.map((t) => t.name)).toEqual(['01.mp3'])
    // Time refers to the stored track, not to the id inside the package (M5).
    expect((await loadSync(id))?.['0-1']).toEqual([[tracks[0].id, 2, 4], [tracks[0].id, 4.2, 6]])
  })

  it('refuses other audio and leaves the library as it was', async () => {
    const pkg = await packageFile(await makePackage())
    await expect(importPrepared([pkg])).rejects.toThrow('Виберіть разом з нею аудіофайли: 01.mp3.')
    await expect(importPrepared([pkg, file('01.mp3', new Uint8Array([9, 9, 9, 9, 9]))])).rejects.toThrow('Аудіофайли відрізняються')
    expect(books.value).toEqual([])
  })

  it('refuses an invalid package', async () => {
    const pkg = await makePackage()
    pkg.edition = '0'
    await expect(importPrepared([await packageFile(pkg), file('01.mp3', audio)])).rejects.toThrow('Текст не збігається з редакцією')
    expect(books.value).toEqual([])
  })
})

describe('sha256', () => {
  const bytes = (n: number) => Uint8Array.from({ length: n }, (_, i) => (i * 31 + 7) & 255)

  it('matches node:crypto at every padding boundary', () => {
    for (const n of [0, 1, 55, 56, 63, 64, 65, 119, 120, 1000]) {
      expect(new Sha256().update(bytes(n)).hex()).toBe(sha(bytes(n)))
    }
  })

  it('gives the same hash when the file is read in uneven parts', async () => {
    const data = bytes(300_001)
    expect(await sha256File(file('a.mp3', data), 4099)).toBe(sha(data))
  })
})

describe('removeOrphanTranslations', () => {
  beforeEach(async () => {
    await resetAll()
  })

  it('removes translations of a book that never reached the library and keeps the rest', async () => {
    const { summary } = await importPrepared([
      file('test.reader.json', JSON.stringify(await makePackage()), 'application/json'), file('01.mp3', audio),
    ])
    await new TranslationStore('lost').saveForKey(['x'], '0-0')
    await removeOrphanTranslations(books.value.map((b) => b.id))
    expect(await new TranslationStore('lost').translationForKey('0-0')).toBeUndefined()
    expect(await new TranslationStore(summary.id).translationForKey('0-0')).toEqual(['Один'])
  })
})
