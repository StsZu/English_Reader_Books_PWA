// Synthetic prepared book for e2e (specs/013-prepared-book, specs/015-reader-book-container): text in the language of
// the build (tests/languages/<lang>/fixtures.ts), a silent WAV generated here, the package and the one-file `.polenuk`.
import { createHash } from 'node:crypto'
import type { Chapter } from '../../../src/core/model/book.ts'
import { editionHash, PACKAGE_FORMAT, PACKAGE_VERSION, type ReaderPackage } from '../../../src/core/prepared/package.ts'
import { sourceLanguage } from '../../../src/core/language.ts'
import { preparedText } from '../language.ts'
import { zipArchive } from '../zip-writer.ts'
import { CONTAINER_MIMETYPE } from '../../../src/core/prepared/container.ts'

function wav(seconds: number, fill = 0): Buffer {
  const samples = 8000 * seconds
  const buffer = Buffer.alloc(44 + samples * 2, fill)
  buffer.write('RIFF', 0, 'ascii')
  buffer.writeUInt32LE(36 + samples * 2, 4)
  buffer.write('WAVEfmt ', 8, 'ascii')
  buffer.writeUInt32LE(16, 16)
  buffer.writeUInt16LE(1, 20)
  buffer.writeUInt16LE(1, 22)
  buffer.writeUInt32LE(8000, 24)
  buffer.writeUInt32LE(16000, 28)
  buffer.writeUInt16LE(2, 32)
  buffer.writeUInt16LE(16, 34)
  buffer.write('data', 36, 'ascii')
  buffer.writeUInt32LE(samples * 2, 40)
  return buffer
}

const chapters: Chapter[] = [{
  title: preparedText.heading,
  paragraphs: [
    { kind: 'text', sentences: [...preparedText.sentences] },
    { kind: 'text', sentences: [preparedText.third] },
  ],
}]

/** Another book of the same shape (a control book in the library): its own title, translations and audio bytes. */
export interface BookVariant { title?: string; translations?: Record<string, string[]>; fill?: number }

const TRANSLATIONS = { '0-0': ['Перше речення.', 'Друге речення.'], '0-1': ['Третє речення.'] }

export async function packageFiles(variant: BookVariant = {}) {
  const audio = wav(30, variant.fill)
  const pkg: ReaderPackage = {
    format: PACKAGE_FORMAT,
    version: PACKAGE_VERSION,
    packageId: 'synthetic',
    edition: await editionHash(chapters),
    language: sourceLanguage,
    translationLanguage: 'uk',
    book: { title: variant.title ?? preparedText.title, author: 'Test', format: 'txt', chapters },
    translations: variant.translations ?? TRANSLATIONS,
    tracks: [{ id: 't1', name: 'synthetic.wav', size: audio.length, sha256: createHash('sha256').update(audio).digest('hex') }],
    // 0–3 s: an introduction without text; the second paragraph from 20 s.
    sync: { '0-0': [['t1', 3, 10], ['t1', 10.2, 18]], '0-1': [['t1', 20, 28]] },
  }
  return [
    { name: 'synthetic.reader.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(pkg)) },
    { name: 'synthetic.wav', mimeType: 'audio/wav', buffer: audio },
  ]
}

/** The same package and audio in one `.polenuk` (specs/015-reader-book-container, R023); `language` overrides the package's. */
export async function polenuk(language?: string, source?: unknown, variant: BookVariant = {}) {
  const [pkgFile, audioFile] = await packageFiles(variant)
  const pkg = JSON.parse(pkgFile.buffer.toString())
  if (language) pkg.language = language
  if (source) pkg.source = source
  const meta = JSON.stringify({ format: 'reader-book-container', version: 1, package: 'book.reader.json',
    audio: [{ path: `audio/${audioFile.name}`, size: audioFile.buffer.length, sha256: createHash('sha256').update(audioFile.buffer).digest('hex') }] })
  const bytes = zipArchive([['mimetype', CONTAINER_MIMETYPE, false], ['container.json', meta, true],
    ['book.reader.json', JSON.stringify(pkg), true], [`audio/${audioFile.name}`, new Uint8Array(audioFile.buffer), false]])
  return { name: 'synthetic.polenuk', mimeType: 'application/octet-stream', buffer: Buffer.from(bytes) }
}

