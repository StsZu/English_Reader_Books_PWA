// Rollback with the same data (specs/015-reader-book-container, R031, SC-06), local WebKit only — not an iPad.
// The new version (this branch, production build) imports two `.polenuk` containers — a control book and the book under
// test — each with a long timed text, its translation and its own synthetic MP3 (made here by a local ffmpeg). Progress
// that is not the default (reading place, listening time and speed) is written for both in the app's own shape. Then
// the previous production version (`main` at a fixed commit, production build) is served on the SAME origin (scheme,
// host, port) in the SAME browser context: on start it must leave the data as it is, then open both books, restore the
// reading place (geometry), the listening time and the speed in its own UI, show the text and the translation and play
// the stored audio with the highlight following the time.
// Limits: service workers are blocked (the code of the old version on the data, not a service-worker update); the speed
// is switched back to 1× before playing, because Playwright's WebKit stops opening audio after a pause at another speed
// (tests/e2e/audiobook.spec.ts); synthetic tones, not speech. Every audio event is written to audio-events.log.
// Run: tests/rollback/run.sh. Nothing is published, nothing is installed, no request leaves the machine.
import { createServer, type Server } from 'node:http'
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { readFile, stat } from 'node:fs/promises'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { extname, join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { expect, test, webkit, devices, type Page } from '@playwright/test'
import { databaseName, sourceLanguage } from '../../src/core/language.ts'
import type { Chapter } from '../../src/core/model/book.ts'
import { editionHash, PACKAGE_FORMAT, PACKAGE_VERSION } from '../../src/core/prepared/package.ts'
import { CONTAINER_MIMETYPE } from '../../src/core/prepared/container.ts'
import { preparedText } from '../fixtures/language.ts'
import { zipArchive } from '../fixtures/zip-writer.ts'

const ROOT = process.env.R031_DIR ?? ''
const LANG = process.env.APP_LANG ?? 'en'
const PORT = Number(process.env.R031_PORT ?? 5193)
const FFMPEG = process.env.R031_FFMPEG ?? '/Users/szubar/bin/ffmpeg'
const PARAGRAPHS = 30                       // one timed sentence each, 1 s apart: the text is longer than the screen
const PLACE = { chapter: 0, paragraph: 20 } // reading place, not the default
const LISTENED = 12.4                       // listening time, not the default (paragraph 12)
const RATE = 1.15                           // listening speed, not the default
const REWIND = 3                            // the old player goes back 3 s when a reopened book starts playing

interface Book { title: string; prefix: string; hz: number }
// The control book is imported first (it is in the library before the book under test), each with its own tone.
const BOOKS: Book[] = [
  { title: 'Control book', prefix: 'Контроль', hz: 660 },
  { title: preparedText.title, prefix: 'Переклад', hz: 440 },
]

const TYPES: Record<string, string> = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json',
  '.webmanifest': 'application/manifest+json', '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon',
  '.woff2': 'font/woff2', '.txt': 'text/plain', '.epub': 'application/epub+zip' }

/** One local static server whose folder is switched between the two versions: the origin, and so the data, stay. */
let folder = ''
let server: Server
test.beforeAll(async () => {
  server = createServer(async (req, res) => {
    const path = decodeURIComponent(new URL(req.url ?? '/', 'http://x').pathname)
    let file = resolve(join(folder, path))
    if (!file.startsWith(resolve(folder))) { res.writeHead(403).end(); return }
    try {
      if ((await stat(file)).isDirectory()) file = join(file, 'index.html')
    } catch {
      file = join(folder, 'index.html')
    }
    try {
      res.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream', 'cache-control': 'no-store' })
      res.end(await readFile(file))
    } catch {
      res.writeHead(404).end()
    }
  })
  await new Promise<void>((done) => server.listen(PORT, '127.0.0.1', done))
})
test.afterAll(() => new Promise<void>((done) => server.close(() => done())))

/** A synthetic MP3 (a sine tone), made by the local ffmpeg; nothing is downloaded. */
function mp3(dir: string, hz: number): Buffer {
  const out = join(dir, `tone-${hz}.mp3`)
  execFileSync(FFMPEG, ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', `sine=frequency=${hz}:duration=${PARAGRAPHS + 2}`,
    '-ac', '1', '-ar', '22050', '-b:a', '64k', out])
  return readFileSync(out)
}

async function container(dir: string, book: Book): Promise<{ file: { name: string; mimeType: string; buffer: Buffer }; sha: string; size: number }> {
  const base = preparedText.third.replace(/[.!?]$/, '')
  const chapters: Chapter[] = [{
    title: preparedText.heading,
    // Each paragraph several lines long, so the place after paragraph 20 is more than a screen and it can be at the top.
    paragraphs: Array.from({ length: PARAGRAPHS }, (_, i) => ({ kind: 'text' as const,
      sentences: [`${base} ${i}, ${Array.from({ length: 8 }, () => base.toLowerCase()).join(', ')}.`] })),
  }]
  const audio = mp3(dir, book.hz)
  const name = `${book.prefix.toLowerCase()}.mp3`
  const sha = createHash('sha256').update(audio).digest('hex')
  const pkg = {
    format: PACKAGE_FORMAT, version: PACKAGE_VERSION, packageId: `r031-${book.hz}`, edition: await editionHash(chapters),
    language: sourceLanguage, translationLanguage: 'uk',
    book: { title: book.title, author: 'Test', format: 'txt', chapters },
    translations: Object.fromEntries(chapters[0].paragraphs.map((_, i) => [`0-${i}`, [`${book.prefix} ${i}.`]])),
    tracks: [{ id: 't1', name, size: audio.length, sha256: sha }],
    sync: Object.fromEntries(chapters[0].paragraphs.map((_, i) => [`0-${i}`, [['t1', i, i + 0.9]]])),
  }
  const meta = JSON.stringify({ format: 'reader-book-container', version: 1, package: 'book.reader.json',
    audio: [{ path: `audio/${name}`, size: audio.length, sha256: sha }] })
  const bytes = zipArchive([['mimetype', CONTAINER_MIMETYPE, false], ['container.json', meta, true],
    ['book.reader.json', JSON.stringify(pkg), true], [`audio/${name}`, new Uint8Array(audio), false]])
  return { file: { name: `${book.hz}.polenuk`, mimeType: 'application/octet-stream', buffer: Buffer.from(bytes) }, sha, size: audio.length }
}

const snapshot = (page: Page) => page.evaluate(async (name) => {
  const hex = (b: ArrayBuffer) => [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, '0')).join('')
  const plain = async (v: unknown): Promise<unknown> => {
    if (v instanceof Blob) return { sha: hex(await crypto.subtle.digest('SHA-256', await v.arrayBuffer())), size: v.size, type: v.type }
    if (v instanceof ArrayBuffer) return { sha: hex(await crypto.subtle.digest('SHA-256', v)), size: v.byteLength }
    if (Array.isArray(v)) return Promise.all(v.map(plain))
    if (v && typeof v === 'object') {
      const o: Record<string, unknown> = {}
      for (const [k, x] of Object.entries(v)) o[k] = await plain(x)
      return o
    }
    return v
  }
  const ask = <T>(r: IDBRequest<T>) => new Promise<T>((ok, no) => { r.onsuccess = () => ok(r.result); r.onerror = () => no(r.error) })
  const out: Record<string, unknown> = {}
  for (const db of [name, `${name}-audio`, `${name}-sync`]) {
    const d = await ask(indexedDB.open(db))
    for (const store of [...d.objectStoreNames]) {
      const keys = await ask(d.transaction(store).objectStore(store).getAllKeys())
      const values = await ask(d.transaction(store).objectStore(store).getAll())
      for (let i = 0; i < keys.length; i++) out[`${db.slice(name.length) || 'main'}/${store}/${String(keys[i])}`] = await plain(values[i])
    }
    d.close()
  }
  return out
}, databaseName)

/** The time of the playing audio element: elements made by `new Audio()` are remembered by an init script of the test
 * (the app's code is not changed); -1 when none plays. */
const playingTime = (page: Page) => page.evaluate(() => {
  const all = (globalThis as unknown as { __r031Audios?: HTMLAudioElement[] }).__r031Audios ?? []
  const playing = all.filter((a) => !a.paused)
  return playing.length ? Math.max(...playing.map((a) => a.currentTime)) : -1
})

const activeParagraph = (page: Page) =>
  page.locator('.s.active').first().evaluate((s) => Number(s.closest('[data-p]')!.getAttribute('data-p')))

const idOf = (snap: Record<string, unknown>, title: string) =>
  Object.entries(snap).find(([k, v]) => k.startsWith('main/books/') && (v as { title?: string }).title === title)?.[0].slice('main/books/'.length)

async function open(page: Page, which: 'new' | 'old') {
  folder = join(ROOT, `${which}-${LANG}`)
  await page.goto(`http://127.0.0.1:${PORT}/`)
  await expect(page.locator('[data-testid^="book-"]').first()).toBeVisible()
  // Which version is on screen: only the new one accepts a `.polenuk`.
  const accept = await page.getByTestId('importPreparedInput').getAttribute('accept')
  expect(accept?.includes('.polenuk'), `the ${which} version is served`).toBe(which === 'new')
}

/** In the old UI: the reading place, the listening time and the speed are restored; then (at 1×) the stored audio
 * plays from there and the highlight with its translation follows the real time. */
async function readsAndPlays(page: Page, book: Book) {
  await page.getByTestId(`book-${book.title}`).click()
  const scroll = page.getByTestId('readerScroll')
  await expect(scroll).toBeVisible()
  await expect(page.getByTestId('audioBar')).toBeVisible()
  await page.waitForTimeout(600)
  const offset = await scroll.evaluate((el, p) => {
    const paragraph = el.querySelector<HTMLElement>(`[data-p="${p}"]`)!
    return paragraph.getBoundingClientRect().top - el.getBoundingClientRect().top
  }, PLACE.paragraph)
  expect(Math.abs(offset), `${book.title}: paragraph ${PLACE.paragraph} at the top (offset ${offset})`).toBeLessThan(80)
  await expect(page.locator(`[data-p="${PLACE.paragraph}"] .s[data-s="0"]`)).toContainText(preparedText.third.replace(/[.!?]$/, ''))
  await expect(page.getByTestId('audioTime')).toHaveText('0:12')
  await expect(page.getByTestId('audioRate')).toHaveText('1,15×')
  await page.getByTestId('audioRate').click()                             // back to 1× while paused (see the limits)
  await page.getByTestId('audioRate-1').click()
  await expect(page.getByTestId('audioRate')).toHaveText('1,0×')

  await page.getByTestId('audioPlay').click()
  await expect(page.locator('.s.active')).toHaveCount(1, { timeout: 8_000 })
  const t0 = await playingTime(page)
  const first = await activeParagraph(page)
  await page.waitForTimeout(1500)
  const t1 = await playingTime(page)
  // Resumed from the stored time, as the old player resumes a reopened book: 3 s back (LONG_PAUSE_REWIND_SECONDS).
  expect(t0, `${book.title}: resumed from the stored time`).toBeGreaterThanOrEqual(LISTENED - REWIND - 0.3)
  expect(t0, `${book.title}: resumed from the stored time`).toBeLessThanOrEqual(LISTENED + 0.5)
  expect(t1, `${book.title}: the stored audio plays and its time moves`).toBeGreaterThan(t0 + 0.5)
  expect(first, `${book.title}: the first highlight is where the audio resumed`).toBe(Math.floor(t0))
  // The highlight moves on with the sound: a later paragraph, and its own translation.
  await expect.poll(() => activeParagraph(page), { timeout: 6_000 }).toBeGreaterThan(first)
  const active = await activeParagraph(page)
  await expect(page.getByTestId(`translation-0-${active}-0`)).toHaveText(`${book.prefix} ${active}.`)
  await page.getByTestId('audioPause').click()
}

test(`R031 ${LANG}: the previous production version reads and plays books from containers with the same data`, async ({}, info) => {
  expect(ROOT, 'R031_DIR').not.toBe('')
  const work = mkdtempSync(join(tmpdir(), 'r031-'))
  const events: string[] = []
  try {
    const made = await Promise.all(BOOKS.map((b) => container(work, b)))
    const files = made.map((m) => m.file)
    const context = await webkit.launchPersistentContext(join(work, 'profile'),
      { ...devices['iPad Pro 11'], locale: 'uk-UA', serviceWorkers: 'block' })
    await context.addInitScript(() => {
      const Original = window.Audio
      const seen: HTMLAudioElement[] = ((globalThis as unknown as { __r031Audios?: HTMLAudioElement[] }).__r031Audios = [])
      const Remembered = function (src?: string) {
        const a = new Original(src)
        const id = seen.push(a)
        for (const ev of ['loadedmetadata', 'durationchange', 'play', 'playing', 'pause', 'seeked', 'ratechange', 'ended', 'error', 'stalled', 'waiting'])
          a.addEventListener(ev, () => console.log(`R031AUDIO ${id} ${ev} t=${a.currentTime.toFixed(2)} d=${a.duration} rate=${a.playbackRate} err=${a.error?.code ?? ''}`))
        return a
      } as unknown as typeof Audio
      Remembered.prototype = Original.prototype
      window.Audio = Remembered
    })
    context.on('console', (m) => { if (m.text().startsWith('R031AUDIO')) events.push(`${new Date().toISOString()} ${m.text().slice(10)}`) })
    const page = await context.newPage()
    page.on('pageerror', (e) => events.push(`${new Date().toISOString()} PAGEERROR ${e.message}`))
    await page.route('https://api.openai.com/**', (route) => route.abort())

    // New version: both containers imported, then progress that is not the default, in the app's own shape.
    for (const file of files) {
      await open(page, 'new')
      events.push(`--- new: import ${file.name}`)
      await page.getByTestId('importPreparedInput').setInputFiles([file])
      await expect(page.getByTestId('readerScroll')).toBeVisible()
    }
    await open(page, 'new')
    await page.evaluate(async ({ name, titles, place, time, rate }) => {
      const ask = <T>(r: IDBRequest<T>) => new Promise<T>((ok, no) => { r.onsuccess = () => ok(r.result); r.onerror = () => no(r.error) })
      const main = await ask(indexedDB.open(name))
      const audio = await ask(indexedDB.open(`${name}-audio`))
      const books = await ask(main.transaction('books').objectStore('books').getAll()) as { id: string; title: string }[]
      for (const title of titles) {
        const id = books.find((b) => b.title === title)!.id
        await ask(main.transaction('positions', 'readwrite').objectStore('positions').put(place, id))
        await ask(audio.transaction('positions', 'readwrite').objectStore('positions').put({ track: 0, time, rate }, id))
      }
      main.close(); audio.close()
    }, { name: databaseName, titles: BOOKS.map((b) => b.title), place: PLACE, time: LISTENED, rate: RATE })
    const before = await snapshot(page)
    for (const book of BOOKS) {
      const id = idOf(before, book.title)!
      expect(id, book.title).toBeTruthy()
      expect(before[`main/translations/${id}|0-20`]).toEqual([`${book.prefix} 20.`])
      expect(Object.keys(before[`-sync/sync/${id}`] as object)).toHaveLength(PARAGRAPHS)
      const [track] = before[`-audio/tracks/${id}`] as { id: string }[]
      // The stored audio is this book's own MP3, byte for byte (a Blob, or its bytes where WebKit keeps no Blob).
      const stored = before[`-audio/files/${track.id}`] as { sha?: string; size?: number; audioBytes?: { sha: string; size: number } }
      const { sha, size } = made[BOOKS.indexOf(book)]
      expect(stored.audioBytes ? { sha: stored.audioBytes.sha, size: stored.audioBytes.size } : { sha: stored.sha, size: stored.size },
        `${book.title}: stored audio`).toEqual({ sha, size })
      expect(before[`main/positions/${id}`]).toEqual(PLACE)
      expect(before[`-audio/positions/${id}`]).toEqual({ track: 0, time: LISTENED, rate: RATE })
    }

    // Previous version on the same origin, in the same context: first, nothing of the data changes by starting it.
    events.push('--- old: start')
    await open(page, 'old')
    for (const book of BOOKS) await expect(page.getByTestId(`book-${book.title}`)).toBeVisible()
    expect(await snapshot(page)).toEqual(before)

    for (const book of BOOKS) {
      await open(page, 'old')
      events.push(`--- old: ${book.title}`)
      await readsAndPlays(page, book)
    }
    const after = await snapshot(page)
    const ids = BOOKS.map((b) => idOf(before, b.title)!)
    for (const [key, value] of Object.entries(before)) {
      if (key.startsWith('main/meta/') || ids.some((id) => key.endsWith(`positions/${id}`))) continue  // moved by reading
      // A track's `duration` is null until a version measured the file; opening the book in the old version may record
      // it (the new one does the same when it gets there first). Only null → the file's real length is allowed.
      if (key.startsWith('-audio/tracks/')) {
        const measured = (after[key] as { duration: number | null }[]).map((t, i) =>
          (value as { duration: number | null }[])[i].duration === null && t.duration !== null && Math.abs(t.duration - (PARAGRAPHS + 2)) < 0.5
            ? { ...t, duration: null } : t)
        expect(measured, key).toEqual(value)
        continue
      }
      expect(after[key], key).toEqual(value)                                 // texts, translations, time, audio bytes
    }
    await context.close()
  } finally {
    writeFileSync(info.outputPath('audio-events.log'), events.join('\n') + '\n')
    rmSync(work, { recursive: true, force: true })
  }
})
