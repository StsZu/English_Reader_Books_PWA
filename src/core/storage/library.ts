// Port of EnglishReader/Services/LibraryStore.swift: index in meta `library`, books in `books`.
import { signal } from '@preact/signals'
import { summarize, type Book, type BookSummary } from '../model/book.ts'
import { STORES, clearStore, deletePrefix, deleteValue, getValue, setValue } from './db.ts'
import { clearPosition } from './positions.ts'
import { resetAllSettings } from './settings.ts'
import { clearAllAudio, deleteAudio } from '../audiobook/store.ts'

const INDEX = 'library'
const DEMO_FLAG = 'demoSeeded.v1'

export const books = signal<BookSummary[]>([])
export const lastError = signal<string | null>(null)

/** Loads the library index; call once at startup. */
export async function initLibrary(): Promise<void> {
  const stored = await getValue<BookSummary[]>('meta', INDEX)
  books.value = Array.isArray(stored) ? stored : []
}

export async function loadBook(id: string): Promise<Book | null> {
  return (await getValue<Book>('books', id)) ?? null
}

export async function addBook(book: Book): Promise<BookSummary> {
  await setValue('books', book.id, book)
  const summary = summarize(book)
  books.value = [summary, ...books.value.filter((b) => b.id !== book.id)]
  await saveIndex()
  return summary
}

export async function deleteBook(id: string): Promise<void> {
  books.value = books.value.filter((b) => b.id !== id)
  await saveIndex()
  await deleteValue('books', id)
  await clearPosition(id)
  await deletePrefix('translations', `${id}|`)
  await deletePrefix('fragments', `${id}|`)
  await deleteAudio(id)
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

async function saveIndex() {
  await setValue('meta', INDEX, books.value)
}
