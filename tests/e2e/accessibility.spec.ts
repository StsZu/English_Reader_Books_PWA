// A narrow window and the reader without touch (specs/008-phone-accessibility, A1–A4).
import { expect, test, type Page } from '@playwright/test'
import { settingsPrefix, sourceLanguage } from '../../src/core/language.ts'
import { demoBook } from '../fixtures/language.ts'

const demo = demoBook.title
const p = demoBook.paragraph

async function openDemo(page: Page, query = '', settings: Record<string, unknown> = {}) {
  await page.route('https://api.openai.com/**', (route) => route.abort())
  await page.goto(`./?reset&${query}`)
  if (Object.keys(settings).length > 0) {
    // «?reset» clears the settings too: they are set after it.
    await expect(page.getByTestId(`book-${demo}`)).toBeVisible()
    await page.evaluate(({ prefix, values }) => {
      for (const [key, value] of Object.entries(values)) localStorage.setItem(prefix + key, JSON.stringify(value))
    }, { prefix: settingsPrefix, values: settings })
    await page.goto(`./?${query}`)
  }
  await page.getByTestId(`book-${demo}`).click()
  await expect(page.getByTestId('readerScroll')).toBeVisible()
}

type Box = { x: number; y: number; width: number; height: number }
const overlap = (a: Box, b: Box) =>
  a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height

for (const [width, height] of [[320, 700], [390, 844], [834, 1194]]) {
  test(`верхня панель читалки на ${width} px: назва не накриває кнопок, усі кнопки на екрані`, async ({ page }) => {
    await page.setViewportSize({ width, height })
    await openDemo(page)
    const title = (await page.locator('.navbar-title').boundingBox())!
    const ids = ['backButton', 'contentsButton', 'translationToggle', 'appearanceButton', 'readerSettingsButton']
    for (const id of ids) {
      const button = (await page.getByTestId(id).boundingBox())!
      expect(overlap(title, button), id).toBe(false)
      expect(button.x).toBeGreaterThanOrEqual(0)
      expect(button.x + button.width).toBeLessThanOrEqual(width)
      expect(button.width).toBeGreaterThanOrEqual(44)
    }
    const label = page.getByTestId('backButton').locator('span')
    if (width < 600) await expect(label).toBeHidden()
    else await expect(label).toHaveText('Мої книжки')
    await page.getByTestId('contentsButton').click()
    await expect(page.getByTestId('readerPanel')).toBeVisible()
  })
}

test('відступи від країв поступаються тексту у вузькому вікні й не змінюються на iPad', async ({ page }) => {
  const side = () => page.locator('.reader-column').evaluate((el) => getComputedStyle(el).paddingLeft)
  await page.setViewportSize({ width: 390, height: 844 })
  await openDemo(page, '', { fontSize: 40, sideMargin: 120 })
  expect(await side()).toBe('0px')
  await page.setViewportSize({ width: 834, height: 1194 })
  expect(await side()).toBe('120px')
})

test('відступ, якому вистачає місця, лишається як задано', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await openDemo(page, '', { fontSize: 20, sideMargin: 40 })
  expect(await page.locator('.reader-column').evaluate((el) => getComputedStyle(el).paddingLeft)).toBe('40px')
})

test('лише клавіатурою: речення → переклад → слово → картка → «Зберегти»', async ({ page }) => {
  await openDemo(page, 'testTranslation&testWordCard')
  const translation = page.getByTestId(`translation-0-${p}-0`)
  for (let i = 0; i < 10 && !(await translation.isVisible()); i++) {
    await page.keyboard.press('ArrowDown')
    await page.waitForTimeout(150)
  }
  await expect(translation).toBeVisible()
  await expect(page.locator(`[data-p="${p}"] [data-s="0"]`)).toHaveClass(/active/)

  await page.keyboard.press('Alt+ArrowRight')
  await page.keyboard.press('Alt+ArrowRight')
  const second = page.locator(`[data-p="${p}"] [data-s="0"] .w[data-w="1"]`)
  await expect(second).toHaveClass(/cursor/)
  await page.keyboard.press('Alt+ArrowLeft')
  const first = page.locator(`[data-p="${p}"] [data-s="0"] .w[data-w="0"]`)
  await expect(first).toHaveClass(/cursor/)
  const headword = await first.textContent()

  await page.keyboard.press('Enter')
  await expect(page.getByTestId('wordCard')).toBeVisible()
  await expect(page.getByTestId('wordHeadword')).toHaveText(new RegExp(headword!, 'i'))
  await page.getByTestId('saveWordButton').click()
  await expect(page.getByTestId('saveWordButton')).toHaveText(/Збережено/)
  await page.keyboard.press('Escape')
  await expect(page.getByTestId('wordCard')).toBeHidden()

  await page.keyboard.press('Escape')
  await expect(page.locator('.w.cursor')).toHaveCount(0)
  await page.keyboard.press('ArrowDown')
  await expect(page.getByTestId(`translation-0-${p}-1`)).toBeVisible()
})

test('мова тексту книжки, заголовки розділів і оголошення перекладу', async ({ page }) => {
  await openDemo(page)
  await expect(page.locator('html')).toHaveAttribute('lang', 'uk')
  await expect(page.getByTestId(`paragraph-${p}`)).toHaveAttribute('lang', sourceLanguage)
  const heading = page.locator('.para.heading').first()
  await expect(heading).toHaveAttribute('role', 'heading')
  await expect(heading).toHaveAttribute('aria-level', '2')
  await expect(page.locator('.navbar-title span')).toHaveAttribute('lang', sourceLanguage)
  await expect(page.locator('.pane-row')).toHaveAttribute('aria-live', 'polite')
})

// The top paragraph is read at the line scrollToParagraph puts it at: a small gap between paragraphs
// no longer moves the reader a paragraph back on every layout change (audit 2026-11-20, finding 1).
for (const settings of [{ paragraphSpacingFactor: 0 }, { fontSize: 14 }]) {
  test(`місце читання не зсувається після зміни розкладки (${JSON.stringify(settings)})`, async ({ page }) => {
    await page.setViewportSize({ width: 834, height: 400 })
    await openDemo(page, '', settings)
    // A paragraph far enough from the chapter end that the scroll is never clamped when the translation pane changes size.
    const index = await page.getByTestId('readerScroll').evaluate((el) => {
      const room = el.scrollHeight - el.clientHeight - 200
      const fits = [...el.querySelectorAll<HTMLElement>('[data-p]')].filter((p) => p.offsetTop - 28 <= room)
      const target = fits[fits.length - 1]
      el.scrollTop = target.offsetTop - 28
      return Number(target.dataset.p)
    })
    expect(index).toBeGreaterThan(0)
    const status = new RegExp(`· абзац ${index + 1}$`)
    await expect(page.getByTestId('playbackStatus')).toHaveText(status)
    for (let i = 0; i < 4; i++) {
      await page.getByTestId('translationToggle').click()
      await page.waitForTimeout(200)
      await expect(page.getByTestId('playbackStatus')).toHaveText(status)
    }
  })
}

// One Esc closes only the top overlay (audit 2026-11-20, finding 2).
test('Esc закриває лише верхнє вікно', async ({ page }) => {
  await page.goto('./?reset')
  await page.getByTestId('settingsButton').click()
  await page.getByTestId('saveBackup').click()
  await expect(page.getByTestId('backupPrepared')).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(page.getByTestId('backupPrepared')).toBeHidden()
  await expect(page.getByTestId('saveBackup')).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(page.getByTestId('saveBackup')).toBeHidden()
})
