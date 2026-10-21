// Port of ReadingPositionStore (EnglishReader/Services/LibraryStore.swift).
import type { ParagraphRef } from '../model/book.ts'
import { deleteValue, getValue, setValue } from './db.ts'

export async function loadPosition(bookID: string): Promise<ParagraphRef | null> {
  const value = await getValue<ParagraphRef>('positions', bookID)
  return value && typeof value.chapter === 'number' && typeof value.paragraph === 'number' ? value : null
}

export async function savePosition(bookID: string, ref: ParagraphRef): Promise<void> {
  await setValue('positions', bookID, { chapter: ref.chapter, paragraph: ref.paragraph })
}

export async function clearPosition(bookID: string): Promise<void> {
  await deleteValue('positions', bookID)
}
