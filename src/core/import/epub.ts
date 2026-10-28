// Port of EnglishReader/Import/EPUBImporter.swift (container.xml → OPF → spine → XHTML blocks).
// container.xml and the OPF are read with a small tag scanner (like the Swift XMLParser delegates)
// so the importer behaves the same in every browser and in Node tests.
import { ImportError } from '../../contracts.ts'
import type { RawBlock, RawBook, RawChapter, RawContentsEntry } from '../model/book.ts'
import { normalizeWhitespace } from '../model/segmenter.ts'
import { decodeEntities, htmlDocument } from './html.ts'
import { ZipArchive, ZipError } from './zip.ts'

interface XMLTag {
  name: string
  local: string
  attributes: Record<string, string>
  closing: boolean
  selfClosing: boolean
  /** Offset just after the tag. */
  end: number
}

const localName = (name: string): string => name.split(':').pop() ?? name

function* scanTags(xml: string): Generator<XMLTag> {
  let index = 0
  while (index < xml.length) {
    const open = xml.indexOf('<', index)
    if (open < 0) return
    if (xml.startsWith('<!--', open)) {
      const end = xml.indexOf('-->', open)
      index = end < 0 ? xml.length : end + 3
      continue
    }
    if (xml.startsWith('<![CDATA[', open)) {
      const end = xml.indexOf(']]>', open)
      index = end < 0 ? xml.length : end + 3
      continue
    }
    const close = xml.indexOf('>', open)
    if (close < 0) return
    const body = xml.slice(open + 1, close)
    index = close + 1
    if (body.startsWith('?') || body.startsWith('!')) continue
    const closing = body.startsWith('/')
    const selfClosing = body.endsWith('/')
    const name = /^\/?([^\s/>]+)/.exec(body)?.[1] ?? ''
    const attributes: Record<string, string> = {}
    for (const m of body.matchAll(/([^\s=/]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) {
      attributes[m[1]] = decodeEntities(m[2] ?? m[3] ?? '')
    }
    yield { name, local: localName(name), attributes, closing, selfClosing, end: index }
  }
}

/** Text between the end of an opening tag and the next tag, entities decoded (CDATA kept). */
function textAfter(xml: string, from: number, local: string): string {
  let text = ''
  let index = from
  while (index < xml.length) {
    if (xml.startsWith('<![CDATA[', index)) {
      const end = xml.indexOf(']]>', index)
      text += xml.slice(index + 9, end < 0 ? xml.length : end)
      index = end < 0 ? xml.length : end + 3
      continue
    }
    const open = xml.indexOf('<', index)
    const chunk = xml.slice(index, open < 0 ? xml.length : open)
    text += decodeEntities(chunk)
    if (open < 0) break
    const close = xml.indexOf('>', open)
    const tag = xml.slice(open + 1, close < 0 ? xml.length : close)
    index = close < 0 ? xml.length : close + 1
    if (tag.startsWith('/') && localName(tag.slice(1).trim()) === local) break
  }
  return text
}

export function containerRootFile(xml: string): string | null {
  for (const tag of scanTags(xml)) {
    if (!tag.closing && tag.name.endsWith('rootfile') && tag.attributes['full-path']) return tag.attributes['full-path']
  }
  return null
}

export interface OPFPackage {
  title: string
  author: string
  manifest: Map<string, { href: string; mediaType: string; properties: string }>
  spine: string[]
  /** Spine documents with linear="no" (notes, appendices): left out of the book. */
  nonLinear: string[]
  /** The id of the NCX table of contents (`<spine toc>`). */
  ncx: string
}

export function parseOPF(xml: string): OPFPackage {
  const pkg: OPFPackage = { title: '', author: '', manifest: new Map(), spine: [], nonLinear: [], ncx: '' }
  for (const tag of scanTags(xml)) {
    if (tag.closing) continue
    switch (tag.local) {
      case 'item':
        if (tag.attributes.id && tag.attributes.href) {
          pkg.manifest.set(tag.attributes.id, {
            href: tag.attributes.href, mediaType: tag.attributes['media-type'] ?? '', properties: tag.attributes.properties ?? '',
          })
        }
        break
      case 'spine':
        pkg.ncx = tag.attributes.toc ?? ''
        break
      case 'itemref':
        if (!tag.attributes.idref) break
        if (tag.attributes.linear === 'no') pkg.nonLinear.push(tag.attributes.idref)
        else pkg.spine.push(tag.attributes.idref)
        break
      case 'title':
        if (!pkg.title && !tag.selfClosing) pkg.title = normalizeWhitespace(textAfter(xml, tag.end, 'title'))
        break
      case 'creator':
        if (!pkg.author && !tag.selfClosing) pkg.author = normalizeWhitespace(textAfter(xml, tag.end, 'creator'))
        break
    }
  }
  return pkg
}

/** Font obfuscation (IDPF/Adobe) is allowed; any other encrypted resource means DRM. */
export function isContentEncrypted(xml: string): boolean {
  return xml.split('<EncryptedData').slice(1).some((block) =>
    !(block.includes('http://www.idpf.org/2008/embedding') || block.includes('http://ns.adobe.com/pdf/enc#RC')))
}

function safeDecode(text: string): string {
  try {
    return decodeURIComponent(text)
  } catch {
    return text
  }
}

export function resolveHref(href: string, baseDir: string): string {
  const decoded = safeDecode(href.split('#')[0] ?? href)
  const parts = baseDir ? baseDir.split('/') : []
  for (const component of decoded.split('/')) {
    if (component === '' || component === '.') continue
    if (component === '..') { if (parts.length) parts.pop() }
    else parts.push(component)
  }
  return parts.join('/')
}

const dirOf = (path: string): string => {
  const slash = path.lastIndexOf('/')
  return slash < 0 ? '' : path.slice(0, slash)
}

const fragment = (href: string): string => {
  const hash = href.indexOf('#')
  return hash < 0 ? '' : safeDecode(href.slice(hash + 1))
}

/** Entries of an EPUB 3 navigation document: links of `<nav epub:type="toc">`, the level is the depth of the lists. */
export function parseNav(xml: string, path: string): RawContentsEntry[] {
  const entries: RawContentsEntry[] = []
  let inToc = false
  let depth = 0
  for (const tag of scanTags(xml)) {
    if (tag.local === 'nav') {
      if (tag.closing) inToc = false
      else if (/\btoc\b/.test(tag.attributes['epub:type'] ?? '')) inToc = true
      continue
    }
    if (!inToc) continue
    if (tag.local === 'ol' && !tag.selfClosing) depth += tag.closing ? -1 : 1
    if (tag.local === 'a' && !tag.closing && tag.attributes.href && !tag.selfClosing) {
      const title = normalizeWhitespace(textAfter(xml, tag.end, 'a'))
      if (title) {
        entries.push({ title, level: Math.max(0, depth - 1), source: resolveHref(tag.attributes.href, dirOf(path)), anchor: fragment(tag.attributes.href) })
      }
    }
  }
  return entries
}

/** Entries of an EPUB 2 NCX: `navPoint` labels and targets, the level is the nesting of the points. */
export function parseNCX(xml: string, path: string): RawContentsEntry[] {
  const entries: RawContentsEntry[] = []
  let depth = 0
  let title = ''
  for (const tag of scanTags(xml)) {
    if (tag.local === 'navPoint' && !tag.selfClosing) {
      depth += tag.closing ? -1 : 1
      if (!tag.closing) title = ''
    } else if (tag.local === 'text' && !tag.closing && !tag.selfClosing && depth > 0) {
      title = normalizeWhitespace(textAfter(xml, tag.end, 'text'))
    } else if (tag.local === 'content' && !tag.closing && tag.attributes.src && depth > 0 && title) {
      entries.push({ title, level: depth - 1, source: resolveHref(tag.attributes.src, dirOf(path)), anchor: fragment(tag.attributes.src) })
      title = ''
    }
  }
  return entries
}

/** The book's table of contents: the EPUB 3 navigation document, else the NCX; empty when there is none or it is unreadable. */
async function readContents(zip: ZipArchive, pkg: OPFPackage, baseDir: string): Promise<RawContentsEntry[]> {
  const items = [...pkg.manifest.values()]
  const nav = items.find((item) => item.properties.split(/\s+/).includes('nav'))
  const ncx = pkg.manifest.get(pkg.ncx) ?? items.find((item) => item.mediaType === 'application/x-dtbncx+xml')
  for (const [item, parse] of [[nav, parseNav], [ncx, parseNCX]] as const) {
    if (!item) continue
    const path = resolveHref(item.href, baseDir)
    const xml = await zip.readText(path).catch(() => null)
    const entries = xml === null ? [] : parse(xml, path)
    if (entries.length > 0) return entries
  }
  return []
}

/** What the import left out of an EPUB (specs/011-epub-formatting, E3). */
export interface SkippedContent {
  images: number
  notes: number
  /** Spine documents with linear="no". */
  pages: number
}

/** First heading; a bare number such as "IV." is joined with the heading that follows it. */
export function chapterTitle(blocks: RawBlock[], index: number): string {
  const headings = blocks.slice(0, 4).filter((b) => b.kind === 'heading').map((b) => b.text)
  if (headings.length === 0) return `Розділ ${index + 1}`
  let title = headings[0]
  if ([...title].length <= 6 && headings.length > 1) title += ' ' + headings[1]
  return [...title].slice(0, 80).join('')
}

/**
 * `unreadable` collects the spine files that are listed but cannot be read from the archive (R2):
 * the book is imported without them and the library says so. Empty pages (a cover) are skipped silently.
 * `skipped` counts what is not imported at all: illustrations, note references and pages outside the reading order.
 */
export async function parseEPUB(
  data: Uint8Array, fallbackTitle: string, unreadable: string[] = [], skipped?: SkippedContent,
): Promise<RawBook> {
  let zip: ZipArchive
  try {
    zip = new ZipArchive(data)
  } catch {
    throw new ImportError({ kind: 'invalidEPUB', detail: 'не ZIP-архів' })
  }
  if (zip.contains('META-INF/encryption.xml')) {
    const encryption = await zip.readText('META-INF/encryption.xml').catch(() => null)
    if (encryption !== null && isContentEncrypted(encryption)) throw new ImportError({ kind: 'drmProtected' })
  }
  if (zip.contains('META-INF/rights.xml')) throw new ImportError({ kind: 'drmProtected' })
  const container = await zip.readText('META-INF/container.xml').catch(() => null)
  if (container === null) throw new ImportError({ kind: 'invalidEPUB', detail: 'немає META-INF/container.xml' })
  const opfPath = containerRootFile(container)
  if (!opfPath) throw new ImportError({ kind: 'invalidEPUB', detail: 'не знайдено OPF' })
  const opf = await zip.readText(opfPath).catch(() => null)
  if (opf === null) throw new ImportError({ kind: 'invalidEPUB', detail: `не читається ${opfPath}` })
  const pkg = parseOPF(opf)
  if (pkg.spine.length === 0) throw new ImportError({ kind: 'invalidEPUB', detail: 'порожній spine' })
  const slash = opfPath.lastIndexOf('/')
  const baseDir = slash < 0 ? '' : opfPath.slice(0, slash)
  const chapters: RawChapter[] = []
  for (const idref of pkg.spine) {
    const item = pkg.manifest.get(idref)
    if (!item || !(item.mediaType.includes('html') || item.href.endsWith('html') || item.href.endsWith('htm'))) continue
    const path = resolveHref(item.href, baseDir)
    let html: string
    try {
      html = await zip.readText(path)
    } catch (error) {
      if (error instanceof ZipError && error.reason === 'tooLarge') throw new ImportError({ kind: 'tooLargeUnpacked' })
      unreadable.push(path.split('/').pop() || path)
      continue
    }
    const doc = htmlDocument(html)
    const blocks = doc.blocks
    if (!(blocks.some((b) => b.kind === 'text') || blocks.length > 1)) continue
    if (skipped) {
      skipped.images += doc.images
      skipped.notes += doc.notes
    }
    chapters.push({ title: chapterTitle(blocks, chapters.length), blocks, source: path, anchors: doc.anchors })
  }
  if (chapters.length === 0) throw new ImportError({ kind: 'emptyText' })
  if (skipped) {
    skipped.pages += pkg.nonLinear.filter((idref) => {
      const item = pkg.manifest.get(idref)
      return !!item && (item.mediaType.includes('html') || /\.x?html?$/.test(item.href))
    }).length
  }
  const contents = await readContents(zip, pkg, baseDir)
  return { title: pkg.title || fallbackTitle, author: pkg.author, chapters, ...(contents.length > 0 ? { contents } : {}) }
}
