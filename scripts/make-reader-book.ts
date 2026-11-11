// Builds a prepared book (specs/013-prepared-book): `<name>.reader.json` from a book file, its audio tracks,
// the word times of a local Whisper run for each track (`--word_timestamps True --output_format json`) and a
// Ukrainian translation. The text is split by the reader's own importer and segmenter (M1); the package is checked
// with the reader's validator before it is written (scripts/reader-book.ts).
//
// Several tracks (D2a): a plan names the chapters each track reads, in the order of the book:
//   [APP_LANG=pl] npm run prepared-book -- --plan plan.json [--translation uk.json] --out book.reader.json [--report report.md] [--id package-id]
//   plan.json: { "text": "book.epub", "tracks": [{ "audio": "01.mp3", "words": "01.json", "chapters": [1, 2] }, …] }
// One track, as before:
//   [APP_LANG=pl] npm run prepared-book -- --text book.epub [--chapters 3] --audio track.mp3 --words track.json \
//     [--translation uk.json] --out book.reader.json [--report report.md] [--id package-id]
//
// Without --translation it writes `<out>.translation.json` with the sentences to translate and stops.
// Book, audio and translation stay outside git (constitution, II).
import { BuildError, makeReaderBook, readPlan, type BookPlan } from './reader-book.ts'

function args(): Record<string, string> {
  const out: Record<string, string> = {}
  const list = process.argv.slice(2)
  for (let i = 0; i < list.length; i += 2) out[list[i].replace(/^--/, '')] = list[i + 1]
  return out
}

async function main() {
  const a = args()
  let plan: BookPlan
  if (a.plan && a.out) {
    plan = readPlan(a.plan)
  } else if (a.text && a.audio && a.words && a.out) {
    plan = { text: a.text, tracks: [{ audio: a.audio, words: a.words, chapters: a.chapters?.split(',').map(Number) }] }
  } else {
    console.error('Потрібно: --plan --out або --text --audio --words --out')
    process.exit(2)
  }
  const result = await makeReaderBook({ plan, out: a.out, translation: a.translation, report: a.report, id: a.id, planFile: a.plan })
  if (result.kind === 'template') {
    console.log(`Речення для перекладу: ${result.path}`)
    return
  }
  console.log(`${result.path}: речень ${result.sentences}, з часом ${result.timed}, без часу ${result.sentences - result.timed}`)
  for (const t of result.tracks) {
    console.log(`  ${t.id} ${t.name}: розділи ${t.chapters.join(', ')}; слів збіглося ${t.matchedWords} з ${t.bookWords}; речень з часом ${t.timedSentences} з ${t.sentences}`)
  }
  for (const warning of result.warnings) console.warn(`Увага: ${warning}`)
}

try {
  await main()
} catch (error) {
  if (!(error instanceof BuildError)) throw error
  console.error(`Пакет не створено. ${error.message}`)
  process.exit(1)
}
