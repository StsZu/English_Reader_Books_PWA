// Prepared book (specs/013-prepared-book, D0): import `.reader.json` with its audio, the heard sentence is highlighted.
// Synthetic text in the language of the build (tests/languages/<lang>/fixtures.ts) and a silent WAV generated here
// (no third-party books or recordings).
import { createHash } from 'node:crypto'
import { expect, test, type Page } from '@playwright/test'
import type { Chapter } from '../../src/core/model/book.ts'
import { editionHash, PACKAGE_FORMAT, PACKAGE_VERSION, type ReaderPackage } from '../../src/core/prepared/package.ts'
import { databaseName, sourceLanguage } from '../../src/core/language.ts'
import { demoBook, preparedText } from '../fixtures/language.ts'
import { zipArchive } from '../fixtures/zip-writer.ts'
import { CONTAINER_MIMETYPE } from '../../src/core/prepared/container.ts'

function wav(seconds: number): Buffer {
  const samples = 8000 * seconds
  const buffer = Buffer.alloc(44 + samples * 2)
  buffer.write('RIFF', 0, 'ascii')
  buffer.writeUInt32LE(36 + samples * 2, 4)
  buffer.write('WAVEfmt ', 8, 'ascii')
  buffer.writeUInt32LE(16, 16)
  buffer.writeUInt16LE(1, 20)
  buffer.writeUInt16LE(1, 22)
  buffer.writeUInt32LE(8000, 24)
  buffer.writeUInt32LE(16000, 28)
  buffer.writeUInt16LE(2, 32)
  buffer.writeUInt16LE(16, 34)
  buffer.write('data', 36, 'ascii')
  buffer.writeUInt32LE(samples * 2, 40)
  return buffer
}

const chapters: Chapter[] = [{
  title: preparedText.heading,
  paragraphs: [
    { kind: 'text', sentences: [...preparedText.sentences] },
    { kind: 'text', sentences: [preparedText.third] },
  ],
}]

async function packageFiles() {
  const audio = wav(30)
  const pkg: ReaderPackage = {
    format: PACKAGE_FORMAT,
    version: PACKAGE_VERSION,
    packageId: 'synthetic',
    edition: await editionHash(chapters),
    language: sourceLanguage,
    translationLanguage: 'uk',
    book: { title: preparedText.title, author: 'Test', format: 'txt', chapters },
    translations: { '0-0': ['Перше речення.', 'Друге речення.'], '0-1': ['Третє речення.'] },
    tracks: [{ id: 't1', name: 'synthetic.wav', size: audio.length, sha256: createHash('sha256').update(audio).digest('hex') }],
    // 0–3 s: an introduction without text; the second paragraph from 20 s.
    sync: { '0-0': [['t1', 3, 10], ['t1', 10.2, 18]], '0-1': [['t1', 20, 28]] },
  }
  return [
    { name: 'synthetic.reader.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(pkg)) },
    { name: 'synthetic.wav', mimeType: 'audio/wav', buffer: audio },
  ]
}

const sentence = (page: Page, paragraph: number, s: number) => page.locator(`[data-p="${paragraph}"] .s[data-s="${s}"]`)

test('підготовлена книжка: імпорт з аудіо, підсвічування речення, яке звучить, і його переклад без дотику', async ({ page }) => {
  await page.route('https://api.openai.com/**', (route) => route.abort())
  await page.goto('./?reset')
  await page.getByTestId('importPreparedInput').setInputFiles(await packageFiles())
  await expect(page.getByTestId('readerScroll')).toBeVisible()
  await expect(page.getByTestId('audioBar')).toBeVisible()
  await expect(page.locator('.s.active')).toHaveCount(0)
  await expect(page.getByTestId('parallelTranslationHint')).toBeVisible()
  // The text of the build language is on screen (Polish letters in Polish Reader).
  await expect(sentence(page, 0, 0)).toContainText(preparedText.sentences[0].replace(/[.!?]$/, ''))

  // Forward to 5 s: the first sentence and its translation from the package (requests to OpenAI are aborted here).
  await page.getByTestId('audioForward').click()
  await page.getByTestId('audioPlay').click()
  await expect(sentence(page, 0, 0)).toHaveClass(/active/, { timeout: 5_000 })
  await expect(page.getByTestId('translation-0-0-0')).toHaveText('Перше речення.')
  await page.getByTestId('audioPause').click()

  // Paused, seeking moves the highlight and the translation with the audio.
  for (let i = 0; i < 2; i++) await page.getByTestId('audioForward').click()
  await expect(sentence(page, 0, 1)).toHaveClass(/active/)
  await expect(page.getByTestId('translation-0-0-1')).toHaveText('Друге речення.')

  // A tapped sentence stays until the next one is heard.
  await sentence(page, 0, 0).locator('.w').first().click()
  await expect(page.getByTestId('translation-0-0-0')).toHaveText('Перше речення.')
  for (let i = 0; i < 2; i++) await page.getByTestId('audioForward').click()
  await expect(sentence(page, 1, 0)).toHaveClass(/active/)
  await expect(page.getByTestId('translation-0-1-0')).toHaveText('Третє речення.')
  await expect(page.locator('.s.active')).toHaveCount(1)
})

test('підготовлена книжка без аудіофайла не імпортується', async ({ page }) => {
  await page.goto('./?reset')
  const [pkg] = await packageFiles()
  await page.getByTestId('importPreparedInput').setInputFiles([pkg])
  await expect(page.getByText(/Виберіть разом з нею аудіофайли: synthetic\.wav/)).toBeVisible()
})

/** Version and stores of a database of this origin, opened without a version (does not upgrade it). */
const inspect = (page: Page, name: string) => page.evaluate((n) => new Promise<{ version: number; stores: string[] }>((resolve, reject) => {
  const request = indexedDB.open(n)
  request.onsuccess = () => {
    const db = request.result
    resolve({ version: db.version, stores: [...db.objectStoreNames].sort() })
    db.close()
  }
  request.onerror = () => reject(request.error)
}), name)

test('підготовлена книжка: аудіобаза лишається версії 1, час речень — в окремій базі', async ({ page }) => {
  await page.route('https://api.openai.com/**', (route) => route.abort())
  await page.goto('./?reset')
  await page.getByTestId('importPreparedInput').setInputFiles(await packageFiles())
  await expect(page.getByTestId('audioBar')).toBeVisible()
  expect(await inspect(page, `${databaseName}-audio`)).toEqual({ version: 1, stores: ['files', 'positions', 'tracks'] })
  expect(await inspect(page, `${databaseName}-sync`)).toEqual({ version: 1, stores: ['meta', 'sync'] })
})

test('аудіобаза версії 2 з прототипу 013 відкривається як є: доріжки на місці, час речень скопійовано', async ({ page, context }) => {
  await page.route('https://api.openai.com/**', (route) => route.abort())
  await page.goto('./?reset')
  await expect(page.locator('[data-testid^="book-"]').first()).toBeVisible()
  const bookID = await page.evaluate((n) => new Promise<string>((resolve, reject) => {
    const request = indexedDB.open(n)
    request.onsuccess = () => {
      const keys = request.result.transaction('books').objectStore('books').getAllKeys()
      keys.onsuccess = () => { resolve(String(keys.result[0])); request.result.close() }
      keys.onerror = () => reject(keys.error)
    }
  }), databaseName)
  await page.close()

  // Without the app on the page: what the 013 prototype left — the audio database at version 2 with its `sync` store.
  const setup = await context.newPage()
  await setup.goto('./manifest.webmanifest')
  await setup.evaluate(({ name, bookID }) => new Promise<void>((resolve, reject) => {
    const sync = indexedDB.deleteDatabase(`${name}-sync`)
    sync.onsuccess = () => {
      const request = indexedDB.open(`${name}-audio`, 2)
      request.onupgradeneeded = () => {
        for (const store of ['tracks', 'files', 'positions', 'sync']) {
          if (!request.result.objectStoreNames.contains(store)) request.result.createObjectStore(store)
        }
      }
      request.onsuccess = () => {
        const tx = request.result.transaction(['tracks', 'positions', 'sync'], 'readwrite')
        tx.objectStore('tracks').put([{ id: 't-old', name: 'old.mp3', size: 3, type: 'audio/mpeg', duration: 9 }], bookID)
        tx.objectStore('positions').put({ track: 0, time: 4.5 }, bookID)
        tx.objectStore('sync').put({ '0-0': [['t-old', 1, 2]] }, bookID)
        tx.oncomplete = () => { request.result.close(); resolve() }
        tx.onerror = () => reject(tx.error)
      }
      request.onerror = () => reject(request.error)
    }
    sync.onerror = () => reject(sync.error)
  }), { name: databaseName, bookID })
  await setup.close()

  const app = await context.newPage()
  await app.route('https://api.openai.com/**', (route) => route.abort())
  await app.goto('./')
  await app.getByTestId(`book-${demoBook.title}`).click()
  await expect(app.getByTestId('readerScroll')).toBeVisible()
  await expect(app.getByTestId('audioBar')).toBeVisible()
  expect(await inspect(app, `${databaseName}-audio`)).toEqual({ version: 2, stores: ['files', 'positions', 'sync', 'tracks'] })
  expect(await inspect(app, `${databaseName}-sync`)).toEqual({ version: 1, stores: ['meta', 'sync'] })
  const copied = await app.evaluate(({ name, bookID }) => new Promise<unknown>((resolve) => {
    const request = indexedDB.open(`${name}-sync`)
    request.onsuccess = () => {
      const get = request.result.transaction('sync').objectStore('sync').get(bookID)
      get.onsuccess = () => { resolve(get.result); request.result.close() }
    }
  }), { name: databaseName, bookID })
  expect(copied).toEqual({ '0-0': [['t-old', 1, 2]] })
})


/** The same package and audio in one `.polenuk` (specs/015-reader-book-container, R023); `language` overrides the package's. */
async function polenuk(language?: string) {
  const [pkgFile, audioFile] = await packageFiles()
  const pkg = JSON.parse(pkgFile.buffer.toString())
  if (language) pkg.language = language
  const meta = JSON.stringify({ format: 'reader-book-container', version: 1, package: 'book.reader.json',
    audio: [{ path: `audio/${audioFile.name}`, size: audioFile.buffer.length, sha256: createHash('sha256').update(audioFile.buffer).digest('hex') }] })
  const bytes = zipArchive([['mimetype', CONTAINER_MIMETYPE, false], ['container.json', meta, true],
    ['book.reader.json', JSON.stringify(pkg), true], [`audio/${audioFile.name}`, new Uint8Array(audioFile.buffer), false]])
  return { name: 'synthetic.polenuk', mimeType: 'application/octet-stream', buffer: Buffer.from(bytes) }
}

test('один файл .polenuk: та сама книжка з аудіо, підсвічуванням і перекладом', async ({ page }) => {
  await page.route('https://api.openai.com/**', (route) => route.abort())
  await page.goto('./?reset')
  await page.getByTestId('importPreparedInput').setInputFiles([await polenuk()])
  await expect(page.getByTestId('readerScroll')).toBeVisible()
  await expect(page.getByTestId('audioBar')).toBeVisible()
  await page.getByTestId('audioForward').click()
  await page.getByTestId('audioPlay').click()
  await expect(sentence(page, 0, 0)).toHaveClass(/active/, { timeout: 5_000 })
  await expect(page.getByTestId('translation-0-0-0')).toHaveText('Перше речення.')
})

test('один файл .polenuk іншої мови не імпортується, бібліотека та сама', async ({ page }) => {
  await page.goto('./?reset')
  const before = await page.locator('[data-testid^="book-"]').count()
  const other = String(sourceLanguage) === 'en' ? 'pl' : 'en'
  await page.getByTestId('importPreparedInput').setInputFiles([await polenuk(other)])
  await expect(page.getByText(/Книжку не імпортовано.*підготовлено для мови/)).toBeVisible()
  await expect(page.locator('[data-testid^="book-"]')).toHaveCount(before)
})
