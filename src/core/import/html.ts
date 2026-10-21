// Port of EnglishReader/Import/HTMLTextExtractor.swift: turns (X)HTML into paragraph and heading blocks.
// A tolerant tag scanner rather than an XML parser, because EPUB content documents are often not well-formed.
import type { RawBlock } from '../model/book.ts'
import { normalizeWhitespace } from '../model/segmenter.ts'

const blockTags = new Set([
  'p', 'div', 'br', 'li', 'blockquote', 'section', 'article', 'tr', 'td', 'th', 'dd', 'dt',
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'pre', 'hr', 'figcaption', 'header', 'footer', 'aside', 'ul', 'ol', 'table',
])
const headingTags = new Set(['h1', 'h2', 'h3', 'h4', 'h5', 'h6'])
const skippedTags = new Set(['head', 'script', 'style', 'svg', 'math', 'sup'])

export function htmlBlocks(html: string): RawBlock[] {
  const blocks: RawBlock[] = []
  let buffer = ''
  let headingDepth = 0
  let skipDepth = 0
  let skipTag = ''

  const flush = () => {
    const text = normalizeWhitespace(decodeEntities(buffer))
    if (/[\p{L}\p{N}]/u.test(text)) blocks.push({ kind: headingDepth > 0 ? 'heading' : 'text', text })
    buffer = ''
  }

  let index = 0
  while (index < html.length) {
    const open = html.indexOf('<', index)
    if (open < 0) {
      if (skipDepth === 0) buffer += html.slice(index)
      break
    }
    if (skipDepth === 0) buffer += html.slice(index, open)
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
      if (local === skipTag) {
        if (isClosing) skipDepth -= 1
        else if (!isSelfClosing) skipDepth += 1
      }
      continue
    }
    if (skippedTags.has(local) && !isClosing && !isSelfClosing) {
      skipTag = local
      skipDepth = 1
      continue
    }
    if (headingTags.has(local)) {
      flush()
      headingDepth = Math.max(0, headingDepth + (isClosing ? -1 : isSelfClosing ? 0 : 1))
    } else if (blockTags.has(local)) {
      flush()
    }
  }
  flush()
  return blocks
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
