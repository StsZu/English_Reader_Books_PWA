// One-file prepared book (specs/015-reader-book-container, R010–R011): the shared container parser and validator.
// Synthetic archives only (tests/fixtures/zip-writer.ts); damaged ones are made by patching their bytes.
import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import {
  CONTAINER_MIMETYPE, ContainerError, matchPackage, openContainer, safePath, verifyAudio, type ByteSource,
} from '../../src/core/prepared/container.ts'
import { zipArchive } from '../fixtures/zip-writer.ts'

const mp3 = [new Uint8Array([1, 2, 3, 4, 5, 6]), new Uint8Array([7, 7, 7])]
const sha = (b: Uint8Array) => createHash('sha256').update(b).digest('hex')
const tracks = [{ id: 't1', name: '01.mp3', size: 6, sha256: sha(mp3[0]) }, { id: 't2', name: '02.mp3', size: 3, sha256: sha(mp3[1]) }]
const pkg = { format: 'reader-book', version: 1, language: 'en', tracks }
const meta = (over: Record<string, unknown> = {}) => JSON.stringify({
  format: 'reader-book-container', version: 1, package: 'book.reader.json',
  audio: tracks.map((t) => ({ path: `audio/${t.name}`, size: t.size, sha256: t.sha256 })), ...over,
})
type Entry = [string, string | Uint8Array, boolean, number?]
const entries = (): Entry[] => [
  ['mimetype', CONTAINER_MIMETYPE, false], ['container.json', meta(), true], ['book.reader.json', JSON.stringify(pkg), true],
  ['audio/01.mp3', mp3[0], false], ['audio/02.mp3', mp3[1], false],
]
const source = (bytes: Uint8Array): ByteSource => ({ size: bytes.length, read: async (a, b) => bytes.slice(a, b) })

/** Offsets of the central directory records. */
function central(bytes: Uint8Array): number[] {
  const out: number[] = []
  for (let i = 0; i + 4 <= bytes.length; i++) if (bytes[i] === 0x50 && bytes[i + 1] === 0x4b && bytes[i + 2] === 0x01 && bytes[i + 3] === 0x02) out.push(i)
  return out
}
const put16 = (b: Uint8Array, at: number, v: number) => { b[at] = v & 0xff; b[at + 1] = v >> 8 }
const put32 = (b: Uint8Array, at: number, v: number) => { put16(b, at, v & 0xffff); put16(b, at + 2, v >>> 16) }

async function refused(bytes: Uint8Array, message: RegExp) {
  await expect(openContainer(source(bytes))).rejects.toThrow(ContainerError)
  await expect(openContainer(source(bytes))).rejects.toThrow(message)
}

describe('container: a valid one', () => {
  it('opens, matches its package and checks each MP3 by SHA-256 in pieces', async () => {
    const bytes = zipArchive(entries())
    const opened = await openContainer(source(bytes))
    expect(opened.audio.map((a) => [a.name, a.size])).toEqual([['01.mp3', 6], ['02.mp3', 3]])
    expect(matchPackage(opened, opened.package as typeof pkg)).toEqual([])
    for (const audio of opened.audio) expect(await verifyAudio(source(bytes), audio, 2)).toBe(true)
    expect(bytes.slice(opened.audio[0].dataStart, opened.audio[0].dataStart + 6)).toEqual(mp3[0])
  })
})

describe('container: refused before anything is imported (≥ 15 cases)', () => {
  it('a cut file', async () => {
    const bytes = zipArchive(entries())
    await refused(bytes.slice(0, bytes.length - 30), /не знайдено каталог ZIP|пошкоджено/)
  })
  it('a path with .., \\, a leading / , a control character or not NFC', async () => {
    for (const path of ['audio/../x.mp3', 'audio\\01.mp3', '/audio/01.mp3', 'audio/0\u00011.mp3', 'audio/ż.mp3'.normalize('NFD')]) {
      const list = entries()
      list[3] = [path, mp3[0], false]
      await refused(zipArchive(list), /Неприпустимий запис/)
    }
    expect(safePath('audio/ż.mp3')).toBe(true)
  })
  it('the same name twice, also differing only by case', async () => {
    await refused(zipArchive([...entries(), ['audio/01.MP3', mp3[0], false]]), /повторюється/)
  })
  it('a record the description does not list', async () => {
    await refused(zipArchive([...entries(), ['audio/03.mp3', mp3[1], false]]), /зайві або відсутні/)
  })
  it('an unknown name outside the contract', async () => {
    await refused(zipArchive([...entries(), ['notes.txt', 'x', false]]), /Неприпустимий запис/)
  })
  it('an MP3 compressed', async () => {
    const list = entries()
    list[3] = ['audio/01.mp3', mp3[0], true]
    await refused(zipArchive(list), /без стиснення/)
  })
  it('mimetype not first, or another type', async () => {
    const list = entries()
    await refused(zipArchive([list[1], list[0], ...list.slice(2)]), /перший запис має бути mimetype/)
    list[0] = ['mimetype', 'application/zip', false]
    await refused(zipArchive(list), /mimetype іншого розміру/)
    list[0] = ['mimetype', 'application/vnd.reader-book+zap', false]          // same length, other type
    await refused(zipArchive(list), /інший тип вмісту/)
  })
  it('a newer container version', async () => {
    const list = entries()
    list[1] = ['container.json', meta({ version: 2 }), true]
    await refused(zipArchive(list), /новішою програмою/)
  })
  it('a size in the description that is not the stored one', async () => {
    const list = entries()
    list[1] = ['container.json', meta({ audio: [{ path: 'audio/01.mp3', size: 7, sha256: tracks[0].sha256 }, { path: 'audio/02.mp3', size: 3, sha256: tracks[1].sha256 }] }), true]
    await refused(zipArchive(list), /Розмір аудіо/)
  })
  it('another MP3 under the right name: SHA-256 differs, and the package does not match', async () => {
    const list = entries()
    list[3] = ['audio/01.mp3', new Uint8Array([9, 9, 9, 9, 9, 9]), false]
    const bytes = zipArchive(list)
    const opened = await openContainer(source(bytes))
    expect(await verifyAudio(source(bytes), opened.audio[0])).toBe(false)
    expect(matchPackage(opened, { tracks: [{ ...tracks[0], name: 'other.mp3' }, tracks[1]] })).toHaveLength(1)
  })
  it('records whose data overlap', async () => {
    const bytes = zipArchive(entries())
    const records = central(bytes)
    const firstAudio = records[3]
    const secondAudio = records[4]
    put32(bytes, secondAudio + 42, (bytes[firstAudio + 42] | (bytes[firstAudio + 43] << 8)) + 0)
    await refused(bytes, /перетинаються|не збігається з каталогом/)
  })
  it('a deflated JSON that claims to unpack far more than it holds (zip bomb)', async () => {
    const list = entries()
    list[2] = ['book.reader.json', JSON.stringify(pkg), true, 40 * 1024 * 1024]
    await refused(zipArchive(list), /підозріло сильно/)
  })
  it('ZIP64 markers', async () => {
    const bytes = zipArchive(entries())
    put32(bytes, central(bytes)[3] + 24, 0xffffffff)
    await refused(bytes, /ZIP64/)
  })
  it('encryption or data descriptors', async () => {
    const encrypted = zipArchive(entries())
    put16(encrypted, central(encrypted)[3] + 8, 0x1)
    await refused(encrypted, /Зашифрований/)
    const described = zipArchive(entries())
    put16(described, central(described)[3] + 8, 0x8)
    await refused(described, /дескрипторами даних/)
  })
  it('no container.json, or one that is not JSON', async () => {
    await refused(zipArchive(entries().filter(([p]) => p !== 'container.json')), /немає container.json/)
    const list = entries()
    list[1] = ['container.json', '{', true]
    await refused(zipArchive(list), /не JSON/)
  })
  it('an MP3 listed but missing', async () => {
    const list = entries().filter(([p]) => p !== 'audio/02.mp3')
    list.push(['audio/03.mp3', mp3[1], false])
    await refused(zipArchive(list), /не збігаються з його описом/)
  })
  it('a local header that does not match the directory', async () => {
    const bytes = zipArchive(entries())
    const records = central(bytes)
    const offset = bytes[records[3] + 42] | (bytes[records[3] + 43] << 8)
    put16(bytes, offset + 8, 8)
    await refused(bytes, /не збігається з каталогом/)
  })
})


// ----------------------------------------------------------------- regressions of review 2026-11-11

/** The source records the largest single read it was asked for. */
function measured(bytes: Uint8Array, size = bytes.length) {
  const log = { largest: 0 }
  const src: ByteSource = {
    size,
    read: async (a, b) => {
      log.largest = Math.max(log.largest, b - a)
      const out = new Uint8Array(b - a)
      const from = size - bytes.length
      for (let i = Math.max(a, from); i < Math.min(b, size); i++) out[i - a] = bytes[i - from]
      return out
    },
  }
  return { src, log }
}

/** Offset of the end-of-central-directory record. */
const eocd = (bytes: Uint8Array) => { for (let i = bytes.length - 22; i >= 0; i--) if (bytes[i] === 0x50 && bytes[i + 1] === 0x4b && bytes[i + 2] === 5 && bytes[i + 3] === 6) return i; return -1 }
const localOf = (bytes: Uint8Array, record: number) => bytes[record + 42] | (bytes[record + 43] << 8) | (bytes[record + 44] << 16) | (bytes[record + 45] << 24)

describe('container: sizes from the file are checked before any read (P1)', () => {
  const HUGE = 512 * 1024 * 1024

  it('a central directory claimed far larger than its records allow is never read', async () => {
    const bytes = zipArchive(entries())
    const prefix = HUGE + 4096
    // The archive sits at the end of a big virtual file; the directory "starts" 512 MiB before the end record.
    const end = eocd(bytes)
    put32(bytes, end + 12, HUGE)
    put32(bytes, end + 16, prefix + end - HUGE)
    const { src, log } = measured(bytes, prefix + bytes.length)
    await expect(openContainer(src)).rejects.toThrow(/розмір каталогу ZIP неправдоподібний/)
    expect(log.largest).toBeLessThan(70_000)
  })

  it('a deflated JSON of 2 bytes that claims 512 MiB packed is refused unread', async () => {
    const bytes = zipArchive(entries())
    const record = central(bytes)[2]                      // book.reader.json
    put32(bytes, record + 24, 2)
    put32(bytes, record + 20, HUGE)
    const { src, log } = measured(bytes)
    await expect(openContainer(src)).rejects.toThrow(/неправдоподібний стиснений розмір/)
    expect(log.largest).toBeLessThan(70_000)
  })

  it('a mimetype record that claims 512 MiB is refused unread', async () => {
    const bytes = zipArchive(entries())
    put32(bytes, central(bytes)[0] + 20, HUGE)
    const { src, log } = measured(bytes)
    await expect(openContainer(src)).rejects.toThrow(/mimetype іншого розміру/)
    expect(log.largest).toBeLessThan(70_000)
  })

  it('a valid container reads nothing larger than one MP3 piece', async () => {
    const { src, log } = measured(zipArchive(entries()))
    const opened = await openContainer(src)
    for (const audio of opened.audio) expect(await verifyAudio(src, audio, 4)).toBe(true)
    expect(log.largest).toBeLessThan(70_000)
  })
})

describe('container: the local header must say what the directory says (P2)', () => {
  it('another uncompressed size in the local header of an MP3', async () => {
    const bytes = zipArchive(entries())
    const local = localOf(bytes, central(bytes)[3])
    put32(bytes, local + 22, 999)
    await refused(bytes, /не збігається з каталогом/)
  })

  it('another CRC in the local header than in the directory', async () => {
    const bytes = zipArchive(entries())
    const local = localOf(bytes, central(bytes)[3])
    put32(bytes, local + 14, 1)
    await refused(bytes, /не збігається з каталогом/)
  })

  it('another packed size or flags in the local header', async () => {
    const packed = zipArchive(entries())
    put32(packed, localOf(packed, central(packed)[3]) + 18, 4)
    await refused(packed, /не збігається з каталогом/)
    const flags = zipArchive(entries())
    put16(flags, localOf(flags, central(flags)[3]) + 6, 0x800)
    await refused(flags, /не збігається з каталогом/)
  })
})

describe('container: description, audio records and package name the same files once (P2)', () => {
  it('the description lists one MP3 twice while the archive holds another one unlisted', async () => {
    const twice = JSON.stringify({ format: 'reader-book-container', version: 1, package: 'book.reader.json',
      audio: [{ path: 'audio/01.mp3', size: 6, sha256: tracks[0].sha256 }, { path: 'audio/01.mp3', size: 6, sha256: tracks[0].sha256 }] })
    const list: Entry[] = [['mimetype', CONTAINER_MIMETYPE, false], ['container.json', twice, true],
      ['book.reader.json', JSON.stringify(pkg), true], ['audio/01.mp3', mp3[0], false], ['audio/unlisted.mp3', mp3[1], false]]
    await refused(zipArchive(list), /аудіо повторюється/)
  })

  it('an unlisted MP3 instead of a listed one', async () => {
    const list = entries()
    list[4] = ['audio/other.mp3', mp3[1], false]
    await refused(zipArchive(list), /не збігаються з його описом/)
  })

  it('a package with two tracks of one name', async () => {
    const opened = await openContainer(source(zipArchive(entries())))
    expect(matchPackage(opened, { tracks: [tracks[0], { ...tracks[1], id: 'x', name: '01.mp3' }] })).toEqual(['У пакеті дві доріжки з однією назвою аудіо.'])
  })
})
