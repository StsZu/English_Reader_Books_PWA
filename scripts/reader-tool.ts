// Versioned tool of the reader for other programs (specs/013-prepared-book, D2c): the converter calls it to read
// the chapters of a book, write the template of the translation, build and check a prepared book. All of it is the
// reader's own code (importer, segmenter, scripts/reader-book.ts, validatePackage); nothing is copied elsewhere.
// One JSON object on stdout for every call: `{ "ok": true, … }` or `{ "ok": false, "error": "…" }`.
//
//   node reader-book-<lang>.mjs version
//   node reader-book-<lang>.mjs chapters --text book.epub
//   node reader-book-<lang>.mjs template --text book.epub --tracks "1,2;3" --out base   → base.translation.json
//   node reader-book-<lang>.mjs build --plan plan.json --translation uk.json --out book.reader.json [--report r.md]
//   node reader-book-<lang>.mjs validate --package book.reader.json [--audio-dir dir]
import { createHash } from 'node:crypto'
import { createReadStream, readFileSync, statSync } from 'node:fs'
import { basename, extname, join } from 'node:path'
import { formatForExtension, importBook, maxFileSize } from '../src/core/import/importer.ts'
import { ImportError } from '../src/contracts.ts'
import { sourceLanguage } from '../src/core/language.ts'
import { PACKAGE_FORMAT, PACKAGE_VERSION, TRANSLATION_LANGUAGE, validatePackage, type ReaderPackage } from '../src/core/prepared/package.ts'
import { BuildError, makeReaderBook, readPlan } from './reader-book.ts'

/** Changes when a command, an option or the shape of an answer changes; the converter pins it. */
export const TOOL_PROTOCOL = 1
declare const __TOOL_COMMIT__: string
const commit = typeof __TOOL_COMMIT__ === 'string' ? __TOOL_COMMIT__ : 'dev'

class InputError extends Error {}

function options(list: string[]): Record<string, string> {
  const out: Record<string, string> = {}
  for (let i = 0; i < list.length; i += 2) {
    if (!list[i].startsWith('--') || list[i + 1] === undefined) throw new InputError(`Незрозумілий параметр: ${list[i]}`)
    out[list[i].slice(2)] = list[i + 1]
  }
  return out
}

function need(o: Record<string, string>, ...names: string[]) {
  const missing = names.filter((n) => !o[n])
  if (missing.length) throw new InputError(`Потрібно: ${missing.map((n) => `--${n}`).join(' ')}`)
}

async function readBook(path: string) {
  const format = formatForExtension(extname(path).slice(1))
  if (!format) throw new InputError(`Непідтримуваний формат книжки: ${basename(path)} (EPUB, TXT або MD).`)
  let data: Uint8Array
  try {
    data = new Uint8Array(readFileSync(path))
  } catch {
    throw new InputError(`Файла книжки ${path} немає.`)
  }
  return importBook(data, format, basename(path, extname(path)))
}

/** "1,2;3" → [[1, 2], [3]]: chapters (from 1) of each track. */
function trackGroups(text: string): number[][] {
  return text.split(';').map((group) => group.split(',').map((n) => Number(n.trim())))
}

async function sha256File(path: string): Promise<string> {
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(path)) hash.update(chunk as Buffer)
  return hash.digest('hex')
}

async function run(command: string | undefined, rest: string[]): Promise<Record<string, unknown>> {
  const o = options(rest)
  switch (command) {
    case 'version':
      return {
        tool: 'reader-book', protocol: TOOL_PROTOCOL, commit, language: sourceLanguage,
        translationLanguage: TRANSLATION_LANGUAGE, format: PACKAGE_FORMAT, formatVersion: PACKAGE_VERSION, maxPackageBytes: maxFileSize,
      }
    case 'chapters': {
      need(o, 'text')
      const book = await readBook(o.text)
      return {
        title: book.title, author: book.author, format: book.format,
        chapters: book.chapters.map((c, i) => ({
          number: i + 1, title: c.title, paragraphs: c.paragraphs.length,
          sentences: c.paragraphs.reduce((n, p) => n + p.sentences.length, 0),
          /** The first sentence of text: chapters often share a title. */
          preview: (c.paragraphs.find((p) => p.kind === 'text')?.sentences[0] ?? '').slice(0, 120),
        })),
      }
    }
    case 'template': {
      need(o, 'text', 'tracks', 'out')
      const groups = trackGroups(o.tracks)
      // Only the chapters of each track matter for the template: no audio or Whisper file is read.
      const plan = { text: o.text, tracks: groups.map((chapters, i) => ({ audio: `track-${i + 1}`, words: `track-${i + 1}`, chapters })) }
      const result = await makeReaderBook({ plan, out: o.out })
      return { ...result }
    }
    case 'build': {
      need(o, 'plan', 'translation', 'out')
      const result = await makeReaderBook({
        plan: readPlan(o.plan), out: o.out, translation: o.translation, report: o.report,
        id: o.id, maxPackageBytes: o['max-package-bytes'] ? Number(o['max-package-bytes']) : undefined,
      })
      return { ...result }
    }
    case 'validate': {
      need(o, 'package')
      const size = statSync(o.package).size
      if (size > maxFileSize) return { valid: false, problems: [`Файл ${size} байтів, Reader приймає до ${maxFileSize}.`] }
      let pkg: ReaderPackage
      try {
        pkg = JSON.parse(readFileSync(o.package, 'utf8'))
      } catch (error) {
        return { valid: false, problems: [`JSON не прочитано: ${(error as Error).message}`] }
      }
      const problems = await validatePackage(pkg)
      const tracks: Array<Record<string, unknown>> = []
      const listed = pkg && typeof pkg === 'object' && Array.isArray(pkg.tracks) ? pkg.tracks : []
      if (o['audio-dir']) {
        for (const track of listed) {
          // A broken entry is already one of the problems found by validatePackage.
          if (!track || typeof track !== 'object' || typeof track.name !== 'string') continue
          const path = join(o['audio-dir'], basename(String(track.name)))
          let state = 'ok'
          try {
            if (statSync(path).size !== track.size) state = 'size'
            else if (await sha256File(path) !== track.sha256) state = 'sha256'
          } catch {
            state = 'missing'
          }
          if (state !== 'ok') problems.push(`Аудіофайл ${track.name}: ${state === 'missing' ? 'немає поруч із пакетом' : 'інший файл (розмір або SHA-256)'}.`)
          tracks.push({ name: track.name, state })
        }
      }
      return { valid: problems.length === 0, problems, tracks }
    }
    default:
      throw new InputError('Команди: version, chapters, template, build, validate.')
  }
}

const [command, ...rest] = process.argv.slice(2)
try {
  console.log(JSON.stringify({ ok: true, ...(await run(command, rest)) }))
} catch (error) {
  const known = error instanceof BuildError || error instanceof InputError || error instanceof ImportError
  console.log(JSON.stringify({ ok: false, kind: known ? 'input' : 'internal', error: (error as Error).message }))
  process.exitCode = known ? 1 : 2
}
