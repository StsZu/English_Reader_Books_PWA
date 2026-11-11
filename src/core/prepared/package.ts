// Prepared book (specs/013-prepared-book): the text split into sentences, its Ukrainian translation,
// the audio tracks and the time of every sentence in them, in one `<name>.reader.json` next to the audio files.
import type { Book, Chapter, ContentsEntry, SentenceRef } from '../model/book.ts'
import { paragraphKey } from '../model/book.ts'
import { sha256Hex } from '../util/hash.ts'
import { sourceLanguage, sourceLanguageName } from '../language.ts'

export const PACKAGE_FORMAT = 'reader-book'
export const PACKAGE_VERSION = 1
export const PACKAGE_SUFFIX = '.reader.json'
/** The translation shown by the reader (specs/013-prepared-book, M3). */
export const TRANSLATION_LANGUAGE = 'uk'

export interface PackageTrack {
  /** Stable id inside the package: sync entries refer to it, not to the place in the list (M5). */
  id: string
  name: string
  size: number
  /** SHA-256 of the file, lowercase hex. */
  sha256: string
}

/** [track id, start, end] in seconds from the start of that track; null: no matching audio, never highlighted. */
export type SyncEntry = [string, number, number] | null

export interface ReaderPackage {
  format: typeof PACKAGE_FORMAT
  version: number
  /** Id of the package (M2); the book in the library gets its own id. */
  packageId: string
  /** SHA-256 of the canonical text and sentence boundaries (`editionHash`). */
  edition: string
  language: string
  translationLanguage: string
  book: Pick<Book, 'title' | 'author' | 'format' | 'chapters'> & { contents?: ContentsEntry[] }
  /** Paragraph key ("chapter-paragraph") → translation of each of its sentences (M3). */
  translations: Record<string, string[]>
  tracks: PackageTrack[]
  /** Paragraph key → one entry per sentence. */
  sync: Record<string, SyncEntry[]>
}

/** Text and sentence boundaries only: no ids, dates, formatting of the JSON or order of its keys (M2). */
export function editionHash(chapters: Chapter[]): Promise<string> {
  const canonical = chapters.map((c) => [c.title, c.paragraphs.map((p) => [p.kind, p.sentences])])
  return sha256Hex(JSON.stringify(canonical))
}

const isString = (value: unknown): value is string => typeof value === 'string'
const isFiniteNumber = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value)

/**
 * Checks everything that can be checked without the audio files. Returns the problems found, empty when valid.
 * `language`: the book language of this app (S9: a Polish package is not imported into English Reader and back).
 */
export async function validatePackage(value: unknown, language: string = sourceLanguage): Promise<string[]> {
  const problems: string[] = []
  const pkg = value as Partial<ReaderPackage> | null
  if (!pkg || typeof pkg !== 'object' || pkg.format !== PACKAGE_FORMAT) return ['Це не файл підготовленої книжки.']
  if (pkg.version !== PACKAGE_VERSION) return [`Версія файла ${String(pkg.version)} не підтримується.`]
  if (pkg.language !== language) {
    return [`Книжку підготовлено для мови «${String(pkg.language)}», а цей застосунок читає книжки ${sourceLanguageName.instrumental} («${language}»).`]
  }
  if (pkg.translationLanguage !== TRANSLATION_LANGUAGE) problems.push(`Переклад у файлі не українською («${String(pkg.translationLanguage)}»).`)
  if (!isString(pkg.packageId) || !pkg.packageId) problems.push('Немає ідентифікатора пакета.')
  const book = pkg.book
  if (!book || !isString(book.title) || !isString(book.author) || !['epub', 'txt', 'md'].includes(book.format as string)
    || !Array.isArray(book.chapters) || book.chapters.length === 0) {
    return [...problems, 'Немає тексту книжки.']
  }
  for (const [c, chapter] of book.chapters.entries()) {
    if (!chapter || !isString(chapter.title) || !Array.isArray(chapter.paragraphs)) return [...problems, `Розділ ${c + 1} пошкоджено.`]
    for (const [p, paragraph] of chapter.paragraphs.entries()) {
      if (!paragraph || !['heading', 'text'].includes(paragraph.kind) || !Array.isArray(paragraph.sentences)
        || paragraph.sentences.length === 0 || !paragraph.sentences.every(isString)) {
        return [...problems, `Абзац ${c + 1}-${p + 1} пошкоджено.`]
      }
    }
  }
  if (pkg.edition !== await editionHash(book.chapters)) problems.push('Текст не збігається з редакцією, для якої зроблено переклад і час.')

  const tracks = Array.isArray(pkg.tracks) ? pkg.tracks : []
  if (tracks.length === 0) problems.push('Немає аудіодоріжок.')
  const trackIDs = new Set<string>()
  for (const track of tracks) {
    if (!track || !isString(track.id) || !isString(track.name) || !isFiniteNumber(track.size) || !isString(track.sha256)) {
      problems.push('Опис доріжки пошкоджено.')
    } else if (trackIDs.has(track.id)) {
      problems.push(`Доріжка «${track.id}» повторюється.`)
    } else {
      trackIDs.add(track.id)
    }
  }

  // Both maps are required objects (an untimed paragraph simply has no key in `sync`); anything else is refused here,
  // before any write (specs/015-reader-book-container, review 2026-11-11).
  const isMap = (value: unknown) => !!value && typeof value === 'object' && !Array.isArray(value)
  if (!isMap(pkg.translations)) problems.push('Немає перекладу (поле translations).')
  if (!isMap(pkg.sync)) problems.push('Немає часу речень (поле sync); для книжки без часу воно порожнє: {}.')
  const translations = isMap(pkg.translations) ? pkg.translations! : {}
  const sync = isMap(pkg.sync) ? pkg.sync! : {}
  let missingTranslation = 0
  let badTranslation = 0
  let badSync = 0
  for (const [c, chapter] of book.chapters.entries()) {
    for (const [p, paragraph] of chapter.paragraphs.entries()) {
      const key = paragraphKey({ chapter: c, paragraph: p })
      const lines = translations[key]
      if (lines === undefined) missingTranslation++
      else if (!Array.isArray(lines) || lines.length !== paragraph.sentences.length || !lines.every(isString)) badTranslation++
      const entries = sync[key]
      if (entries === undefined) continue
      if (!Array.isArray(entries) || entries.length !== paragraph.sentences.length) {
        badSync++
        continue
      }
      for (const entry of entries) {
        if (entry === null) continue
        if (!Array.isArray(entry) || entry.length !== 3 || !trackIDs.has(entry[0])
          || !isFiniteNumber(entry[1]) || !isFiniteNumber(entry[2]) || entry[1] < 0 || entry[2] <= entry[1]) {
          badSync++
          break
        }
      }
    }
  }
  if (missingTranslation) problems.push(`Немає перекладу для абзаців: ${missingTranslation}.`)
  if (badTranslation) problems.push(`Переклад не відповідає реченням в абзацах: ${badTranslation}.`)
  if (badSync) problems.push(`Час речень пошкоджено в абзацах: ${badSync}.`)
  // Every key, of both maps, is exactly "chapter-paragraph" of a paragraph that exists: no extra parts, no leading zeros.
  for (const key of [...Object.keys(translations), ...Object.keys(sync)]) {
    const match = /^(0|[1-9]\d*)-(0|[1-9]\d*)$/.exec(key)
    if (!match || !book.chapters[Number(match[1])]?.paragraphs[Number(match[2])]) {
      problems.push(`Переклад або час для абзацу ${key}, якого немає в тексті.`)
      break
    }
  }
  return problems
}

// MARK: Sentence at a time

export interface TimedSentence {
  start: number
  end: number
  ref: SentenceRef
}

/** Sentences of each track, in order of their start. */
export type SyncIndex = ReadonlyMap<string, TimedSentence[]>

/** Sync entries with the package track ids replaced by the ids of the stored tracks. */
export type StoredSync = Record<string, SyncEntry[]>

export function buildSyncIndex(sync: StoredSync): SyncIndex {
  const index = new Map<string, TimedSentence[]>()
  for (const [key, entries] of Object.entries(sync)) {
    const [chapter, paragraph] = key.split('-').map(Number)
    entries.forEach((entry, sentence) => {
      if (!entry) return
      const [track, start, end] = entry
      let list = index.get(track)
      if (!list) index.set(track, list = [])
      list.push({ start, end, ref: { paragraph: { chapter, paragraph }, sentence } })
    })
  }
  for (const list of index.values()) list.sort((a, b) => a.start - b.start)
  return index
}

/**
 * A pause shorter than this after a sentence keeps it highlighted, so the highlight does not blink between sentences;
 * a longer one (music, the reader's introduction, a gap in the alignment) highlights nothing.
 */
export const SYNC_GAP_SECONDS = 1

/** The sentence heard at `time` of the track, or null. */
export function sentenceAt(index: SyncIndex, track: string, time: number): SentenceRef | null {
  const list = index.get(track)
  if (!list?.length) return null
  let low = 0
  let high = list.length - 1
  let found = -1
  while (low <= high) {
    const middle = (low + high) >> 1
    if (list[middle].start <= time) {
      found = middle
      low = middle + 1
    } else {
      high = middle - 1
    }
  }
  if (found < 0) return null
  const item = list[found]
  return time < item.end + SYNC_GAP_SECONDS ? item.ref : null
}
