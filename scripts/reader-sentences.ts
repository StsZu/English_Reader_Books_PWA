// Protocol 2 of the reader tool (specs/015-reader-book-container, R012–R013): the one place where a book text is split
// into sentences and linked with the word times of local Whisper, for the converter (specs/004-mp3-reader-book).
//
// `sentences`: plan v2 → sentences.json — every sentence occurrence with a stable id, its track and time (or null).
// `build-sentences`: sentences.json + translations by occurrence id (+ source) → book.reader.json, checked.
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { basename, dirname, extname, isAbsolute, join } from 'node:path'
import { formatForExtension, importBook, maxFileSize } from '../src/core/import/importer.ts'
import { sourceLanguage } from '../src/core/language.ts'
import { paragraphKey, type Chapter } from '../src/core/model/book.ts'
import {
  editionHash, PACKAGE_FORMAT, PACKAGE_VERSION, TRANSLATION_LANGUAGE, validatePackage, type ReaderPackage, type SyncEntry,
} from '../src/core/prepared/package.ts'
import { alignWords, alignmentCells, MAX_ALIGN_CELLS, normalizeWords } from '../src/core/prepared/align.ts'
import { BuildError, MIN_MATCHED, readWords, writeFileAtomic, type WhisperWord } from './reader-book.ts'

export const SENTENCES_FORMAT = 'reader-sentences'
export const SENTENCES_VERSION = 1

export interface TrackPlanV2 {
  id: string
  title?: string
  audio: { name: string; size: number; sha256: string }
  /** Words of local Whisper for this track, kept by the converter's filter (Whisper JSON shape). */
  words: string
  /** Text of this track (TXT): a transcript made from these words, or its edited version. */
  text?: string
  /** Chapters (from 1) of the plan's `text` this track reads, when the book text is one file. */
  chapters?: number[]
}

export interface PlanV2 {
  language: string
  title?: string
  author?: string
  /** One book text for all tracks (EPUB/TXT/MD) with `chapters` per track; or `text` per track. */
  text?: string
  tracks: TrackPlanV2[]
}

export interface SentenceOccurrence {
  /** Track, place and a hash of the exact text: the same words elsewhere are another occurrence. */
  id: string
  key: string
  sentence: number
  text: string
  track: string
  start: number | null
  end: number | null
  /** Share of the sentence's words linked to heard words. */
  matched: number
}

export interface SentencesFile {
  format: typeof SENTENCES_FORMAT
  version: number
  language: string
  edition: string
  book: { title: string; author: string; format: 'epub' | 'txt' | 'md'; chapters: Chapter[] }
  tracks: Array<{ id: string; name: string; size: number; sha256: string; bookWords: number; heardWords: number; linkedWords: number; timed: number; sentences: number; direct: boolean }>
  sentences: SentenceOccurrence[]
}

/** Book words that were not at one place in the heard ones: the window of alignment around each step. */
const WINDOW = 3000
const OVERLAP = 300
const MARGIN = 600

/** Pairs [book word, heard word]. Same words in the same order: linked directly, no alignment (the transcript). */
export function linkWords(book: readonly string[], heard: readonly string[], limit = MAX_ALIGN_CELLS): { pairs: Array<[number, number]>; direct: boolean } {
  if (book.length === heard.length && book.every((w, i) => w === heard[i])) {
    return { pairs: book.map((_, i) => [i, i] as [number, number]), direct: true }
  }
  if (alignmentCells(book.length, heard.length) <= limit) return { pairs: alignWords(book, heard, limit), direct: false }
  // Longer than one table: windows of the book along the heard words, each next one starting after the last link.
  const pairs: Array<[number, number]> = []
  let i = 0
  let j = 0
  while (i < book.length) {
    const end = Math.min(book.length, i + WINDOW)
    const expected = Math.round(((end - i) * heard.length) / book.length)
    const heardEnd = Math.min(heard.length, j + expected + MARGIN)
    const local = alignWords(book.slice(i, end), heard.slice(j, heardEnd), limit)
    const cut = end === book.length ? end : end - OVERLAP
    const kept = local.filter(([a]) => i + a < cut).map(([a, b]) => [i + a, j + b] as [number, number])
    pairs.push(...kept)
    if (kept.length) j = kept[kept.length - 1][1] + 1
    i = cut
  }
  return { pairs, direct: false }
}

const at = (base: string, file: string) => (isAbsolute(file) ? file : join(base, file))

async function readText(path: string, fallback: string): Promise<{ title: string; author: string; format: 'epub' | 'txt' | 'md'; chapters: Chapter[] }> {
  const format = formatForExtension(extname(path).slice(1))
  if (!format) throw new BuildError(`Непідтримуваний формат тексту: ${basename(path)}.`)
  let data: Uint8Array
  try {
    data = new Uint8Array(readFileSync(path))
  } catch {
    throw new BuildError(`Файла тексту ${path} немає.`)
  }
  return importBook(data, format, fallback)
}

export function readPlanV2(path: string): PlanV2 {
  let plan: PlanV2
  try {
    plan = JSON.parse(readFileSync(path, 'utf8'))
  } catch (error) {
    throw new BuildError(`План ${path} не прочитано: ${(error as Error).message}`)
  }
  if (!plan || !Array.isArray(plan.tracks) || plan.tracks.length === 0) throw new BuildError('План має містити доріжки.')
  if (plan.language !== sourceLanguage) throw new BuildError(`План для мови «${String(plan.language)}», а інструмент — для «${sourceLanguage}».`)
  const base = dirname(path)
  const ids = new Set<string>()
  const names = new Set<string>()
  for (const [i, t] of plan.tracks.entries()) {
    if (typeof t?.id !== 'string' || !t.id || ids.has(t.id)) throw new BuildError(`Доріжка ${i + 1}: потрібен унікальний id.`)
    ids.add(t.id)
    const a = t.audio
    if (!a || typeof a.name !== 'string' || typeof a.size !== 'number' || !/^[0-9a-f]{64}$/.test(String(a.sha256))) {
      throw new BuildError(`Доріжка ${i + 1}: опис аудіо пошкоджено.`)
    }
    if (names.has(a.name.toLowerCase())) throw new BuildError(`Доріжка ${i + 1}: назва аудіо «${a.name}» повторюється.`)
    names.add(a.name.toLowerCase())
    if (typeof t.words !== 'string') throw new BuildError(`Доріжка ${i + 1}: немає файла слів.`)
    t.words = at(base, t.words)
    if (t.text !== undefined) t.text = at(base, t.text)
    if (!t.text && !plan.text) throw new BuildError(`Доріжка ${i + 1}: немає тексту.`)
  }
  if (plan.text) plan.text = at(base, plan.text)
  return plan
}

export async function makeSentences(plan: PlanV2): Promise<SentencesFile> {
  // Chapters of each track: its own text, or the chapters of the one book text.
  const parts: Array<{ track: TrackPlanV2; chapters: Chapter[] }> = []
  let title = plan.title ?? ''
  let author = plan.author ?? ''
  let format: 'epub' | 'txt' | 'md' = 'txt'
  if (plan.text) {
    const book = await readText(plan.text, basename(plan.text, extname(plan.text)))
    title ||= book.title
    author ||= book.author
    format = book.format
    let last = 0
    for (const [i, track] of plan.tracks.entries()) {
      const wanted = track.chapters ?? (plan.tracks.length === 1 ? book.chapters.map((_, c) => c + 1) : [])
      if (!wanted.length) throw new BuildError(`Доріжка ${i + 1}: вкажіть розділи, які вона читає.`)
      for (const c of wanted) {
        if (!Number.isInteger(c) || c < 1 || c > book.chapters.length) throw new BuildError(`Доріжка ${i + 1}: розділу ${c} немає.`)
        if (c <= last) throw new BuildError(`Доріжка ${i + 1}: розділ ${c} повторюється або йде не по порядку.`)
        last = c
      }
      parts.push({ track, chapters: wanted.map((c) => book.chapters[c - 1]) })
    }
  } else {
    for (const track of plan.tracks) {
      const own = await readText(track.text!, track.title ?? track.audio.name)
      const chapters = own.chapters.map((c, i) => (i === 0 && track.title ? { ...c, title: track.title } : c))
      parts.push({ track, chapters })
    }
    title ||= plan.tracks[0].title ?? 'Book'
  }

  const chapters: Chapter[] = []
  const sentences: SentenceOccurrence[] = []
  const tracks: SentencesFile['tracks'] = []
  for (const { track, chapters: own } of parts) {
    const label = `Доріжка ${track.id} (${track.audio.name})`
    const heard: WhisperWord[] = []
    const heardWords: string[] = []
    for (const word of readWords(track.words, label)) {
      for (const part of normalizeWords(word.word)) {
        heard.push(word)
        heardWords.push(part)
      }
    }
    for (let k = 1; k < heard.length; k++) {
      if (heard[k].start < heard[k - 1].start) throw new BuildError(`${label}: мітки слів ідуть не за часом.`)
    }
    // Words of the spoken paragraphs; headings are not in the recording and are not linked.
    const bookWords: string[] = []
    const owner: Array<{ chapter: number; paragraph: number; sentence: number }> = []
    const first = chapters.length
    own.forEach((chapter, ci) => chapter.paragraphs.forEach((p, pi) => p.sentences.forEach((s, si) => {
      if (p.kind === 'heading') return
      for (const word of normalizeWords(s)) {
        bookWords.push(word)
        owner.push({ chapter: first + ci, paragraph: pi, sentence: si })
      }
    })))
    const { pairs, direct } = linkWords(bookWords, heardWords)
    const link = new Map<number, WhisperWord>()
    for (const [b, h] of pairs) link.set(b, heard[h])
    const bySentence = new Map<string, number[]>()
    owner.forEach((o, i) => {
      const key = `${o.chapter}-${o.paragraph}:${o.sentence}`
      const list = bySentence.get(key) ?? []
      list.push(i)
      bySentence.set(key, list)
    })
    let previousEnd = 0
    let timed = 0
    let count = 0
    own.forEach((chapter, ci) => {
      chapters.push(chapter)
      chapter.paragraphs.forEach((p, pi) => p.sentences.forEach((text, si) => {
        count++
        const key = paragraphKey({ chapter: first + ci, paragraph: pi })
        const ids = bySentence.get(`${first + ci}-${pi}:${si}`) ?? []
        const hits = ids.map((i) => link.get(i)).filter((w): w is WhisperWord => !!w)
        const matched = ids.length ? hits.length / ids.length : 0
        let start: number | null = null
        let end: number | null = null
        if (hits.length && matched >= MIN_MATCHED) {
          start = Math.round(Math.max(hits[0].start, previousEnd) * 100) / 100
          end = Math.round(Math.max(hits[hits.length - 1].end, start + 0.1) * 100) / 100
          previousEnd = end
          timed++
        }
        const hash = createHash('sha256').update(text).digest('hex').slice(0, 12)
        sentences.push({ id: `${track.id}:${key}:${si}:${hash}`, key, sentence: si, text, track: track.id, start, end, matched: Math.round(matched * 100) / 100 })
      }))
    })
    tracks.push({ id: track.id, ...track.audio, bookWords: bookWords.length, heardWords: heardWords.length, linkedWords: link.size, timed, sentences: count, direct })
  }
  return {
    format: SENTENCES_FORMAT, version: SENTENCES_VERSION, language: sourceLanguage, edition: await editionHash(chapters),
    book: { title, author, format, chapters }, tracks, sentences,
  }
}

export interface TranslationItem { id: string; text: string }

/** Problems that block the book: ids missing, unknown or twice, wrong type, empty text. Heuristics are the converter's. */
export function translationStructure(sentences: SentenceOccurrence[], value: unknown): string[] {
  if (!Array.isArray(value)) return ['Переклад має бути списком { id, text }.']
  const wanted = new Set(sentences.map((s) => s.id))
  const seen = new Set<string>()
  const problems: string[] = []
  for (const [i, item] of value.entries()) {
    const id = (item as TranslationItem)?.id
    const text = (item as TranslationItem)?.text
    if (typeof id !== 'string' || typeof text !== 'string') problems.push(`Переклад ${i + 1}: потрібні рядки id і text.`)
    else if (!wanted.has(id)) problems.push(`Переклад ${i + 1}: речення «${id}» немає в книжці.`)
    else if (seen.has(id)) problems.push(`Переклад речення «${id}» повторюється.`)
    else if (!text.trim()) problems.push(`Переклад речення «${id}» порожній.`)
    if (typeof id === 'string') seen.add(id)
  }
  const missing = [...wanted].filter((id) => !seen.has(id))
  if (missing.length) problems.push(`Немає перекладу речень: ${missing.slice(0, 5).join(', ')}${missing.length > 5 ? ` і ще ${missing.length - 5}` : ''}.`)
  return problems
}

export interface SourceInfo {
  title?: string
  url?: string
  author?: string
  contentRights?: { basis: 'own' | 'licence' | 'permission'; licence?: string; attribution?: string; confirmed: boolean }
  acquisition?: { method: 'user-file' | 'author-download' | 'platform-permitted' | 'permission'; detail?: string; confirmed: boolean }
}

export function checkSource(value: unknown): string[] {
  if (value === undefined) return []
  const s = value as SourceInfo
  if (!s || typeof s !== 'object') return ['Опис джерела має бути об’єктом.']
  const problems: string[] = []
  for (const field of ['title', 'url', 'author'] as const) if (s[field] !== undefined && typeof s[field] !== 'string') problems.push(`Джерело: «${field}» має бути рядком.`)
  if (s.contentRights && !(['own', 'licence', 'permission'].includes(s.contentRights.basis) && typeof s.contentRights.confirmed === 'boolean')) problems.push('Джерело: права на вміст описано неправильно.')
  if (s.acquisition && !(['user-file', 'author-download', 'platform-permitted', 'permission'].includes(s.acquisition.method) && typeof s.acquisition.confirmed === 'boolean')) problems.push('Джерело: спосіб отримання описано неправильно.')
  return problems
}

export async function buildFromSentences(options: { sentences: string; translations: string; source?: string; out: string; id?: string; maxPackageBytes?: number }) {
  let file: SentencesFile
  let translations: unknown
  let source: unknown
  try {
    file = JSON.parse(readFileSync(options.sentences, 'utf8'))
    translations = JSON.parse(readFileSync(options.translations, 'utf8'))
    source = options.source ? JSON.parse(readFileSync(options.source, 'utf8')) : undefined
  } catch (error) {
    throw new BuildError(`Вхідний файл не прочитано: ${(error as Error).message}`)
  }
  if (file?.format !== SENTENCES_FORMAT || file.version !== SENTENCES_VERSION) throw new BuildError('Це не файл речень протоколу 2.')
  if (file.language !== sourceLanguage) throw new BuildError(`Речення мови «${file.language}», а інструмент — «${sourceLanguage}».`)
  if (file.edition !== await editionHash(file.book.chapters)) throw new BuildError('Речення не відповідають тексту книжки (редакція змінилася).')
  const problems = [...translationStructure(file.sentences, translations), ...checkSource(source)]
  if (problems.length) throw new BuildError(problems.join('\n'))
  const byId = new Map((translations as TranslationItem[]).map((t) => [t.id, t.text]))
  const byKey = new Map<string, string[]>()
  const sync: Record<string, SyncEntry[]> = {}
  for (const s of file.sentences) {
    const lines = byKey.get(s.key) ?? []
    lines[s.sentence] = byId.get(s.id)!
    byKey.set(s.key, lines)
    const entries = sync[s.key] ?? []
    entries[s.sentence] = s.start === null || s.end === null ? null : [s.track, s.start, s.end]
    sync[s.key] = entries
  }
  const pkg: ReaderPackage & { source?: unknown } = {
    format: PACKAGE_FORMAT, version: PACKAGE_VERSION,
    packageId: options.id ?? basename(options.out).replace(/\.reader\.json$/, ''),
    edition: file.edition, language: file.language, translationLanguage: TRANSLATION_LANGUAGE,
    book: file.book, translations: Object.fromEntries(byKey), sync,
    tracks: file.tracks.map((t) => ({ id: t.id, name: t.name, size: t.size, sha256: t.sha256 })),
    ...(source === undefined ? {} : { source }),
  }
  const json = JSON.stringify(pkg)
  const bytes = Buffer.byteLength(json, 'utf8')
  const max = options.maxPackageBytes ?? maxFileSize
  if (bytes > max) throw new BuildError(`Пакет завеликий для Reader: ${bytes} байтів, межа ${max}.`)
  const checked = await validatePackage(JSON.parse(json))
  if (checked.length) throw new BuildError(`Пакет не пройшов перевірку Reader:\n${checked.join('\n')}`)
  writeFileAtomic(options.out, json)
  return { kind: 'package' as const, path: options.out, sentences: file.sentences.length, timed: file.sentences.filter((s) => s.start !== null).length }
}
