// Port of EnglishReader/Import/ZipArchive.swift: minimal read-only ZIP reader for EPUB containers.
// Stored and deflated entries, no ZIP64. Inflate uses the platform DecompressionStream.

export interface ZipEntry {
  path: string
  method: number
  compressedSize: number
  uncompressedSize: number
  localHeaderOffset: number
}

export class ZipError extends Error {
  constructor(readonly reason: 'notAZip' | 'corrupted' | 'unsupportedMethod' | 'tooLarge', readonly method?: number) {
    super(`ZIP: ${reason}${method !== undefined ? ` ${method}` : ''}`)
    this.name = 'ZipError'
  }
}

const utf8 = new TextDecoder('utf-8')

/** Total unpacked bytes one archive may produce (R4): a 50 MB file must not expand into gigabytes in memory. */
export const maxUnpackedSize = 200 * 1024 * 1024

export class ZipArchive {
  readonly entries = new Map<string, ZipEntry>()
  private readonly view: DataView
  private unpacked = 0

  constructor(private readonly data: Uint8Array, private readonly budget = maxUnpackedSize) {
    this.view = new DataView(data.buffer, data.byteOffset, data.byteLength)
    this.readCentralDirectory()
  }

  contains(path: string): boolean {
    return this.entries.has(path)
  }

  async read(path: string): Promise<Uint8Array> {
    const entry = this.entries.get(path)
    if (!entry) throw new ZipError('corrupted')
    const header = entry.localHeaderOffset
    if (header + 30 > this.data.length || this.u32(header) !== 0x04034b50) throw new ZipError('corrupted')
    const start = header + 30 + this.u16(header + 26) + this.u16(header + 28)
    if (start + entry.compressedSize > this.data.length) throw new ZipError('corrupted')
    const payload = this.data.subarray(start, start + entry.compressedSize)
    switch (entry.method) {
      case 0: return payload
      case 8: {
        // The size from the central directory is checked before inflating; inflate() never goes past it.
        if (entry.uncompressedSize > this.budget - this.unpacked) throw new ZipError('tooLarge')
        this.unpacked += entry.uncompressedSize
        return inflate(payload, entry.uncompressedSize)
      }
      default: throw new ZipError('unsupportedMethod', entry.method)
    }
  }

  async readText(path: string): Promise<string> {
    return utf8.decode(await this.read(path))
  }

  private readCentralDirectory() {
    const size = this.data.length
    if (size < 22) throw new ZipError('notAZip')
    const searchStart = Math.max(0, size - 22 - 65_535)
    let eocd = -1
    for (let i = size - 22; i >= searchStart; i--) {
      if (this.u32(i) === 0x06054b50) { eocd = i; break }
    }
    if (eocd < 0) throw new ZipError('notAZip')
    const count = this.u16(eocd + 10)
    let offset = this.u32(eocd + 16)
    for (let n = 0; n < count; n++) {
      if (offset + 46 > size || this.u32(offset) !== 0x02014b50) throw new ZipError('corrupted')
      const method = this.u16(offset + 10)
      const compressedSize = this.u32(offset + 20)
      const uncompressedSize = this.u32(offset + 24)
      const nameLength = this.u16(offset + 28)
      const extraLength = this.u16(offset + 30)
      const commentLength = this.u16(offset + 32)
      const localHeaderOffset = this.u32(offset + 42)
      const nameStart = offset + 46
      if (nameStart + nameLength > size) throw new ZipError('corrupted')
      const path = utf8.decode(this.data.subarray(nameStart, nameStart + nameLength))
      this.entries.set(path, { path, method, compressedSize, uncompressedSize, localHeaderOffset })
      offset = nameStart + nameLength + extraLength + commentLength
    }
  }

  private u16(offset: number): number {
    return this.view.getUint16(offset, true)
  }

  private u32(offset: number): number {
    return this.view.getUint32(offset, true)
  }
}

/**
 * Raw-deflate decode; the result must have the size recorded in the central directory.
 * Streams into a buffer of that size and stops as soon as the data would exceed it.
 */
export async function inflate(payload: Uint8Array, expectedSize: number): Promise<Uint8Array> {
  if (expectedSize === 0) return new Uint8Array()
  const output = new Uint8Array(expectedSize)
  let length = 0
  try {
    const reader = new Blob([payload as BlobPart]).stream().pipeThrough(new DecompressionStream('deflate-raw')).getReader()
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      if (length + value.length > expectedSize) {
        await reader.cancel().catch(() => {})
        throw new ZipError('corrupted')
      }
      output.set(value, length)
      length += value.length
    }
  } catch (error) {
    if (error instanceof ZipError) throw error
    throw new ZipError('corrupted')
  }
  if (length !== expectedSize) throw new ZipError('corrupted')
  return output
}
