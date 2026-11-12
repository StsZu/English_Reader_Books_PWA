// Two real tabs of one app and one prepared import (specs/015-reader-book-container, R021, FR-04, SC-04).
// A finished control book (text, translation, time, audio, positions) is in the library first. Tab A imports a
// synthetic `.polenuk` and is held after each phase of the import (test mode `?testImportPause`); tab B starts
// meanwhile. Proof that B waits: the browser's own lock list shows A holding and B pending on the import lock, and
// the databases do not change while B waits. After A finishes, the new book is exactly the package (translation,
// time, audio bytes); when A is closed or fails, the databases are again exactly what they were before its import.
import { createHash } from 'node:crypto'
import { expect, test, type BrowserContext, type Page } from '@playwright/test'
import { databaseName } from '../../src/core/language.ts'
import { preparedText } from '../fixtures/language.ts'
import { packageFiles, polenuk, type BookVariant } from '../fixtures/e2e/prepared-book.ts'
import type { ReaderPackage } from '../../src/core/prepared/package.ts'

const PHASES = ['checked', 'tracks', 'sync', 'translations'] as const
const LOCK = `${databaseName}-prepared-import`
const CONTROL: BookVariant = {
  title: 'Control book',
  translations: { '0-0': ['Контроль один.', 'Контроль два.'], '0-1': ['Контроль три.'] },
  fill: 7,
}
const READING_POSITION = { chapter: 0, paragraph: 1 }
const AUDIO_POSITION = { track: 0, time: 12.5, rate: 1.25 }

/** Every entry of the app's three databases, `<db>/<store>/<key>` → value; a Blob or bytes become their SHA-256. */
type Snapshot = Record<string, unknown>

const snapshot = (page: Page) => page.evaluate(async (name) => {
  const hex = (buffer: ArrayBuffer) => [...new Uint8Array(buffer)].map((b) => b.toString(16).padStart(2, '0')).join('')
  const plain = async (value: unknown): Promise<unknown> => {
    if (value instanceof Blob) {
      return { blob: hex(await crypto.subtle.digest('SHA-256', await value.arrayBuffer())), size: value.size, type: value.type }
    }
    if (value instanceof ArrayBuffer) return { bytes: hex(await crypto.subtle.digest('SHA-256', value)), size: value.byteLength }
    if (Array.isArray(value)) return Promise.all(value.map(plain))
    if (value && typeof value === 'object') {
      const out: Record<string, unknown> = {}
      for (const [k, v] of Object.entries(value)) out[k] = await plain(v)
      return out
    }
    return value
  }
  const open = (db: string) => new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(db)
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
  const ask = <T>(request: IDBRequest<T>) => new Promise<T>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
  const out: Record<string, unknown> = {}
  for (const db of [name, `${name}-audio`, `${name}-sync`]) {
    const database = await open(db)
    for (const store of [...database.objectStoreNames]) {
      const os = () => database.transaction(store).objectStore(store)
      const keys = await ask(os().getAllKeys())
      const values = await ask(os().getAll())
      for (let i = 0; i < keys.length; i++) out[`${db.slice(name.length) || 'main'}/${store}/${String(keys[i])}`] = await plain(values[i])
    }
    database.close()
  }
  return out
}, databaseName) as Promise<Snapshot>

const entries = (snap: Snapshot, prefix: string) =>
  Object.entries(snap).filter(([key]) => key.startsWith(prefix)).map(([key, value]) => [key.slice(prefix.length), value] as const)

/** Nothing belongs to a book that is not in the library, and no import is half done. */
function expectNoLeftovers(snap: Snapshot) {
  const books = new Set(entries(snap, 'main/books/').map(([id]) => id))
  const trackIDs = entries(snap, '-audio/tracks/').flatMap(([, tracks]) => (tracks as { id: string }[]).map((t) => t.id))
  expect(entries(snap, '-sync/meta/').filter(([key]) => key.startsWith('import:'))).toEqual([])
  for (const store of ['-audio/tracks/', '-audio/positions/', '-sync/sync/', 'main/positions/']) {
    expect(entries(snap, store).filter(([id]) => !books.has(id))).toEqual([])
  }
  expect(entries(snap, '-audio/files/').filter(([id]) => !trackIDs.includes(id))).toEqual([])
  expect(entries(snap, 'main/translations/').filter(([key]) => key.includes('|') && !books.has(key.slice(0, key.indexOf('|'))))).toEqual([])
}

/** The stored book `id` is exactly the package: text, every translation, time on its own track, audio bytes. */
async function expectBookIs(snap: Snapshot, id: string, variant: BookVariant = {}) {
  const pkg = JSON.parse((await packageFiles(variant))[0].buffer.toString()) as ReaderPackage
  const book = snap[`main/books/${id}`] as { title: string; chapters: unknown }
  expect(book.title).toBe(pkg.book.title)
  expect(book.chapters).toEqual(pkg.book.chapters)

  expect(Object.fromEntries(entries(snap, `main/translations/${id}|`))).toEqual(pkg.translations)
  expect(Object.keys(pkg.translations).length).toBeGreaterThan(0)

  const tracks = snap[`-audio/tracks/${id}`] as { id: string; name: string; size: number }[]
  expect(tracks.map(({ name, size }) => ({ name, size }))).toEqual(pkg.tracks.map(({ name, size }) => ({ name, size })))
  for (const [i, track] of pkg.tracks.entries()) {
    // A Blob, or its bytes where the browser does not store a Blob (WebKit of the tests): the same SHA-256 either way.
    const file = snap[`-audio/files/${tracks[i].id}`] as { blob?: string; size?: number; audioBytes?: { bytes: string; size: number } }
    expect(file.audioBytes ? { sha: file.audioBytes.bytes, size: file.audioBytes.size } : { sha: file.blob, size: file.size })
      .toEqual({ sha: track.sha256, size: track.size })
  }
  const ids = new Map(pkg.tracks.map((track, i) => [track.id, tracks[i].id]))
  expect(snap[`-sync/sync/${id}`]).toEqual(Object.fromEntries(Object.entries(pkg.sync).map(([key, list]) =>
    [key, list.map((entry) => (entry ? [ids.get(entry[0]), entry[1], entry[2]] : null))])))
}

const bookIDs = (snap: Snapshot) => entries(snap, 'main/books/').map(([id]) => id)

/** What the import adds is only its own book: every entry that was there before is unchanged. */
function expectKept(before: Snapshot, after: Snapshot) {
  const changed = Object.keys(before).filter((key) => JSON.stringify(after[key]) !== JSON.stringify(before[key]))
  expect(changed.filter((key) => key !== LIBRARY)).toEqual([])
  // The library index gains the new book; every earlier entry stays as it was.
  const index = after[LIBRARY] as { id: string }[]
  for (const entry of before[LIBRARY] as { id: string }[]) expect(index.find((e) => e.id === entry.id)).toEqual(entry)
}
const LIBRARY = 'main/meta/library'

/** The browser's own list of the import lock: who holds it and who waits. */
const lockState = (page: Page) => page.evaluate(async (name) => {
  const state = await navigator.locks.query()
  const pick = (list: LockInfo[] | undefined) => (list ?? []).filter((l) => l.name === name).map((l) => ({ mode: l.mode, client: l.clientId }))
  return { held: pick(state.held), pending: pick(state.pending) }
}, LOCK)

const libraryShown = (page: Page) => page.locator('[data-testid^="book-"]').first()

async function page(context: BrowserContext, url: string) {
  const p = await context.newPage()
  await p.route('https://api.openai.com/**', (route) => route.abort())
  await p.goto(url)
  await expect(libraryShown(p)).toBeVisible()
  return p
}

/** A clean library with the finished control book, its reading and listening positions. Returns its id. */
async function withControlBook(context: BrowserContext): Promise<string> {
  const s = await page(context, './?reset')
  await s.getByTestId('importPreparedInput').setInputFiles([await polenuk(undefined, undefined, CONTROL)])
  await expect(s.getByTestId('readerScroll')).toBeVisible()
  const before = await snapshot(s)
  const id = entries(before, '-audio/tracks/').map(([key]) => key)[0]
  await expectBookIs(before, id, CONTROL)
  await s.evaluate(async ({ name, id, reading, audio }) => {
    const put = (db: string, store: string, value: unknown) => new Promise<void>((resolve, reject) => {
      const request = indexedDB.open(db)
      request.onerror = () => reject(request.error)
      request.onsuccess = () => {
        const tx = request.result.transaction(store, 'readwrite')
        tx.objectStore(store).put(value, id)
        tx.oncomplete = () => { request.result.close(); resolve() }
        tx.onerror = () => reject(tx.error)
      }
    })
    await put(name, 'positions', reading)
    await put(`${name}-audio`, 'positions', audio)
  }, { name: databaseName, id, reading: READING_POSITION, audio: AUDIO_POSITION })
  await s.close()
  return id
}

/** Tab A with the control book in the library, held after `phase` of its import, holding the lock. */
async function heldAt(context: BrowserContext, phase: string) {
  const control = await withControlBook(context)
  const a = await page(context, `./?testImportPause=${phase}`)
  const before = await snapshot(a)
  expect(before[`main/positions/${control}`]).toEqual(READING_POSITION)
  expect(before[`-audio/positions/${control}`]).toEqual(AUDIO_POSITION)
  await expectBookIs(before, control, CONTROL)
  expect(await lockState(a)).toEqual({ held: [], pending: [] })
  await a.getByTestId('importPreparedInput').setInputFiles([await polenuk()])
  await expect.poll(() => a.evaluate(() => (globalThis as { __importPausedAt?: string }).__importPausedAt)).toBe(phase)
  const locks = await lockState(a)
  expect(locks.held).toHaveLength(1)
  expect(locks.held[0].mode).toBe('exclusive')
  expect(locks.pending).toEqual([])
  return { a, before, control, holder: locks.held[0].client }
}

/** B is started and its start is waiting for A's lock: A still holds it, B is the one pending. */
async function startWaitingB(context: BrowserContext, a: Page, holder: string | undefined) {
  const held = await snapshot(a)
  const b = await context.newPage()
  await b.route('https://api.openai.com/**', (route) => route.abort())
  await b.goto('./')
  await expect.poll(async () => (await lockState(b)).pending.length).toBe(1)
  const locks = await lockState(b)
  expect(locks.held).toEqual([{ mode: 'exclusive', client: holder }])
  expect(locks.pending[0].mode).toBe('exclusive')
  expect(locks.pending[0].client).not.toBe(holder)
  await expect(libraryShown(b)).toHaveCount(0)
  expect(await snapshot(b)).toEqual(held)                  // waiting, B took nothing of A's partial import
  return { b, held }
}

for (const phase of PHASES) {
  test(`дві вкладки: B стартує, поки A тримає імпорт після фази «${phase}», — чекає й бачить цілу книжку`, async ({ context }) => {
    const { a, before, control, holder } = await heldAt(context, phase)
    const { b, held } = await startWaitingB(context, a, holder)
    const journal = entries(held, '-sync/meta/').filter(([key]) => key.startsWith('import:'))
    expect(journal).toHaveLength(1)
    const bookID = journal[0][0].slice('import:'.length)

    await a.evaluate(() => (globalThis as { __resumeImport?: () => void }).__resumeImport?.())
    await expect(a.getByTestId('readerScroll')).toBeVisible()
    await expect(libraryShown(b)).toBeVisible()
    await expect(b.getByTestId(`book-${preparedText.title}`)).toBeVisible()
    await expect(b.getByTestId(`book-${CONTROL.title}`)).toBeVisible()
    await expect.poll(async () => (await lockState(b)).pending.length).toBe(0)

    const done = await snapshot(b)
    expect(bookIDs(done).sort()).toEqual([...bookIDs(before), bookID].sort())
    await expectBookIs(done, bookID)
    await expectBookIs(done, control, CONTROL)
    expectKept(before, done)
    expectNoLeftovers(done)

    await b.getByTestId(`book-${preparedText.title}`).click()
    await expect(b.getByTestId('readerScroll')).toBeVisible()
    await expect(b.getByTestId('audioBar')).toBeVisible()
  })

  test(`дві вкладки: A закрито після фази «${phase}» — B після старту прибирає залишки, інші книжки цілі`, async ({ context }) => {
    const { a, before, holder } = await heldAt(context, phase)
    const { b } = await startWaitingB(context, a, holder)
    await a.close()                                     // the lock goes with the tab

    await expect(libraryShown(b)).toBeVisible()
    await expect(b.getByTestId(`book-${preparedText.title}`)).toHaveCount(0)
    await expect(b.getByTestId(`book-${CONTROL.title}`)).toBeVisible()
    await expect.poll(async () => (await lockState(b)).held.length).toBe(0)
    const after = await snapshot(b)
    expect(after).toEqual(before)                       // every entry, with the control book's audio bytes
    expectNoLeftovers(after)
  })

  test(`збій імпорту після фази «${phase}»: повідомлення, нічого від нього не лишається, наступний імпорт іде`, async ({ context }) => {
    const control = await withControlBook(context)
    const a = await page(context, `./?testImportFail=${phase}`)
    const before = await snapshot(a)
    await expectBookIs(before, control, CONTROL)
    await a.getByTestId('importPreparedInput').setInputFiles([await polenuk()])
    await expect(a.getByText(`тестовий збій після фази ${phase}`)).toBeVisible()
    await expect.poll(async () => (await lockState(a)).held.length).toBe(0)
    const after = await snapshot(a)
    expect(after).toEqual(before)
    expectNoLeftovers(after)

    const b = await page(context, './')                 // another tab without the failure imports the same file
    await b.getByTestId('importPreparedInput').setInputFiles([await polenuk()])
    await expect(b.getByTestId('readerScroll')).toBeVisible()
    const done = await snapshot(b)
    const added = bookIDs(done).filter((id) => !bookIDs(before).includes(id))
    expect(added).toHaveLength(1)
    await expectBookIs(done, added[0])
    expectKept(before, done)
    expectNoLeftovers(done)
  })
}

test('контрольна книжка й позиції справді різні від імпортованої (передумова порівнянь)', async () => {
  const [, own] = await packageFiles()
  const [, control] = await packageFiles(CONTROL)
  expect(createHash('sha256').update(own.buffer).digest('hex')).not.toBe(createHash('sha256').update(control.buffer).digest('hex'))
})
