// One file of a prepared book (specs/015-reader-book-container): a ZIP with `mimetype`, `container.json`,
// `book.reader.json` and the MP3s, read in pieces through a byte source, so the app (File.slice) and the reader tool
// (file reads) share this one parser and the same rules. Nothing is written here; the caller imports after it passes.
import { inflate } from '../import/zip.ts'
import { maxFileSize } from '../import/importer.ts'
import { Sha256 } from '../util/sha256.ts'

export const CONTAINER_MIMETYPE = 'application/vnd.reader-book+zip'
export const CONTAINER_FORMAT = 'reader-book-container'
export const CONTAINER_VERSION = 1
export const CONTAINER_PACKAGE = 'book.reader.json'
export const CONTAINER_META = 'container.json'
export const MAX_CONTAINER_TRACKS = 200
/** Unpacked to packed size of a deflated entry: more is treated as a zip bomb. */
export const MAX_DEFLATE_RATIO = 100

/** Bytes of the container: a File in the app, a file on disk in the tool. `read` returns [start, end). */
export interface ByteSource {
  size: number
  read(start: number, end: number): Promise<Uint8Array>
}

export interface ContainerAudio {
  name: string
  path: string
  size: number
  sha256: string
  /** Offset of the stored MP3 bytes in the container. */
  dataStart: number
}

export interface OpenedContainer {
  meta: { format: string; version: number; package: string; generator?: unknown; created?: string }
  /** Parsed `book.reader.json`; check it with validatePackage before use. */
  package: unknown
  audio: ContainerAudio[]
}

/** The file is not a usable container; the message is for the user. */
export class ContainerError extends Error {}

interface Entry {
  path: string
  method: number
  flags: number
  packed: number
  size: number
  localOffset: number
  dataStart: number
}

const utf8 = new TextDecoder('utf-8', { fatal: true })
const fail = (message: string): never => { throw new ContainerError(message) }

function u16(b: Uint8Array, at: number) { return b[at] | (b[at + 1] << 8) }
function u32(b: Uint8Array, at: number) { return (b[at] | (b[at + 1] << 8) | (b[at + 2] << 16)) + b[at + 3] * 0x1000000 }

const AUDIO = /^audio\/[^/]+$/

/** A path allowed by the contract: one of the three fixed names or audio/<one name>, NFC, no tricks. */
export function safePath(path: string): boolean {
  if (path !== path.normalize('NFC') || path.startsWith('/') || path.includes('\\')) return false
  if ([...path].some((ch) => { const c = ch.codePointAt(0)!; return c < 0x20 || c === 0x7f })) return false
  if (path.split('/').some((part) => part === '' || part === '.' || part === '..')) return false
  return path === 'mimetype' || path === CONTAINER_META || path === CONTAINER_PACKAGE || AUDIO.test(path)
}

async function readEntries(src: ByteSource): Promise<{ entries: Entry[]; centralStart: number }> {
  if (src.size < 22) fail('Файл замалий для книжки в одному файлі.')
  const tailStart = Math.max(0, src.size - 65_557)
  const tail = await src.read(tailStart, src.size)
  let eocd = -1
  for (let i = tail.length - 22; i >= 0; i--) {
    if (tail[i] === 0x50 && tail[i + 1] === 0x4b && tail[i + 2] === 0x05 && tail[i + 3] === 0x06) { eocd = i; break }
  }
  if (eocd < 0) fail('Це не книжка в одному файлі: не знайдено каталог ZIP.')
  const count = u16(tail, eocd + 10)
  const centralSize = u32(tail, eocd + 12)
  const centralStart = u32(tail, eocd + 16)
  if (u16(tail, eocd + 4) !== 0 || u16(tail, eocd + 6) !== 0 || u16(tail, eocd + 8) !== count) fail('Багатотомний ZIP не підтримується.')
  if (count === 0xffff || centralSize === 0xffffffff || centralStart === 0xffffffff) fail('ZIP64 не підтримується: файл завеликий для цієї версії.')
  if (count > MAX_CONTAINER_TRACKS + 3) fail('Забагато записів у файлі книжки.')
  if (centralStart + centralSize > tailStart + eocd) fail('Файл книжки пошкоджено: каталог ZIP виходить за межі.')
  const central = await src.read(centralStart, centralStart + centralSize)
  const entries: Entry[] = []
  let at = 0
  for (let i = 0; i < count; i++) {
    if (at + 46 > central.length || u32(central, at) !== 0x02014b50) fail('Файл книжки пошкоджено: каталог ZIP.')
    const flags = u16(central, at + 8)
    const method = u16(central, at + 10)
    const packed = u32(central, at + 20)
    const size = u32(central, at + 24)
    const nameLength = u16(central, at + 28)
    const extraLength = u16(central, at + 30)
    const commentLength = u16(central, at + 32)
    const localOffset = u32(central, at + 42)
    let path: string
    try {
      path = utf8.decode(central.subarray(at + 46, at + 46 + nameLength))
    } catch {
      return fail('Файл книжки має запис з неправильною назвою.')
    }
    if (packed === 0xffffffff || size === 0xffffffff || localOffset === 0xffffffff) fail('ZIP64 не підтримується: файл завеликий для цієї версії.')
    if (flags & 0x1) fail('Зашифрований файл книжки не підтримується.')
    if (flags & 0x8) fail('Файл книжки записано з дескрипторами даних; такий формат не підтримується.')
    if (!safePath(path)) fail(`Неприпустимий запис у файлі книжки: «${path}».`)
    entries.push({ path, method, flags, packed, size, localOffset, dataStart: 0 })
    at += 46 + nameLength + extraLength + commentLength
  }
  const seen = new Set<string>()
  for (const entry of entries) {
    const key = entry.path.toLowerCase()
    if (seen.has(key)) fail(`Запис «${entry.path}» повторюється у файлі книжки.`)
    seen.add(key)
  }
  return { entries, centralStart }
}

async function locate(src: ByteSource, entries: Entry[], centralStart: number) {
  for (const entry of entries) {
    if (entry.localOffset + 30 > centralStart) fail('Файл книжки пошкоджено: запис поза файлом.')
    const header = await src.read(entry.localOffset, entry.localOffset + 30)
    if (u32(header, 0) !== 0x04034b50) fail('Файл книжки пошкоджено: заголовок запису.')
    const nameLength = u16(header, 26)
    const extraLength = u16(header, 28)
    const name = await src.read(entry.localOffset + 30, entry.localOffset + 30 + nameLength)
    if (new TextDecoder().decode(name) !== entry.path || u16(header, 8) !== entry.method || (u16(header, 6) & 0x9) !== 0) {
      fail('Файл книжки пошкоджено: заголовок запису не збігається з каталогом.')
    }
    entry.dataStart = entry.localOffset + 30 + nameLength + extraLength
    if (entry.dataStart + entry.packed > centralStart) fail('Файл книжки пошкоджено: дані запису виходять за межі.')
  }
  const ordered = [...entries].sort((a, b) => a.localOffset - b.localOffset)
  for (let i = 1; i < ordered.length; i++) {
    if (ordered[i].localOffset < ordered[i - 1].dataStart + ordered[i - 1].packed) fail('Файл книжки пошкоджено: записи перетинаються.')
  }
}

async function readJSON(src: ByteSource, entry: Entry, maxSize: number): Promise<unknown> {
  if (entry.method !== 0 && entry.method !== 8) fail(`Запис «${entry.path}» стиснуто непідтримуваним способом.`)
  if (entry.size > maxSize) fail(`Запис «${entry.path}» завеликий.`)
  if (entry.method === 0 && entry.packed !== entry.size) fail('Файл книжки пошкоджено: розмір запису.')
  if (entry.method === 8 && entry.size > entry.packed * MAX_DEFLATE_RATIO) fail(`Запис «${entry.path}» стиснуто підозріло сильно.`)
  const raw = await src.read(entry.dataStart, entry.dataStart + entry.packed)
  let bytes: Uint8Array
  try {
    bytes = entry.method === 8 ? await inflate(raw, entry.size) : raw
  } catch {
    return fail(`Запис «${entry.path}» пошкоджено.`)
  }
  try {
    return JSON.parse(new TextDecoder().decode(bytes))
  } catch {
    return fail(`Запис «${entry.path}» — не JSON.`)
  }
}

/** Reads and checks everything except the MP3 bytes (see verifyAudio) and the package itself (validatePackage). */
export async function openContainer(src: ByteSource, maxJSON = maxFileSize): Promise<OpenedContainer> {
  const { entries, centralStart } = await readEntries(src)
  await locate(src, entries, centralStart)
  const byPath = new Map(entries.map((e) => [e.path, e]))
  const mimetype = byPath.get('mimetype')
  if (!mimetype || mimetype.localOffset !== 0 || mimetype.method !== 0) fail('Це не книжка в одному файлі: перший запис має бути mimetype.')
  const type = await src.read(mimetype!.dataStart, mimetype!.dataStart + mimetype!.packed)
  if (new TextDecoder().decode(type) !== CONTAINER_MIMETYPE) fail('Це не книжка в одному файлі: інший тип вмісту.')
  const metaEntry = byPath.get(CONTAINER_META) ?? fail('У файлі книжки немає container.json.')
  const packageEntry = byPath.get(CONTAINER_PACKAGE) ?? fail('У файлі книжки немає book.reader.json.')
  const meta = await readJSON(src, metaEntry, maxJSON) as Partial<OpenedContainer['meta']> & { audio?: unknown }
  if (!meta || typeof meta !== 'object' || meta.format !== CONTAINER_FORMAT) fail('Опис файла книжки (container.json) пошкоджено.')
  if (typeof meta.version !== 'number' || meta.version > CONTAINER_VERSION) fail(`Файл книжки версії ${String(meta.version)} створено новішою програмою; оновіть застосунок.`)
  if (meta.version !== CONTAINER_VERSION) fail(`Версія файла книжки ${String(meta.version)} не підтримується.`)
  if (meta.package !== CONTAINER_PACKAGE) fail('Опис файла книжки вказує інший пакет.')
  const listed = Array.isArray(meta.audio) ? meta.audio as Array<Record<string, unknown>> : fail('В описі файла книжки немає аудіо.')
  if (listed.length === 0 || listed.length > MAX_CONTAINER_TRACKS) fail('Кількість аудіо у файлі книжки неприпустима.')
  if (entries.length !== listed.length + 3) fail('У файлі книжки є зайві або відсутні записи.')
  const audio: ContainerAudio[] = []
  for (const item of listed) {
    const path = typeof item?.path === 'string' ? item.path : ''
    const entry = byPath.get(path)
    if (!AUDIO.test(path) || !entry) fail(`Аудіо «${path}» з опису немає у файлі книжки.`)
    if (entry!.method !== 0) fail(`Аудіо «${path}» має бути без стиснення.`)
    if (typeof item.size !== 'number' || item.size !== entry!.size || entry!.packed !== entry!.size) fail(`Розмір аудіо «${path}» не збігається.`)
    if (typeof item.sha256 !== 'string' || !/^[0-9a-f]{64}$/.test(item.sha256)) fail(`Хеш аудіо «${path}» пошкоджено.`)
    audio.push({ name: path.slice('audio/'.length), path, size: entry!.size, sha256: item.sha256 as string, dataStart: entry!.dataStart })
  }
  const pkg = await readJSON(src, packageEntry, maxJSON)
  return { meta: meta as OpenedContainer['meta'], package: pkg, audio }
}

/** The package and the container describe the same tracks, in the same order. Returns problems, empty when they match. */
export function matchPackage(opened: OpenedContainer, pkg: { tracks?: Array<{ name?: unknown; size?: unknown; sha256?: unknown }> }): string[] {
  const tracks = Array.isArray(pkg.tracks) ? pkg.tracks : []
  if (tracks.length !== opened.audio.length) return ['Кількість доріжок у пакеті й у файлі книжки різна.']
  const problems: string[] = []
  tracks.forEach((track, i) => {
    const audio = opened.audio[i]
    if (track.name !== audio.name || track.size !== audio.size || track.sha256 !== audio.sha256) {
      problems.push(`Доріжка ${i + 1} пакета не збігається з аудіо «${audio.path}» у файлі книжки.`)
    }
  })
  return problems
}

/** SHA-256 of one stored MP3, read in pieces; true when it is the one described. */
export async function verifyAudio(src: ByteSource, audio: ContainerAudio, chunk = 4 * 1024 * 1024): Promise<boolean> {
  const hash = new Sha256()
  for (let at = 0; at < audio.size; at += chunk) {
    hash.update(await src.read(audio.dataStart + at, audio.dataStart + Math.min(audio.size, at + chunk)))
  }
  return hash.hex() === audio.sha256
}
