// Port of MainScenarioUITests.testSavedWordsAndQuotes (stage 2.3, Z1–Z6).
import { expect, test, type Locator, type Page } from '@playwright/test'
import { demoBook } from '../fixtures/language.ts'

const demoTitle = demoBook.title
const [first, second] = demoBook.words
const p = demoBook.paragraph

const word = (page: Page, text: string): Locator =>
  page.locator('[data-p] .w').filter({ hasText: new RegExp(`^${text}$`) }).first()

async function longPressDrag(page: Page, from: Locator, to: Locator) {
  const a = (await from.boundingBox())!
  const b = (await to.boundingBox())!
  await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2)
  await page.mouse.down()
  await page.waitForTimeout(800)
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 8 })
  await page.mouse.up()
}

test('збережені слова й цитати: картка, фрагмент, вкладка панелі, бібліотека, видалення', async ({ page }) => {
  await page.goto('./?reset&voice=system&testTranslation&testWordCard')
  await page.getByTestId(`book-${demoTitle}`).click()

  const firstWord = word(page, first)
  await expect(firstWord).toBeVisible({ timeout: 10_000 })
  await firstWord.click()
  await expect(page.getByTestId(`translation-0-${p}-0`)).toBeVisible({ timeout: 5_000 })
  await firstWord.click()
  const save = page.getByTestId('saveWordButton')
  await expect(save).toHaveText(/Зберегти/)
  await save.click()
  await expect(save).toHaveText(/Збережено/)
  await page.keyboard.press('Escape')
  await expect(save).toBeHidden()

  // A quote from a selected fragment.
  await longPressDrag(page, firstWord, word(page, second))
  const saveFragment = page.getByTestId('saveFragment')
  await expect(saveFragment).toBeVisible({ timeout: 5_000 })
  await saveFragment.click()
  await expect(saveFragment).toHaveText(/Збережено/)
  await page.getByTestId('hideParallelTranslation').click()

  // Highlighting of saved words: off by default.
  await page.getByTestId('appearanceButton').click()
  const dictionary = page.getByTestId('panelSection-dictionary')
  await dictionary.click()
  const highlight = page.getByTestId('highlightSavedWords')
  await highlight.scrollIntoViewIfNeeded()
  await expect(highlight).toHaveAttribute('aria-checked', 'false')
  await highlight.click()
  await expect(highlight).toHaveAttribute('aria-checked', 'true')

  // The saved tab of the panel: the word and its context open the place.
  await page.getByTestId('panelTabSaved').click()
  const savedWord = page.getByTestId(`savedWord-${first}`)
  await expect(savedWord).toBeVisible()
  await page.screenshot({ path: 'build/visual/saved-tab.png' })
  await savedWord.click()
  await page.getByTestId(`savedContext-${first}`).first().click()
  await expect(page.getByTestId('readerPanel')).toBeHidden()
  await expect(page.getByTestId(`translation-0-${p}-0`)).toBeVisible({ timeout: 5_000 })
  await page.screenshot({ path: 'build/visual/saved-word-highlight.png' })
  await page.getByTestId('contentsButton').click()
  await page.getByTestId('panelTabSaved').click()
  await page.getByTestId('savedKindQuotes').click()
  await expect(page.getByTestId('savedKindQuotes')).toHaveText('Цитати (1)')
  await expect(page.getByTestId('savedQuote')).toBeVisible()
  await page.getByTestId('panelBackdrop').click({ position: { x: 20, y: 300 } })

  // From the library: open the place from another chapter, then delete with a swipe.
  await page.getByTestId('contentsButton').click()
  await page.getByTestId('chapter-1').click()
  await page.getByTestId('backButton').click()
  await page.getByTestId('savedButton').click()
  const libraryWord = page.getByTestId(`savedWord-${first}`)
  await expect(libraryWord).toBeVisible()
  await libraryWord.click()
  await page.getByTestId(`savedContext-${first}`).first().click()
  await expect(page.getByTestId(`translation-0-${p}-0`)).toBeVisible({ timeout: 10_000 })
  await page.getByTestId('backButton').click()
  await page.getByTestId('savedButton').click()
  await expect(libraryWord).toBeVisible()
  // Let the sheet finish its entrance animation before measuring the row for a manual swipe.
  await page.waitForTimeout(500)

  const box = (await libraryWord.boundingBox())!
  await page.mouse.move(box.x + box.width - 20, box.y + box.height / 2)
  await page.mouse.down()
  await page.mouse.move(box.x + box.width - 140, box.y + box.height / 2, { steps: 10 })
  await page.mouse.up()
  await page.getByTestId('savedDelete').first().click()
  await expect(page.getByText('Збережених слів немає')).toBeVisible()
  await page.getByTestId('savedDone').click()
})
