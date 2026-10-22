// Audiobook player (specs/002-audio-player, stage A): adding files, scrubber, ±5 s, speed, tracks, place, removal.
import { expect, test, type Page } from '@playwright/test'

const demo = 'The Adventures of Sherlock Holmes (excerpt)'

/** Silent 8 kHz mono WAV generated in the test (no third-party recordings). */
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

async function openDemo(page: Page) {
  await page.route('https://api.openai.com/**', (route) => route.abort())
  await page.goto('./?reset')
  await page.getByTestId(`book-${demo}`).click()
  await expect(page.getByTestId('readerScroll')).toBeVisible()
}

async function addFiles(page: Page) {
  await page.getByTestId('audiobookMode').click()
  await expect(page.getByTestId('audioSheet')).toBeVisible()
  await page.getByTestId('audioInput').setInputFiles([
    { name: '02 Second.wav', mimeType: 'audio/wav', buffer: wav(90) },
    { name: '01 First.wav', mimeType: 'audio/wav', buffer: wav(120) },
    { name: 'cover.jpg', mimeType: 'image/jpeg', buffer: Buffer.from([1, 2, 3]) },
  ])
  await expect(page.getByTestId('audioTrack-1')).toBeVisible()
}

test('аудіокнига: додати файли, повзунок, ±5 с, швидкість, доріжки, місце після перезапуску', async ({ page }) => {
  await openDemo(page)
  await addFiles(page)
  await expect(page.getByTestId('audioTrack-0')).toContainText('01 First.wav')
  await expect(page.getByTestId('audioTrack-1')).toContainText('02 Second.wav')
  await expect(page.getByTestId('audioTracks').locator('li')).toHaveCount(2)
  await expect(page.getByTestId('audioStorage')).toContainText('МБ')
  await page.screenshot({ path: 'build/visual/audiobook-sheet.png' })
  await page.getByTestId('audioSheetDone').click()

  const bar = page.getByTestId('audioBar')
  await expect(bar).toBeVisible()
  await expect(page.getByTestId('audioTrackButton')).toHaveText('Доріжка 1 з 2')
  await expect(page.getByTestId('audioDuration')).toHaveText('2:00')
  // The scrubber spans the window width.
  const scrubber = (await page.getByTestId('audioScrubber').boundingBox())!
  expect(scrubber.width).toBeGreaterThan(page.viewportSize()!.width * 0.7)

  await page.getByTestId('audioPlay').click()
  await expect(page.getByTestId('audioPause')).toBeVisible()
  await expect(page.getByTestId('audioTime')).not.toHaveText('0:00', { timeout: 5_000 })

  // Drag to the middle: the time bubble follows the finger, the place changes on release.
  const y = scrubber.y + scrubber.height / 2
  await page.mouse.move(scrubber.x + 4, y)
  await page.mouse.down()
  await page.mouse.move(scrubber.x + scrubber.width / 2, y, { steps: 6 })
  await expect(page.getByTestId('scrubberBubble')).toHaveText(/^0:59|1:00$/)
  await page.screenshot({ path: 'build/visual/audiobook-bar.png' })
  await page.mouse.up()
  await expect(page.getByTestId('scrubberBubble')).toHaveCount(0)
  await expect(page.getByTestId('audioTime')).toHaveText(/^1:0[0-2]$/)

  await page.getByTestId('audioBack').click()
  await expect(page.getByTestId('audioTime')).toHaveText(/^0:5[5-9]$/)
  await page.getByTestId('audioForward').click()
  await expect(page.getByTestId('audioTime')).toHaveText(/^1:0[0-4]$/)

  await page.getByTestId('audioPause').click()
  await expect(page.getByTestId('audioPlay')).toBeVisible()

  // Speed from a menu of four values. Chosen while paused: Playwright's WebKit stops opening any audio file once a file
  // played at a speed other than 1× was paused (Chromium does not); the switch while playing is checked below.
  await page.getByTestId('audioRate').click()
  await expect(page.getByRole('menuitem')).toHaveText(['0,75×', '0,9×', '1,0×', '1,15×'])
  await page.waitForTimeout(400)
  await page.screenshot({ path: 'build/visual/audiobook-rate.png' })
  await page.getByTestId('audioRate-0.9').click()
  await expect(page.getByRole('menu')).toHaveCount(0)
  await expect(page.getByTestId('audioRate')).toHaveText('0,9×')

  // Second track from the sheet.
  await page.getByTestId('audioTrackButton').click()
  await page.getByTestId('selectTrack-1').click()
  await page.getByTestId('audioSheetDone').click()
  await expect(page.getByTestId('audioTrackButton')).toHaveText('Доріжка 2 з 2')
  await expect(page.getByTestId('audioDuration')).toHaveText('1:30')
  const scrubber2 = (await page.getByTestId('audioScrubber').boundingBox())!
  await page.mouse.click(scrubber2.x + scrubber2.width / 3, scrubber2.y + scrubber2.height / 2)
  await expect(page.getByTestId('audioTime')).toHaveText(/^0:(29|30|31)$/)
  await page.waitForTimeout(300)

  // The place survives a relaunch.
  await page.goto('./')
  await page.getByTestId(`book-${demo}`).click()
  await expect(page.getByTestId('audioTrackButton')).toHaveText('Доріжка 2 з 2')
  await expect(page.getByTestId('audioTime')).toHaveText(/^0:(29|30|31)$/)
  await expect(page.getByTestId('audioRate')).toHaveText('0,9×')
})

test('аудіокнига: перемикання на голос, видалення доріжки й усього аудіо', async ({ page }) => {
  await openDemo(page)
  await addFiles(page)
  await page.getByTestId('removeTrack-0').click()
  await expect(page.getByTestId('audioTracks').locator('li')).toHaveCount(1)
  await expect(page.getByTestId('audioTrack-0')).toContainText('02 Second.wav')
  await page.getByTestId('audioSheetDone').click()
  await expect(page.getByTestId('audioTrackButton')).toHaveText('Аудіокнига')

  await page.getByTestId('voiceMode').click()
  await expect(page.getByTestId('playButton')).toBeVisible()
  await page.getByTestId('audiobookMode').click()
  await expect(page.getByTestId('audioBar')).toBeVisible()

  await page.getByTestId('audioTrackButton').click()
  await page.getByTestId('removeAllAudio').click()
  await page.getByTestId('confirmRemoveAudio').click()
  await expect(page.getByTestId('audioTracks')).toHaveCount(0)
  await page.getByTestId('audioSheetDone').click()
  await expect(page.getByTestId('playButton')).toBeVisible()
  await expect(page.getByTestId('audioBar')).toHaveCount(0)
})

test('аудіокнига: перехід на іншу доріжку під час відтворення на швидкості 0,9×', async ({ page }) => {
  await openDemo(page)
  await addFiles(page)
  await page.getByTestId('audioSheetDone').click()
  await page.getByTestId('audioPlay').click()
  await expect(page.getByTestId('audioPause')).toBeVisible()
  await page.getByTestId('audioRate').click()
  await page.getByTestId('audioRate-0.9').click()
  await expect(page.getByTestId('audioTime')).not.toHaveText('0:00', { timeout: 5_000 })
  await page.getByTestId('audioTrackButton').click()
  await page.getByTestId('selectTrack-1').click()
  await page.getByTestId('audioSheetDone').click()
  await expect(page.getByTestId('audioTrackButton')).toHaveText('Доріжка 2 з 2')
  await expect(page.getByTestId('audioDuration')).toHaveText('1:30')
  await expect(page.getByTestId('audioPause')).toBeVisible()
  await expect(page.getByTestId('audioTime')).not.toHaveText('0:00', { timeout: 5_000 })
})
