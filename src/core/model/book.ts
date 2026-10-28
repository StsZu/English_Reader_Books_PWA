// Port of EnglishReader/Model/Book.swift. Field names match the Swift JSON encoding.

export type BookFormat = 'epub' | 'txt' | 'md'

export const formatLabel = (format: BookFormat): string => format.toUpperCase()

export type ParagraphKind = 'heading' | 'text'

export interface Paragraph {
  kind: ParagraphKind
  sentences: string[]
}

export interface Chapter {
  title: string
  paragraphs: Paragraph[]
}

export interface Book {
  id: string
  title: string
  author: string
  format: BookFormat
  /** ISO 8601 date. */
  importedAt: string
  chapters: Chapter[]
}

export interface BookSummary {
  id: string
  title: string
  author: string
  format: BookFormat
  importedAt: string
  /** When the book was last opened in the reader; missing in older indexes (specs/010-library, F1). */
  openedAt?: string
  chapterCount: number
  sentenceCount: number
}

/** Address of one paragraph inside a book. */
export interface ParagraphRef {
  chapter: number
  paragraph: number
}

/** Address of one sentence inside a book. */
export interface SentenceRef {
  paragraph: ParagraphRef
  sentence: number
}

/** Importer output before sentence segmentation. */
export interface RawBlock {
  kind: ParagraphKind
  text: string
}

export interface RawChapter {
  title: string
  blocks: RawBlock[]
}

export interface RawBook {
  title: string
  author: string
  chapters: RawChapter[]
}

export const paragraphText = (paragraph: Paragraph): string => paragraph.sentences.join(' ')

export const paragraphKey = (ref: ParagraphRef): string => `${ref.chapter}-${ref.paragraph}`

export const compareRefs = (a: ParagraphRef, b: ParagraphRef): number =>
  a.chapter - b.chapter || a.paragraph - b.paragraph

export const sameParagraph = (a: ParagraphRef | null | undefined, b: ParagraphRef | null | undefined): boolean =>
  !!a && !!b && a.chapter === b.chapter && a.paragraph === b.paragraph

export const sameSentence = (a: SentenceRef | null | undefined, b: SentenceRef | null | undefined): boolean =>
  !!a && !!b && sameParagraph(a.paragraph, b.paragraph) && a.sentence === b.sentence

export function summarize(book: Book): BookSummary {
  return {
    id: book.id,
    title: book.title,
    author: book.author,
    format: book.format,
    importedAt: book.importedAt,
    chapterCount: book.chapters.length,
    sentenceCount: book.chapters.reduce((sum, c) => sum + c.paragraphs.reduce((s, p) => s + p.sentences.length, 0), 0),
  }
}

export function sentenceText(book: Book, ref: SentenceRef): string {
  return book.chapters[ref.paragraph.chapter].paragraphs[ref.paragraph.paragraph].sentences[ref.sentence]
}
