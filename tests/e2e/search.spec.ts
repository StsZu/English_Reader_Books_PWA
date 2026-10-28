// «Продовжити», search and order of the library; search in the book and the way back (specs/010-library).
import { expect, test, type Page } from '@playwright/test'
import { databaseName } from '../../src/core/language.ts'
import { demoBook } from '../fixtures/language.ts'

const demo = demoBook.title
const BOOKS = 100

test.beforeEach(async ({ page }) => {
  await page.route('https://api.openai.com/**', (route) => route.abort())
})

/** Adds 100 small books straight to IndexedDB: «Volume n», authors Aaronson / Brontë / none in turn, imported a minute apart. */
async function seedLibrary(page: Page) {
  await page.goto('./?reset')
  await expect(page.getByTestId(`book-${demo}`)).toBeVisible()
  await page.evaluate(({ name, count }) => new Promise<void>((resolve, reject) => {
    const open = indexedDB.open(name)
    open.onerror = () => reject(open.error)
    open.onsuccess = () => {
      const db = open.result
      const tx = db.transaction(['books', 'meta'], 'readwrite')
      const meta = tx.objectStore('meta')
      const read = meta.get('library')
      read.onsuccess = () => {
        const index = [...(read.result ?? [])]
        for (let n = 1; n <= count; n++) {
          const book = {
            id: `seed-${n}`, title: `Volume ${n}`, author: ['Aaronson', 'Brontë', ''][n % 3], format: 'txt',
            importedAt: new Date(Date.UTC(2026, 0, 1, 0, n)).toISOString(),
            chapters: [{ title: `Chapter of volume ${n}`, paragraphs: [{ kind: 'text', sentences: [`Text of volume ${n}.`] }] }],
          }
          tx.objectStore('books').put(book, book.id)
          index.push({ id: book.id, title: book.title, author: book.author, format: book.format, importedAt: book.importedAt, chapterCount: 1, sentenceCount: 1 })
        }
        meta.put(index, 'library')
      }
      tx.oncomplete = () => { db.close(); resolve() }
      tx.onerror = () => reject(tx.error)
    }
  }), { name: databaseName, count: BOOKS })
  await page.goto('./')
  await expect(page.locator('[data-testid^="book-"]')).toHaveCount(BOOKS + 1)
}

const cards = (page: Page) => page.locator('[data-testid^="book-"]')
const firstTitle = (page: Page) => cards(page).first().getAttribute('aria-label')

async function sortBy(page: Page, value: string) {
  await page.getByTestId('librarySortButton').click()
  await page.getByTestId(`librarySort-${value}`).click()
}

test('бібліотека зі 100 книжок: пошук за назвою й автором, сортування зберігається', async ({ page }) => {
  await seedLibrary(page)
  const search = page.getByTestId('librarySearch')
  await search.fill('volume 42')
  await expect(cards(page)).toHaveCount(1)
  await expect(page.getByTestId('book-Volume 42')).toBeVisible()
  await search.fill('BRONTE')
  await expect(cards(page)).toHaveCount(34)
  await search.fill('zzz')
  await expect(page.getByTestId('libraryNoResults')).toContainText('Нічого не знайдено')
  await search.fill('')
  await expect(cards(page)).toHaveCount(BOOKS + 1)

  // «Нещодавні» by default: the demo was imported last and nothing was opened yet.
  expect(await firstTitle(page)).toBe(demo)
  await sortBy(page, 'added')
  expect(await firstTitle(page)).toBe(demo)
  await expect(cards(page).nth(1)).toHaveAttribute('aria-label', `Volume ${BOOKS}`)
  await sortBy(page, 'title')
  await expect(cards(page).nth(1)).toHaveAttribute('aria-label', 'Volume 1')
  await expect(cards(page).nth(2)).toHaveAttribute('aria-label', 'Volume 2')
  await sortBy(page, 'author')
  await expect(cards(page).first()).toHaveAttribute('aria-label', 'Volume 3')
  await expect(cards(page).last()).toHaveAttribute('aria-label', 'Volume 98')
  await page.reload()
  await expect(cards(page).first()).toHaveAttribute('aria-label', 'Volume 3')
  await page.getByTestId('librarySortButton').click()
  await expect(page.getByTestId('librarySort-author')).toContainText('Автор')
  await expect(page.getByTestId('librarySort-author').locator('svg')).toHaveCount(1)
  await expect(page.getByTestId('librarySort-title').locator('svg')).toHaveCount(0)
})

test('«Продовжити»: остання відкрита книжка з місцем, першою за «Нещодавні»; з однією книжкою рядка немає', async ({ page }) => {
  await page.goto('./?reset')
  await expect(page.getByTestId(`book-${demo}`)).toBeVisible()
  await expect(page.getByTestId('continueReading')).toHaveCount(0)
  await expect(page.getByTestId('librarySearch')).toHaveCount(0)

  await seedLibrary(page)
  await expect(page.getByTestId('continueReading')).toHaveCount(0)
  await page.getByTestId(`book-${demo}`).click()
  await page.getByTestId('contentsButton').click()
  await page.getByTestId('chapter-1').click()
  await expect(page.locator('.navbar-title')).toContainText(demoBook.secondChapter)
  await page.getByTestId('backButton').click()
  await page.getByTestId('book-Volume 7').click()
  await expect(page.getByTestId('readerScroll')).toBeVisible()
  await page.getByTestId('backButton').click()

  const resume = page.getByTestId('continueReading')
  await expect(resume).toContainText('Volume 7')
  expect(await firstTitle(page)).toBe('Volume 7')
  await expect(cards(page).nth(1)).toHaveAttribute('aria-label', demo)
  await page.reload()
  await expect(page.getByTestId('continueReading')).toContainText('Volume 7')

  await cards(page).nth(1).click()
  await page.getByTestId('backButton').click()
  await expect(resume).toContainText(demo)
  await expect(page.getByTestId('continuePlace')).toHaveText('Розділ 2 з 2')
  await resume.click()
  await expect(page.locator('.navbar-title')).toContainText(demoBook.secondChapter)
})

test('на 320 px поле пошуку, кнопка сортування й «Продовжити» в межах екрана', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 700 })
  await seedLibrary(page)
  await page.getByTestId('book-Volume 5').click()
  await page.getByTestId('backButton').click()
  for (const id of ['librarySearch', 'librarySortButton', 'continueReading']) {
    const box = (await page.getByTestId(id).boundingBox())!
    expect(box.x, id).toBeGreaterThanOrEqual(0)
    expect(box.x + box.width, id).toBeLessThanOrEqual(320)
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320)
})

test('пошук у книжці: фраза з другого розділу → речення вибране → «Повернутися» на попереднє місце', async ({ page }) => {
  await page.goto('./?reset&testTranslation')
  await page.getByTestId(`book-${demo}`).click()
  await expect(page.getByTestId('readerScroll')).toBeVisible()
  const startTitle = await page.locator('.navbar-title').textContent()

  // The reader listens to the keys once its effects have run; on a loaded machine that can lag behind the first paint.
  await expect(async () => {
    await page.keyboard.press('Meta+f')
    await expect(page.getByTestId('readerPanel')).toBeVisible({ timeout: 1_000 })
  }).toPass()
  await expect(page.getByTestId('bookSearch')).toBeFocused()
  await page.getByTestId('bookSearch').fill(demoBook.secondChapterText.toUpperCase())
  const hit = page.getByTestId('searchResult-0')
  await expect(hit).toContainText(demoBook.secondChapter)
  await expect(hit.locator('mark')).toHaveText(demoBook.secondChapterText)
  await hit.click()

  await expect(page.getByTestId('readerPanel')).toBeHidden()
  await expect(page.locator('.navbar-title')).toContainText(demoBook.secondChapter)
  await expect(page.locator('[data-p="1"] [data-s="0"]')).toHaveClass(/active/)
  await expect(page.locator('[data-p="1"] [data-s="0"]')).toContainText(demoBook.secondChapterText)
  const bar = page.getByTestId('searchReturnBar')
  await expect(bar).toContainText('Перейшли до знайденого.')

  // The query stays: the next result is one tap away; the way back still leads to the first place.
  await page.getByTestId('contentsButton').click()
  await expect(page.getByTestId('bookSearch')).toHaveValue(demoBook.secondChapterText.toUpperCase())
  await page.getByTestId('searchResult-0').click()
  await bar.getByRole('button', { name: 'Повернутися' }).click()
  await expect(bar).toBeHidden()
  await expect(page.locator('.navbar-title')).toHaveText(startTitle!)

  // A chapter chosen in «Зміст» drops the way back.
  await page.getByTestId('contentsButton').click()
  await page.getByTestId('searchResult-0').click()
  await expect(bar).toBeVisible()
  await page.getByTestId('contentsButton').click()
  await page.getByTestId('bookSearch').fill('')
  await page.getByTestId('chapter-0').click()
  await expect(bar).toBeHidden()
})

test('пошук у книжці: з одним символом лишається зміст, без збігів — «Нічого не знайдено»', async ({ page }) => {
  await page.goto('./?reset')
  await page.getByTestId(`book-${demo}`).click()
  await page.getByTestId('contentsButton').click()
  await page.getByTestId('bookSearch').fill('q')
  await page.waitForTimeout(300)
  await expect(page.getByTestId('chapter-1')).toBeVisible()
  await expect(page.getByTestId('searchResults')).toHaveCount(0)
  await page.getByTestId('bookSearch').fill('qqqzzz')
  await expect(page.getByTestId('searchNoResults')).toHaveText('Нічого не знайдено')
  await page.getByTestId('bookSearch').fill('')
  await expect(page.getByTestId('chapter-1')).toBeVisible()
})
