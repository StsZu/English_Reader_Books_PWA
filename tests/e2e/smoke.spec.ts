import { expect, test } from '@playwright/test'

test('застосунок відкривається на бібліотеці', async ({ page }) => {
  await page.goto('./?reset')
  await expect(page.getByRole('heading', { name: 'Мої книжки' })).toBeVisible()
})
