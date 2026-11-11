// Building a prepared book (specs/013-prepared-book, D0 and D2a): the text of the book split by the reader's own
// importer and segmenter, its Ukrainian translation, one or more audio tracks with the word times of a local
// Whisper run, and the time of every sentence. Used by scripts/make-reader-book.ts; no network, no AI.
//
// D2a: each track is matched with the chapters it reads, given explicitly. The package is checked with the
// reader's own `validatePackage` before it is written, and every file is written whole or not at all.
// There is no cache: every run reads all inputs again.
import { createHash, randomUUID } from 'node:crypto'
import { createReadStream, readFileSync, realpathSync, renameSync, statSync, unlinkSync, writeFileSync } from 'node:fs'
import { basename, dirname, extname, isAbsolute, join, resolve } from 'node:path'
import { formatForExtension, importBook, maxFileSize } from '../src/core/import/importer.ts'
import { sourceLanguage } from '../src/core/language.ts'
import { paragraphKey, type Chapter } from '../src/core/model/book.ts'
import {
  editionHash, PACKAGE_FORMAT, PACKAGE_VERSION, TRANSLATION_LANGUAGE, validatePackage,
  type PackageTrack, type ReaderPackage, type SyncEntry,
} from '../src/core/prepared/package.ts'
import { alignWords, alignmentCells, MAX_ALIGN_CELLS, normalizeWords } from '../src/core/prepared/align.ts'

/** One audio file, the Whisper JSON made from it and the chapters of the book (from 1) it reads, in order. */
export interface TrackPlan {
  audio: string
  words: string
  /** Missing only when the plan has one track: then it reads every chapter of the book. */
  chapters?: number[]
}

/** What goes into the package: the book file and its tracks in the order they are played. */
export interface BookPlan {
  text: string
  tracks: TrackPlan[]
  /** The plan file it was read from (`readPlan`): it must not be overwritten. */
  file?: string
}

export interface BuildOptions {
  plan: BookPlan
  out: string
  /** Paragraph key → translation of each sentence. Without it a template of the sentences is written instead. */
  translation?: string
  report?: string
  id?: string
  maxAlignCells?: number
  /** Largest package in bytes of UTF-8: the reader refuses a bigger file (`maxFileSize`, `readPackage`). */
  maxPackageBytes?: number
  /** The plan file, when the plan does not name it: it must not be overwritten either. */
  planFile?: string
}

export interface TrackReport {
  id: string
  name: string
  chapters: number[]
  bookWords: number
  heardWords: number
  matchedWords: number
  sentences: number
  timedSentences: number
}

export type BuildResult =
  | { kind: 'template'; path: string; sentences: number }
  | { kind: 'package'; path: string; sentences: number; timed: number; tracks: TrackReport[]; warnings: string[] }

/** A problem with the inputs: the message says what to fix. Nothing has been written. */
export class BuildError extends Error {}

/** A sentence gets a time when at least this share of its words was heard. */
export const MIN_MATCHED = 0.5
/** Below this share of the words of its chapters heard, a track is reported as possibly another edition. */
export const WARN_TRACK_MATCH = 0.8
/** Below this share, a track most likely reads other chapters: the package is not made. */
export const MIN_TRACK_MATCH = 0.3
/** Below this share of the heard words found in the text, the recording holds much that the text has not. */
export const WARN_HEARD_MATCH = 0.6

export interface WhisperWord { word: string; start: number; end: number }

/** `plan.json`: `{ "text": "book.epub", "tracks": [{ "audio": "01.mp3", "words": "01.json", "chapters": [1, 2] }] }`. Paths are relative to the plan. */
export function readPlan(path: string): BookPlan {
  let value: unknown
  try {
    value = JSON.parse(readFileSync(path, 'utf8'))
  } catch (error) {
    throw new BuildError(`План ${path} не прочитано: ${(error as Error).message}`)
  }
  const plan = value as Partial<BookPlan> | null
  if (!plan || typeof plan.text !== 'string' || !Array.isArray(plan.tracks)) {
    throw new BuildError('План має містити "text" і "tracks".')
  }
  const base = dirname(path)
  const at = (file: unknown) => (typeof file === 'string' ? (isAbsolute(file) ? file : join(base, file)) : file as string)
  return {
    text: at(plan.text),
    tracks: plan.tracks.map((t: Partial<TrackPlan>) => ({ audio: at(t?.audio), words: at(t?.words), chapters: t?.chapters })),
    file: path,
  }
}

/** Checks the plan against the book; returns the chapters of the book (from 0) of each track. */
export function checkPlan(plan: BookPlan, chapterCount: number): number[][] {
  if (!plan.tracks.length) throw new BuildError('У плані немає доріжок.')
  const names = new Set<string>()
  const result: number[][] = []
  let last = 0
  plan.tracks.forEach((track, t) => {
    const label = `Доріжка ${t + 1}`
    if (typeof track.audio !== 'string' || typeof track.words !== 'string') {
      throw new BuildError(`${label}: потрібні "audio" і "words".`)
    }
    const name = basename(track.audio)
    if (names.has(name)) throw new BuildError(`${label}: файл «${name}» уже є в плані; назви аудіофайлів мають різнитися.`)
    names.add(name)
    let chapters = track.chapters
    if (chapters === undefined) {
      if (plan.tracks.length > 1) throw new BuildError(`${label} (${name}): вкажіть розділи, які вона читає.`)
      chapters = Array.from({ length: chapterCount }, (_, i) => i + 1)
    }
    if (!Array.isArray(chapters) || !chapters.length || !chapters.every((c) => Number.isInteger(c))) {
      throw new BuildError(`${label} (${name}): розділи — непорожній список номерів.`)
    }
    for (const chapter of chapters) {
      if (chapter < 1 || chapter > chapterCount) {
        throw new BuildError(`${label} (${name}): розділу ${chapter} немає, у книжці розділів ${chapterCount}.`)
      }
      if (chapter <= last) {
        throw new BuildError(`${label} (${name}): розділ ${chapter} повторюється або йде не по порядку; доріжки й розділи мають іти в порядку книжки, один розділ — в одній доріжці.`)
      }
      last = chapter
    }
    result.push(chapters.map((c) => c - 1))
  })
  return result
}

/** Problems of a translation against the sentences of the package; empty when it fits. */
export function checkTranslation(chapters: Chapter[], value: unknown): string[] {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return ['Переклад має бути об’єктом «розділ-абзац → [речення…]».']
  const translations = value as Record<string, unknown>
  const missing: string[] = []
  const uneven: string[] = []
  const keys = new Set<string>()
  chapters.forEach((c, ci) => c.paragraphs.forEach((p, pi) => {
    const key = paragraphKey({ chapter: ci, paragraph: pi })
    keys.add(key)
    const lines = translations[key]
    if (lines === undefined) missing.push(key)
    else if (!Array.isArray(lines) || lines.length !== p.sentences.length || !lines.every((l) => typeof l === 'string')) uneven.push(key)
  }))
  const extra = Object.keys(translations).filter((key) => !keys.has(key))
  const list = (items: string[]) => items.slice(0, 5).join(', ') + (items.length > 5 ? ` і ще ${items.length - 5}` : '')
  const problems: string[] = []
  if (missing.length) problems.push(`Немає перекладу абзаців: ${list(missing)}.`)
  if (uneven.length) problems.push(`Кількість речень перекладу не збігається з текстом в абзацах: ${list(uneven)}.`)
  if (extra.length) problems.push(`Переклад для абзаців, яких немає в тексті: ${list(extra)}.`)
  return problems
}

export function readWords(path: string, label: string): WhisperWord[] {
  let value: { segments?: Array<{ words?: WhisperWord[] }> }
  try {
    value = JSON.parse(readFileSync(path, 'utf8'))
  } catch (error) {
    throw new BuildError(`${label}: JSON Whisper ${path} не прочитано: ${(error as Error).message}`)
  }
  if (!Array.isArray(value?.segments)) throw new BuildError(`${label}: ${basename(path)} — не JSON Whisper (немає "segments").`)
  const words = value.segments.flatMap((s) => s.words ?? [])
  if (!words.length) throw new BuildError(`${label}: у ${basename(path)} немає міток слів; запустіть Whisper з --word_timestamps True.`)
  // Checked before matching: invalid times are refused, not hidden by the order of sentences later.
  // A word of zero length (end = start) is kept: Whisper writes such words for real recordings.
  const bad = words.findIndex((w) => typeof w?.word !== 'string' || typeof w.start !== 'number' || typeof w.end !== 'number'
    || !Number.isFinite(w.start) || !Number.isFinite(w.end) || w.start < 0 || w.end < w.start)
  if (bad >= 0) {
    const w = words[bad]
    throw new BuildError(`${label}: мітку слова ${bad + 1} у ${basename(path)} пошкоджено («${String(w?.word).trim()}», ${String(w?.start)} – ${String(w?.end)}); час має бути скінченним, невід’ємним, кінець — не раніше початку.`)
  }
  return words
}

async function describeAudio(path: string, id: string, label: string): Promise<PackageTrack> {
  let size: number
  try {
    size = statSync(path).size
  } catch {
    throw new BuildError(`${label}: аудіофайла ${path} немає.`)
  }
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(path)) hash.update(chunk as Buffer)
  return { id, name: basename(path), size, sha256: hash.digest('hex') }
}

/** Writes the file whole or not at all: a temporary file next to it, then a rename over the old one. */
export function writeFileAtomic(path: string, data: string, fs = { writeFileSync, renameSync, unlinkSync }) {
  const temporary = join(dirname(resolve(path)), `.${basename(path)}.${process.pid}.${randomUUID()}.tmp`)
  try {
    fs.writeFileSync(temporary, data, { flag: 'wx' })
    fs.renameSync(temporary, path)
  } catch (error) {
    try { fs.unlinkSync(temporary) } catch { /* not created */ }
    throw error
  }
}

/** Absolute path with links resolved: of the file, or of its folder when the file is not there yet. */
function canonical(path: string): string {
  try {
    return realpathSync(path)
  } catch {
    try {
      return join(realpathSync(dirname(resolve(path))), basename(path))
    } catch {
      return resolve(path)
    }
  }
}

/** The same file: the same inode when both exist, else the same canonical path (case ignored, as on the Mac disk). */
function sameFile(a: string, b: string): boolean {
  if (canonical(a).toLowerCase() === canonical(b).toLowerCase()) return true
  try {
    const x = statSync(a)
    const y = statSync(b)
    return x.dev === y.dev && x.ino === y.ino
  } catch {
    return false
  }
}

/** Refuses outputs that are one file or replace an input: the atomic rename would destroy the source. */
export function checkPaths(options: BuildOptions) {
  const outputs: Array<[string, string]> = options.translation
    ? [['пакет', options.out], ...(options.report ? [['звіт', options.report] as [string, string]] : [])]
    : [['заготовка перекладу', `${options.out}.translation.json`]]
  const inputs: Array<[string, string]> = [['книжка', options.plan.text]]
  options.plan.tracks.forEach((t, i) => {
    if (typeof t.audio === 'string') inputs.push([`аудіо доріжки ${i + 1}`, t.audio])
    if (typeof t.words === 'string') inputs.push([`JSON Whisper доріжки ${i + 1}`, t.words])
  })
  if (options.translation) inputs.push(['переклад', options.translation])
  for (const file of new Set([options.plan.file, options.planFile])) if (file) inputs.push(['план', file])
  outputs.forEach(([name, path], i) => {
    for (const [other, otherPath] of outputs.slice(i + 1)) {
      if (sameFile(path, otherPath)) throw new BuildError(`Вихідні файли (${name} і ${other}) збігаються: ${path}. Вкажіть різні шляхи.`)
    }
    for (const [input, inputPath] of inputs) {
      if (sameFile(path, inputPath)) throw new BuildError(`Вихідний файл (${name}) збігається з вхідним (${input}): ${path}. Вкажіть інший шлях.`)
    }
  })
}

export async function makeReaderBook(options: BuildOptions): Promise<BuildResult> {
  const { plan, out } = options
  checkPaths(options)
  const format = formatForExtension(extname(plan.text).slice(1))
  if (!format) throw new BuildError(`Непідтримуваний формат книжки: ${plan.text}`)
  let data: Uint8Array
  try {
    data = new Uint8Array(readFileSync(plan.text))
  } catch {
    throw new BuildError(`Файла книжки ${plan.text} немає.`)
  }
  const imported = await importBook(data, format, basename(plan.text, extname(plan.text)))
  const trackChapters = checkPlan(plan, imported.chapters.length)
  const chapters: Chapter[] = trackChapters.flat().map((i) => imported.chapters[i])
  const sentenceCount = chapters.reduce((n, c) => n + c.paragraphs.reduce((m, p) => m + p.sentences.length, 0), 0)

  if (!options.translation) {
    const template: Record<string, string[]> = {}
    chapters.forEach((c, ci) => c.paragraphs.forEach((p, pi) => { template[paragraphKey({ chapter: ci, paragraph: pi })] = p.sentences }))
    const path = `${out}.translation.json`
    writeFileAtomic(path, JSON.stringify(template, null, 2))
    return { kind: 'template', path, sentences: sentenceCount }
  }
  let translations: unknown
  try {
    translations = JSON.parse(readFileSync(options.translation, 'utf8'))
  } catch (error) {
    throw new BuildError(`Переклад ${options.translation} не прочитано: ${(error as Error).message}`)
  }
  const translationProblems = checkTranslation(chapters, translations)
  if (translationProblems.length) throw new BuildError(translationProblems.join('\n'))

  const limit = options.maxAlignCells ?? MAX_ALIGN_CELLS
  const sync: Record<string, SyncEntry[]> = {}
  const tracks: PackageTrack[] = []
  const reports: TrackReport[] = []
  const warnings: string[] = []
  const rows: string[] = []
  let packageChapter = 0
  for (const [t, bookChapters] of trackChapters.entries()) {
    const trackPlan = plan.tracks[t]
    const id = `t${t + 1}`
    const label = `Доріжка ${t + 1} (${basename(trackPlan.audio)})`
    const own = bookChapters.map(() => packageChapter++)

    // Words of the chapters of this track, each with its sentence.
    const bookWords: string[] = []
    const sentenceWords = new Map<string, number[]>()
    for (const ci of own) {
      chapters[ci].paragraphs.forEach((p, pi) => p.sentences.forEach((s, si) => {
        const ids: number[] = []
        for (const word of normalizeWords(s)) {
          ids.push(bookWords.length)
          bookWords.push(word)
        }
        sentenceWords.set(`${paragraphKey({ chapter: ci, paragraph: pi })}:${si}`, ids)
      }))
    }
    const heard: WhisperWord[] = []
    const heardWords: string[] = []
    for (const word of readWords(trackPlan.words, label)) {
      for (const part of normalizeWords(word.word)) {
        heard.push(word)
        heardWords.push(part)
      }
    }
    const cells = alignmentCells(bookWords.length, heardWords.length)
    if (cells > limit) {
      throw new BuildError(`${label}: слів тексту ${bookWords.length}, почутих ${heardWords.length}; зіставлення потребує ${cells} клітинок таблиці, межа ${limit}. Розділіть запис на коротші доріжки за розділами.`)
    }
    const match = new Map<number, WhisperWord>()
    for (const [i, j] of alignWords(bookWords, heardWords, limit)) match.set(i, heard[j])

    tracks.push(await describeAudio(trackPlan.audio, id, label))
    let previousEnd = 0
    let sentences = 0
    let timed = 0
    for (const ci of own) {
      chapters[ci].paragraphs.forEach((p, pi) => {
        const key = paragraphKey({ chapter: ci, paragraph: pi })
        sync[key] = p.sentences.map((text, si) => {
          sentences++
          const ids = sentenceWords.get(`${key}:${si}`) ?? []
          const hits = ids.map((i) => match.get(i)).filter((w): w is WhisperWord => !!w)
          const share = ids.length ? hits.length / ids.length : 0
          let entry: SyncEntry = null
          if (hits.length && share >= MIN_MATCHED) {
            const start = Math.max(hits[0].start, previousEnd)
            const end = Math.max(hits[hits.length - 1].end, start + 0.1)
            entry = [id, Math.round(start * 100) / 100, Math.round(end * 100) / 100]
            previousEnd = entry[2]
            timed++
          }
          const time = entry ? `${entry[1].toFixed(2)} – ${entry[2].toFixed(2)}` : '—'
          rows.push(`| ${id} | ${key}:${si} | ${time} | ${Math.round(share * 100)}% | ${text.replace(/\|/g, '\\|')} |`)
          return entry
        })
      })
    }
    const report: TrackReport = {
      id, name: basename(trackPlan.audio), chapters: bookChapters.map((c) => c + 1),
      bookWords: bookWords.length, heardWords: heardWords.length, matchedWords: match.size, sentences, timedSentences: timed,
    }
    reports.push(report)
    const bookShare = bookWords.length ? match.size / bookWords.length : 0
    const heardShare = heardWords.length ? match.size / heardWords.length : 0
    const percent = (x: number) => `${Math.round(x * 100)}%`
    if (bookShare < MIN_TRACK_MATCH) {
      throw new BuildError(`${label}: у записі знайдено лише ${percent(bookShare)} слів розділів ${report.chapters.join(', ')}. Схоже, доріжку зіставлено не з тими розділами або це інша книжка; перевірте план.`)
    }
    if (bookShare < WARN_TRACK_MATCH) {
      warnings.push(`${label}: у записі знайдено ${percent(bookShare)} слів розділів ${report.chapters.join(', ')}. Можливо, текст і запис — різні редакції або частину розділу не прочитано; перевірте звіт.`)
    }
    if (heardShare < WARN_HEARD_MATCH) {
      warnings.push(`${label}: лише ${percent(heardShare)} почутих слів є в тексті. Можливо, запис містить те, чого немає в тексті (інша редакція, довгий вступ).`)
    }
    if (timed < sentences) warnings.push(`${label}: без часу речень ${sentences - timed} з ${sentences}; вони не підсвічуватимуться.`)
  }

  const pkg: ReaderPackage = {
    format: PACKAGE_FORMAT,
    version: PACKAGE_VERSION,
    packageId: options.id ?? basename(out).replace(/\.reader\.json$/, ''),
    edition: await editionHash(chapters),
    language: sourceLanguage,
    translationLanguage: TRANSLATION_LANGUAGE,
    book: { title: imported.title, author: imported.author, format: imported.format, chapters },
    translations: translations as Record<string, string[]>,
    tracks,
    sync,
  }
  const json = JSON.stringify(pkg)
  const bytes = Buffer.byteLength(json, 'utf8')
  const maxBytes = options.maxPackageBytes ?? maxFileSize
  if (bytes > maxBytes) {
    throw new BuildError(`Пакет завеликий для Reader: ${bytes} байтів, межа ${maxBytes}. Розділіть книжку на частини.`)
  }
  const problems = await validatePackage(JSON.parse(json))
  if (problems.length) throw new BuildError(`Пакет не пройшов перевірку Reader:\n${problems.join('\n')}`)

  const timed = reports.reduce((n, r) => n + r.timedSentences, 0)
  if (options.report) {
    writeFileAtomic(options.report, [
      `# ${imported.title}: час речень`, '',
      `Речень: ${sentenceCount}, з часом: ${timed}.`, '',
      '| Доріжка | Файл | Розділи | Слів тексту | Почуто | Збіглося | Речень з часом |', '|---|---|---|---|---|---|---|',
      ...reports.map((r) => `| ${r.id} | ${r.name} | ${r.chapters.join(', ')} | ${r.bookWords} | ${r.heardWords} | ${r.matchedWords} (${Math.round((r.bookWords ? r.matchedWords / r.bookWords : 0) * 100)}%) | ${r.timedSentences} з ${r.sentences} |`),
      '', ...(warnings.length ? ['## Попередження', '', ...warnings.map((w) => `- ${w}`), ''] : []),
      '| Доріжка | Речення | Час, с | Слова | Текст |', '|---|---|---|---|---|', ...rows, '',
    ].join('\n'))
  }
  writeFileAtomic(out, json)
  return { kind: 'package', path: out, sentences: sentenceCount, timed, tracks: reports, warnings }
}
