// Prepared book (specs/013-prepared-book, D0): import `.reader.json` with its audio, the heard sentence is highlighted.
// Synthetic text and a silent WAV generated here (no third-party books or recordings).
import { createHash } from 'node:crypto'
import { expect, test, type Page } from '@playwright/test'
import type { Chapter } from '../../src/core/model/book.ts'
import { editionHash, PACKAGE_FORMAT, PACKAGE_VERSION, type ReaderPackage } from '../../src/core/prepared/package.ts'

function wav(seconds: number): Buffer {
  const samples = 8000 * seconds
  const buffer = Buffer.alloc(44 + samples * 2)
  buffer.write('RIFF', 0, 'ascii')
  buffer.writeUInt32LE(36 + samples * 2, 4)
  buffer.write('WAVEfmt ', 8, 'ascii')
  buffer.writeUInt32LE(16, 16)
  buffer.writeUInt16LE(1, 20)
  buffer.writeUInt16LE(1, 22)
  buffer.writeUInt32LE(8000, 24)
  buffer.writeUInt32LE(16000, 28)
  buffer.writeUInt16LE(2, 32)
  buffer.writeUInt16LE(16, 34)
  buffer.write('data', 36, 'ascii')
  buffer.writeUInt32LE(samples * 2, 40)
  return buffer
}

const chapters: Chapter[] = [{
  title: 'Synthetic',
  paragraphs: [
    { kind: 'text', sentences: ['First sentence here.', 'Second sentence here.'] },
    { kind: 'text', sentences: ['Third sentence here.'] },
  ],
}]

async function packageFiles() {
  const audio = wav(30)
  const pkg: ReaderPackage = {
    format: PACKAGE_FORMAT,
    version: PACKAGE_VERSION,
    packageId: 'synthetic',
    edition: await editionHash(chapters),
    language: 'en',
    translationLanguage: 'uk',
    book: { title: 'Synthetic book', author: 'Test', format: 'txt', chapters },
    translations: { '0-0': ['Перше речення.', 'Друге речення.'], '0-1': ['Третє речення.'] },
    tracks: [{ id: 't1', name: 'synthetic.wav', size: audio.length, sha256: createHash('sha256').update(audio).digest('hex') }],
    // 0–3 s: an introduction without text; the second paragraph from 20 s.
    sync: { '0-0': [['t1', 3, 10], ['t1', 10.2, 18]], '0-1': [['t1', 20, 28]] },
  }
  return [
    { name: 'synthetic.reader.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(pkg)) },
    { name: 'synthetic.wav', mimeType: 'audio/wav', buffer: audio },
  ]
}

const sentence = (page: Page, paragraph: number, s: number) => page.locator(`[data-p="${paragraph}"] .s[data-s="${s}"]`)

test('підготовлена книжка: імпорт з аудіо, підсвічування речення, яке звучить, і його переклад без дотику', async ({ page }) => {
  await page.route('https://api.openai.com/**', (route) => route.abort())
  await page.goto('./?reset')
  await page.getByTestId('importPreparedInput').setInputFiles(await packageFiles())
  await expect(page.getByTestId('readerScroll')).toBeVisible()
  await expect(page.getByTestId('audioBar')).toBeVisible()
  await expect(page.locator('.s.active')).toHaveCount(0)
  await expect(page.getByTestId('parallelTranslationHint')).toBeVisible()

  // Forward to 5 s: the first sentence and its translation from the package (requests to OpenAI are aborted here).
  await page.getByTestId('audioForward').click()
  await page.getByTestId('audioPlay').click()
  await expect(sentence(page, 0, 0)).toHaveClass(/active/, { timeout: 5_000 })
  await expect(page.getByTestId('translation-0-0-0')).toHaveText('Перше речення.')
  await page.getByTestId('audioPause').click()

  // Paused, seeking moves the highlight and the translation with the audio.
  for (let i = 0; i < 2; i++) await page.getByTestId('audioForward').click()
  await expect(sentence(page, 0, 1)).toHaveClass(/active/)
  await expect(page.getByTestId('translation-0-0-1')).toHaveText('Друге речення.')

  // A tapped sentence stays until the next one is heard.
  await sentence(page, 0, 0).locator('.w').first().click()
  await expect(page.getByTestId('translation-0-0-0')).toHaveText('Перше речення.')
  for (let i = 0; i < 2; i++) await page.getByTestId('audioForward').click()
  await expect(sentence(page, 1, 0)).toHaveClass(/active/)
  await expect(page.getByTestId('translation-0-1-0')).toHaveText('Третє речення.')
  await expect(page.locator('.s.active')).toHaveCount(1)
})

test('підготовлена книжка без аудіофайла не імпортується', async ({ page }) => {
  await page.goto('./?reset')
  const [pkg] = await packageFiles()
  await page.getByTestId('importPreparedInput').setInputFiles([pkg])
  await expect(page.getByText(/Виберіть разом з нею аудіофайли: synthetic\.wav/)).toBeVisible()
})
