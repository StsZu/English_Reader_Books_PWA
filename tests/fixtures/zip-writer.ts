// Writes a ZIP with stored or raw-deflated entries (CRC left zero; the reader does not check it).
// `declaredSize` replaces the uncompressed size in the headers (a damaged or oversized archive).
import { deflateRawSync } from 'node:zlib'

export function zipArchive(entries: [path: string, content: string | Uint8Array, compress: boolean, declaredSize?: number][]): Uint8Array {
  const out: number[] = []
  const central: number[] = []
  const le16 = (arr: number[], v: number) => arr.push(v & 0xff, (v >> 8) & 0xff)
  const le32 = (arr: number[], v: number) => arr.push(v & 0xff, (v >> 8) & 0xff, (v >> 16) & 0xff, (v >>> 24) & 0xff)
  const bytes = (arr: number[], data: Uint8Array) => { for (const b of data) arr.push(b) }
  for (const [path, value, compress, declaredSize] of entries) {
    const content = typeof value === 'string' ? new TextEncoder().encode(value) : value
    const payload = compress ? new Uint8Array(deflateRawSync(content)) : content
    const name = new TextEncoder().encode(path)
    const offset = out.length
    le32(out, 0x04034b50); le16(out, 20); le16(out, 0); le16(out, compress ? 8 : 0)
    le16(out, 0); le16(out, 0); le32(out, 0)
    le32(out, payload.length); le32(out, declaredSize ?? content.length)
    le16(out, name.length); le16(out, 0); bytes(out, name); bytes(out, payload)

    le32(central, 0x02014b50); le16(central, 20); le16(central, 20); le16(central, 0)
    le16(central, compress ? 8 : 0); le16(central, 0); le16(central, 0); le32(central, 0)
    le32(central, payload.length); le32(central, declaredSize ?? content.length)
    le16(central, name.length); le16(central, 0); le16(central, 0)
    le16(central, 0); le16(central, 0); le32(central, 0); le32(central, offset)
    bytes(central, name)
  }
  const centralOffset = out.length
  out.push(...central)
  le32(out, 0x06054b50); le16(out, 0); le16(out, 0)
  le16(out, entries.length); le16(out, entries.length)
  le32(out, central.length); le32(out, centralOffset); le16(out, 0)
  return new Uint8Array(out)
}

/** `omit` leaves files out of the archive although the OPF lists them. */
export function makeEPUB(extra: Record<string, string> = {}, omit: string[] = []): Uint8Array {
  const files: [string, string, boolean][] = [
    ['mimetype', 'application/epub+zip', false],
    ['META-INF/container.xml', `<?xml version="1.0"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
<rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>`, false],
    ['OEBPS/content.opf', `<?xml version="1.0"?><package xmlns="http://www.idpf.org/2007/opf" version="3.0">
<metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>Test Book</dc:title><dc:creator>A. Writer</dc:creator></metadata>
<manifest>
  <item id="cover" href="cover.xhtml" media-type="application/xhtml+xml"/>
  <item id="c1" href="text/ch1.xhtml" media-type="application/xhtml+xml"/>
  <item id="c2" href="text/ch2.xhtml" media-type="application/xhtml+xml"/>
  <item id="css" href="style.css" media-type="text/css"/>
</manifest>
<spine><itemref idref="cover"/><itemref idref="c1"/><itemref idref="c2"/></spine></package>`, false],
    ['OEBPS/cover.xhtml', '<html><body><img src="c.jpg" alt=""/></body></html>', false],
    ['OEBPS/text/ch1.xhtml', '<html><body><h2>Chapter 1</h2><p>The first sentence. The second one.</p></body></html>', false],
    ['OEBPS/text/ch2.xhtml', '<html><body><h2>Chapter 2</h2><p>Deflated text survives.</p></body></html>', true],
  ]
  for (const [path, content] of Object.entries(extra)) files.push([path, content, false])
  return zipArchive(files.filter(([path]) => !omit.includes(path)))
}
