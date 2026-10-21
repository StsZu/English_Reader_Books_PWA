// Port of testReaderPanelSettingsApplyAndPersist (MainScenarioUITests.swift), stage 2.0: S1–S5, B1–B7, D1–D8.
import { expect, test, type Page } from '@playwright/test'

const demoTitle = 'The Adventures of Sherlock Holmes (excerpt)'

test.beforeEach(async ({ page }) => {
  await page.route('https://api.openai.com/**', (route) => route.abort())
})

async function openDemo(page: Page, query: string) {
  await page.goto(`./${query}`)
  await page.getByTestId(`book-${demoTitle}`).click()
  await expect(page.getByTestId('readerScroll')).toBeVisible()
  await expect(page.locator('[data-p]').first()).toBeVisible()
}

async function openPanel(page: Page) {
  await page.getByTestId('appearanceButton').click()
  await expect(page.getByTestId('readerPanel')).toBeVisible()
}

async function tap(page: Page, id: string, times = 1) {
  const button = page.getByTestId(id)
  await button.scrollIntoViewIfNeeded()
  for (let i = 0; i < times; i++) await button.click()
}

async function expand(page: Page, section: string) {
  const header = page.getByTestId(`panelSection-${section}`)
  await header.scrollIntoViewIfNeeded()
  if ((await header.getAttribute('aria-expanded')) !== 'true') await header.click()
}

test('панель читання змінює оформлення книжки й зберігає налаштування', async ({ page }) => {
  await openDemo(page, '?reset&testTranslation&testSpeech&voice=openAI')
  const paragraph = page.locator('[data-p="2"]')
  const status = page.getByTestId('playbackStatus')
  const positionBefore = (await status.count()) ? await status.textContent() : null
  const boxBefore = await paragraph.boundingBox()

  // S1–S3: over the book, tabs and themes; «Текст книги» expanded by default.
  await openPanel(page)
  await expect(paragraph).toBeAttached()
  await expect(page.getByTestId('panelTabSettings')).toHaveAttribute('aria-selected', 'true')
  await expect(page.getByTestId('panelSection-text')).toHaveAttribute('aria-expanded', 'true')
  await expect(page.getByTestId('panelSection-parallel')).toHaveAttribute('aria-expanded', 'false')
  await expect(page.getByTestId('panelSection-dictionary')).toHaveAttribute('aria-expanded', 'false')
  await page.getByTestId('theme-light').click()
  await expect(page.getByTestId('theme-light')).toHaveAttribute('aria-pressed', 'true')
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light')

  // B1–B7.
  await page.getByTestId('panel-font').click()
  await page.getByTestId('font-georgia').click()
  await expect(page.getByTestId('panel-font')).toContainText('Georgia')
  await tap(page, 'panel-fontSize-minus', 8)
  await expect(page.getByTestId('panel-fontSize-value')).toHaveText('14')
  await expect(page.getByTestId('panel-fontSize-minus')).toBeDisabled()
  await tap(page, 'panel-fontSize-plus', 4)
  await expect(page.getByTestId('panel-fontSize-value')).toHaveText('18')
  await tap(page, 'panel-lineSpacing-plus')
  await expect(page.getByTestId('panel-lineSpacing-value')).toHaveText('0,30')
  await tap(page, 'panel-sideMargin-plus', 2)
  await expect(page.getByTestId('panel-sideMargin-value')).toHaveText('60')
  await tap(page, 'panel-firstLineIndent-plus', 6)
  await expect(page.getByTestId('panel-firstLineIndent-value')).toHaveText('1,50')
  await tap(page, 'panel-paragraphSpacing-minus')
  await expect(page.getByTestId('panel-paragraphSpacing-value')).toHaveText('0,8')
  await tap(page, 'panel-justify')
  await expect(page.getByTestId('panel-justify')).toHaveAttribute('aria-checked', 'true')
  await expand(page, 'parallel')
  await expand(page, 'pronunciation')
  await expect(page.getByText('Офлайн-резерв Apple')).toHaveCount(0)
  await page.waitForTimeout(300)
  await page.screenshot({ path: 'build/visual/panel-settings.png' })
  await expand(page, 'dictionary')
  await page.getByTestId('manageDictionaries').scrollIntoViewIfNeeded()
  await page.screenshot({ path: 'build/visual/panel-dictionary.png' })

  // Closing by tapping the dimmed book keeps the reading position.
  await page.mouse.click(40, 600)
  await expect(page.getByTestId('readerPanel')).toBeHidden()
  if (positionBefore !== null) await expect(status).toHaveText(positionBefore)
  const boxAfter = await paragraph.boundingBox()
  expect(boxAfter).not.toEqual(boxBefore)
  const style = await paragraph.evaluate((el) => {
    const s = getComputedStyle(el)
    return { family: s.fontFamily, align: s.textAlign }
  })
  expect(style.family).toContain('Georgia')
  expect(style.align).toBe('justify')
  await page.screenshot({ path: 'build/visual/panel-justified-text.png' })

  // Contents tab from the contents button; swipe right closes.
  await page.getByTestId('contentsButton').click()
  await expect(page.getByTestId('panelTabContents')).toHaveAttribute('aria-selected', 'true')
  await expect(page.getByRole('listitem', { name: 'The Red-Headed League' })).toBeVisible()
  await page.screenshot({ path: 'build/visual/panel-contents.png' })
  const panel = page.getByTestId('readerPanel')
  const box = (await panel.boundingBox())!
  const y = box.y + box.height / 2
  await panel.dispatchEvent('pointerdown', { pointerType: 'touch', clientX: box.x + 60, clientY: y, pointerId: 1 })
  await panel.dispatchEvent('pointermove', { pointerType: 'touch', clientX: box.x + 200, clientY: y, pointerId: 1 })
  await panel.dispatchEvent('pointerup', { pointerType: 'touch', clientX: box.x + 300, clientY: y, pointerId: 1 })
  await expect(panel).toBeHidden()

  // Everything persists after relaunch.
  await openDemo(page, '?testTranslation&testSpeech&voice=openAI')
  await openPanel(page)
  await expect(page.getByTestId('theme-light')).toHaveAttribute('aria-pressed', 'true')
  await expect(page.getByTestId('panelSection-parallel')).toHaveAttribute('aria-expanded', 'true')
  await expect(page.getByTestId('panel-font')).toContainText('Georgia')
  await expect(page.getByTestId('panel-fontSize-value')).toHaveText('18')
  await expect(page.getByTestId('panel-firstLineIndent-value')).toHaveText('1,50')
  await expect(page.getByTestId('panel-justify')).toHaveAttribute('aria-checked', 'true')
})

test('вкладка «Зміст» переходить до розділу', async ({ page }) => {
  await openDemo(page, '?reset')
  await page.getByTestId('contentsButton').click()
  await page.getByRole('listitem', { name: 'The Red-Headed League' }).click()
  await expect(page.getByTestId('readerPanel')).toBeHidden()
  await expect(page.locator('[data-p="1"]')).toContainText('I had called upon my friend')
})
