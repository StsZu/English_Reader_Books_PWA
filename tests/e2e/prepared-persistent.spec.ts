// Audio of a `.polenuk` in a persistent WebKit profile (specs/015-reader-book-container, R033): in a profile that keeps
// data — as a normal Safari does, unlike the ephemeral context of the other e2e — WebKit stored the WHOLE container as
// each track (a Blob made of a slice of the chosen file). Each stored track must be its own bytes (size and SHA-256),
// read back from storage before the book appears; with one and with two different tracks; each plays; the earlier book
// stays as it was; a failed import leaves nothing. Synthetic WAV (no MP3 encoder in the e2e suite; R031 uses MP3).
import { createHash } from 'node:crypto'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test, webkit, devices, type BrowserContext, type Page } from '@playwright/test'
import { databaseName, sourceLanguage } from '../../src/core/language.ts'
import type { Chapter } from '../../src/core/model/book.ts'
import { editionHash, PACKAGE_FORMAT, PACKAGE_VERSION } from '../../src/core/prepared/package.ts'
import { CONTAINER_MIMETYPE } from '../../src/core/prepared/container.ts'
import { preparedText } from '../fixtures/language.ts'
import { zipArchive } from '../fixtures/zip-writer.ts'

function wav(seconds: number, fill: number): Buffer {
  const samples = 8000 * seconds
  const b = Buffer.alloc(44 + samples * 2, fill)
  b.write('RIFF', 0, 'ascii'); b.writeUInt32LE(36 + samples * 2, 4); b.write('WAVEfmt ', 8, 'ascii')
  b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22); b.writeUInt32LE(8000, 24)
  b.writeUInt32LE(16000, 28); b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34); b.write('data', 36, 'ascii')
  b.writeUInt32LE(samples * 2, 40)
  return b
}

interface Track { name: string; bytes: Buffer; sha: string }
const track = (name: string, seconds: number, fill: number): Track => {
  const bytes = wav(seconds, fill)
  return { name, bytes, sha: createHash('sha256').update(bytes).digest('hex') }
}

/** A container: one paragraph per track, timed on its own track. */
async function container(title: string, tracks: Track[]) {
  const chapters: Chapter[] = [{
    title: preparedText.heading,
    paragraphs: tracks.map((_, i) => ({ kind: 'text' as const, sentences: [`${preparedText.third.replace(/[.!?]$/, '')} ${i}.`] })),
  }]
  const pkg = {
    format: PACKAGE_FORMAT, version: PACKAGE_VERSION, packageId: `persistent-${title}`, edition: await editionHash(chapters),
    language: sourceLanguage, translationLanguage: 'uk', book: { title, author: 'Test', format: 'txt', chapters },
    translations: Object.fromEntries(tracks.map((_, i) => [`0-${i}`, [`Переклад ${i}.`]])),
    tracks: tracks.map((t, i) => ({ id: `t${i + 1}`, name: t.name, size: t.bytes.length, sha256: t.sha })),
    sync: Object.fromEntries(tracks.map((_, i) => [`0-${i}`, [[`t${i + 1}`, 1, 4]]])),
  }
  const meta = JSON.stringify({ format: 'reader-book-container', version: 1, package: 'book.reader.json',
    audio: tracks.map((t) => ({ path: `audio/${t.name}`, size: t.bytes.length, sha256: t.sha })) })
  const bytes = zipArchive([['mimetype', CONTAINER_MIMETYPE, false], ['container.json', meta, true],
    ['book.reader.json', JSON.stringify(pkg), true], ...tracks.map((t) => [`audio/${t.name}`, new Uint8Array(t.bytes), false] as [string, Uint8Array, boolean])])
  return { name: `${title}.polenuk`, mimeType: 'application/octet-stream', buffer: Buffer.from(bytes) }
}

/** Every stored audio file: its key, size and SHA-256 of the bytes read back (a Blob or its bytes). */
const stored = (page: Page) => page.evaluate(async (name) => {
  const ask = <T>(r: IDBRequest<T>) => new Promise<T>((ok, no) => { r.onsuccess = () => ok(r.result); r.onerror = () => no(r.error) })
  const hex = (b: ArrayBuffer) => [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, '0')).join('')
  const d = await ask(indexedDB.open(`${name}-audio`))
  const tracks = Object.fromEntries((await ask(d.transaction('tracks').objectStore('tracks').getAllKeys())).map((k) => [String(k), null]))
  for (const key of Object.keys(tracks)) tracks[key] = await ask(d.transaction('tracks').objectStore('tracks').get(key))
  const files: Record<string, { size: number; sha: string; blob: boolean }> = {}
  const keys = await ask(d.transaction('files').objectStore('files').getAllKeys())
  for (const key of keys) {
    const v = await ask(d.transaction('files').objectStore('files').get(key)) as Blob | { audioBytes: ArrayBuffer }
    const buffer = v instanceof Blob ? await v.arrayBuffer() : v.audioBytes
    files[String(key)] = { size: buffer.byteLength, sha: hex(await crypto.subtle.digest('SHA-256', buffer)), blob: v instanceof Blob }
  }
  d.close()
  return { tracks: tracks as unknown as Record<string, { id: string; name: string }[]>, files }
}, databaseName)

async function persistent(): Promise<{ context: BrowserContext; page: Page; done: () => Promise<void> }> {
  const dir = mkdtempSync(join(tmpdir(), 'persistent-webkit-'))
  const context = await webkit.launchPersistentContext(dir, { ...devices['iPad Pro 11'], locale: 'uk-UA',
    baseURL: test.info().project.use.baseURL })
  const page = await context.newPage()
  await page.route('https://api.openai.com/**', (route) => route.abort())
  return { context, page, done: async () => { await context.close(); rmSync(dir, { recursive: true, force: true }) } }
}

/** For each book: its stored tracks are exactly its own files, in order. */
function expectOwnBytes(snap: Awaited<ReturnType<typeof stored>>, books: Record<string, Track[]>, ids: Record<string, string>) {
  for (const [title, tracks] of Object.entries(books)) {
    const list = snap.tracks[ids[title]]
    expect(list.map((t) => t.name), title).toEqual(tracks.map((t) => t.name))
    list.forEach((t, i) => expect(snap.files[t.id], `${title}: ${t.name}`).toEqual({ ...snap.files[t.id], size: tracks[i].bytes.length, sha: tracks[i].sha }))
  }
}

/** All three databases, every entry; a Blob or bytes as size and SHA-256. */
const everything = (page: Page) => page.evaluate(async (name) => {
  const ask = <T>(r: IDBRequest<T>) => new Promise<T>((ok, no) => { r.onsuccess = () => ok(r.result); r.onerror = () => no(r.error) })
  const hex = (b: ArrayBuffer) => [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, '0')).join('')
  const plain = async (v: unknown): Promise<unknown> => {
    if (v instanceof Blob) return { sha: hex(await crypto.subtle.digest('SHA-256', await v.arrayBuffer())), size: v.size }
    if (v instanceof ArrayBuffer) return { sha: hex(await crypto.subtle.digest('SHA-256', v)), size: v.byteLength }
    if (Array.isArray(v)) return Promise.all(v.map(plain))
    if (v && typeof v === 'object') return Object.fromEntries(await Promise.all(Object.entries(v).map(async ([k, x]) => [k, await plain(x)])))
    return v
  }
  const out: Record<string, unknown> = {}
  for (const db of [name, `${name}-audio`, `${name}-sync`]) {
    const d = await ask(indexedDB.open(db))
    for (const store of [...d.objectStoreNames]) {
      const keys = await ask(d.transaction(store).objectStore(store).getAllKeys())
      for (const key of keys) out[`${db}/${store}/${String(key)}`] = await plain(await ask(d.transaction(store).objectStore(store).get(key)))
    }
    d.close()
  }
  return out
}, databaseName)

const bookIDs = (page: Page) => page.evaluate(async (name) => {
  const ask = <T>(r: IDBRequest<T>) => new Promise<T>((ok, no) => { r.onsuccess = () => ok(r.result); r.onerror = () => no(r.error) })
  const d = await ask(indexedDB.open(name))
  const books = await ask(d.transaction('books').objectStore('books').getAll()) as { id: string; title: string }[]
  d.close()
  return Object.fromEntries(books.map((b) => [b.title, b.id]))
}, databaseName)

test('постійний профіль WebKit: кожна доріжка контейнера зберігається власними байтами (1 і 2 доріжки), грає, попередня книжка ціла', async () => {
  const control = [track('control.wav', 30, 7)]
  const two = [track('01 first.wav', 30, 3), track('02 second.wav', 20, 5)]
  const { page, done } = await persistent()
  try {
    await page.goto('./?reset')
    await expect(page.locator('[data-testid^="book-"]').first()).toBeVisible()
    await page.getByTestId('importPreparedInput').setInputFiles([await container('Control book', control)])
    await expect(page.getByTestId('readerScroll')).toBeVisible()
    await page.goto('./')
    const before = await stored(page)
    expectOwnBytes(before, { 'Control book': control }, await bookIDs(page))

    await page.getByTestId('importPreparedInput').setInputFiles([await container('Two tracks', two)])
    await expect(page.getByTestId('readerScroll')).toBeVisible()
    const after = await stored(page)
    const ids = await bookIDs(page)
    expectOwnBytes(after, { 'Control book': control, 'Two tracks': two }, ids)
    for (const [key, value] of Object.entries(before.files)) expect(after.files[key], `control file ${key}`).toEqual(value)

    // Each track plays: its own duration on the bar, and the time moves.
    await expect(page.getByTestId('audioDuration')).toHaveText('0:30')
    await page.getByTestId('audioPlay').click()
    await expect(page.getByTestId('audioTime')).not.toHaveText('0:00', { timeout: 5_000 })
    await page.getByTestId('audioPause').click()
    await page.getByTestId('audioTrackButton').click()
    await page.getByTestId('selectTrack-1').click()
    await page.getByTestId('audioSheetDone').click()
    await expect(page.getByTestId('audioTrackButton')).toHaveText('Доріжка 2 з 2')
    await expect(page.getByTestId('audioDuration')).toHaveText('0:20')
    await page.getByTestId('audioPlay').click()
    await expect(page.getByTestId('audioTime')).not.toHaveText('0:00', { timeout: 5_000 })
    await page.getByTestId('audioPause').click()
  } finally {
    await done()
  }
})

for (const phase of ['track-1', 'track-2', 'tracks', 'translations'] as const) {
  test(`постійний профіль WebKit: збій імпорту контейнера (${phase}) одразу повертає всі три бази до стану з контрольною книжкою`, async () => {
    const control = [track('control.wav', 30, 7)]
    const { page, done } = await persistent()
    try {
      await page.goto('./?reset')
      await page.getByTestId('importPreparedInput').setInputFiles([await container('Control book', control)])
      await expect(page.getByTestId('readerScroll')).toBeVisible()
      await page.goto(`./?testImportFail=${phase}`)
      await expect(page.locator('[data-testid^="book-"]').first()).toBeVisible()
      const before = await everything(page)
      await page.getByTestId('importPreparedInput').setInputFiles([await container('Two tracks', [track('01 first.wav', 30, 3), track('02 second.wav', 20, 5)])])
      await expect(page.getByText(/тестовий збій після (фази|доріжки)/)).toBeVisible()
      expect(await everything(page)).toEqual(before)                  // at once, in the same page, no restart
    } finally {
      await done()
    }
  })
}

test('звичайний (тимчасовий) контекст WebKit без збереження Blob: доріжка контейнера понад 64 МіБ — відмова з поясненням, бази без змін', async ({ page }) => {
  // The ephemeral context of Playwright's WebKit does not keep a Blob in IndexedDB (as Safari in private mode): only
  // the fallback form, limited to MAX_FALLBACK_BYTES, is possible; the track is refused before it is copied.
  await page.route('https://api.openai.com/**', (route) => route.abort())
  await page.goto('./?reset')
  await expect(page.locator('[data-testid^="book-"]').first()).toBeVisible()
  const before = await everything(page)
  const seconds = Math.ceil((64 * 1024 * 1024 + 1 - 44) / 16000)
  const dir = mkdtempSync(join(tmpdir(), 'big-polenuk-'))
  try {
    const box = await container('Big', [track('big.wav', seconds, 4)])
    const path = join(dir, box.name)
    writeFileSync(path, box.buffer)                                        // over Playwright's 50 MB limit for a buffer
    await page.getByTestId('importPreparedInput').setInputFiles(path)
    await expect(page.getByText(/завелика для збереження через пам'ять/)).toBeVisible({ timeout: 60_000 })
    expect(await everything(page)).toEqual(before)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
