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
    await refused(zipArchive(list), /немає у файлі книжки/)
  })
  it('a local header that does not match the directory', async () => {
    const bytes = zipArchive(entries())
    const records = central(bytes)
    const offset = bytes[records[3] + 42] | (bytes[records[3] + 43] << 8)
    put16(bytes, offset + 8, 8)
    await refused(bytes, /не збігається з каталогом/)
  })
})
