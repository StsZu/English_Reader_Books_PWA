// Port of MainScenarioUITests.testDictionaryTranslationCardAndSettings (stage 2.2: DT2–DT6).
import { expect, test, type Page } from '@playwright/test'
import { defaultEnabledDictionaries, fixtureCard } from '../../src/core/language.ts'
import { demoBook } from '../fixtures/language.ts'

const demoTitle = demoBook.title
const id = (page: Page, testID: string) => page.locator(`[data-testid="${testID}"]`)

/** The first word of the first text paragraph of the demo, sentence 0. */
const firstWord = (page: Page) =>
  page.locator(`[data-p="${demoBook.paragraph}"] [data-s="0"] .w`, { hasText: new RegExp(`^${demoBook.words[0]}$`) }).first()
const firstDictionary = defaultEnabledDictionaries[0]

async function closeCard(page: Page) {
  await page.keyboard.press('Escape')
  await expect(id(page, 'wordCard')).toHaveCount(0)
}

test('картка слова: рівень, форми, словники, пояснення й налаштування розділу', async ({ page }) => {
  await page.goto('./?reset&voice=system&testTranslation&testWordCard')
  await id(page, `book-${demoTitle}`).click()
  await expect(firstWord(page)).toBeVisible({ timeout: 10_000 })
  await firstWord(page).click()
  await expect(id(page, `translation-0-${demoBook.paragraph}-0`)).toBeVisible({ timeout: 5_000 })
  await firstWord(page).click()

  // DT3, DT4, DT2: level, forms and the default five dictionaries.
  await expect(id(page, 'wordContextTranslation')).toHaveText(fixtureCard.contextTranslation, { timeout: 5_000 })
  await expect(id(page, 'wordLevel')).toHaveAttribute('aria-label', `Рівень ${fixtureCard.level}`)
  await expect(id(page, 'wordForms')).toHaveText(fixtureCard.forms)
  await expect(id(page, 'wordIrregular')).toBeVisible()
  for (const dictionary of defaultEnabledDictionaries) {
    await expect(id(page, `dictionary-${dictionary}`), dictionary).toBeVisible()
  }
  await expect(id(page, 'dictionary-forvo')).toHaveCount(0)

  // DT6: one explanation, shown again from the cache when the card reopens.
  await id(page, 'explainButton').click()
  await expect(id(page, 'wordExplanation')).toBeVisible({ timeout: 5_000 })
  await page.screenshot({ path: 'build/visual/25-word-card-dictionary.png' })
  await closeCard(page)
  await firstWord(page).click()
  await expect(id(page, 'wordExplanation')).toBeVisible({ timeout: 5_000 })
  await expect(id(page, 'explainAgainButton')).toBeVisible()
  await closeCard(page)

  // Section settings: level off, larger card, dictionaries changed.
  await id(page, 'appearanceButton').click()
  await expect(id(page, 'readerPanel')).toBeVisible()
  const header = id(page, 'panelSection-dictionary')
  await header.scrollIntoViewIfNeeded()
  if ((await header.getAttribute('aria-expanded')) !== 'true') await header.click()
  const level = id(page, 'showWordLevel')
  await level.scrollIntoViewIfNeeded()
  await level.click()
  await expect(level).toHaveAttribute('aria-checked', 'false')
  await id(page, 'panel-wordCardScale-plus').click()
  await expect(id(page, 'panel-wordCardScale-value')).toHaveText('1,1×')
  await expect(id(page, 'explanationTemplate')).toBeVisible()
  await page.screenshot({ path: 'build/visual/26-dictionary-section.png' })
  await id(page, 'manageDictionaries').scrollIntoViewIfNeeded()
  await id(page, 'manageDictionaries').click()
  const firstToggle = id(page, `enableDictionary-${firstDictionary}`)
  await expect(firstToggle).toBeVisible({ timeout: 3_000 })
  await firstToggle.click()
  await expect(firstToggle).toHaveAttribute('aria-checked', 'false')
  const forvo = id(page, 'enableDictionary-forvo')
  await forvo.scrollIntoViewIfNeeded()
  await forvo.click()
  await expect(forvo).toHaveAttribute('aria-checked', 'true')
  await page.screenshot({ path: 'build/visual/27-dictionary-manager.png' })
  await id(page, 'dictionariesDone').click()
  await id(page, 'closePanel').click()
  await expect(id(page, 'readerPanel')).toHaveCount(0)

  await firstWord(page).click()
  await expect(id(page, 'wordContextTranslation')).toBeVisible({ timeout: 5_000 })
  await expect(id(page, 'wordLevel')).toHaveCount(0)
  await expect(id(page, 'wordForms')).toBeVisible()
  await expect(id(page, `dictionary-${firstDictionary}`)).toHaveCount(0)
  await expect(id(page, 'dictionary-forvo')).toBeVisible()
  const scale = await id(page, 'wordCardContent').evaluate((e) => getComputedStyle(e).getPropertyValue('--card-scale').trim())
  expect(Number(scale)).toBeCloseTo(1.1)
})
