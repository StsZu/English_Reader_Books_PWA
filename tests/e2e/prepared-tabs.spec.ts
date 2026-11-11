// Two real tabs of one app and one prepared import (specs/015-reader-book-container, R021, FR-04, SC-04).
// Tab A imports a synthetic `.polenuk` and is held after each phase of the import (test mode `?testImportPause`);
// tab B starts meanwhile. B must wait for the import lock instead of taking A's audio, time and translations for
// leftovers; when A is closed in the middle, B's start removes what A left; when A fails, nothing of it stays.
import { expect, test, type BrowserContext, type Page } from '@playwright/test'
import { databaseName } from '../../src/core/language.ts'
import { preparedText } from '../fixtures/language.ts'
import { polenuk } from '../fixtures/e2e/prepared-book.ts'

const PHASES = ['checked', 'tracks', 'sync', 'translations'] as const

interface Inventory {
  books: string[]
  tracks: string[]
  trackIDs: string[]
  files: string[]
  positions: string[]
  sync: string[]
  journal: string[]
  translations: string[]
}

/** What the app's databases hold, read in the page without the app's code. */
const inventory = (page: Page) => page.evaluate((name) => {
  const open = (db: string) => new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(db)
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
  const all = (db: IDBDatabase, store: string, values = false) => new Promise<unknown[]>((resolve, reject) => {
    if (!db.objectStoreNames.contains(store)) return resolve([])
    const os = db.transaction(store).objectStore(store)
    const request = values ? os.getAll() : os.getAllKeys()
    request.onsuccess = () => resolve(request.result as unknown[])
    request.onerror = () => reject(request.error)
  })
  return (async () => {
    const main = await open(name)
    const audio = await open(`${name}-audio`)
    const sync = await open(`${name}-sync`)
    const tracks = await all(audio, 'tracks', true) as { id: string }[][]
    const out = {
      books: (await all(main, 'books')).map(String),
      tracks: (await all(audio, 'tracks')).map(String),
      trackIDs: tracks.flat().map((t) => t.id),
      files: (await all(audio, 'files')).map(String),
      positions: (await all(audio, 'positions')).map(String),
      sync: (await all(sync, 'sync')).map(String),
      journal: (await all(sync, 'meta')).map(String).filter((k) => k.startsWith('import:')),
      translations: (await all(main, 'translations')).map(String),
    }
    main.close(); audio.close(); sync.close()
    return out
  })()
}, databaseName) as Promise<Inventory>

/** Nothing belongs to a book that is not in the library, and no import is half done. */
function expectNoLeftovers(inv: Inventory) {
  const books = new Set(inv.books)
  expect(inv.journal).toEqual([])
  expect(inv.tracks.filter((id) => !books.has(id))).toEqual([])
  expect(inv.positions.filter((id) => !books.has(id))).toEqual([])
  expect(inv.sync.filter((id) => !books.has(id))).toEqual([])
  expect(inv.files.filter((id) => !inv.trackIDs.includes(id))).toEqual([])
  expect(inv.translations.filter((key) => key.includes('|') && !books.has(key.slice(0, key.indexOf('|'))))).toEqual([])
}

async function heldAt(context: BrowserContext, phase: string) {
  const a = await context.newPage()
  await a.route('https://api.openai.com/**', (route) => route.abort())
  await a.goto(`./?reset&testImportPause=${phase}`)
  await expect(a.locator('[data-testid^="book-"]').first()).toBeVisible()
  await a.getByTestId('importPreparedInput').setInputFiles([await polenuk()])
  await expect.poll(() => a.evaluate(() => (globalThis as { __importPausedAt?: string }).__importPausedAt)).toBe(phase)
  return a
}

async function startB(context: BrowserContext) {
  const b = await context.newPage()
  await b.route('https://api.openai.com/**', (route) => route.abort())
  await b.goto('./')
  return b
}

const libraryShown = (page: Page) => page.locator('[data-testid^="book-"]').first()

for (const phase of PHASES) {
  test(`дві вкладки: B стартує, поки A тримає імпорт після фази «${phase}», — чекає й бачить цілу книжку`, async ({ context }) => {
    const a = await heldAt(context, phase)
    const held = await inventory(a)
    expect(held.journal).toHaveLength(1)
    const bookID = held.journal[0].slice('import:'.length)

    const b = await startB(context)
    // B's start waits for the lock: no library yet, and A's partial data is untouched.
    await b.waitForTimeout(1500)
    await expect(libraryShown(b)).toHaveCount(0)
    expect(await inventory(a)).toEqual(held)

    await a.evaluate(() => (globalThis as { __resumeImport?: () => void }).__resumeImport?.())
    await expect(a.getByTestId('readerScroll')).toBeVisible()
    await expect(libraryShown(b)).toBeVisible()
    await expect(b.getByTestId(`book-${preparedText.title}`)).toBeVisible()

    const done = await inventory(b)
    expect(done.books).toContain(bookID)
    expect(done.tracks).toContain(bookID)
    expect(done.sync).toContain(bookID)
    expect(done.trackIDs.every((id) => done.files.includes(id))).toBe(true)
    expectNoLeftovers(done)

    await b.getByTestId(`book-${preparedText.title}`).click()
    await expect(b.getByTestId('readerScroll')).toBeVisible()
    await expect(b.getByTestId('audioBar')).toBeVisible()
  })

  test(`дві вкладки: A закрито після фази «${phase}» — B після старту прибирає залишки, інші книжки цілі`, async ({ context }) => {
    const a = await heldAt(context, phase)
    const held = await inventory(a)
    const others = held.books
    const b = await startB(context)
    await b.waitForTimeout(500)
    await expect(libraryShown(b)).toHaveCount(0)
    await a.close()                                     // the lock goes with the tab

    await expect(libraryShown(b)).toBeVisible()
    await expect(b.getByTestId(`book-${preparedText.title}`)).toHaveCount(0)
    await expect.poll(async () => (await inventory(b)).journal).toEqual([])
    const after = await inventory(b)
    expect(after.books).toEqual(others)
    expectNoLeftovers(after)
  })

  test(`збій імпорту після фази «${phase}»: повідомлення, нічого від нього не лишається, наступний імпорт іде`, async ({ context }) => {
    const a = await context.newPage()
    await a.route('https://api.openai.com/**', (route) => route.abort())
    await a.goto(`./?reset&testImportFail=${phase}`)
    await expect(libraryShown(a)).toBeVisible()
    const before = await inventory(a)
    await a.getByTestId('importPreparedInput').setInputFiles([await polenuk()])
    await expect(a.getByText(`тестовий збій після фази ${phase}`)).toBeVisible()
    const after = await inventory(a)
    expect(after.books).toEqual(before.books)
    expectNoLeftovers(after)

    const b = await startB(context)                    // another tab without the failure imports the same file
    await expect(libraryShown(b)).toBeVisible()
    await b.getByTestId('importPreparedInput').setInputFiles([await polenuk()])
    await expect(b.getByTestId('readerScroll')).toBeVisible()
    expectNoLeftovers(await inventory(b))
  })
}
