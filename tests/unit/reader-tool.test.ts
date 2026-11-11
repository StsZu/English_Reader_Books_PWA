// The versioned reader tool for the converter (specs/013-prepared-book, D2c): build/reader-tool/reader-book-<lang>.mjs,
// built by scripts/build-reader-tool.mjs and run here as the converter runs it, with synthetic data of the build language.
import { execFileSync, spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { copyFileSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { sourceLanguage } from '../../src/core/language.ts'
import { preparedChapters } from '../fixtures/language.ts'

let tool = ''
let dir: string
const at = (name: string) => join(dir, name)

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- answers of the tool are read field by field
type Answer = Record<string, any>

function call(...args: string[]): Answer {
  const run = spawnSync(process.execPath, [tool, ...args], { encoding: 'utf8' })
  const answer = JSON.parse(run.stdout)
  expect(run.status).toBe(answer.ok ? 0 : answer.kind === 'input' ? 1 : 2)
  return answer
}

function whisper(chapters: number[]) {
  const words: Array<{ word: string; start: number; end: number }> = []
  let t = 1
  for (const c of chapters) {
    const ch = preparedChapters[c - 1]
    for (const w of [ch.heading, ...ch.sentences].join(' ').toLocaleLowerCase().replace(/[.,!?]/g, '').split(' ')) {
      words.push({ word: ` ${w}`, start: t, end: t + 0.4 })
      t += 0.5
    }
  }
  return { segments: [{ words }] }
}

beforeAll(() => {
  execFileSync(process.execPath, ['scripts/build-reader-tool.mjs'], { stdio: 'pipe' })
  tool = join('build', 'reader-tool', JSON.parse(readFileSync('build/reader-tool/manifest.json', 'utf8')).tools[sourceLanguage].file)
  dir = mkdtempSync(join(tmpdir(), 'reader-tool-'))
  writeFileSync(at('book.md'), `# Book\n\n${preparedChapters.map((c) => `## ${c.heading}\n\n${c.sentences.join(' ')}\n`).join('\n')}`)
}, 60_000)
afterAll(() => rmSync(dir, { recursive: true, force: true }))

describe(`reader tool (${sourceLanguage})`, () => {
  it('names its protocol, language and the hash written in the manifest', () => {
    expect(call('version')).toMatchObject({ ok: true, tool: 'reader-book', protocol: 1, language: sourceLanguage, translationLanguage: 'uk', format: 'reader-book', formatVersion: 1 })
    const manifest = JSON.parse(readFileSync('build/reader-tool/manifest.json', 'utf8'))
    expect(manifest.tools[sourceLanguage].sha256).toBe(createHash('sha256').update(readFileSync(tool)).digest('hex'))
  })

  it('publishes both languages as one package: a repeated build changes nothing, no staging is left', () => {
    const first = readFileSync('build/reader-tool/manifest.json', 'utf8')
    execFileSync(process.execPath, ['scripts/build-reader-tool.mjs'], { stdio: 'pipe' })
    const manifest = JSON.parse(readFileSync('build/reader-tool/manifest.json', 'utf8'))
    expect(readFileSync('build/reader-tool/manifest.json', 'utf8')).toBe(first)
    for (const language of ['en', 'pl']) {
      const file = join('build/reader-tool', manifest.tools[language].file)
      expect(file).toContain(`versions/${manifest.version}/`)
      expect(createHash('sha256').update(readFileSync(file)).digest('hex')).toBe(manifest.tools[language].sha256)
    }
    expect(readdirSync('build/reader-tool').filter((n) => n.startsWith('.'))).toEqual([])
  }, 60_000)

  it('lists the chapters of the book with a preview of each', () => {
    const answer = call('chapters', '--text', at('book.md'))
    expect(answer.chapters.map((c: Answer) => [c.number, c.title, c.sentences, c.preview]))
      .toEqual(preparedChapters.map((c, i) => [i + 1, c.heading, 3, c.sentences[0]]))
  })

  it('writes the template of the translation keyed by the chapters of the tracks, from 0', () => {
    const answer = call('template', '--text', at('book.md'), '--tracks', '2;3', '--out', at('t'))
    expect(answer).toMatchObject({ ok: true, kind: 'template', sentences: 6 })
    expect(Object.keys(JSON.parse(readFileSync(answer.path, 'utf8')))).toEqual(['0-0', '0-1', '1-0', '1-1'])
  })

  it('builds a package of two tracks and checks it with the audio beside it', () => {
    mkdirSync(at('out'), { recursive: true })
    const tracks = [[1, 2], [3]]
    tracks.forEach((chapters, i) => {
      writeFileSync(at(`0${i + 1}.mp3`), new Uint8Array([i + 1, 2, 3]))
      writeFileSync(at(`0${i + 1}.json`), JSON.stringify(whisper(chapters)))
    })
    writeFileSync(at('plan.json'), JSON.stringify({ text: 'book.md', tracks: tracks.map((chapters, i) => ({ audio: `0${i + 1}.mp3`, words: `0${i + 1}.json`, chapters })) }))
    const translation: Record<string, string[]> = {}
    for (let c = 0; c < 3; c++) {
      translation[`${c}-0`] = ['Розділ']
      translation[`${c}-1`] = ['Одне.', 'Два.']
    }
    writeFileSync(at('uk.json'), JSON.stringify(translation))
    const built = call('build', '--plan', at('plan.json'), '--translation', at('uk.json'), '--out', at('out/book.reader.json'))
    expect(built).toMatchObject({ ok: true, kind: 'package', sentences: 9, timed: 9, warnings: [] })
    expect(call('validate', '--package', at('out/book.reader.json'))).toMatchObject({ ok: true, valid: true, problems: [] })
    // Beside the package the audio is missing, then present, then another file.
    expect(call('validate', '--package', at('out/book.reader.json'), '--audio-dir', at('out')).valid).toBe(false)
    copyFileSync(at('01.mp3'), at('out/01.mp3'))
    copyFileSync(at('02.mp3'), at('out/02.mp3'))
    expect(call('validate', '--package', at('out/book.reader.json'), '--audio-dir', at('out'))).toMatchObject({ valid: true, tracks: [{ name: '01.mp3', state: 'ok' }, { name: '02.mp3', state: 'ok' }] })
    writeFileSync(at('out/02.mp3'), new Uint8Array([9, 9, 9]))
    expect(call('validate', '--package', at('out/book.reader.json'), '--audio-dir', at('out')).tracks[1].state).toBe('sha256')
  })

  it('answers a problem with the inputs as JSON, not as a crash', () => {
    expect(call('chapters')).toMatchObject({ ok: false, kind: 'input', error: 'Потрібно: --text' })
    expect(call('chapters', '--text', at('missing.epub'))).toMatchObject({ ok: false, kind: 'input' })
    writeFileSync(at('empty.md'), '')
    expect(call('chapters', '--text', at('empty.md'))).toMatchObject({ ok: false, kind: 'input' })
    expect(call('build', '--plan', at('plan.json'), '--translation', at('book.md'), '--out', at('x.reader.json'))).toMatchObject({ ok: false, kind: 'input' })
    writeFileSync(at('broken.reader.json'), '{')
    expect(call('validate', '--package', at('broken.reader.json'))).toMatchObject({ ok: true, valid: false })
    // JSON that is not a package: an answer, never a crash, also with the audio folder.
    for (const text of ['null', '[]', '{"tracks":[null]}', '{"tracks":[{"name":5}]}']) {
      writeFileSync(at('odd.reader.json'), text)
      expect(call('validate', '--package', at('odd.reader.json'), '--audio-dir', at('out'))).toMatchObject({ ok: true, valid: false })
    }
  })
})
