// Backup and restore (specs/006-backup, B3–B4): a file from «ШІ-сервіси» brings back the place, words, quotes and settings.
import { expect, test, type Locator, type Page } from '@playwright/test'
import { appName } from '../../src/core/language.ts'
import { demoBook } from '../fixtures/language.ts'

const demo = demoBook.title
const [first, second] = demoBook.words
const p = demoBook.paragraph
const { paragraph: index, status } = demoBook.position

const word = (page: Page, text: string): Locator =>
  page.locator(`[data-p="${p}"] .w`).filter({ hasText: new RegExp(`^${text}$`) }).first()

async function longPressDrag(page: Page, from: Locator, to: Locator) {
  const a = (await from.boundingBox())!
  const b = (await to.boundingBox())!
  await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2)
  await page.mouse.down()
  await page.waitForTimeout(800)
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 8 })
  await page.mouse.up()
}

test.beforeEach(async ({ page }) => {
  await page.route('https://api.openai.com/**', (route) => route.abort())
  // The file goes to a download: the share sheet cannot be driven in a test.
  await page.addInitScript(() => Object.defineProperty(navigator, 'canShare', { value: undefined }))
  await page.setViewportSize({ width: 834, height: 500 })
})

test('копія → скидання → відновлення: місце читання, слово, цитата й налаштування повертаються, ключ лишається свій', async ({ page }, testInfo) => {
  test.skip(demoBook.position.nextChapter, 'the place is set in chapter 1')
  await page.goto('./?reset&voice=system&testTranslation&testWordCard')
  await page.getByTestId(`book-${demo}`).click()

  const firstWord = word(page, first)
  await expect(firstWord).toBeVisible({ timeout: 10_000 })
  await firstWord.click()
  await expect(page.getByTestId(`translation-0-${p}-0`)).toBeVisible({ timeout: 5_000 })
  await firstWord.click()
  await page.getByTestId('saveWordButton').click()
  await expect(page.getByTestId('saveWordButton')).toHaveText(/Збережено/)
  await page.keyboard.press('Escape')
  await longPressDrag(page, firstWord, word(page, second))
  await page.getByTestId('saveFragment').click()
  await expect(page.getByTestId('saveFragment')).toHaveText(/Збережено/)
  await page.getByTestId('hideParallelTranslation').click()

  await page.getByTestId('readerScroll').evaluate((el, index) => {
    el.scrollTop = el.querySelector<HTMLElement>(`[data-p="${index}"]`)!.offsetTop - 28
  }, index)
  await expect(page.getByTestId('playbackStatus')).toHaveText(status)
  await page.waitForTimeout(400)
  await page.getByTestId('backButton').click()

  await page.getByTestId('settingsButton').click()
  await page.getByTestId('textModelField').fill('gpt-5.4')
  await expect(page.getByTestId('lastBackup')).toHaveCount(0)
  await page.getByTestId('saveBackup').click()
  await expect(page.getByTestId('backupPrepared')).toContainText(`«${appName} — копія `)
  const download = page.waitForEvent('download')
  await page.getByTestId('backupShare').click()
  const file = await download
  expect(file.suggestedFilename()).toMatch(new RegExp(`^${appName} — копія \\d{4}-\\d{2}-\\d{2}\\.json\\.gz$`))
  const path = testInfo.outputPath('backup.json.gz')
  await file.saveAs(path)
  await expect(page.getByTestId('lastBackup')).toHaveText(/^Остання копія: \d{2}\.\d{2}\.\d{4}$/)

  // A clean device with its own key.
  await page.goto('./?reset&voice=system&testTranslation&testWordCard')
  await page.getByTestId('settingsButton').click()
  await page.getByTestId('apiKeyField').fill('test-key-placeholder')
  await page.getByTestId('saveKey').click()
  await expect(page.getByTestId('textModelField')).toHaveValue('gpt-5.4-mini')
  await page.getByTestId('restoreInput').setInputFiles(path)
  const summary = page.getByTestId('restoreSummary')
  await expect(summary).toContainText('книжок 1, слів 1, цитат 1')
  await expect(summary).toContainText('Ключ OpenAI і аудіокниги не змінюються.')
  await page.getByTestId('restoreConfirm').click()
  await page.waitForURL((url) => !url.searchParams.has('reset'))

  await page.getByTestId('settingsButton').click()
  await expect(page.getByTestId('keyState')).toBeVisible()
  await expect(page.getByTestId('textModelField')).toHaveValue('gpt-5.4')
  await page.getByTestId('settingsDone').click()

  await page.getByTestId('savedButton').click()
  await expect(page.getByTestId(`savedWord-${first}`)).toBeVisible()
  await page.getByTestId('savedKindQuotes').click()
  await expect(page.getByTestId('savedKindQuotes')).toHaveText('Цитати (1)')
  await page.getByTestId('savedDone').click()

  await page.getByTestId(`book-${demo}`).click()
  await expect(page.getByTestId('playbackStatus')).toHaveText(status)
})

test('файл, що не є копією, і скасування не змінюють даних', async ({ page }) => {
  await page.goto('./?reset')
  await page.getByTestId('settingsButton').click()
  await page.getByTestId('restoreInput').setInputFiles({ name: 'notes.json', mimeType: 'application/json', buffer: Buffer.from('{"a":1}\n') })
  await expect(page.getByTestId('backupAlert')).toContainText(`Це не файл копії ${appName}.`)
  await page.getByTestId('backupAlertOK').click()

  await page.getByTestId('saveBackup').click()
  const download = page.waitForEvent('download')
  await page.getByTestId('backupShare').click()
  const file = await download
  const path = test.info().outputPath('backup.json.gz')
  await file.saveAs(path)
  await page.getByTestId('restoreInput').setInputFiles(path)
  await expect(page.getByTestId('restoreSummary')).toContainText('книжок 1, слів 0, цитат 0')
  await page.getByTestId('restoreCancel').click()
  await expect(page.getByTestId('restoreSummary')).toBeHidden()
  await expect(page.getByTestId('aiServices')).toBeVisible()
})
