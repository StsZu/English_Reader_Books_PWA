// Port of EnglishReader/Import/EPUBImporter.swift (container.xml → OPF → spine → XHTML blocks).
// container.xml and the OPF are read with a small tag scanner (like the Swift XMLParser delegates)
// so the importer behaves the same in every browser and in Node tests.
import { ImportError } from '../../contracts.ts'
import type { RawBlock, RawBook, RawChapter } from '../model/book.ts'
import { normalizeWhitespace } from '../model/segmenter.ts'
import { decodeEntities, htmlBlocks } from './html.ts'
import { ZipArchive } from './zip.ts'

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
  manifest: Map<string, { href: string; mediaType: string }>
  spine: string[]
}

export function parseOPF(xml: string): OPFPackage {
  const pkg: OPFPackage = { title: '', author: '', manifest: new Map(), spine: [] }
  for (const tag of scanTags(xml)) {
    if (tag.closing) continue
    switch (tag.local) {
      case 'item':
        if (tag.attributes.id && tag.attributes.href) {
          pkg.manifest.set(tag.attributes.id, { href: tag.attributes.href, mediaType: tag.attributes['media-type'] ?? '' })
        }
        break
      case 'itemref':
        if (tag.attributes.idref && tag.attributes.linear !== 'no') pkg.spine.push(tag.attributes.idref)
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

/** First heading; a bare number such as "IV." is joined with the heading that follows it. */
export function chapterTitle(blocks: RawBlock[], index: number): string {
  const headings = blocks.slice(0, 4).filter((b) => b.kind === 'heading').map((b) => b.text)
  if (headings.length === 0) return `Розділ ${index + 1}`
  let title = headings[0]
  if ([...title].length <= 6 && headings.length > 1) title += ' ' + headings[1]
  return [...title].slice(0, 80).join('')
}

export async function parseEPUB(data: Uint8Array, fallbackTitle: string): Promise<RawBook> {
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
    const html = await zip.readText(resolveHref(item.href, baseDir)).catch(() => null)
    if (html === null) continue
    const blocks = htmlBlocks(html)
    if (!(blocks.some((b) => b.kind === 'text') || blocks.length > 1)) continue
    chapters.push({ title: chapterTitle(blocks, chapters.length), blocks })
  }
  if (chapters.length === 0) throw new ImportError({ kind: 'emptyText' })
  return { title: pkg.title || fallbackTitle, author: pkg.author, chapters }
}
