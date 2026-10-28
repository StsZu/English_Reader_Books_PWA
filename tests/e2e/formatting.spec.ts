// EPUB contents with levels, italic and bold, and what the import left out (specs/011-epub-formatting).
import { expect, test } from '@playwright/test'
import { formattedEPUB, storedEPUB } from '../fixtures/e2e/books.ts'

test.beforeEach(async ({ page }) => {
  await page.route('https://api.openai.com/**', (route) => route.abort())
})

test('EPUB з ілюстрацією й приміткою: діалог «Книжку імпортовано як текст», курсив, зміст з рівнями', async ({ page }) => {
  await page.goto('./?reset')
  await page.getByTestId('importInput').setInputFiles(formattedEPUB())
  const dialog = page.getByTestId('textImport')
  await expect(dialog).toContainText('Книжку імпортовано як текст')
  await expect(dialog).toContainText('Не перенесено: ілюстрацій: 1, приміток: 1, додаткових сторінок: 1.')
  await page.getByTestId('textImportOpen').click()
  await expect(page.getByTestId('readerScroll')).toBeVisible()

  const italic = page.locator('[data-p="1"] [data-s="0"] .w', { hasText: 'Times' })
  await expect(italic).toHaveCSS('font-style', 'italic')
  await expect(page.locator('[data-p="1"] [data-s="0"] .w', { hasText: 'read' })).toHaveCSS('font-style', 'normal')
  const bold = page.locator('[data-p="1"] [data-s="1"] .w', { hasText: 'pride' })
  expect(Number(await bold.evaluate((el) => getComputedStyle(el).fontWeight))).toBeGreaterThanOrEqual(600)

  await page.getByTestId('contentsButton').click()
  await expect(page.getByTestId('contents-0')).toHaveText('Part One')
  await expect(page.getByTestId('contents-0')).toHaveAttribute('aria-current', 'true')
  await expect(page.getByTestId('contents-2')).toHaveText('Part Two')
  await expect(page.getByTestId('contents-3')).toHaveCount(0)
  const nested = page.getByTestId('contents-1')
  await expect(nested).toHaveText('The Second Scene')
  const indent = await nested.evaluate((el) => parseFloat(getComputedStyle(el).paddingLeft))
  const base = await page.getByTestId('contents-0').evaluate((el) => parseFloat(getComputedStyle(el).paddingLeft))
  expect(indent).toBeGreaterThan(base)

  await nested.click()
  await expect(page.getByTestId('readerPanel')).toBeHidden()
  const heading = page.locator('.para.heading', { hasText: 'The Second Scene' })
  await expect.poll(async () => {
    const box = await heading.boundingBox()
    const scroller = await page.getByTestId('readerScroll').boundingBox()
    return box && scroller ? Math.abs(box.y - scroller.y) : Infinity
  }).toBeLessThan(80)
  await page.getByTestId('contentsButton').click()
  await expect(page.getByTestId('contents-1')).toHaveAttribute('aria-current', 'true')
  await page.getByTestId('contents-2').click()
  await expect(page.locator('.navbar-title')).toHaveText('Part Two')
})

test('EPUB без пропусків відкривається одразу, без діалогу; без змісту — список розділів', async ({ page }) => {
  await page.goto('./?reset')
  await page.getByTestId('importInput').setInputFiles(storedEPUB())
  await expect(page.getByTestId('readerScroll')).toBeVisible()
  await expect(page.getByTestId('textImport')).toBeHidden()
  await page.getByTestId('contentsButton').click()
  await expect(page.getByTestId('chapter-1')).toHaveText('Chapter 2')
  await expect(page.getByTestId('contents-0')).toHaveCount(0)
})
