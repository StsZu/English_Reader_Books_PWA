// SC-09 / T50: after the first visit the installed app starts without network.
// Runs in Chromium: Playwright's WebKit cannot load pages offline or route through a service worker;
// Safari itself is checked by hand on the iPad (T61).
import { expect, test } from '@playwright/test'
import { demoBook } from '../fixtures/language.ts'

const demo = demoBook.title
const p = demoBook.paragraph

test('після першого відвідування застосунок працює без мережі', async ({ page, context }) => {
  await page.route('https://api.openai.com/**', (route) => route.abort())
  await page.goto('./?reset&testTranslation')
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready
    if (!navigator.serviceWorker.controller) {
      await new Promise((resolve) => navigator.serviceWorker.addEventListener('controllerchange', resolve, { once: true }))
    }
  })
  // A translation fetched online stays available offline.
  await page.getByTestId(`book-${demo}`).click()
  await page.locator(`[data-p="${p}"] .w`).first().click()
  await expect(page.getByTestId(`translation-0-${p}-0`)).toBeVisible()
  await page.getByTestId('backButton').click()

  // The precache holds the shell; then the network goes away and the worker answers everything.
  const shell = await page.evaluate(async () => {
    const keys = await caches.keys()
    const cache = await caches.open(keys.find((k) => k.startsWith('shell-'))!)
    return (await cache.keys()).map((r) => new URL(r.url).pathname)
  })
  expect(shell).toEqual(expect.arrayContaining(['/', '/demo.md', '/manifest.webmanifest']))
  expect(shell.some((p) => p.startsWith('/assets/') && p.endsWith('.js'))).toBe(true)
  await context.setOffline(true)
  await page.reload()
  await expect(page.getByRole('heading', { name: 'Мої книжки' })).toBeVisible()
  await page.getByTestId(`book-${demo}`).click()
  await expect(page.getByTestId('readerScroll')).toBeVisible()
  await page.locator(`[data-p="${p}"] .w`).first().click()
  await expect(page.getByTestId(`translation-0-${p}-0`)).toBeVisible()

  // A new (uncached) paragraph without the test provider would need the network:
  // the real provider reports the missing key first, so check the offline mapping in unit tests (ai.test.ts).
})
