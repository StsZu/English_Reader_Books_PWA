// Port of EnglishReader/Import/TextImporter.swift: decoding, plain text and Markdown.
import { ImportError } from '../../contracts.ts'
import { chapterHeading, textEncodings } from '../language.ts'
import type { RawBook, RawChapter } from '../model/book.ts'
import { normalizeWhitespace } from '../model/segmenter.ts'

const startsWith = (bytes: Uint8Array, prefix: number[]) => prefix.every((b, i) => bytes[i] === b)

/**
 * How much a decoding looks like real text: +1 for each word with non-ASCII letters that is all Cyrillic or Latin with
 * at least one ASCII letter, −1 for a word that mixes scripts, holds a symbol between letters («Zaїуіж», «³adny») or is
 * Latin without any ASCII letter («Ďđčâłň» — Cyrillic read as Central European).
 */
function plausibility(text: string): number {
  let score = 0
  for (const token of text.match(/\S*[^\x00-\x7f]\S*/gu) ?? []) {
    const word = token.replace(/^[\p{P}\p{S}]+|[\p{P}\p{S}]+$/gu, '')
    if ([...word].length < 2) continue
    if (/[^\p{L}\p{M}\x00-\x7f]/u.test(word)) score -= 1
    else if (/\p{Script=Cyrillic}/u.test(word)) score += /\p{Script=Latin}/u.test(word) ? -1 : 1
    else score += /[A-Za-z]/.test(word) ? 1 : -1
  }
  return score
}

export function decodeText(data: Uint8Array): string {
  let bytes = data
  if (startsWith(bytes, [0xef, 0xbb, 0xbf])) bytes = bytes.subarray(3)
  try {
    return new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes)
  } catch {
    // Not UTF-8; fall through.
  }
  // UTF-16 only with a byte-order mark: without one almost any even-length data "decodes".
  if (startsWith(bytes, [0xff, 0xfe]) || startsWith(bytes, [0xfe, 0xff])) {
    try {
      return new TextDecoder(bytes[0] === 0xff ? 'utf-16le' : 'utf-16be', { fatal: true }).decode(bytes)
    } catch {
      // Fall through.
    }
  }
  // V-27: UTF-8 with a few damaged bytes stays UTF-8; the damaged bytes become «\uFFFD».
  const lossy = new TextDecoder('utf-8', { ignoreBOM: true }).decode(bytes)
  const damaged = lossy.match(/\uFFFD/gu)?.length ?? 0
  const valid = lossy.match(/[^\x00-\x7f\uFFFD]/gu)?.length ?? 0
  if (valid >= 10 * damaged) return lossy
  // V-27: of the single-byte encodings the one whose words look real; on a tie the language's own (language.ts).
  let best: { text: string; score: number } | null = null
  for (const encoding of textEncodings) {
    try {
      const text = new TextDecoder(encoding).decode(bytes)
      const score = plausibility(text)
      if (!best || score > best.score) best = { text, score }
    } catch {
      // Encoding unavailable; try the next one.
    }
  }
  if (best) return best.text
  throw new ImportError({ kind: 'unreadable' })
}

// MARK: - Plain text

const chapterPattern = chapterHeading

export function isChapterHeading(paragraph: string): boolean {
  return [...paragraph].length <= 70 && chapterPattern.test(paragraph)
}

const trimSpaces = (s: string) => s.replace(/^[ \t]+|[ \t]+$/g, '')

export function parsePlainText(text: string, fallbackTitle: string): RawBook {
  const normalized = text.replaceAll('\r\n', '\n').replaceAll('\r', '\n')
  const lines = normalized.split('\n')
  const nonEmpty = lines.filter((l) => trimSpaces(l) !== '').length
  const blankRuns = normalized.split('\n\n').length - 1
  // Files with one paragraph per line have almost no blank lines.
  const onePerLine = nonEmpty > 3 && blankRuns * 10 < nonEmpty
  const paragraphs: string[] = []
  let current: string[] = []
  const flush = () => {
    const joined = trimSpaces(current.join(' '))
    if (joined) paragraphs.push(joined)
    current = []
  }
  for (const line of lines) {
    const trimmed = trimSpaces(line)
    if (!trimmed) {
      flush()
    } else if (onePerLine) {
      current.push(trimmed)
      flush()
    } else {
      current.push(trimmed)
    }
  }
  flush()
  if (paragraphs.length === 0) throw new ImportError({ kind: 'emptyText' })
  const chapters: RawChapter[] = []
  let chapter: RawChapter = { title: fallbackTitle, blocks: [] }
  for (const paragraph of paragraphs) {
    if (isChapterHeading(paragraph)) {
      if (chapter.blocks.length) chapters.push(chapter)
      chapter = { title: paragraph, blocks: [{ kind: 'heading', text: paragraph }] }
    } else {
      chapter.blocks.push({ kind: 'text', text: paragraph })
    }
  }
  if (chapter.blocks.length) chapters.push(chapter)
  return { title: fallbackTitle, author: '', chapters }
}

// MARK: - Markdown

const stripQuotes = (s: string) => s.replace(/^[ "']+|[ "']+$/g, '')

export function parseMarkdown(text: string, fallbackTitle: string): RawBook {
  const lines = text.replaceAll('\r\n', '\n').split('\n')
  let title: string | null = null
  let author = ''
  const chapters: RawChapter[] = []
  let chapter: RawChapter = { title: fallbackTitle, blocks: [] }
  let current: string[] = []
  let inCodeBlock = false
  let inFrontMatter = false
  const flush = () => {
    const joined = stripInline(current.join(' '))
    if (joined) chapter.blocks.push({ kind: 'text', text: joined })
    current = []
  }
  lines.forEach((line, index) => {
    const trimmed = trimSpaces(line)
    if (index === 0 && trimmed === '---') { inFrontMatter = true; return }
    if (inFrontMatter) {
      if (trimmed === '---') inFrontMatter = false
      else if (trimmed.toLowerCase().startsWith('author:')) author = stripQuotes(trimmed.slice(7))
      else if (trimmed.toLowerCase().startsWith('title:')) title = stripQuotes(trimmed.slice(6))
      return
    }
    if (trimmed.startsWith('```') || trimmed.startsWith('~~~')) { flush(); inCodeBlock = !inCodeBlock; return }
    if (inCodeBlock) return
    if (trimmed === '' || ([...trimmed].every((c) => '-*_'.includes(c)) && trimmed.length >= 3)) { flush(); return }
    if (trimmed.startsWith('#')) {
      flush()
      const level = /^#*/.exec(trimmed)![0].length
      const heading = stripInline(trimmed.slice(level))
      if (!heading) return
      if (level === 1 && title === null && chapters.length === 0 && chapter.blocks.length === 0) {
        title = heading
        return
      }
      if (level <= 2) {
        // A chapter that so far holds only headings absorbs the next heading.
        if (chapter.blocks.some((b) => b.kind === 'text')) {
          chapters.push(chapter)
          chapter = { title: heading, blocks: [] }
        } else {
          chapter.title = heading
        }
      }
      chapter.blocks.push({ kind: 'heading', text: heading })
      return
    }
    let content = trimmed
    if (content.startsWith('>')) content = content.replace(/^[> ]+/, '')
    const marker = /^([-*+]|\d+[.)])\s+/.exec(content)
    if (marker) {
      flush()
      content = content.slice(marker[0].length)
    }
    current.push(content)
  })
  flush()
  if (chapter.blocks.length) chapters.push(chapter)
  if (chapters.length === 0) throw new ImportError({ kind: 'emptyText' })
  return { title: title ?? fallbackTitle, author, chapters }
}

export function stripInline(text: string): string {
  let s = text
  s = s.replace(/!\[[^\]]*\]\([^)]*\)/g, '')
  s = s.replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
  s = s.replace(/<[^>]+>/g, '')
  s = s.replace(/(\*\*|__)(.+?)\1/g, '$2')
  s = s.replace(/(?<![\w*])[*_](?!\s)(.+?)(?<!\s)[*_](?![\w*])/g, '$1')
  s = s.replaceAll('`', '')
  return normalizeWhitespace(s)
}
