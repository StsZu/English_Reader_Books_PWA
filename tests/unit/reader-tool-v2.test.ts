// Protocol 2 of the reader tool (specs/015-reader-book-container, R012–R014): sentences with time from word times,
// the book from sentences and translations by occurrence id, and the check of a one-file container. Synthetic data
// of the build language; the tool is the build the converter runs (build/reader-tool-p2).
import { execFileSync, spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { sourceLanguage } from '../../src/core/language.ts'
import { linkWords } from '../../scripts/reader-sentences.ts'
import { CONTAINER_MIMETYPE } from '../../src/core/prepared/container.ts'
import { zipArchive } from '../fixtures/zip-writer.ts'
import { preparedChapters } from '../fixtures/language.ts'

const ROOT = 'build/reader-tool-p2'
const language: string = sourceLanguage
const otherLanguage = language === 'en' ? 'pl' : 'en'
let tool = ''
let dir: string
const at = (name: string) => join(dir, name)
const sha = (b: Uint8Array) => createHash('sha256').update(b).digest('hex')
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- answers of the tool are read field by field
type Answer = Record<string, any>

function call(...args: string[]): Answer {
  const run = spawnSync(process.execPath, [tool, ...args], { encoding: 'utf8' })
  const answer = JSON.parse(run.stdout)
  expect(run.status).toBe(answer.ok ? 0 : answer.kind === 'input' ? 1 : 2)
  return answer
}

/** Whisper words of chapters (from 1): lower case, no punctuation, 0.5 s each. */
function words(chapters: number[], from = 1) {
  const list: Array<{ word: string; start: number; end: number }> = []
  let t = from
  for (const c of chapters) {
    const ch = preparedChapters[c - 1]
    for (const w of ch.sentences.join(' ').toLocaleLowerCase().replace(/[.,!?]/g, '').split(' ')) {
      list.push({ word: ` ${w}`, start: t, end: t + 0.4 })
      t += 0.5
    }
  }
  return { segments: [{ words: list }] }
}

const audio = [new Uint8Array([1, 1, 1]), new Uint8Array([2, 2, 2, 2])]
const track = (i: number, extra: Record<string, unknown>) => ({
  id: `t${i + 1}`, audio: { name: `0${i + 1}.mp3`, size: audio[i].length, sha256: sha(audio[i]) }, words: `0${i + 1}.json`, ...extra,
})

beforeAll(() => {
  execFileSync(process.execPath, ['scripts/build-reader-tool.mjs'], { stdio: 'pipe' })
  tool = join(ROOT, JSON.parse(readFileSync(`${ROOT}/manifest.json`, 'utf8')).tools[sourceLanguage].file)
  dir = mkdtempSync(join(tmpdir(), 'reader-tool-v2-'))
  // A transcript per track, as the converter writes it from the kept words: paragraphs, no headings.
  writeFileSync(at('t1.txt'), `${preparedChapters[0].sentences.join(' ')}\n\n${preparedChapters[1].sentences.join(' ')}\n`)
  writeFileSync(at('t2.txt'), `${preparedChapters[2].sentences.join(' ')}\n`)
  writeFileSync(at('01.json'), JSON.stringify(words([1, 2])))
  writeFileSync(at('02.json'), JSON.stringify(words([3])))
  writeFileSync(at('plan.json'), JSON.stringify({ language: sourceLanguage, title: 'Synthetic', tracks: [
    track(0, { text: 't1.txt', title: 'Part 1' }), track(1, { text: 't2.txt', title: 'Part 2' }),
  ] }))
}, 60_000)
afterAll(() => rmSync(dir, { recursive: true, force: true }))

describe(`protocol 2: sentences (${sourceLanguage})`, () => {
  it('an unchanged transcript is linked word by word directly, every sentence gets its time in its own track', () => {
    const answer = call('sentences', '--plan', at('plan.json'), '--out', at('s.json'))
    expect(answer).toMatchObject({ ok: true, sentences: 6, timed: 6 })
    expect(answer.tracks.map((t: Answer) => [t.id, t.direct])).toEqual([['t1', true], ['t2', true]])
    const file = JSON.parse(readFileSync(at('s.json'), 'utf8'))
    expect(file.sentences[0]).toMatchObject({ track: 't1', start: 1, text: preparedChapters[0].sentences[0] })
    expect(file.sentences.find((s: Answer) => s.track === 't2').start).toBe(1)   // own time of track 2
    expect(new Set(file.sentences.map((s: Answer) => s.id)).size).toBe(6)
  })

  it('the same sentence in two places is two occurrences with different ids', () => {
    writeFileSync(at('rep.txt'), `${preparedChapters[0].sentences[0]} ${preparedChapters[0].sentences[0]}\n`)
    const first = preparedChapters[0].sentences[0].toLocaleLowerCase().replace(/[.,!?]/g, '').split(' ')
    writeFileSync(at('rep.json'), JSON.stringify({ segments: [{ words: [...first, ...first].map((x, i) => ({ word: ` ${x}`, start: 1 + i * 0.5, end: 1.4 + i * 0.5 })) }] }))
    writeFileSync(at('rep-plan.json'), JSON.stringify({ language: sourceLanguage, tracks: [{ ...track(0, { text: 'rep.txt' }), words: 'rep.json' }] }))
    call('sentences', '--plan', at('rep-plan.json'), '--out', at('rep-s.json'))
    const file = JSON.parse(readFileSync(at('rep-s.json'), 'utf8'))
    expect(file.sentences).toHaveLength(2)
    expect(file.sentences[0].text).toBe(file.sentences[1].text)
    expect(file.sentences[0].id).not.toBe(file.sentences[1].id)
    expect(file.sentences[1].start).toBeGreaterThan(file.sentences[0].start)
  })

  it('an edited transcript is aligned, not linked directly; the changed sentence may lose its time, the others keep it', () => {
    const edited = `${preparedChapters[0].sentences[0]} Completely different words here.\n\n${preparedChapters[1].sentences.join(' ')}\n`
    writeFileSync(at('t1-edited.txt'), edited)
    writeFileSync(at('plan-edited.json'), JSON.stringify({ language: sourceLanguage, tracks: [track(0, { text: 't1-edited.txt' })] }))
    const answer = call('sentences', '--plan', at('plan-edited.json'), '--out', at('s-edited.json'))
    expect(answer.tracks[0].direct).toBe(false)
    const file = JSON.parse(readFileSync(at('s-edited.json'), 'utf8'))
    expect(file.sentences[0].start).toBe(1)
    expect(file.sentences[1].start).toBeNull()
    expect(file.sentences.slice(2).every((s: Answer) => s.start !== null)).toBe(true)
  })

  it('one book text with chapters per track, as protocol 1', () => {
    writeFileSync(at('book.md'), `# Book\n\n${preparedChapters.map((c) => `## ${c.heading}\n\n${c.sentences.join(' ')}\n`).join('\n')}`)
    writeFileSync(at('plan-book.json'), JSON.stringify({ language: sourceLanguage, text: 'book.md', tracks: [
      track(0, { chapters: [1, 2] }), track(1, { chapters: [3] }),
    ] }))
    const answer = call('sentences', '--plan', at('plan-book.json'), '--out', at('s-book.json'))
    expect(answer).toMatchObject({ ok: true, sentences: 9, timed: 6 })   // headings are not spoken
  })

  it('refuses a plan for the other language, repeated audio names and word times out of order', () => {
    writeFileSync(at('bad-lang.json'), JSON.stringify({ language: otherLanguage, tracks: [track(0, { text: 't1.txt' })] }))
    expect(call('sentences', '--plan', at('bad-lang.json'), '--out', at('x.json'))).toMatchObject({ ok: false, kind: 'input' })
    writeFileSync(at('bad-names.json'), JSON.stringify({ language: sourceLanguage, tracks: [track(0, { text: 't1.txt' }), { ...track(1, { text: 't2.txt' }), audio: { ...track(0, {}).audio, name: '01.MP3' } }] }))
    expect(call('sentences', '--plan', at('bad-names.json'), '--out', at('x.json')).error).toMatch(/повторюється/)
    const w = words([1, 2])
    w.segments[0].words[2].start = 0.1
    writeFileSync(at('back.json'), JSON.stringify(w))
    writeFileSync(at('bad-time.json'), JSON.stringify({ language: sourceLanguage, tracks: [{ ...track(0, { text: 't1.txt' }), words: 'back.json' }] }))
    expect(call('sentences', '--plan', at('bad-time.json'), '--out', at('x.json')).error).toMatch(/не за часом/)
  })
})

describe('protocol 2: long texts are aligned in windows', () => {
  it('a text 3 times over the limit of one table loses and repeats no word', () => {
    const vocab = 'one two three four five six seven eight nine ten'.split(' ')
    let seed = 3
    const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648
    const book = Array.from({ length: 9000 }, () => vocab[Math.floor(rnd() * vocab.length)])
    const heard = book.filter(() => rnd() > 0.02)
    const limit = Math.round(((9000 + 1) * (heard.length + 1)) / 3)
    const { pairs, direct } = linkWords(book, [...heard, 'extra'], limit)
    expect(direct).toBe(false)
    for (let k = 1; k < pairs.length; k++) {
      expect(pairs[k][0]).toBeGreaterThan(pairs[k - 1][0])
      expect(pairs[k][1]).toBeGreaterThan(pairs[k - 1][1])
    }
    expect(pairs.length).toBeGreaterThan(heard.length * 0.95)
  })
})

describe(`protocol 2: book from sentences and translations (${sourceLanguage})`, () => {
  const translations = () => JSON.parse(readFileSync(at('s.json'), 'utf8')).sentences.map((s: Answer) => ({ id: s.id, text: `Переклад ${s.id.slice(-4)}` }))

  it('builds and checks the package; source keeps rights and the way it was obtained apart', () => {
    writeFileSync(at('uk.json'), JSON.stringify(translations()))
    writeFileSync(at('source.json'), JSON.stringify({ title: 'Synthetic', contentRights: { basis: 'own', confirmed: true }, acquisition: { method: 'user-file', confirmed: true } }))
    const answer = call('build-sentences', '--sentences', at('s.json'), '--translations', at('uk.json'), '--source', at('source.json'), '--out', at('book.reader.json'))
    expect(answer).toMatchObject({ ok: true, kind: 'package', sentences: 6, timed: 6 })
    const pkg = JSON.parse(readFileSync(at('book.reader.json'), 'utf8'))
    expect(pkg.source.acquisition.method).toBe('user-file')
    expect(pkg.tracks.map((t: Answer) => t.id)).toEqual(['t1', 't2'])
    expect(call('validate', '--package', at('book.reader.json'))).toMatchObject({ valid: true })
  })

  it('blocks missing, unknown, repeated, empty or mistyped translations', () => {
    const good = translations()
    const cases: Array<[unknown[], RegExp]> = [
      [good.slice(1), /Немає перекладу речень/],
      [[...good, { id: 'nope', text: 'x' }], /немає в книжці/],
      [[...good, good[0]], /повторюється/],
      [[{ ...good[0], text: '  ' }, ...good.slice(1)], /порожній/],
      [[{ id: good[0].id, text: 5 }, ...good.slice(1)], /потрібні рядки/],
    ]
    for (const [list, message] of cases) {
      writeFileSync(at('bad-uk.json'), JSON.stringify(list))
      const answer = call('build-sentences', '--sentences', at('s.json'), '--translations', at('bad-uk.json'), '--out', at('bad.reader.json'))
      expect(answer.ok).toBe(false)
      expect(answer.error).toMatch(message)
    }
  })
})

describe(`protocol 2: validate-container (${sourceLanguage})`, () => {
  it('accepts the container of a built package and refuses one with another MP3', () => {
    const pkgText = readFileSync(at('book.reader.json'), 'utf8')
    const pkg = JSON.parse(pkgText)
    const meta = JSON.stringify({ format: 'reader-book-container', version: 1, package: 'book.reader.json', audio: pkg.tracks.map((t: Answer) => ({ path: `audio/${t.name}`, size: t.size, sha256: t.sha256 })) })
    const make = (second: Uint8Array) => zipArchive([['mimetype', CONTAINER_MIMETYPE, false], ['container.json', meta, true], ['book.reader.json', pkgText, true],
      ['audio/01.mp3', audio[0], false], ['audio/02.mp3', second, false]])
    writeFileSync(at('good.polenuk'), make(audio[1]))
    expect(call('validate-container', '--container', at('good.polenuk'))).toMatchObject({ ok: true, valid: true, problems: [] })
    writeFileSync(at('bad.polenuk'), make(new Uint8Array([9, 9, 9, 9])))
    expect(call('validate-container', '--container', at('bad.polenuk'))).toMatchObject({ valid: false })
    writeFileSync(at('cut.polenuk'), make(audio[1]).slice(0, 40))
    expect(call('validate-container', '--container', at('cut.polenuk'))).toMatchObject({ ok: true, valid: false })
  })
})
