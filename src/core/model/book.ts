// Port of EnglishReader/Model/Book.swift. Field names match the Swift JSON encoding.

export type BookFormat = 'epub' | 'txt' | 'md'

export const formatLabel = (format: BookFormat): string => format.toUpperCase()

export type ParagraphKind = 'heading' | 'text'

export type TextStyle = 'italic' | 'bold'

/** Italic or bold text inside one sentence: [start, end) offsets of the sentence text (specs/011-epub-formatting, E2). */
export interface TextMark {
  sentence: number
  start: number
  end: number
  style: TextStyle
}

export interface Paragraph {
  kind: ParagraphKind
  sentences: string[]
  /** Missing when the paragraph has no italic or bold text, and in books imported before 2026-10-28. */
  marks?: TextMark[]
}

/** An entry of the book's own table of contents, pointing at a paragraph (specs/011-epub-formatting, E1). */
export interface ContentsEntry {
  title: string
  /** 0 for the top level. */
  level: number
  chapter: number
  paragraph: number
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
  /** The EPUB table of contents; missing for TXT and MD, EPUB without one and books imported before 2026-10-28. */
  contents?: ContentsEntry[]
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
  /** Italic and bold ranges of `text`. */
  marks?: { start: number; end: number; style: TextStyle }[]
}

export interface RawChapter {
  title: string
  blocks: RawBlock[]
  /** EPUB: the file of the chapter and the block that follows each element id in it, for the table of contents. */
  source?: string
  anchors?: Record<string, number>
}

/** A table of contents entry before it is resolved to a paragraph: the file and the element id in it. */
export interface RawContentsEntry {
  title: string
  level: number
  source: string
  anchor: string
}

export interface RawBook {
  title: string
  author: string
  chapters: RawChapter[]
  contents?: RawContentsEntry[]
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
