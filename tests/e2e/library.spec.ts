import { expect, test, type Page } from '@playwright/test'
import { brokenEPUB, drmEPUB, garbageEPUB, partialEPUB, pdfFile, plainText, storedEPUB, type FilePayload } from '../fixtures/e2e/books.ts'
import { demoBook } from '../fixtures/language.ts'

test.beforeEach(async ({ page }) => {
  await page.route('https://api.openai.com/**', (route) => route.abort())
})

const demoTitle = demoBook.title

async function importFile(page: Page, payload: FilePayload) {
  await page.getByTestId('importInput').setInputFiles(payload)
}

async function expectImportError(page: Page, payload: FilePayload, text: string) {
  await importFile(page, payload)
  const dialog = page.getByTestId('importError')
  await expect(dialog).toBeVisible()
  await expect(dialog).toContainText('Не вдалося імпортувати')
  await expect(dialog).toContainText(text)
  await page.getByTestId('importErrorOK').click()
  await expect(dialog).toBeHidden()
}

test('демо-книжка є після першого запуску й лишається після перезапуску', async ({ page }) => {
  await page.goto('./?reset')
  await expect(page.getByRole('heading', { name: 'Мої книжки' })).toBeVisible()
  const demo = page.getByTestId(`book-${demoTitle}`)
  await expect(demo).toBeVisible()
  await expect(demo).toContainText(demoBook.author)
  await expect(demo).toContainText('MD')
  await expect(demo).toContainText('Розділів: 2')
  await page.goto('./')
  await expect(page.getByTestId(`book-${demoTitle}`)).toBeVisible()
  await expect(page.locator('[data-testid^="book-"]')).toHaveCount(1)
})

test('імпорт EPUB відкриває книжку, а вона зберігається в бібліотеці', async ({ page }) => {
  await page.goto('./?reset')
  await importFile(page, storedEPUB())
  await expect(page.getByTestId('libraryGrid')).toBeHidden()
  await page.goto('./')
  const card = page.getByTestId('book-Test Book')
  await expect(card).toBeVisible()
  await expect(card).toContainText('A. Writer')
  await expect(card).toContainText('EPUB')
  // The newest book comes first.
  await expect(page.locator('[data-testid^="book-"]').first()).toHaveAttribute('data-testid', 'book-Test Book')
})

test('неповний EPUB: попередження з назвою файла, потім книжка відкривається (R2)', async ({ page }) => {
  await page.goto('./?reset')
  await importFile(page, partialEPUB())
  const dialog = page.getByTestId('partialImport')
  await expect(dialog).toBeVisible()
  await expect(dialog).toContainText('Книжку імпортовано не повністю')
  await expect(dialog).toContainText('Розділів: 1. Не вдалося прочитати файлів: 1 (ch2.xhtml).')
  await page.getByTestId('partialImportOpen').click()
  await expect(page.getByTestId('readerScroll')).toBeVisible()
  await expect(page.locator('[data-p]').first()).toContainText('Chapter 1')
})

test('імпорт TXT додає книжку з назвою файла', async ({ page }) => {
  await page.goto('./?reset')
  await importFile(page, plainText())
  await expect(page.getByTestId('libraryGrid')).toBeHidden()
  await page.goto('./')
  await expect(page.getByTestId('book-Notes')).toContainText('TXT')
})

test('непридатні файли дають зрозумілі повідомлення', async ({ page }) => {
  await page.goto('./?reset')
  await expectImportError(page, drmEPUB(), 'Книжка захищена DRM. Імпортуйте копію без захисту.')
  await expectImportError(page, brokenEPUB(), 'немає META-INF/container.xml')
  await expectImportError(page, garbageEPUB(), 'Файл EPUB пошкоджений або має нестандартну структуру (не ZIP-архів).')
  await expectImportError(page, pdfFile(), 'Формат «.pdf» не підтримується. Підтримуються EPUB (без DRM), TXT і MD.')
  await expect(page.locator('[data-testid^="book-"]')).toHaveCount(1)
})

test('видалення книжки через контекстне меню', async ({ page }) => {
  await page.goto('./?reset')
  const demo = page.getByTestId(`book-${demoTitle}`)
  await expect(demo).toBeVisible()
  await demo.click({ button: 'right' })
  await page.getByTestId('deleteBook').click()
  const dialog = page.getByTestId('deleteDialog')
  await expect(dialog).toContainText(`Видалити книжку «${demoTitle}»?`)
  await page.getByTestId('confirmDelete').click()
  await expect(demo).toHaveCount(0)
  await expect(page.getByText('Бібліотека порожня')).toBeVisible()
  await page.goto('./')
  await expect(page.getByText('Бібліотека порожня')).toBeVisible()
})

test('довге натискання відкриває меню й не відкриває книжку', async ({ page }) => {
  await page.goto('./?reset')
  const demo = page.getByTestId(`book-${demoTitle}`)
  const box = (await demo.boundingBox())!
  const x = box.x + box.width / 2
  const y = box.y + box.height / 3
  await page.mouse.move(x, y)
  await page.mouse.down()
  await page.waitForTimeout(700)
  await page.mouse.up()
  await expect(page.getByTestId('deleteBook')).toBeVisible()
  await expect(page.getByTestId('libraryGrid')).toBeVisible()
  await page.keyboard.press('Escape')
})

test('знімок бібліотеки', async ({ page }) => {
  await page.goto('./?reset')
  await importFile(page, storedEPUB())
  await page.goto('./')
  await expect(page.getByTestId('book-Test Book')).toBeVisible()
  await page.waitForTimeout(400)
  await page.screenshot({ path: 'build/visual/library.png' })
})
