// Builds a prepared book (specs/013-prepared-book, D0): `<name>.reader.json` from a book file, one audio file,
// the word times of a local Whisper run (`--word_timestamps True --output_format json`) and a Ukrainian translation.
// The text is split by the reader's own importer and segmenter; the package keeps those boundaries (M1).
//
//   npm run prepared-book -- --text book.epub [--chapters 3] --audio track.mp3 --words track.json \
//     [--translation uk.json] --out book.reader.json [--report report.md] [--id package-id]
//
// Without --translation it writes `<out>.translation.json` with the sentences to translate and stops.
// Book, audio and translation stay outside git (constitution, II).
import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import { basename, extname } from 'node:path'
import { formatForExtension, importBook } from '../src/core/import/importer.ts'
import { paragraphKey, type Chapter } from '../src/core/model/book.ts'
import {
  editionHash, PACKAGE_FORMAT, PACKAGE_VERSION, type ReaderPackage, type SyncEntry,
} from '../src/core/prepared/package.ts'

interface WhisperWord { word: string; start: number; end: number }

function args(): Record<string, string> {
  const out: Record<string, string> = {}
  const list = process.argv.slice(2)
  for (let i = 0; i < list.length; i += 2) out[list[i].replace(/^--/, '')] = list[i + 1]
  return out
}

const normalize = (text: string): string[] =>
  text.toLowerCase().replace(/[’‘]/g, "'").replace(/[^a-z0-9'\s-]/g, ' ').replace(/-/g, ' ').split(/\s+/)
    .map((w) => w.replace(/^'+|'+$/g, '')).filter(Boolean)

/** Longest common subsequence of the two word lists: pairs [book word, spoken word]. */
function align(a: string[], b: string[]): Array<[number, number]> {
  const width = b.length + 1
  const table = new Uint16Array((a.length + 1) * width)
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      table[i * width + j] = a[i] === b[j]
        ? table[(i + 1) * width + j + 1] + 1
        : Math.max(table[(i + 1) * width + j], table[i * width + j + 1])
    }
  }
  const pairs: Array<[number, number]> = []
  let i = 0
  let j = 0
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) pairs.push([i++, j++])
    else if (table[(i + 1) * width + j] >= table[i * width + j + 1]) i++
    else j++
  }
  return pairs
}

/** A sentence gets a time when at least this share of its words was heard. */
const MIN_MATCHED = 0.5

async function main() {
  const a = args()
  if (!a.text || !a.audio || !a.words || !a.out) {
    console.error('Потрібно: --text --audio --words --out')
    process.exit(2)
  }
  const format = formatForExtension(extname(a.text).slice(1))
  if (!format) throw new Error(`Непідтримуваний формат: ${a.text}`)
  const imported = await importBook(new Uint8Array(readFileSync(a.text)), format, basename(a.text, extname(a.text)))
  const wanted = a.chapters ? a.chapters.split(',').map((n) => Number(n) - 1) : imported.chapters.map((_, i) => i)
  const chapters: Chapter[] = wanted.map((i) => imported.chapters[i])
  if (chapters.some((c) => !c)) throw new Error('Такого розділу немає')

  const translationPath = a.translation
  if (!translationPath) {
    const template: Record<string, string[]> = {}
    chapters.forEach((c, ci) => c.paragraphs.forEach((p, pi) => { template[paragraphKey({ chapter: ci, paragraph: pi })] = p.sentences }))
    writeFileSync(`${a.out}.translation.json`, JSON.stringify(template, null, 2))
    console.log(`Речення для перекладу: ${a.out}.translation.json`)
    return
  }
  const translations = JSON.parse(readFileSync(translationPath, 'utf8')) as Record<string, string[]>

  // Words of the book, each with its sentence.
  const bookWords: string[] = []
  const owner: Array<{ key: string; sentence: number }> = []
  const sentenceWords = new Map<string, number[]>()
  chapters.forEach((c, ci) => c.paragraphs.forEach((p, pi) => p.sentences.forEach((s, si) => {
    const key = paragraphKey({ chapter: ci, paragraph: pi })
    const ids: number[] = []
    for (const word of normalize(s)) {
      ids.push(bookWords.length)
      bookWords.push(word)
      owner.push({ key, sentence: si })
    }
    sentenceWords.set(`${key}:${si}`, ids)
  })))

  const whisper = JSON.parse(readFileSync(a.words, 'utf8')) as { segments: Array<{ words?: WhisperWord[] }> }
  const heard: WhisperWord[] = []
  const heardWords: string[] = []
  for (const word of whisper.segments.flatMap((s) => s.words ?? [])) {
    for (const part of normalize(word.word)) {
      heard.push(word)
      heardWords.push(part)
    }
  }
  const match = new Map<number, WhisperWord>()
  for (const [i, j] of align(bookWords, heardWords)) match.set(i, heard[j])

  const audio = readFileSync(a.audio)
  const trackID = 't1'
  const sync: Record<string, SyncEntry[]> = {}
  const rows: string[] = []
  let previousEnd = 0
  let timed = 0
  let total = 0
  chapters.forEach((c, ci) => c.paragraphs.forEach((p, pi) => {
    const key = paragraphKey({ chapter: ci, paragraph: pi })
    sync[key] = p.sentences.map((text, si) => {
      total++
      const ids = sentenceWords.get(`${key}:${si}`) ?? []
      const hits = ids.map((id) => match.get(id)).filter((w): w is WhisperWord => !!w)
      const share = ids.length ? hits.length / ids.length : 0
      let entry: SyncEntry = null
      if (hits.length && share >= MIN_MATCHED) {
        const start = Math.max(hits[0].start, previousEnd)
        const end = Math.max(hits[hits.length - 1].end, start + 0.1)
        entry = [trackID, Math.round(start * 100) / 100, Math.round(end * 100) / 100]
        previousEnd = entry[2]
        timed++
      }
      const time = entry ? `${entry[1].toFixed(2)} – ${entry[2].toFixed(2)}` : '—'
      rows.push(`| ${key}:${si} | ${time} | ${Math.round(share * 100)}% | ${text.replace(/\|/g, '\\|')} |`)
      return entry
    })
  }))

  const pkg: ReaderPackage = {
    format: PACKAGE_FORMAT,
    version: PACKAGE_VERSION,
    packageId: a.id ?? basename(a.out).replace(/\.reader\.json$/, ''),
    edition: await editionHash(chapters),
    language: 'en',
    translationLanguage: 'uk',
    book: { title: imported.title, author: imported.author, format: imported.format, chapters },
    translations,
    tracks: [{ id: trackID, name: basename(a.audio), size: audio.length, sha256: createHash('sha256').update(audio).digest('hex') }],
    sync,
  }
  writeFileSync(a.out, JSON.stringify(pkg))
  console.log(`${a.out}: речень ${total}, з часом ${timed}, без часу ${total - timed}`)
  if (a.report) {
    writeFileSync(a.report, [
      `# ${imported.title}: час речень`, '',
      `Аудіо: ${basename(a.audio)}. Речень: ${total}, з часом: ${timed}. Слів книжки: ${bookWords.length}, почуто: ${heardWords.length}, збіглося: ${match.size}.`, '',
      '| Речення | Час, с | Слова | Текст |', '|---|---|---|---|', ...rows, '',
    ].join('\n'))
  }
}

await main()
