// Port of EnglishReader/Model/TextSegmenter.swift. NLTokenizer is replaced by Intl.Segmenter (ICU);
// ICU breaks after abbreviations that continue the sentence (src/core/language.ts), so those are glued back.
import type { Book, BookFormat, Paragraph, RawBook } from './book.ts'
import {
  abbreviations as abbreviationList, capitalLetterWords, dialogueDashStartsSentence, numberAbbreviations as numberAbbreviationList,
  sourceLanguage,
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

/**
 * Whether the next sentence continues this one: it ends with an abbreviation, a single-letter
 * initial ("A.", not the English word "I."), or a number abbreviation followed by a number.
 */
export function gluesToNext(sentence: string, next: string): boolean {
  const match = /(?:^|[\s("'“‘—–-])((?:\p{L}\.)*\p{L}+)\.$/u.exec(sentence)
  if (!match) return false
  const token = match[1]
  if (/^\p{Lu}$/u.test(token)) return !capitalWords.has(token)
  const lower = token.toLowerCase()
  if (numberAbbreviations.has(lower)) return /^\p{N}/u.test(next)
  return abbreviations.has(lower)
}

/**
 * Splits a paragraph into trimmed sentences. Very long sentences stay whole:
 * translation and speech both work per sentence, so only splitting at real
 * boundaries keeps the Ukrainian line aligned with its source.
 */
export function sentences(text: string): string[] {
  const cleaned = normalizeWhitespace(text)
  if (!cleaned) return []
  const result: string[] = []
  // ICU does not break before a dialogue dash («…jesteście? — Jestem Polak.»); where the dash starts a reply
  // (language.ts), a new sentence starts there when the dash is followed by a capital letter.
  // A lower-case attribution («— spytał.») stays glued below.
  const segments = [...sentenceSegmenter.segment(cleaned)].map(({ segment }) => segment)
  const pieces = dialogueDashStartsSentence
    ? segments.flatMap((segment) => segment.split(/(?<=[.?!…])\s+(?=[—–]\s*\p{Lu})/u))
    : segments
  for (const segment of pieces) {
    const sentence = segment.trim()
    if (!sentence) continue
    const glue = result.length > 0 && gluesToNext(result[result.length - 1], sentence)
    const firstLetter = sentence.match(/\p{L}/u)?.[0]
    const startsLowercase = !!firstLetter && firstLetter !== firstLetter.toUpperCase()
      && firstLetter === firstLetter.toLowerCase() && !/^\p{N}/u.test(sentence)
    // Glue fragments without letters (a lone "—"), dialogue attributions that start in lower case
    // ("Is it you?" he asked.) and text after an abbreviation ("Mr. Holmes") to the previous sentence.
    if (result.length > 0 && (glue || !hasLetter(sentence) || startsLowercase)) {
      result[result.length - 1] = result[result.length - 1] + ' ' + sentence
    } else {
      result.push(sentence)
    }
  }
  return result.length === 0 ? [cleaned] : result
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

export function makeBook(raw: RawBook, format: BookFormat, id: string = crypto.randomUUID().toUpperCase(),
  importedAt: string = new Date().toISOString()): Book {
  const chapters = []
  for (const rawChapter of raw.chapters) {
    const paragraphs: Paragraph[] = []
    for (const block of rawChapter.blocks) {
      const list = block.kind === 'heading'
        ? [normalizeWhitespace(block.text)].filter((s) => s.length > 0)
        : sentences(block.text)
      if (list.length > 0) paragraphs.push({ kind: block.kind, sentences: list })
    }
    if (paragraphs.length === 0) continue
    chapters.push({ title: rawChapter.title, paragraphs })
  }
  return { id, title: raw.title, author: raw.author, format, importedAt, chapters }
}
