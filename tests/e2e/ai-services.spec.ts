import { expect, test } from '@playwright/test'

test.beforeEach(async ({ page }) => {
  await page.route('https://api.openai.com/**', (route) => route.abort())
})

test('ключ зберігається й видаляється, стан переживає перезапуск', async ({ page }) => {
  await page.goto('./?reset')
  await page.getByTestId('settingsButton').click()
  const sheet = page.getByTestId('aiServices')
  await expect(sheet).toBeVisible()
  await expect(sheet.getByRole('heading', { name: 'ШІ-сервіси' })).toBeVisible()
  await expect(page.getByTestId('saveKey')).toBeDisabled()
  await page.getByTestId('apiKeyField').fill('  test-key-placeholder  ')
  await page.getByTestId('saveKey').click()
  await expect(page.getByTestId('keyState')).toHaveText('збережено на цьому пристрої')
  await page.getByTestId('settingsDone').click()
  await expect(sheet).toBeHidden()

  await page.goto('./')
  await page.getByTestId('settingsButton').click()
  await expect(page.getByTestId('keyState')).toBeVisible()
  await page.getByTestId('deleteKey').click()
  await expect(page.getByTestId('apiKeyField')).toBeVisible()

  await page.goto('./')
  await page.getByTestId('settingsButton').click()
  await expect(page.getByTestId('apiKeyField')).toBeVisible()
})

test('перевірка перекладу без ключа пояснює, що робити', async ({ page }) => {
  await page.goto('./?reset')
  await page.getByTestId('settingsButton').click()
  await page.getByTestId('checkTranslation').click()
  await expect(page.getByTestId('checkResult')).toHaveText('Не вказано ключ OpenAI. Додайте його в Налаштуваннях.')
})

test('моделі мають типові значення й зберігаються', async ({ page }) => {
  await page.goto('./?reset')
  await page.getByTestId('settingsButton').click()
  await expect(page.getByTestId('textModelField')).toHaveValue('gpt-5.4-mini')
  await expect(page.getByTestId('ttsModelField')).toHaveValue('gpt-4o-mini-tts')
  await expect(page.getByText('Типово: gpt-5.4-mini для перекладу й карток слів, gpt-4o-mini-tts для озвучення.')).toBeVisible()
  await page.getByTestId('textModelField').fill('gpt-5.4')
  await page.goto('./')
  await page.getByTestId('settingsButton').click()
  await expect(page.getByTestId('textModelField')).toHaveValue('gpt-5.4')
  await page.waitForTimeout(400)
  await page.screenshot({ path: 'build/visual/ai-services.png' })
})

test('версія застосунку: дата, час і коміт збірки, та сама, що в service worker (specs/007-version)', async ({ page }) => {
  await page.goto('./?reset')
  await page.getByTestId('settingsButton').click()
  const version = page.getByTestId('appVersion')
  await version.scrollIntoViewIfNeeded()
  await expect(version).toHaveText(/^\d{2}\.\d{2}\.\d{4} \d{2}:\d{2}( · [0-9a-f]{7,})?$/)
  const worker = await page.evaluate(() => fetch('./sw.js').then((r) => r.text()))
  expect(worker).toContain(`'shell-${await version.textContent()}'`)
})
