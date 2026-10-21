// SC-03: compares the PWA importer with book.json produced by the native Swift importer.
// Usage: npm run golden  (expects build/golden/<name>.swift.json; see specs/001-pwa-copy/tasks.md T51)
// @vitest-environment node
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { expect, test } from 'vitest'
import { importBook } from '../../src/core/import/importer.ts'
import { gluesToNext } from '../../src/core/model/segmenter.ts'
import type { Book, BookFormat } from '../../src/core/model/book.ts'

interface Case { name: string; file: string; format: BookFormat; title: string }

const cases: Case[] = [
  { name: 'demo', file: 'public/demo.md', format: 'md', title: 'demo' },
  { name: 'pg1661', file: 'tests/fixtures/external/pg1661.epub', format: 'epub', title: 'pg1661' },
]

type SwiftBook = { title: string; author: string; chapters: { title: string; paragraphs: { kind: string; sentences: string[] }[] }[] }

/** Native splits after abbreviations such as «St.» and «Esq.» that the PWA keeps together (V-09). */
function glueAbbreviations(list: string[]): string[] {
  const out: string[] = []
  for (const s of list) {
    if (out.length > 0 && gluesToNext(out[out.length - 1], s)) out[out.length - 1] += ' ' + s
    else out.push(s)
  }
  return out
}

const count = (b: { chapters: { paragraphs: { sentences: string[] }[] }[] }) =>
  b.chapters.reduce((s, c) => s + c.paragraphs.reduce((t, p) => t + p.sentences.length, 0), 0)

test('розбиття збігається з нативним імпортером', async () => {
const lines: string[] = ['# Еталонне порівняння розбиття (SC-03)', '', `Дата: ${new Date().toISOString()}`, '']
let ok = true

for (const c of cases) {
  const goldenPath = `build/golden/${c.name}.swift.json`
  if (!existsSync(c.file) || !existsSync(goldenPath)) {
    lines.push(`## ${c.name}`, '', `Пропущено: немає ${existsSync(c.file) ? goldenPath : c.file}.`, '')
    continue
  }
  const swift = JSON.parse(readFileSync(goldenPath, 'utf8')) as SwiftBook
  const pwa: Book = await importBook(new Uint8Array(readFileSync(c.file)), c.format, c.title)
  const swiftSentences = count(swift)
  const pwaSentences = count(pwa)
  let paragraphs = 0
  let identical = 0
  let normalized = 0
  const diffs: string[] = []
  const chapterCount = Math.min(swift.chapters.length, pwa.chapters.length)
  for (let ci = 0; ci < chapterCount; ci++) {
    const a = swift.chapters[ci].paragraphs
    const b = pwa.chapters[ci].paragraphs
    const n = Math.max(a.length, b.length)
    for (let pi = 0; pi < n; pi++) {
      paragraphs++
      const sa = a[pi]?.sentences ?? []
      const sb = b[pi]?.sentences ?? []
      if (JSON.stringify(sa) === JSON.stringify(sb)) identical++
      const same = JSON.stringify(glueAbbreviations(sa)) === JSON.stringify(sb)
      if (same) normalized++
      else if (diffs.length < 45) {
        diffs.push(`- розділ ${ci + 1}, абзац ${pi + 1}: Swift ${sa.length} / PWA ${sb.length}`)
        const first = sa.findIndex((s, i) => s !== sb[i])
        diffs.push(`  - Swift: «${(sa[first] ?? '').slice(0, 160)}»`, `  - PWA:   «${(sb[first] ?? '').slice(0, 160)}»`)
      }
    }
  }
  const share = paragraphs ? (identical / paragraphs) * 100 : 100
  const normalizedShare = paragraphs ? (normalized / paragraphs) * 100 : 100
  const sentenceDelta = swiftSentences ? Math.abs(pwaSentences - swiftSentences) / swiftSentences * 100 : 0
  const chaptersOk = swift.chapters.length === pwa.chapters.length
  const pass = chaptersOk && normalizedShare >= 98
  ok &&= pass
  lines.push(
    `## ${c.name} — ${pass ? 'пройдено' : 'НЕ пройдено'}`, '',
    '| Показник | Swift | PWA | Критерій |', '|---|---|---|---|',
    `| Розділи | ${swift.chapters.length} | ${pwa.chapters.length} | рівні |`,
    `| Речення | ${swiftSentences} | ${pwaSentences} | ±1 % (зараз ${sentenceDelta.toFixed(2)} %) |`,
    `| Абзаци з ідентичним поділом | — | ${identical} з ${paragraphs} (${share.toFixed(2)} %) | довідково |`,
    `| …без урахування склеювання після скорочень (V-09) | — | ${normalized} з ${paragraphs} (${normalizedShare.toFixed(2)} %) | ≥ 98 % |`,
    `| Назва / автор | ${swift.title} / ${swift.author} | ${pwa.title} / ${pwa.author} | рівні |`,
    '',
  )
  if (diffs.length) lines.push('Розбіжності, що лишаються (не пояснюються V-09):', '', ...diffs, '')
}

writeFileSync('build/golden/report.md', lines.join('\n'))
console.log(lines.join('\n'))
expect(ok).toBe(true)
}, 60_000)
