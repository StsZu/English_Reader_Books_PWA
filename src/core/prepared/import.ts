// Import of a prepared book (specs/013-prepared-book, D0): `<name>.reader.json` and its audio files chosen together.
// Everything is checked before anything is written; the book appears in the library only at the end (M9).
import type { Book, BookSummary } from '../model/book.ts'
import { journalDelete, journalPut, putTracksInOrder, saveSync } from '../audiobook/store.ts'
import { withImportLock } from './coordination.ts'
import { ContainerError, matchPackage, openContainer, type ByteSource } from './container.ts'
import { TranslationStore } from '../ai/translation.ts'
import { addBook, deleteBook } from '../storage/library.ts'
import { maxFileSize } from '../import/importer.ts'
import { sha256File } from '../util/sha256.ts'
import { PACKAGE_SUFFIX, validatePackage, type ReaderPackage, type StoredSync } from './package.ts'

export const isPackageFile = (file: { name: string }) => file.name.toLowerCase().endsWith(PACKAGE_SUFFIX)

export interface PreparedImport {
  summary: BookSummary
  /** Sentences without matching audio: they are never highlighted. */
  untimed: number
  sentences: number
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
    else if (file.size !== track.size || await sha256File(file) !== track.sha256) different.push(track.name)
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

/** Tests: called after each phase is written, to stop an import in the middle (specs/015, R021). */
export interface ImportHooks { afterPhase?(phase: string, bookId: string): Promise<void> }

export async function importPrepared(files: File[], now = new Date(), hooks: ImportHooks = {}): Promise<PreparedImport> {
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
  return withImportLock(() => writePrepared(pkg, audio, book, hooks))
}

async function writePrepared(pkg: ReaderPackage, audio: File[], book: Book, hooks: ImportHooks): Promise<PreparedImport> {
  const phase = async (name: string) => {
    await journalPut({ bookId: book.id, phase: name, startedAt: book.importedAt })
    await hooks.afterPhase?.(name, book.id)
  }
  try {
    await phase('checked')
    const tracks = await putTracksInOrder(book.id, audio)
    await phase('tracks')
    const ids = new Map(pkg.tracks.map((track, i) => [track.id, tracks[i].id]))
    const sync: StoredSync = {}
    for (const [key, entries] of Object.entries(pkg.sync)) {
      sync[key] = entries.map((entry) => (entry ? [ids.get(entry[0])!, entry[1], entry[2]] : null))
    }
    await saveSync(book.id, sync)
    await phase('sync')
    const store = new TranslationStore(book.id)
    for (const [key, lines] of Object.entries(pkg.translations)) await store.saveForKey(lines, key)
    await phase('translations')
    const summary = await addBook(book)
    await journalDelete(book.id)
    const sentences = book.chapters.reduce((n, c) => n + c.paragraphs.reduce((m, p) => m + p.sentences.length, 0), 0)
    const timed = Object.values(pkg.sync).reduce((n, entries) => n + entries.filter(Boolean).length, 0)
    return { summary, untimed: sentences - timed, sentences }
  } catch (error) {
    // Nothing of a failed import stays: audio, time and translations of the new id (the book itself was not added).
    await deleteBook(book.id).catch(() => {})
    await journalDelete(book.id).catch(() => {})
    throw error
  }
}


// ----------------------------------------------------------------- one file (specs/015-reader-book-container, R023)

/** A `.polenuk` (or the same content as `.zip`): one file with the package and its MP3s. */
export const isContainerFile = (file: { name: string }) => /\.(polenuk|zip)$/i.test(file.name)

/**
 * Imports a one-file prepared book. The container is read in pieces (File.slice); its package and MP3s become the
 * same input the folder import takes, so the checks (language, translation, time, SHA-256) and the atomic write with
 * the import lock are the ones of importPrepared. Nothing is written when any check fails.
 */
export async function importContainer(file: File, now = new Date()): Promise<PreparedImport> {
  const src: ByteSource = { size: file.size, read: async (a, b) => new Uint8Array(await file.slice(a, b).arrayBuffer()) }
  let opened
  try {
    opened = await openContainer(src)
  } catch (error) {
    if (error instanceof ContainerError) throw new Error(`Книжку не імпортовано. ${error.message}`)
    throw error
  }
  const problems = await validatePackage(opened.package)
  if (problems.length) throw new Error(`Книжку не імпортовано. ${problems.join(' ')}`)
  const mismatch = matchPackage(opened, opened.package as ReaderPackage)
  if (mismatch.length) throw new Error(`Книжку не імпортовано. ${mismatch.join(' ')}`)
  const pkg = new File([JSON.stringify(opened.package)], 'book.reader.json', { type: 'application/json' })
  // Slices of the chosen file: no MP3 is copied into memory here; importPrepared hashes and stores them in pieces.
  const audio = opened.audio.map((a) => new File([file.slice(a.dataStart, a.dataStart + a.size)], a.name, { type: 'audio/mpeg' }))
  return importPrepared([pkg, ...audio], now)
}

/** The prepared-book button: one container, or a package with its audio files. */
export async function importPreparedSelection(files: File[], now = new Date()): Promise<PreparedImport> {
  if (files.length === 1 && isContainerFile(files[0])) return importContainer(files[0], now)
  if (files.some(isContainerFile)) throw new Error('Виберіть або один файл .polenuk, або файл .reader.json разом з аудіофайлами.')
  return importPrepared(files, now)
}
