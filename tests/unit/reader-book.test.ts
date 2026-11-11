// Building a prepared book of several chapters and tracks (specs/013-prepared-book, D2a: scripts/reader-book.ts).
// Synthetic data only, in the language of the build (tests/languages/<lang>/fixtures.ts → preparedChapters):
// a Markdown book, small byte arrays as audio, Whisper JSON with word times written by hand.
import { createHash } from 'node:crypto'
import { File as NodeFile } from 'node:buffer'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  BuildError, makeReaderBook, readPlan, writeFileAtomic, type BookPlan, type BuildOptions,
} from '../../scripts/reader-book.ts'
import { alignWords, AlignmentTooLarge } from '../../src/core/prepared/align.ts'
import { validatePackage, type ReaderPackage } from '../../src/core/prepared/package.ts'
import { importPrepared } from '../../src/core/prepared/import.ts'
import { listTracks, loadSync } from '../../src/core/audiobook/store.ts'
import { books, resetAll } from '../../src/core/storage/library.ts'
import { sourceLanguage } from '../../src/core/language.ts'
import { preparedChapters } from '../fixtures/language.ts'

// The reader's check of the finished package can be made to fail, to see that nothing is written after it.
const validation = vi.hoisted(() => ({ problems: [] as string[] }))
vi.mock('../../src/core/prepared/package.ts', async (original) => {
  const actual = await original<typeof import('../../src/core/prepared/package.ts')>()
  return {
    ...actual,
    validatePackage: async (...args: Parameters<typeof actual.validatePackage>) =>
      (validation.problems.length ? validation.problems : actual.validatePackage(...args)),
  }
})

let dir: string
const at = (name: string) => join(dir, name)
const sha = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex')
const audio = [new Uint8Array([1, 1, 1]), new Uint8Array([2, 2, 2, 2]), new Uint8Array([3, 3, 3, 3, 3])]

/** Words of chapters (from 1) as Whisper writes them: lower case, no punctuation, 0.5 s each from 1 s. */
function whisper(chapters: number[], replace?: { chapter: number; sentence: number; words: string[] }) {
  const words: Array<{ word: string; start: number; end: number }> = []
  let time = 1
  for (const c of chapters) {
    const chapter = preparedChapters[c - 1]
    if (!chapter) continue
    const parts = [chapter.heading, ...chapter.sentences.map((s, i) => (replace?.chapter === c && replace.sentence === i ? replace.words.join(' ') : s))]
    for (const word of parts.join(' ').toLocaleLowerCase().replace(/[.,!?]/g, '').split(' ')) {
      words.push({ word: ` ${word}`, start: time, end: time + 0.4 })
      time += 0.5
    }
  }
  return { text: '', segments: [{ words }] }
}

/** Translation of the chapters in the package (keys from 0 in the order of the package). */
function translation(count: number): Record<string, string[]> {
  const out: Record<string, string[]> = {}
  for (let c = 0; c < count; c++) {
    out[`${c}-0`] = [`Розділ ${c + 1}`]
    out[`${c}-1`] = ['Перше речення.', 'Друге речення.']
  }
  return out
}

function setup(tracks: Array<{ chapters?: number[]; words?: unknown }>, translated = 3): BuildOptions {
  writeFileSync(at('book.md'), `# Book\n\n${preparedChapters.map((c) => `## ${c.heading}\n\n${c.sentences.join(' ')}\n`).join('\n')}`)
  const plan: BookPlan = { text: at('book.md'), tracks: [] }
  tracks.forEach((t, i) => {
    writeFileSync(at(`0${i + 1}.mp3`), audio[i])
    writeFileSync(at(`0${i + 1}.json`), JSON.stringify(t.words ?? whisper(t.chapters ?? [1, 2, 3])))
    plan.tracks.push({ audio: at(`0${i + 1}.mp3`), words: at(`0${i + 1}.json`), chapters: t.chapters })
  })
  writeFileSync(at('uk.json'), JSON.stringify(translation(translated)))
  return { plan, out: at('book.reader.json'), translation: at('uk.json'), report: at('report.md') }
}

const read = (path: string) => JSON.parse(readFileSync(path, 'utf8')) as ReaderPackage
const temporaryFiles = () => readdirSync(dir).filter((name) => name.endsWith('.tmp'))

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'reader-book-'))
})
afterEach(() => {
  validation.problems = []
  rmSync(dir, { recursive: true, force: true })
})

describe(`prepared book of several chapters and tracks (${sourceLanguage})`, () => {
  it('matches each track with its chapters; time starts again in each track; the package passes the reader check', async () => {
    const result = await makeReaderBook(setup([{ chapters: [1, 2] }, { chapters: [3] }]))
    expect(result).toMatchObject({ kind: 'package', sentences: 9, timed: 9, warnings: [] })
    const pkg = read(at('book.reader.json'))
    expect(await validatePackage(pkg)).toEqual([])
    expect(pkg.language).toBe(sourceLanguage)
    expect(pkg.book.chapters.map((c) => c.title)).toEqual(preparedChapters.map((c) => c.heading))
    expect(pkg.tracks).toEqual([
      { id: 't1', name: '01.mp3', size: 3, sha256: sha(audio[0]) },
      { id: 't2', name: '02.mp3', size: 4, sha256: sha(audio[1]) },
    ])
    expect(pkg.sync['0-0']).toEqual([['t1', 1, 1.4]])
    expect(pkg.sync['1-1'].map((e) => e?.[0])).toEqual(['t1', 't1'])
    // Chapter 3 is the first thing heard in track 2.
    expect(pkg.sync['2-0']).toEqual([['t2', 1, 1.4]])
    expect(pkg.sync['2-1'].every((e) => e?.[0] === 't2')).toBe(true)
    const report = readFileSync(at('report.md'), 'utf8')
    expect(report).toContain('| t1 | 01.mp3 | 1, 2 |')
    expect(report).toContain('| t2 | 02.mp3 | 3 |')
    expect(temporaryFiles()).toEqual([])
  })

  it('three chapters in three tracks: the reader imports one book with three tracks in order', async () => {
    await resetAll()
    await makeReaderBook(setup([{ chapters: [1] }, { chapters: [2] }, { chapters: [3] }]))
    const json = readFileSync(at('book.reader.json'), 'utf8')
    const file = (name: string, bytes: Uint8Array | string) => new NodeFile([bytes], name) as unknown as File
    const result = await importPrepared([file('book.reader.json', json), ...audio.map((a, i) => file(`0${i + 1}.mp3`, a))])
    expect(result).toMatchObject({ sentences: 9, untimed: 0 })
    const tracks = await listTracks(result.summary.id)
    expect(tracks.map((t) => t.name)).toEqual(['01.mp3', '02.mp3', '03.mp3'])
    expect((await loadSync(result.summary.id))?.['2-1']?.[0]?.[0]).toBe(tracks[2].id)
    expect(books.value.map((b) => b.id)).toEqual([result.summary.id])
  })

  it('one track as before: without chapters it reads the whole book, the same as naming them all', async () => {
    const options = setup([{}])
    const result = await makeReaderBook(options)
    expect(result).toMatchObject({ kind: 'package', sentences: 9, timed: 9 })
    const implicit = readFileSync(options.out, 'utf8')
    options.plan.tracks[0].chapters = [1, 2, 3]
    await makeReaderBook(options)
    expect(readFileSync(options.out, 'utf8')).toBe(implicit)
    expect(read(options.out).tracks.map((t) => t.id)).toEqual(['t1'])
  })

  it('one track with some chapters: the package holds only them, numbered from 0', async () => {
    const options = setup([{ chapters: [3], words: whisper([3]) }], 1)
    await makeReaderBook(options)
    const pkg = read(options.out)
    expect(pkg.book.chapters.map((c) => c.title)).toEqual([preparedChapters[2].heading])
    expect(Object.keys(pkg.sync)).toEqual(['0-0', '0-1'])
  })

  it('a plan file names paths relative to itself', async () => {
    const options = setup([{ chapters: [1, 2] }, { chapters: [3] }])
    writeFileSync(at('plan.json'), JSON.stringify({ text: 'book.md', tracks: [
      { audio: '01.mp3', words: '01.json', chapters: [1, 2] }, { audio: '02.mp3', words: '02.json', chapters: [3] },
    ] }))
    expect(readPlan(at('plan.json'))).toEqual({ ...options.plan, file: at('plan.json') })
  })

  it('without a translation writes the sentences to translate, keyed as in the package', async () => {
    const options = setup([{ chapters: [2] }, { chapters: [3] }])
    const result = await makeReaderBook({ ...options, translation: undefined })
    expect(result).toEqual({ kind: 'template', path: `${options.out}.translation.json`, sentences: 6 })
    const template = JSON.parse(readFileSync(`${options.out}.translation.json`, 'utf8'))
    expect(template).toEqual({
      '0-0': [preparedChapters[1].heading], '0-1': [...preparedChapters[1].sentences],
      '1-0': [preparedChapters[2].heading], '1-1': [...preparedChapters[2].sentences],
    })
    expect(existsSync(options.out)).toBe(false)
  })
})

describe(`refused inputs: nothing is written (${sourceLanguage})`, () => {
  const refused = async (options: BuildOptions, message: string | RegExp) => {
    writeFileSync(options.out, 'previous package')
    await expect(makeReaderBook(options)).rejects.toThrow(BuildError)
    await expect(makeReaderBook(options)).rejects.toThrow(message)
    expect(readFileSync(options.out, 'utf8')).toBe('previous package')
    expect(existsSync(at('report.md'))).toBe(false)
    expect(temporaryFiles()).toEqual([])
  }

  it('an incomplete translation', async () => {
    await refused(setup([{ chapters: [1, 2] }, { chapters: [3] }], 2), 'Немає перекладу абзаців: 2-0, 2-1.')
  })

  it('a translation with another number of sentences or for paragraphs that are not in the text', async () => {
    const options = setup([{}])
    writeFileSync(at('uk.json'), JSON.stringify({ ...translation(3), '0-1': ['Одне речення.'], '5-0': ['Зайве.'] }))
    await refused(options, /в абзацах: 0-1\.\nПереклад для абзаців, яких немає в тексті: 5-0\./)
  })

  it('chapters out of order, repeated, missing or not in the book', async () => {
    await refused(setup([{ chapters: [3] }, { chapters: [1] }]), 'розділ 1 повторюється або йде не по порядку')
    await refused(setup([{ chapters: [1, 2] }, { chapters: [2, 3] }]), 'розділ 2 повторюється')
    await refused(setup([{ chapters: [1, 4] }]), 'розділу 4 немає, у книжці розділів 3')
    await refused(setup([{ chapters: [1] }, {}]), 'вкажіть розділи, які вона читає')
  })

  it('two tracks with the same file name', async () => {
    const options = setup([{ chapters: [1, 2] }, { chapters: [3] }])
    options.plan.tracks[1].audio = join(dir, 'other', '01.mp3')
    await refused(options, 'файл «01.mp3» уже є в плані')
  })

  it('a track matched with chapters it does not read', async () => {
    await refused(setup([{ chapters: [1, 2], words: whisper([3]) }, { chapters: [3], words: whisper([1, 2]) }]), 'не з тими розділами')
  })

  it('Whisper JSON without word times', async () => {
    await refused(setup([{ words: { segments: [{ start: 0, end: 5, text: 'text' }] } }]), '--word_timestamps True')
  })

  it('a missing audio file', async () => {
    const options = setup([{}])
    rmSync(options.plan.tracks[0].audio)
    await refused(options, 'аудіофайла')
  })

  it('a track too long for the word matching, before the table is made', async () => {
    await refused({ ...setup([{ chapters: [1, 2] }, { chapters: [3] }]), maxAlignCells: 100 }, /Доріжка 1 \(01\.mp3\): слів тексту \d+, почутих \d+; .* межа 100\. Розділіть запис/)
    expect(() => alignWords(['a', 'b'], ['a', 'b'], 8)).toThrow(AlignmentTooLarge)
    expect(alignWords(['a', 'b'], ['a', 'b'], 9)).toEqual([[0, 0], [1, 1]])
  })
})

describe(`another edition of the text or the recording (${sourceLanguage})`, () => {
  it('warns about the track and the sentences left without time, and still makes the package', async () => {
    const changed = whisper([1], { chapter: 1, sentence: 1, words: ['xa', 'xb', 'xc', 'xd', 'xe'] })
    const result = await makeReaderBook(setup([{ chapters: [1], words: changed }, { chapters: [2, 3] }]))
    if (result.kind !== 'package') throw new Error('no package')
    expect(result.warnings.join('\n')).toMatch(/Доріжка 1 \(01\.mp3\): у записі знайдено \d+% слів розділів 1\. Можливо, текст і запис — різні редакції/)
    expect(result.warnings.join('\n')).toContain('Доріжка 1 (01.mp3): без часу речень 1 з 3')
    expect(result.warnings.some((w) => w.startsWith('Доріжка 2'))).toBe(false)
    expect(read(at('book.reader.json')).sync['0-1'][1]).toBeNull()
    expect(readFileSync(at('report.md'), 'utf8')).toContain('## Попередження')
  })
})

describe('writing whole or not at all', () => {
  it('a failure while writing leaves the old file and no temporary file', () => {
    writeFileSync(at('book.reader.json'), 'previous package')
    const failing = {
      writeFileSync: (path: string, data: string) => {
        writeFileSync(path, data.slice(0, 3))
        throw new Error('disk full')
      },
      renameSync: () => { throw new Error('not reached') },
      unlinkSync: (path: string) => rmSync(path),
    }
    expect(() => writeFileAtomic(at('book.reader.json'), 'new package', failing as never)).toThrow('disk full')
    expect(readFileSync(at('book.reader.json'), 'utf8')).toBe('previous package')
    expect(temporaryFiles()).toEqual([])
  })

  it('an interrupted run leaves at most a temporary file beside the old one, never a cut package', () => {
    writeFileSync(at('book.reader.json'), 'previous package')
    const interrupted = { writeFileSync, renameSync: () => { throw new Error('killed') }, unlinkSync: () => { throw new Error('killed') } }
    expect(() => writeFileAtomic(at('book.reader.json'), 'new package', interrupted as never)).toThrow('killed')
    expect(readFileSync(at('book.reader.json'), 'utf8')).toBe('previous package')
    expect(temporaryFiles()).toHaveLength(1)
  })

  it('replaces the file when the write succeeds', () => {
    writeFileSync(at('book.reader.json'), 'previous package')
    writeFileAtomic(at('book.reader.json'), 'new package')
    expect(readFileSync(at('book.reader.json'), 'utf8')).toBe('new package')
    expect(temporaryFiles()).toEqual([])
  })
})

describe(`contracts of the package (${sourceLanguage})`, () => {
  it('time in each track counts from its own start: the end of track 1 does not push track 2', async () => {
    await makeReaderBook(setup([{ chapters: [1, 2] }, { chapters: [3] }]))
    const pkg = read(at('book.reader.json'))
    const lastOfTrack1 = pkg.sync['1-1'][1]![2]
    expect(lastOfTrack1).toBeGreaterThan(5)
    expect(pkg.sync['2-0'][0]).toEqual(['t2', 1, 1.4])
    expect(pkg.sync['2-1'][0]![1]).toBeLessThan(lastOfTrack1)
  })

  it('a selection of chapters is numbered from 0 in translation and time, and the reader check sees those keys', async () => {
    const options = setup([{ chapters: [2], words: whisper([2]) }, { chapters: [3], words: whisper([3]) }], 2)
    await makeReaderBook(options)
    const pkg = read(options.out)
    expect(Object.keys(pkg.sync).sort()).toEqual(['0-0', '0-1', '1-0', '1-1'])
    expect(Object.keys(pkg.translations).sort()).toEqual(['0-0', '0-1', '1-0', '1-1'])
    expect(await validatePackage(pkg)).toEqual([])
    // A translation keyed by the chapters of the whole book does not fit.
    const byBook = Object.fromEntries(Object.entries(translation(2)).map(([k, v]) => [`${Number(k.split('-')[0]) + 1}-${k.split('-')[1]}`, v]))
    writeFileSync(at('uk.json'), JSON.stringify(byBook))
    await expect(makeReaderBook(options)).rejects.toThrow(/Немає перекладу абзаців: 0-0, 0-1\.[\s\S]*яких немає в тексті: 2-0, 2-1\./)
  })

  it('a package the reader check refuses is not written', async () => {
    const options = setup([{ chapters: [1, 2] }, { chapters: [3] }])
    writeFileSync(options.out, 'previous package')
    validation.problems = ['Час речень пошкоджено в абзацах: 1.']
    await expect(makeReaderBook(options)).rejects.toThrow('Пакет не пройшов перевірку Reader:\nЧас речень пошкоджено в абзацах: 1.')
    expect(readFileSync(options.out, 'utf8')).toBe('previous package')
    expect(existsSync(at('report.md'))).toBe(false)
    expect(temporaryFiles()).toEqual([])
  })

  it('refuses invalid word times before matching and keeps words of zero length', async () => {
    const times = (start: unknown, end: unknown) => {
      const words = whisper([1, 2, 3])
      Object.assign(words.segments[0].words[3], { start, end })
      return words
    }
    for (const [start, end] of [[-1, 1], [3, 2], [null, 2], ['1', 2], [1, null]]) {
      writeFileSync(at('book.reader.json'), 'previous package')
      await expect(makeReaderBook(setup([{ words: times(start, end) }]))).rejects.toThrow(/мітку слова 4 у 01\.json пошкоджено/)
      expect(readFileSync(at('book.reader.json'), 'utf8')).toBe('previous package')
    }
    const zero = times(2.5, 2.5)
    await expect(makeReaderBook(setup([{ words: zero }]))).resolves.toMatchObject({ kind: 'package', timed: 9 })
  })

  it('outputs never replace each other or an input file', async () => {
    const options = setup([{ chapters: [1, 2] }, { chapters: [3] }])
    writeFileSync(at('plan.json'), '{}')
    const sources = ['book.md', '01.mp3', '02.json', 'uk.json', 'plan.json'].map((name) => [name, readFileSync(at(name))] as const)
    const cases: Array<[Partial<BuildOptions>, RegExp]> = [
      [{ out: at('book.md') }, /Вихідний файл \(пакет\) збігається з вхідним \(книжка\)/],
      [{ out: at('BOOK.MD') }, /Вихідний файл \(пакет\) збігається з вхідним \(книжка\)/],
      [{ out: at('01.mp3') }, /\(пакет\) збігається з вхідним \(аудіо доріжки 1\)/],
      [{ report: at('02.json') }, /\(звіт\) збігається з вхідним \(JSON Whisper доріжки 2\)/],
      [{ out: at('uk.json') }, /\(пакет\) збігається з вхідним \(переклад\)/],
      [{ out: at('plan.json'), planFile: at('plan.json') }, /\(пакет\) збігається з вхідним \(план\)/],
      [{ report: at('book.reader.json') }, /Вихідні файли \(пакет і звіт\) збігаються/],
    ]
    for (const [change, message] of cases) {
      await expect(makeReaderBook({ ...options, ...change })).rejects.toThrow(message)
    }
    // Without a translation the output is `<out>.translation.json`: here it would be the Whisper JSON of track 2.
    writeFileSync(at('uk.translation.json'), 'words')
    options.plan.tracks[1].words = at('uk.translation.json')
    await expect(makeReaderBook({ ...options, out: at('uk'), translation: undefined }))
      .rejects.toThrow(/\(заготовка перекладу\) збігається з вхідним \(JSON Whisper доріжки 2\)/)
    for (const [name, bytes] of sources) expect(readFileSync(at(name))).toEqual(bytes)
    expect(readFileSync(at('uk.translation.json'), 'utf8')).toBe('words')
    expect(temporaryFiles()).toEqual([])
  })

  it('the plan file read by readPlan is protected without naming it again', async () => {
    setup([{ chapters: [1, 2] }, { chapters: [3] }])
    const text = JSON.stringify({ text: 'book.md', tracks: [
      { audio: '01.mp3', words: '01.json', chapters: [1, 2] }, { audio: '02.mp3', words: '02.json', chapters: [3] },
    ] })
    writeFileSync(at('plan.json'), text)
    const plan = readPlan(at('plan.json'))
    const base = { plan, out: at('book.reader.json'), translation: at('uk.json'), report: at('report.md') }
    await expect(makeReaderBook({ ...base, out: at('plan.json') })).rejects.toThrow(/\(пакет\) збігається з вхідним \(план\)/)
    await expect(makeReaderBook({ ...base, report: at('PLAN.json') })).rejects.toThrow(/\(звіт\) збігається з вхідним \(план\)/)
    expect(readFileSync(at('plan.json'), 'utf8')).toBe(text)
    await expect(makeReaderBook(base)).resolves.toMatchObject({ kind: 'package' })
  })

  it('a package larger than the reader takes, counted in bytes of UTF-8, is not written', async () => {
    const options = setup([{ chapters: [1, 2] }, { chapters: [3] }])
    await makeReaderBook(options)
    const json = readFileSync(options.out, 'utf8')
    const bytes = Buffer.byteLength(json, 'utf8')
    expect(bytes).toBeGreaterThan(json.length) // the Ukrainian translation takes two bytes a letter
    writeFileSync(options.out, 'previous package')
    rmSync(at('report.md'))
    await expect(makeReaderBook({ ...options, maxPackageBytes: json.length }))
      .rejects.toThrow(`Пакет завеликий для Reader: ${bytes} байтів, межа ${json.length}.`)
    expect(readFileSync(options.out, 'utf8')).toBe('previous package')
    expect(existsSync(at('report.md'))).toBe(false)
    expect(temporaryFiles()).toEqual([])
    await makeReaderBook({ ...options, maxPackageBytes: bytes })
    expect(readFileSync(options.out, 'utf8')).toBe(json)
  })

  it('without a limit given it is the limit of the reader import, 50 MiB of UTF-8', async () => {
    const { maxFileSize } = await import('../../src/core/import/importer.ts')
    const options = setup([{}])
    // A translation of fewer letters than the limit, but more bytes: each letter is two bytes of UTF-8.
    const long = 'ї'.repeat(maxFileSize / 2 + 1024)
    expect(long.length).toBeLessThan(maxFileSize)
    writeFileSync(at('uk.json'), JSON.stringify({ ...translation(3), '0-0': [long] }))
    writeFileSync(options.out, 'previous package')
    await expect(makeReaderBook(options)).rejects.toThrow(new RegExp(`Пакет завеликий для Reader: \\d+ байтів, межа ${maxFileSize}\\.`))
    expect(readFileSync(options.out, 'utf8')).toBe('previous package')
    expect(temporaryFiles()).toEqual([])
  })

  it('two outputs not made yet are one file when their folders are one folder through a link', async () => {
    const options = setup([{ chapters: [1, 2] }, { chapters: [3] }])
    mkdirSync(at('real'))
    symlinkSync(at('real'), at('alias'))
    const out = join(dir, 'real', 'new.reader.json')
    const report = join(dir, 'alias', 'new.reader.json')
    await expect(makeReaderBook({ ...options, out, report })).rejects.toThrow(/Вихідні файли \(пакет і звіт\) збігаються/)
    expect(readdirSync(at('real'))).toEqual([])
    await expect(makeReaderBook({ ...options, out, report: join(dir, 'alias', 'new.md') })).resolves.toMatchObject({ kind: 'package' })
  })
})
