// Port of EnglishReader/Model/TextSegmenter.swift. NLTokenizer is replaced by Intl.Segmenter (ICU);
// ICU breaks after abbreviations that continue the sentence (src/core/language.ts), so those are glued back.
import type { Book, BookFormat, Chapter, ContentsEntry, Paragraph, RawBlock, RawBook, TextMark } from './book.ts'
import {
  abbreviations as abbreviationList, capitalLetterWords, dialogueDashStartsSentence, nameAbbreviations as nameAbbreviationList,
  numberAbbreviations as numberAbbreviationList, sourceLanguage,
} from '../language.ts'

export interface WordRange {
  start: number
  end: number
}

const sentenceSegmenter = new Intl.Segmenter(sourceLanguage, { granularity: 'sentence' })
const wordSegmenter = new Intl.Segmenter(sourceLanguage, { granularity: 'word' })

const abbreviations = new Set(abbreviationList)

const hasLetter = (s: string): boolean => /\p{L}/u.test(s)

/** Abbreviations glued only before a number ("No. 7"), since "No." is also a whole reply. */
const numberAbbreviations = new Set(numberAbbreviationList)

const capitalWords = new Set(capitalLetterWords)

/** Abbreviations that are also words, glued only after a capitalized word («Szkoła im. Jana»). */
const nameAbbreviations = new Set(nameAbbreviationList)

/**
 * Whether the next sentence continues this one: it ends with an abbreviation, a single-letter
 * initial ("A.", not the English word "I."), or a number abbreviation followed by a number.
 * The abbreviation may follow an opening quote or bracket («„Prof. Nowak”», "[Mr. Smith").
 */
export function gluesToNext(sentence: string, next: string): boolean {
  const match = /(?:^|[\s("'“‘„«»‹›‚[—–-])((?:\p{L}\.)*\p{L}+)\.$/u.exec(sentence)
  if (!match) return false
  const token = match[1]
  if (/^\p{Lu}$/u.test(token)) return !capitalWords.has(token)
  const lower = token.toLowerCase()
  if (numberAbbreviations.has(lower)) return /^\p{N}/u.test(next)
  if (nameAbbreviations.has(lower)) return /(?:^|\s)\p{Lu}\p{L}*\s+$/u.test(sentence.slice(0, match.index + match[0].length - token.length - 1))
  return abbreviations.has(lower)
}

/** Breaks before a dialogue dash after the end of a sentence: «— Skąd? — Jestem.», «- Dobrze. - Jan wstał.». */
const dialogueBreak = /(?<=[.?!…])\s+(?=(?:[—–]\s*|-\s+)\p{Lu})/gu

/** Closing marks that ICU puts at the start of the next piece («Co?… nic.» → «Co?» / «… nic.»). */
const leadingClose = /^[…!?.]+/u

interface Span {
  start: number
  end: number
}

/** The span without surrounding spaces. */
function trimmed(text: string, span: Span): Span {
  let { start, end } = span
  while (start < end && /\s/u.test(text[start])) start++
  while (end > start && /\s/u.test(text[end - 1])) end--
  return { start, end }
}

/**
 * Splits a paragraph into trimmed sentences. Very long sentences stay whole:
 * translation and speech both work per sentence, so only splitting at real
 * boundaries keeps the Ukrainian line aligned with its source.
 * Every sentence is a piece of the normalized text, so glued pieces keep the spaces (or their absence) between them.
 */
export function sentences(text: string): string[] {
  const cleaned = normalizeWhitespace(text)
  if (!cleaned) return []
  // ICU does not break before a dialogue dash («…jesteście? — Jestem Polak.»); where the dash starts a reply
  // (language.ts), a new sentence starts there when the dash is followed by a capital letter.
  // A lower-case attribution («— spytał.») stays glued below.
  const pieces: Span[] = []
  for (const { segment, index } of sentenceSegmenter.segment(cleaned)) {
    let from = 0
    if (dialogueDashStartsSentence) {
      for (const dash of segment.matchAll(dialogueBreak)) {
        pieces.push({ start: index + from, end: index + dash.index })
        from = dash.index
      }
    }
    pieces.push({ start: index + from, end: index + segment.length })
  }
  const result: Span[] = []
  for (const piece of pieces) {
    const last = result[result.length - 1]
    const span = trimmed(cleaned, piece)
    const end = span.end
    let start = span.start
    // «…» or «!» right after the previous sentence, with no space, closes that sentence.
    const close = last && start === last.end ? leadingClose.exec(cleaned.slice(start, end)) : null
    if (close) {
      last.end = start + close[0].length
      start = trimmed(cleaned, { start: last.end, end }).start
    }
    if (start >= end) continue
    const sentence = cleaned.slice(start, end)
    const glue = last !== undefined && gluesToNext(cleaned.slice(last.start, last.end), sentence)
    const firstLetter = sentence.match(/\p{L}/u)?.[0]
    const startsLowercase = !!firstLetter && firstLetter !== firstLetter.toUpperCase()
      && firstLetter === firstLetter.toLowerCase() && !/^\p{N}/u.test(sentence)
    // Glue fragments without letters (a lone "—"), dialogue attributions that start in lower case
    // ("Is it you?" he asked.) and text after an abbreviation ("Mr. Holmes") to the previous sentence.
    if (last && (glue || !hasLetter(sentence) || startsLowercase)) {
      last.end = end
    } else {
      result.push({ start, end })
    }
  }
  return result.length === 0 ? [cleaned] : result.map(({ start, end }) => cleaned.slice(start, end))
}

/** Word ranges (UTF-16 offsets) used to make each word tappable; only tokens with letters. */
export function wordRanges(sentence: string): WordRange[] {
  const ranges: WordRange[] = []
  for (const { segment, index } of wordSegmenter.segment(sentence)) {
    if (hasLetter(segment)) ranges.push({ start: index, end: index + segment.length })
  }
  return ranges
}

export function words(sentence: string): string[] {
  return wordRanges(sentence).map((r) => sentence.slice(r.start, r.end))
}

export function normalizeWhitespace(text: string): string {
  return text.replaceAll(' ', ' ').replaceAll('­', '').replace(/\s+/g, ' ').trim()
}

/**
 * Moves the italic and bold ranges of a block onto its sentences. Every sentence is a piece of the normalized block
 * text in order (only the spaces between them are dropped); a block whose text was not normalized keeps no ranges.
 */
export function sentenceMarks(block: RawBlock, list: string[]): TextMark[] {
  if (!block.marks?.length || normalizeWhitespace(block.text) !== block.text) return []
  const result: TextMark[] = []
  let from = 0
  list.forEach((sentence, index) => {
    const base = block.text.indexOf(sentence, from)
    if (base < 0) return
    from = base + sentence.length
    for (const mark of block.marks!) {
      const start = Math.max(mark.start, base) - base
      const end = Math.min(mark.end, from) - base
      if (end > start) result.push({ sentence: index, start, end, style: mark.style })
    }
  })
  return result
}

export function makeBook(raw: RawBook, format: BookFormat, id: string = crypto.randomUUID().toUpperCase(),
  importedAt: string = new Date().toISOString()): Book {
  const chapters: Chapter[] = []
  /** For each raw chapter: its index in the book (or -1) and the paragraph each block became or precedes. */
  const placed: { chapter: number; paragraphOf: number[] }[] = []
  for (const rawChapter of raw.chapters) {
    const paragraphs: Paragraph[] = []
    const paragraphOf: number[] = []
    for (const block of rawChapter.blocks) {
      paragraphOf.push(paragraphs.length)
      const list = block.kind === 'heading'
        ? [normalizeWhitespace(block.text)].filter((s) => s.length > 0)
        : sentences(block.text)
      if (list.length === 0) continue
      const paragraph: Paragraph = { kind: block.kind, sentences: list }
      const marks = sentenceMarks(block, list)
      if (marks.length > 0) paragraph.marks = marks
      paragraphs.push(paragraph)
    }
    paragraphOf.push(paragraphs.length)
    placed.push({ chapter: paragraphs.length === 0 ? -1 : chapters.length, paragraphOf })
    if (paragraphs.length === 0) continue
    chapters.push({ title: rawChapter.title, paragraphs })
  }
  const book: Book = { id, title: raw.title, author: raw.author, format, importedAt, chapters }
  const contents = resolveContents(raw, chapters, placed)
  if (contents.length > 0) book.contents = contents
  return book
}

/**
 * Turns the EPUB table of contents into paragraph addresses (specs/011-epub-formatting, E1). Entries whose file was
 * not imported are dropped; a chapter that no entry points into gets its own entry, so «Зміст» reaches every chapter.
 */
function resolveContents(raw: RawBook, chapters: Chapter[], placed: { chapter: number; paragraphOf: number[] }[]): ContentsEntry[] {
  if (!raw.contents?.length) return []
  const resolved: ContentsEntry[] = []
  for (const entry of raw.contents) {
    const index = raw.chapters.findIndex((c) => c.source === entry.source)
    const chapter = index < 0 ? -1 : placed[index].chapter
    if (chapter < 0) continue
    const block = entry.anchor ? raw.chapters[index].anchors?.[entry.anchor] : 0
    if (block === undefined) continue
    const last = chapters[chapter].paragraphs.length - 1
    const paragraph = Math.min(placed[index].paragraphOf[Math.min(block, placed[index].paragraphOf.length - 1)], last)
    resolved.push({ title: entry.title, level: entry.level, chapter, paragraph })
  }
  if (resolved.length === 0) return []
  chapters.forEach((chapter, index) => {
    if (!resolved.some((e) => e.chapter === index)) resolved.push({ title: chapter.title, level: 0, chapter: index, paragraph: 0 })
  })
  // Book order; entries at the same place keep the order of the table of contents.
  return resolved
    .map((entry, order) => ({ entry, order }))
    .sort((a, b) => a.entry.chapter - b.entry.chapter || a.entry.paragraph - b.entry.paragraph || a.order - b.order)
    .map(({ entry }) => entry)
}
