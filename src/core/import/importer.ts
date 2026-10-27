// Port of EnglishReader/Import/BookImporter.swift.
import { ImportError } from '../../contracts.ts'
import type { Book, BookFormat, RawBook } from '../model/book.ts'
import { makeBook } from '../model/segmenter.ts'
import { parseEPUB } from './epub.ts'
import { decodeText, parseMarkdown, parsePlainText } from './text.ts'

export const maxFileSize = 50 * 1024 * 1024

export function formatForExtension(ext: string): BookFormat | null {
  switch (ext.toLowerCase()) {
    case 'epub': return 'epub'
    case 'txt': case 'text': return 'txt'
    case 'md': case 'markdown': return 'md'
    default: return null
  }
}

/** `unreadable` receives the EPUB files that could not be read (the book is imported without them). */
export async function importBook(data: Uint8Array, format: BookFormat, fallbackTitle: string, unreadable?: string[]): Promise<Book> {
  if (data.length > maxFileSize) throw new ImportError({ kind: 'tooLarge' })
  let raw: RawBook
  switch (format) {
    case 'epub': raw = await parseEPUB(data, fallbackTitle, unreadable); break
    case 'txt': raw = parsePlainText(decodeText(data), fallbackTitle); break
    case 'md': raw = parseMarkdown(decodeText(data), fallbackTitle); break
  }
  const book = makeBook(raw, format)
  if (book.chapters.length === 0) throw new ImportError({ kind: 'emptyText' })
  return book
}

/** Imports a file chosen in the system file picker. */
export async function importFile(file: File, unreadable?: string[]): Promise<Book> {
  const dot = file.name.lastIndexOf('.')
  const ext = dot < 0 ? '' : file.name.slice(dot + 1).toLowerCase()
  const format = formatForExtension(ext)
  if (!format) throw new ImportError({ kind: 'unsupportedFormat', ext })
  if (file.size > maxFileSize) throw new ImportError({ kind: 'tooLarge' })
  let data: Uint8Array
  try {
    data = new Uint8Array(await file.arrayBuffer())
  } catch {
    throw new ImportError({ kind: 'unreadable' })
  }
  const fallbackTitle = dot < 0 ? file.name : file.name.slice(0, dot)
  return importBook(data, format, fallbackTitle, unreadable)
}
