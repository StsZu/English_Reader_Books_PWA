// Ports of the reader scenarios in EnglishReaderUITests/MainScenarioUITests.swift:
// testTranslationToggleKeepsOriginal, testParallelTranslationUsesStablePanelAndSecondTapOpensWord,
// testMissingKeyIsExplained, testLongPressSpeaksTranslatedSentenceAndReplaysSavedAudio,
// testAutoHideUsesLineThreshold, testParagraphPositionRestoredAfterRelaunch,
// testParallelTranslationSettingsPersist, testFragmentSelectionTranslatesSpeaksAndCopies, playback.
import { expect, test, type Locator, type Page } from '@playwright/test'
import { fixtureTranslation } from '../../src/core/language.ts'
import { demoBook } from '../fixtures/language.ts'

const demo = demoBook.title
const p = demoBook.paragraph
const [w0, w1, w2] = demoBook.words

const word = (page: Page, text: string, paragraph = p): Locator =>
  page.locator(`[data-p="${paragraph}"] .w`).filter({ hasText: new RegExp(`^${text}$`) }).first()

async function openDemo(page: Page, query: string) {
  await page.route('https://api.openai.com/**', (route) => route.abort())
  await page.goto(`./?reset&${query}`)
  await page.getByTestId(`book-${demo}`).click()
  await expect(page.getByTestId('readerScroll')).toBeVisible()
}

async function top(locator: Locator) {
  return (await locator.boundingBox())!.y
}

async function longPress(page: Page, target: Locator, moveTo?: Locator) {
  const a = (await target.boundingBox())!
  await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2)
  await page.mouse.down()
  await page.waitForTimeout(700)
  if (moveTo) {
    const b = (await moveTo.boundingBox())!
    await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 8 })
  }
  await page.mouse.up()
  await page.waitForTimeout(650)
}

/** Drags the text by hand (touch-like: pointer on the scroller) by `dy` pixels. */
async function scrollByHand(page: Page, dy: number) {
  const scroller = page.getByTestId('readerScroll')
  await scroller.dispatchEvent('pointerdown', { pointerId: 9, isPrimary: true })
  await scroller.evaluate((el, delta) => { el.scrollTop += delta }, dy)
  await page.waitForTimeout(50)
  await scroller.dispatchEvent('pointerup', { pointerId: 9, isPrimary: true })
  await page.waitForTimeout(250)
}

test('переклад над текстом: перший дотик — речення, другий — картка; панель не зсуває текст', async ({ page }) => {
  await openDemo(page, 'testTranslation&testWordCard')
  const pane = page.getByTestId('parallelTranslationPane')
  await expect(page.getByTestId('parallelTranslationHint')).toBeVisible()
  const paragraph = page.getByTestId(`paragraph-${p}`)
  const before = await top(paragraph)
  const paneHeight = (await pane.boundingBox())!.height

  await word(page, w0).click()
  await expect(page.getByTestId(`translation-0-${p}-0`)).toContainText(fixtureTranslation.split('. ')[0])
  await expect(page.locator(`[data-p="${p}"] [data-s="0"]`)).toHaveClass(/active/)
  expect(Math.abs((await top(paragraph)) - before)).toBeLessThanOrEqual(1)
  expect((await pane.boundingBox())!.height).toBeCloseTo(paneHeight, 0)
  await expect(page.getByTestId('wordCardContent')).toHaveCount(0)

  // Second tap on a word of the same sentence opens its card; the sentence translation stays.
  await word(page, w0).click()
  await expect(page.getByTestId('wordCardContent')).toBeVisible()
  await expect(page.getByTestId(`translation-0-${p}-0`)).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(page.getByTestId('wordCardContent')).toHaveCount(0)

  // A tap on another sentence selects it instead of opening a card.
  await word(page, w1).click()
  await expect(page.getByTestId(`translation-0-${p}-1`)).toBeVisible()
  await expect(page.getByTestId('wordCardContent')).toHaveCount(0)

  // Closing keeps the reserved height and the text in place; the next tap selects again.
  await page.getByTestId('hideParallelTranslation').click()
  await expect(page.getByTestId('parallelTranslationHint')).toBeVisible()
  expect((await pane.boundingBox())!.height).toBeCloseTo(paneHeight, 0)
  expect(Math.abs((await top(paragraph)) - before)).toBeLessThanOrEqual(1)
})

test('перемикач перекладу ховає панель, оригінал лишається, дотик одразу відкриває картку', async ({ page }) => {
  await openDemo(page, 'testTranslation&testWordCard')
  await page.getByTestId('translationToggle').click()
  await expect(page.getByTestId('parallelTranslationPane')).toHaveCount(0)
  await expect(word(page, w0)).toBeVisible()
  await word(page, w0).click()
  await expect(page.getByTestId('wordCardContent')).toBeVisible()
})

test('без ключа — одне повідомлення з «Налаштування»', async ({ page }) => {
  await openDemo(page, '')
  await word(page, w0).click()
  await expect(page.getByTestId('noticeText')).toContainText('Не вказано ключ OpenAI')
  await page.getByTestId('openSettingsFromPane').click()
  await expect(page.getByText('Ключ OpenAI').first()).toBeVisible()
})

test('утримання перекладеного речення озвучує його; «Ще раз» без нового синтезу', async ({ page }) => {
  await openDemo(page, 'testTranslation&testSpeech&voice=openAI')
  const pane = page.getByTestId('parallelTranslationPane')
  const paragraph = page.getByTestId(`paragraph-${p}`)
  const before = await top(paragraph)
  const paneHeight = (await pane.boundingBox())!.height

  // Long press on an inactive sentence only selects it (G4).
  await longPress(page, word(page, w0))
  await expect(page.getByTestId(`translation-0-${p}-0`)).toBeVisible()
  await expect(pane).toHaveAttribute('data-testvalue', /synthesis:0 speech:idle/)

  await longPress(page, word(page, w0))
  await expect(pane).toHaveAttribute('data-testvalue', /synthesis:1 speech:(preparing|playing)/)
  await expect(page.getByTestId('stopSentenceSpeech')).toBeVisible()
  await page.getByTestId('stopSentenceSpeech').click()
  await expect(page.getByTestId('replaySentence')).toBeVisible({ timeout: 5_000 })

  for (let i = 0; i < 2; i++) {
    await page.getByTestId('replaySentence').click()
    await expect(page.getByTestId('stopSentenceSpeech')).toBeVisible()
    await page.getByTestId('stopSentenceSpeech').click()
    await expect(page.getByTestId('replaySentence')).toBeVisible()
  }
  await longPress(page, word(page, w0))
  await expect(pane).toHaveAttribute('data-testvalue', /synthesis:1 /)
  await page.getByTestId('stopSentenceSpeech').click()

  // No card opened by the long presses; layout untouched.
  await expect(page.getByTestId('wordCardContent')).toHaveCount(0)
  expect(Math.abs((await top(paragraph)) - before)).toBeLessThanOrEqual(1)
  expect((await pane.boundingBox())!.height).toBeCloseTo(paneHeight, 0)
})

test('автоприховування за порогом у рядках', async ({ page }) => {
  // The demo chapter fits a full iPad screen; a shorter viewport makes it scroll.
  await page.setViewportSize({ width: 834, height: 560 })
  await openDemo(page, 'testTranslation')
  await word(page, w0).click()
  await expect(page.getByTestId(`translation-0-${p}-0`)).toBeVisible()
  await scrollByHand(page, 20)
  await expect(page.getByTestId(`translation-0-${p}-0`)).toBeVisible()
  await scrollByHand(page, 100)
  await expect(page.getByTestId('parallelTranslationHint')).toBeVisible()

  // Threshold 5 lines.
  await page.getByTestId('appearanceButton').click()
  const section = page.getByTestId('panelSection-parallel')
  if ((await section.getAttribute('aria-expanded')) !== 'true') await section.click()
  for (let i = 0; i < 8; i++) await page.getByTestId('panel-parallelTranslationAutoHideLines-plus').click()
  await expect(page.getByTestId('panel-parallelTranslationAutoHideLines-value')).toHaveText('5 рядків')
  await page.getByTestId('panelBackdrop').click({ position: { x: 20, y: 400 } })
  await page.getByTestId('readerScroll').evaluate((el) => { el.scrollTop = 0 })
  await page.waitForTimeout(300)
  await word(page, w0).click()
  await expect(page.getByTestId(`translation-0-${p}-0`)).toBeVisible()
  await scrollByHand(page, 120)
  await expect(page.getByTestId(`translation-0-${p}-0`)).toBeVisible()
  await scrollByHand(page, 250)
  await expect(page.getByTestId('parallelTranslationHint')).toBeVisible()

  await page.goto('./')
  await page.getByTestId(`book-${demo}`).click()
  await page.getByTestId('appearanceButton').click()
  await expect(page.getByTestId('panel-parallelTranslationAutoHideLines-value')).toHaveText('5 рядків')
})

test('програмне прокручування не приховує переклад', async ({ page }) => {
  await page.setViewportSize({ width: 834, height: 560 })
  await openDemo(page, 'testTranslation')
  await word(page, w0).click()
  await expect(page.getByTestId(`translation-0-${p}-0`)).toBeVisible()
  // Reading aloud follows the text with programmatic scrolling (A4).
  await page.getByTestId('playButton').click()
  await page.waitForTimeout(300)
  await page.getByTestId('readerScroll').evaluate((el) => el.scrollTo({ top: 300 }))
  await page.waitForTimeout(300)
  expect(await page.getByTestId('readerScroll').evaluate((el) => el.scrollTop)).toBeGreaterThan(100)
  await expect(page.getByTestId(`translation-0-${p}-0`)).toBeVisible()
})

test('позиція абзацу відновлюється після перезапуску', async ({ page }) => {
  await page.setViewportSize({ width: 834, height: 500 })
  await openDemo(page, '')
  const { nextChapter, paragraph: index, status } = demoBook.position
  if (nextChapter) {
    await page.getByTestId('nextChapter').scrollIntoViewIfNeeded()
    await page.getByTestId('nextChapter').click()
  }
  await page.getByTestId('readerScroll').evaluate((el, index) => {
    const p = el.querySelector<HTMLElement>(`[data-p="${index}"]`)!
    el.scrollTop = p.offsetTop - 28
  }, index)
  await expect(page.getByTestId('playbackStatus')).toHaveText(status)
  await page.waitForTimeout(400)

  await page.goto('./')
  await page.getByTestId(`book-${demo}`).click()
  await expect(page.getByTestId('playbackStatus')).toHaveText(status)
  const paragraph = page.getByTestId(`paragraph-${index}`)
  const scroller = (await page.getByTestId('readerScroll').boundingBox())!
  expect(Math.abs((await top(paragraph)) - scroller.y - 28)).toBeLessThan(4)
})

test('налаштування паралельного перекладу зберігаються', async ({ page }) => {
  await openDemo(page, 'testTranslation')
  await page.getByTestId('appearanceButton').click()
  const section = page.getByTestId('panelSection-parallel')
  if ((await section.getAttribute('aria-expanded')) !== 'true') await section.click()
  await page.getByTestId('panel-parallelTranslationScale-minus').click()
  await expect(page.getByTestId('panel-parallelTranslationScale-value')).toHaveText('0,6×')
  await page.getByTestId('parallelTranslationMultiline').click()
  await page.getByTestId('parallelTranslationAutoHide').click()
  await page.goto('./')
  await page.getByTestId(`book-${demo}`).click()
  await page.getByTestId('appearanceButton').click()
  await expect(page.getByTestId('panel-parallelTranslationScale-value')).toHaveText('0,6×')
  await expect(page.getByTestId('parallelTranslationMultiline')).toHaveAttribute('aria-checked', 'true')
  await expect(page.getByTestId('parallelTranslationAutoHide')).toHaveAttribute('aria-checked', 'false')
})

test('виділення фрагмента: переклад, прослуховування, копіювання, скидання дотиком', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']).catch(() => {})
  await openDemo(page, 'testTranslation&testSpeech&voice=openAI')
  const pane = page.getByTestId('parallelTranslationPane')
  const paneHeight = (await pane.boundingBox())!.height

  // Forward across a sentence boundary.
  await longPress(page, word(page, demoBook.forwardFragment.from), word(page, demoBook.forwardFragment.to))
  await expect(page.getByTestId('fragmentBadge')).toBeVisible()
  await expect(page.getByTestId('fragmentTranslation')).toBeVisible()
  await expect(page.locator(`[data-p="${p}"] .w.sel`)).toHaveCount(demoBook.forwardFragment.count)
  await expect(page.getByTestId('wordCardContent')).toHaveCount(0)
  await expect(pane).toHaveAttribute('data-testvalue', /synthesis:0/)

  await page.getByTestId('speakFragment').click()
  await expect(page.getByTestId('stopSentenceSpeech')).toBeVisible()
  await page.getByTestId('stopSentenceSpeech').click()
  await expect(page.getByTestId('replayFragment')).toBeVisible({ timeout: 5_000 })
  await page.getByTestId('copyFragment').click()
  await expect(page.getByTestId('copyFragment')).toHaveText(/Скопійовано/)

  // Backward selection.
  await longPress(page, word(page, demoBook.backwardFragment.from), word(page, demoBook.backwardFragment.to))
  await expect(page.locator(`[data-p="${p}"] .w.sel`)).toHaveCount(demoBook.backwardFragment.count)

  // A tap resets the fragment and selects the sentence (G1).
  await word(page, w2).click()
  await expect(page.getByTestId('fragmentBadge')).toHaveCount(0)
  await expect(page.getByTestId(`translation-0-${p}-2`)).toBeVisible()
  expect((await pane.boundingBox())!.height).toBeCloseTo(paneHeight, 0)
})

test('читання вголос: Слухати → Пауза → Продовжити → Стоп', async ({ page }) => {
  await openDemo(page, 'testSpeech&voice=openAI')
  await page.getByTestId('playButton').click()
  await expect(page.getByTestId('pauseButton')).toBeVisible()
  await expect(page.locator('.s.active')).toHaveCount(1, { timeout: 5_000 })
  await page.getByTestId('pauseButton').click()
  await expect(page.getByTestId('playbackStatus')).toHaveText('Пауза')
  await page.getByTestId('resumeButton').click()
  await expect(page.getByTestId('pauseButton')).toBeVisible()
  await page.getByTestId('stopButton').click()
  await expect(page.getByTestId('playButton')).toBeVisible()
  await expect(page.getByTestId('playbackStatus')).toContainText('Розділ 1 з 2')
})

test('читання вголос з вибраного речення; утримання речення посеред читання не зависає', async ({ page }) => {
  await openDemo(page, 'testTranslation&testSpeech&voice=openAI')
  await word(page, w2).click()
  await expect(page.getByTestId(`translation-0-${p}-2`)).toBeVisible()
  await page.getByTestId('playButton').click()
  await expect(page.getByTestId('pauseButton')).toBeVisible()
  // Reading starts at the selected sentence, not at the top of the page.
  await expect(page.locator(`[data-p="${p}"] .s.active[data-s="2"]`)).toBeVisible({ timeout: 5_000 })
  await expect(page.locator('.s.active')).toHaveCount(1)

  // A long press speaks the translated sentence: reading pauses and then goes on.
  await page.waitForTimeout(800) // reading scrolls to the paragraph first
  await longPress(page, word(page, w2))
  await expect(page.getByTestId('resumeButton')).toBeVisible()
  if (await page.getByTestId('stopSentenceSpeech').isVisible()) await page.getByTestId('stopSentenceSpeech').click()
  await page.getByTestId('resumeButton').click()
  await expect(page.getByTestId('pauseButton')).toBeVisible()
  await expect(page.locator(`[data-p="${p}"] .s.active:is([data-s="1"], [data-s="3"])`)).toBeVisible({ timeout: 15_000 })
  await page.getByTestId('stopButton').click()
  await expect(page.getByTestId('playButton')).toBeVisible()
})

test('читання голосом з клавіатури: пробіл — «Слухати» / «Пауза» / «Продовжити», Enter — вибране речення', async ({ page }) => {
  await openDemo(page, 'testTranslation&testSpeech&voice=openAI')
  await word(page, w2).click()
  await expect(page.getByTestId(`translation-0-${p}-2`)).toBeVisible()
  await page.keyboard.press('Space')
  await expect(page.getByTestId('pauseButton')).toBeVisible()
  await expect(page.locator(`[data-p="${p}"] .s.active[data-s="2"]`)).toBeVisible({ timeout: 5_000 })
  await page.keyboard.press('Space')
  await expect(page.getByTestId('resumeButton')).toBeVisible()
  await page.keyboard.press('Space')
  await expect(page.getByTestId('pauseButton')).toBeVisible()
  await page.getByTestId('stopButton').click()
  await expect(page.getByTestId('playButton')).toBeVisible()

  // Enter: the selected sentence once, as a long press.
  await page.keyboard.press('Enter')
  await expect(page.getByTestId('stopSentenceSpeech')).toBeVisible()
  await page.getByTestId('stopSentenceSpeech').click()
})
