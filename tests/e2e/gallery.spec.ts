import { expect, test } from '@playwright/test'

// Design-system showcase (T16): snapshots for visual review and the 44 pt hit-target rule.
// Exception documented in components.css: stepper buttons are 46×36 like the Swift StepRow
// (28×32 label in a .bordered button); their 44 pt target is the whole row.
for (const theme of ['light', 'sepia', 'dark'] as const) {
  test(`вітрина компонентів — тема ${theme}`, async ({ page }) => {
    await page.goto(`./?gallery&theme=${theme}`)
    await expect(page.getByRole('heading', { name: 'Компоненти' })).toBeVisible()
    await expect(page.locator('html')).toHaveAttribute('data-theme', theme)
    await page.waitForTimeout(400)
    await page.screenshot({ path: `build/visual/gallery-${theme}.png`, fullPage: true })
  })
}

test('цілі дотику не менші за 44 pt', async ({ page }) => {
  await page.goto('./?gallery')
  const small = await page.evaluate(() => {
    const result: string[] = []
    for (const el of document.querySelectorAll<HTMLElement>('button, [role="switch"]')) {
      if (el.classList.contains('stepper-btn')) continue
      const rect = el.getBoundingClientRect()
      if (rect.width === 0) continue
      const target = el.matches('.switch') ? rect.height + 14 : el.matches('.btn') ? rect.height + 10 : rect.height
      const label = el.getAttribute('aria-label') ?? el.textContent?.trim() ?? el.className
      const minHeight = el.matches('.btn-small, .segment, .gallery-theme, .search-clear') ? 28 : 44
      if (target < minHeight - 0.5) result.push(`${label}: ${Math.round(rect.height)}`)
    }
    return result
  })
  expect(small).toEqual([])
})

test('накладки відкриваються й закриваються', async ({ page }) => {
  await page.goto('./?gallery')
  await page.getByRole('button', { name: 'Панель' }).click()
  const panel = page.getByTestId('readerPanel')
  await expect(panel).toBeVisible()
  expect(Math.round((await panel.boundingBox())!.width)).toBe(420)
  await page.waitForTimeout(450)
  await page.screenshot({ path: 'build/visual/gallery-panel.png' })
  await page.getByTestId('panelBackdrop').click({ position: { x: 100, y: 300 } })
  await expect(panel).toBeHidden()

  await page.getByRole('button', { name: 'Аркуш', exact: true }).click()
  await expect(page.getByRole('dialog', { name: 'Картка слова' })).toBeVisible()
  await page.waitForTimeout(450)
  await page.screenshot({ path: 'build/visual/gallery-sheet.png' })
  await page.keyboard.press('Escape')
  await expect(page.getByRole('dialog', { name: 'Картка слова' })).toBeHidden()

  await page.getByRole('button', { name: 'Діалог' }).click()
  await expect(page.getByRole('alertdialog')).toBeVisible()
  await page.waitForTimeout(450)
  await page.screenshot({ path: 'build/visual/gallery-dialog.png' })
  await page.getByRole('button', { name: 'Скасувати' }).click()
  await expect(page.getByRole('alertdialog')).toBeHidden()

  await page.getByRole('button', { name: 'Розмір шрифту' }).count()
  const minus = page.getByTestId('panel-fontSize-minus')
  for (let i = 0; i < 8; i++) await minus.click()
  await expect(page.getByTestId('panel-fontSize-value')).toHaveText('14')
  await expect(minus).toBeDisabled()
})
