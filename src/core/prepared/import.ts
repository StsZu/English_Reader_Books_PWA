// Import of a prepared book (specs/013-prepared-book, D0): `<name>.reader.json` and its audio files chosen together.
// Everything is checked before anything is written; the book appears in the library only at the end (M9).
import type { Book, BookSummary } from '../model/book.ts'
import { putTracksInOrder, saveSync } from '../audiobook/store.ts'
import { TranslationStore } from '../ai/translation.ts'
import { addBook, deleteBook } from '../storage/library.ts'
import { maxFileSize } from '../import/importer.ts'
import { PACKAGE_SUFFIX, validatePackage, type ReaderPackage, type StoredSync } from './package.ts'

export const isPackageFile = (file: { name: string }) => file.name.toLowerCase().endsWith(PACKAGE_SUFFIX)

export interface PreparedImport {
  summary: BookSummary
  /** Sentences without matching audio: they are never highlighted. */
  untimed: number
  sentences: number
}

async function fileHash(file: Blob): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', await file.arrayBuffer())
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('')
}

export async function readPackage(file: File): Promise<ReaderPackage> {
  if (file.size > maxFileSize) throw new Error('Файл підготовленої книжки завеликий.')
  let value: unknown
  try {
    value = JSON.parse(await file.text())
  } catch {
    throw new Error('Файл підготовленої книжки не читається.')
  }
  const problems = await validatePackage(value)
  if (problems.length) throw new Error(`Книжку не імпортовано. ${problems.join(' ')}`)
  return value as ReaderPackage
}

/** The audio file of every track of the package, checked by name, size and SHA-256. */
export async function matchTracks(pkg: ReaderPackage, files: File[]): Promise<File[]> {
  const matched: File[] = []
  const missing: string[] = []
  const different: string[] = []
  for (const track of pkg.tracks) {
    const file = files.find((f) => f.name === track.name)
    if (!file) missing.push(track.name)
    else if (file.size !== track.size || await fileHash(file) !== track.sha256) different.push(track.name)
    else matched.push(file)
  }
  if (missing.length) throw new Error(`Книжку не імпортовано. Виберіть разом з нею аудіофайли: ${missing.join(', ')}.`)
  if (different.length) throw new Error(`Книжку не імпортовано. Аудіофайли відрізняються від тих, для яких зроблено час: ${different.join(', ')}.`)
  return matched
}

async function checkSpace(bytes: number) {
  const estimate = await navigator.storage?.estimate?.().catch(() => null)
  if (!estimate?.quota || estimate.usage === undefined) return
  if (estimate.quota - estimate.usage < bytes * 1.1) throw new Error('Книжку не імпортовано: на пристрої замало місця для аудіо.')
}

export async function importPrepared(files: File[], now = new Date()): Promise<PreparedImport> {
  const packages = files.filter(isPackageFile)
  if (packages.length !== 1) throw new Error('Виберіть один файл підготовленої книжки (.reader.json) разом з його аудіофайлами.')
  const pkg = await readPackage(packages[0])
  const audio = await matchTracks(pkg, files)
  await checkSpace(audio.reduce((sum, f) => sum + f.size, 0))

  const book: Book = {
    id: crypto.randomUUID(),
    title: pkg.book.title,
    author: pkg.book.author,
    format: pkg.book.format,
    importedAt: now.toISOString(),
    chapters: pkg.book.chapters,
    ...(pkg.book.contents ? { contents: pkg.book.contents } : {}),
  }
  try {
    const tracks = await putTracksInOrder(book.id, audio)
    const ids = new Map(pkg.tracks.map((track, i) => [track.id, tracks[i].id]))
    const sync: StoredSync = {}
    for (const [key, entries] of Object.entries(pkg.sync)) {
      sync[key] = entries.map((entry) => (entry ? [ids.get(entry[0])!, entry[1], entry[2]] : null))
    }
    await saveSync(book.id, sync)
    const store = new TranslationStore(book.id)
    for (const [key, lines] of Object.entries(pkg.translations)) await store.saveForKey(lines, key)
    const summary = await addBook(book)
    const sentences = book.chapters.reduce((n, c) => n + c.paragraphs.reduce((m, p) => m + p.sentences.length, 0), 0)
    const timed = Object.values(pkg.sync).reduce((n, entries) => n + entries.filter(Boolean).length, 0)
    return { summary, untimed: sentences - timed, sentences }
  } catch (error) {
    // Nothing of a failed import stays: audio, time and translations of the new id (the book itself was not added).
    await deleteBook(book.id).catch(() => {})
    throw error
  }
}
