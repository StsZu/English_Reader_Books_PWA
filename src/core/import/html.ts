// Port of EnglishReader/Import/HTMLTextExtractor.swift: turns (X)HTML into paragraph and heading blocks.
// A tolerant tag scanner rather than an XML parser, because EPUB content documents are often not well-formed.
// Italic and bold ranges, element ids and what is left out come along with the text (specs/011-epub-formatting).
import type { RawBlock } from '../model/book.ts'
import { normalizeWhitespace } from '../model/segmenter.ts'

const blockTags = new Set([
  'p', 'div', 'br', 'li', 'blockquote', 'section', 'article', 'tr', 'td', 'th', 'dd', 'dt',
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'pre', 'hr', 'figcaption', 'header', 'footer', 'aside', 'ul', 'ol', 'table',
])
const headingTags = new Set(['h1', 'h2', 'h3', 'h4', 'h5', 'h6'])
const skippedTags = new Set(['head', 'script', 'style', 'svg', 'math', 'sup'])
const italicTags = new Set(['i', 'em', 'cite'])
const boldTags = new Set(['b', 'strong'])

/** What a content document has beyond its text (specs/011-epub-formatting, E1–E3). */
export interface HTMLDocument {
  blocks: RawBlock[]
  /** Element id → index of the block it starts or belongs to. */
  anchors: Record<string, number>
  /** Illustrations (`img`, `svg`) and note references (a linked `sup`, an `epub:type="noteref"` link) left out. */
  images: number
  notes: number
}

type Style = 0 | 1 | 2 | 3
const ITALIC = 1
const BOLD = 2

/**
 * The text of a block with the same normalization as normalizeWhitespace, and its italic and bold ranges.
 * Each piece is text between two tags with the style that was open there.
 */
function styledText(pieces: { text: string; style: Style }[]): { text: string; marks: NonNullable<RawBlock['marks']> } {
  let text = ''
  const styles: Style[] = []
  for (const piece of pieces) {
    for (const ch of decodeEntities(piece.text)) {
      if (ch === '\u00ad') continue
      if (/\s/.test(ch)) {
        if (text.length > 0 && !text.endsWith(' ')) {
          text += ' '
          styles.push(piece.style)
        }
        continue
      }
      text += ch
      for (let i = 0; i < ch.length; i++) styles.push(piece.style)
    }
  }
  if (text.endsWith(' ')) {
    text = text.slice(0, -1)
    styles.pop()
  }
  const marks: NonNullable<RawBlock['marks']> = []
  for (const [flag, style] of [[ITALIC, 'italic'], [BOLD, 'bold']] as const) {
    let start = -1
    for (let i = 0; i <= text.length; i++) {
      const on = i < text.length && (styles[i] & flag) !== 0
      if (on && start < 0) start = i
      if (!on && start >= 0) {
        let end = i
        while (end > start && text[end - 1] === ' ') end--
        while (start < end && text[start] === ' ') start++
        if (end > start) marks.push({ start, end, style })
        start = -1
      }
    }
  }
  return { text, marks }
}

export function htmlBlocks(html: string): RawBlock[] {
  return htmlDocument(html).blocks
}

export function htmlDocument(html: string): HTMLDocument {
  const doc: HTMLDocument = { blocks: [], anchors: {}, images: 0, notes: 0 }
  const blocks = doc.blocks
  let buffer = ''
  let pieces: { text: string; style: Style }[] = []
  let headingDepth = 0
  let skipDepth = 0
  let skipTag = ''
  let linkInSup = false
  let italicDepth = 0
  let boldDepth = 0
  const style = (): Style => ((italicDepth > 0 ? ITALIC : 0) | (boldDepth > 0 ? BOLD : 0)) as Style

  const append = (text: string) => {
    buffer += text
    if (text) pieces.push({ text, style: style() })
  }

  const flush = () => {
    const text = normalizeWhitespace(decodeEntities(buffer))
    if (/[\p{L}\p{N}]/u.test(text)) {
      const block: RawBlock = { kind: headingDepth > 0 ? 'heading' : 'text', text }
      const styled = styledText(pieces)
      // The ranges are kept only when the styled text is exactly the plain one.
      if (styled.marks.length > 0 && styled.text === text) block.marks = styled.marks
      blocks.push(block)
    }
    buffer = ''
    pieces = []
  }

  let index = 0
  while (index < html.length) {
    const open = html.indexOf('<', index)
    if (open < 0) {
      if (skipDepth === 0) append(html.slice(index))
      break
    }
    if (skipDepth === 0) append(html.slice(index, open))
    if (html.startsWith('<!--', open)) {
      const end = html.indexOf('-->', open)
      index = end < 0 ? html.length : end + 3
      continue
    }
    const close = html.indexOf('>', open)
    if (close < 0) break
    const tagBody = html.slice(open + 1, close)
    index = close + 1
    const isClosing = tagBody.startsWith('/')
    const isSelfClosing = tagBody.endsWith('/')
    const name = /^[^\s/>]*/.exec(tagBody.replace(/^\/+/, ''))![0].toLowerCase()
    const local = name.split(':').pop() ?? name
    if (skipDepth > 0) {
      if (skipTag === 'sup' && local === 'a' && !isClosing) linkInSup = true
      if (local === skipTag) {
        if (isClosing) skipDepth -= 1
        else if (!isSelfClosing) skipDepth += 1
        if (skipDepth === 0 && skipTag === 'sup' && linkInSup) doc.notes += 1
      }
      continue
    }
    let anchor: string | undefined
    if (!isClosing) {
      const id = /\s(?:id|name)\s*=\s*(?:"([^"]*)"|'([^']*)')/i.exec(tagBody)
      anchor = id?.[1] ?? id?.[2]
      if (local === 'img' || local === 'svg') doc.images += 1
      if (local === 'a' && /epub:type\s*=\s*["'][^"']*noteref/i.test(tagBody)) doc.notes += 1
    }
    if (skippedTags.has(local) && !isClosing && !isSelfClosing) {
      skipTag = local
      skipDepth = 1
      linkInSup = false
    } else if (italicTags.has(local) && !isSelfClosing) {
      italicDepth = Math.max(0, italicDepth + (isClosing ? -1 : 1))
    } else if (boldTags.has(local) && !isSelfClosing) {
      boldDepth = Math.max(0, boldDepth + (isClosing ? -1 : 1))
    } else if (headingTags.has(local)) {
      flush()
      headingDepth = Math.max(0, headingDepth + (isClosing ? -1 : isSelfClosing ? 0 : 1))
    } else if (blockTags.has(local)) {
      flush()
    }
    // After the flush, so an id on a heading or a paragraph points at that block, not at the text before it.
    if (anchor && !(anchor in doc.anchors)) doc.anchors[anchor] = blocks.length
  }
  flush()
  return doc
}

const namedEntities: Record<string, string> = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ',
  mdash: '—', ndash: '–', hellip: '…', rsquo: '’', lsquo: '‘', rdquo: '”', ldquo: '“',
  laquo: '«', raquo: '»', copy: '©', shy: '', eacute: 'é', egrave: 'è', aacute: 'á',
  agrave: 'à', ouml: 'ö', uuml: 'ü', auml: 'ä', ccedil: 'ç', iuml: 'ï', ecirc: 'ê',
  bull: '•', middot: '·', times: '×', deg: '°', pound: '£', euro: '€', thinsp: ' ', ensp: ' ', emsp: ' ',
}

function codePoint(value: number): string | null {
  if (!Number.isInteger(value) || value < 0 || value > 0x10ffff || (value >= 0xd800 && value <= 0xdfff)) return null
  return String.fromCodePoint(value)
}

export function decodeEntities(text: string): string {
  if (!text.includes('&')) return text
  let result = ''
  let index = 0
  while (index < text.length) {
    const ch = text[index]
    if (ch === '&') {
      const semi = text.slice(index, index + 12).indexOf(';')
      if (semi >= 0) {
        const entity = text.slice(index + 1, index + semi)
        let replacement: string | null | undefined
        if (/^#[xX][0-9a-fA-F]+$/.test(entity)) replacement = codePoint(parseInt(entity.slice(2), 16))
        else if (/^#\d+$/.test(entity)) replacement = codePoint(parseInt(entity.slice(1), 10))
        else replacement = Object.hasOwn(namedEntities, entity) ? namedEntities[entity] : undefined
        if (replacement !== null && replacement !== undefined) {
          result += replacement
          index += semi + 1
          continue
        }
      }
    }
    result += ch
    index += 1
  }
  return result
}
