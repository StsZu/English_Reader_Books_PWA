// Search in the text of the open book (specs/010-library, F4): sentences that contain the query, case- and diacritic-insensitive.
import type { Book, SentenceRef } from './book.ts'
import { fold, foldedRange } from '../util/fold.ts'

/** Shorter queries match almost every sentence. */
export const MIN_QUERY_LENGTH = 2
/** Results shown at once; the rest are only counted. */
export const SEARCH_LIMIT = 100

export interface SearchHit {
  ref: SentenceRef
  chapterTitle: string
  text: string
  /** The first match in `text`: [start, end) offsets. */
  match: [number, number]
}

export interface SearchResult {
  hits: SearchHit[]
  /** All matching sentences, also the ones beyond the limit. */
  total: number
}

export function searchBook(book: Book, query: string, limit = SEARCH_LIMIT): SearchResult {
  const trimmed = query.trim()
  const needle = fold(trimmed)
  const hits: SearchHit[] = []
  let total = 0
  if (needle.length < MIN_QUERY_LENGTH) return { hits, total }
  book.chapters.forEach((chapter, c) => {
    chapter.paragraphs.forEach((paragraph, p) => {
      paragraph.sentences.forEach((text, sentence) => {
        if (!fold(text).includes(needle)) return
        total++
        if (hits.length >= limit) return
        hits.push({
          ref: { paragraph: { chapter: c, paragraph: p }, sentence },
          chapterTitle: chapter.title,
          text,
          match: foldedRange(text, trimmed) ?? [0, 0],
        })
      })
    })
  })
  return { hits, total }
}
