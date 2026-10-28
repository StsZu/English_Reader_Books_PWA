// Port of EnglishReader/Services/LibraryStore.swift: index in meta `library`, books in `books`.
import { signal } from '@preact/signals'
import { summarize, type Book, type BookSummary } from '../model/book.ts'
import { sourceLanguage } from '../language.ts'
import { fold } from '../util/fold.ts'
import { DB_NAME, STORES, clearStore, getValue, setValue, storageErrorText, transact } from './db.ts'
import { resetAllSettings } from './settings.ts'
import { clearAllAudio, deleteAudio } from '../audiobook/store.ts'

const INDEX = 'library'
const DEMO_FLAG = 'demoSeeded.v1'

export const books = signal<BookSummary[]>([])
export const lastError = signal<string | null>(null)

const asIndex = (value: unknown): BookSummary[] => (Array.isArray(value) ? value : [])

/** Other tabs of the app re-read the index after a change, so a stale list never hides or resurrects a book (R1). */
let channel: BroadcastChannel | null = null

function listenToOtherTabs() {
  if (channel || typeof BroadcastChannel === 'undefined') return
  channel = new BroadcastChannel(`${DB_NAME}-library`)
  channel.onmessage = () => { void reloadIndex() }
  ;(channel as BroadcastChannel & { unref?: () => void }).unref?.()
}

const announce = () => channel?.postMessage('library')

async function reloadIndex() {
  books.value = asIndex(await getValue('meta', INDEX))
}

/** Loads the library index; call once at startup. */
export async function initLibrary(): Promise<void> {
  listenToOtherTabs()
  await reloadIndex()
}

export async function loadBook(id: string): Promise<Book | null> {
  return (await getValue<Book>('books', id)) ?? null
}

/**
 * Saves the book and its index entry in one transaction (R1). The stored index is merged, not overwritten
 * with the list in memory; the list on screen changes only after the commit.
 */
export async function addBook(book: Book): Promise<BookSummary> {
  const summary = summarize(book)
  let index: BookSummary[]
  try {
    index = await transact(['books', 'meta'], async (tx) => {
      await tx.objectStore('books').put(book, book.id)
      const stored = asIndex(await tx.objectStore('meta').get(INDEX))
      // A book imported again keeps the time it was last opened (specs/010-library, F1).
      const openedAt = stored.find((b) => b.id === book.id)?.openedAt
      if (openedAt) summary.openedAt = openedAt
      const merged = [summary, ...stored.filter((b) => b.id !== book.id)]
      await tx.objectStore('meta').put(merged, INDEX)
      return merged
    })
  } catch (error) {
    throw new Error(`Не вдалося зберегти книжку: ${storageErrorText(error)}`)
  }
  books.value = index
  announce()
  return summary
}

/** Records when the book was opened in the reader: the order «Нещодавні» and «Продовжити» (specs/010-library, F1). */
export async function markOpened(id: string, now = new Date()): Promise<void> {
  const openedAt = now.toISOString()
  let index: BookSummary[]
  try {
    index = await transact(['meta'], async (tx) => {
      const stored = asIndex(await tx.objectStore('meta').get(INDEX))
      if (!stored.some((b) => b.id === id)) return stored
      const updated = stored.map((b) => (b.id === id ? { ...b, openedAt } : b))
      await tx.objectStore('meta').put(updated, INDEX)
      return updated
    })
  } catch {
    // Only the order of the library depends on it; the next opening tries again.
    return
  }
  books.value = index
  announce()
}

// MARK: - Order and search (specs/010-library, F2–F3)

export type LibrarySort = 'recent' | 'added' | 'title' | 'author'

export const librarySorts: { value: LibrarySort; label: string }[] = [
  { value: 'recent', label: 'Нещодавні' },
  { value: 'added', label: 'Додані' },
  { value: 'title', label: 'Назва' },
  { value: 'author', label: 'Автор' },
]

/** A book that was never opened counts as opened when it was imported. */
const openedTime = (book: BookSummary): string => book.openedAt ?? book.importedAt

const collator = new Intl.Collator(sourceLanguage, { sensitivity: 'base', numeric: true })

/** Books in the chosen order; ties keep the order of the index (newest import first). An unknown order is «Нещодавні». */
export function sortBooks(list: BookSummary[], sort: string): BookSummary[] {
  const byTitle = (a: BookSummary, b: BookSummary) => collator.compare(a.title, b.title)
  const compare: (a: BookSummary, b: BookSummary) => number =
    sort === 'added' ? (a, b) => b.importedAt.localeCompare(a.importedAt)
      : sort === 'title' ? byTitle
        // Books without an author go last.
        : sort === 'author' ? (a, b) => (!a.author !== !b.author ? (a.author ? -1 : 1) : collator.compare(a.author, b.author) || byTitle(a, b))
          : (a, b) => openedTime(b).localeCompare(openedTime(a))
  return [...list].sort(compare)
}

/** Books whose title or author contains the query, case- and diacritic-insensitive. */
export function filterBooks(list: BookSummary[], query: string): BookSummary[] {
  const needle = fold(query.trim())
  if (!needle) return list
  return list.filter((b) => fold(b.title).includes(needle) || fold(b.author).includes(needle))
}

/** The book for «Продовжити»: the last one opened; null when none was opened yet. */
export function lastOpened(list: BookSummary[]): BookSummary | null {
  let last: BookSummary | null = null
  for (const book of list) if (book.openedAt && (!last || book.openedAt > last.openedAt!)) last = book
  return last
}

/** Removes the book, its index entry, reading place and caches in one transaction; then its audio (separate database). */
export async function deleteBook(id: string): Promise<void> {
  const range = (prefix: string) => IDBKeyRange.bound(prefix, prefix + '\uffff')
  let index: BookSummary[]
  try {
    index = await transact(['books', 'meta', 'positions', 'translations', 'fragments'], async (tx) => {
      const rest = asIndex(await tx.objectStore('meta').get(INDEX)).filter((b) => b.id !== id)
      await tx.objectStore('meta').put(rest, INDEX)
      await tx.objectStore('books').delete(id)
      await tx.objectStore('positions').delete(id)
      await tx.objectStore('translations').delete(range(`${id}|`))
      await tx.objectStore('fragments').delete(range(`${id}|`))
      return rest
    })
  } catch (error) {
    throw new Error(`Не вдалося видалити книжку: ${storageErrorText(error)}`)
  }
  books.value = index
  announce()
  // Audio left behind by a failure here is removed at the next start (removeOrphanAudio).
  await deleteAudio(id).catch(() => {})
}

/** Adds the bundled demo book on first launch so the reader is usable immediately. */
export async function seedDemoIfNeeded(loadDemo: () => Promise<Book | null>): Promise<void> {
  if (await getValue<boolean>('meta', DEMO_FLAG)) return
  await setValue('meta', DEMO_FLAG, true)
  try {
    const book = await loadDemo()
    if (book) await addBook(book)
  } catch {
    // The demo is optional; a failure leaves the library empty.
  }
}

/** Test hook: wipes all imported books, caches, saved data and settings. */
export async function resetAll(): Promise<void> {
  for (const store of STORES) await clearStore(store)
  await clearAllAudio()
  books.value = []
  try {
    if (typeof caches !== 'undefined') await caches.delete('tts')
  } catch {
    // Cache Storage may be unavailable outside a secure context.
  }
  resetAllSettings()
}
