// Ports of the training UI tests in EnglishReaderUITests/MainScenarioUITests.swift (stages 2.4–2.5).
import { expect, test, type Page } from '@playwright/test'
import { fixtureSavedWords } from '../../src/core/language.ts'

// allTextContents does not wait, so a fixture removed between two checks cannot stall a poll.
const fixture = async (page: Page) => ((await page.getByTestId('trainingFixture').allTextContents())[0] ?? '').split('|')

async function openTraining(page: Page, params: string) {
  await page.goto(`./?reset&testSavedWords&${params}`)
  await page.getByTestId('savedButton').click()
  await page.getByTestId('startTraining').click()
  await expect(page.getByTestId('trainingScreen')).toBeVisible()
}

async function solveReorderByTaps(page: Page, answer: string) {
  const tokens = answer.includes(' ') ? answer.split(' ') : [...answer]
  for (let target = 0; target < tokens.length; target++) {
    const tile = page.getByTestId(`tile-${target}`)
    if ((await tile.textContent()) === tokens[target]) continue
    let source = -1
    for (let index = target + 1; index < tokens.length; index++) {
      const text = await page.getByTestId(`tile-${index}`).textContent()
      if (text === tokens[target] && text !== tokens[index]) { source = index; break }
    }
    if (source < 0) continue
    await page.getByTestId(`tile-${source}`).click()
    await tile.click()
  }
}

test('повна сесія з помилками, клавіатурою та підсумком', async ({ page }) => {
  await openTraining(page, 'testRecording&voice=system')
  await page.getByTestId('trainingContinue').click()
  await expect(page.getByTestId(`introWord-${fixtureSavedWords[0][0]}`)).toBeVisible()
  await page.getByTestId(`introWord-${fixtureSavedWords[0][0]}`).click()
  await page.screenshot({ path: 'build/visual/training-intro.png' })
  await page.getByTestId('trainingStart').click()

  let failedOnce = false
  let typedOnce = false
  let reorderTyped = false
  let keyedOnce = false
  test.setTimeout(120_000)
  for (let steps = 0; steps < 40; steps++) {
    // Between words either the next exercise item or the summary appears.
    await expect.poll(async () => (await page.getByTestId('trainingTotals').count()) + (await page.getByTestId('trainingFixture').count()),
      { timeout: 5000 }).toBeGreaterThan(0)
    if (await page.getByTestId('trainingTotals').count()) break
    const before = (await fixture(page)).join('|')
    const [exerciseText, answer, correct] = before.split('|')
    const exercise = Number(exerciseText)
    if (exercise === 1 || exercise === 2) {
      if (exercise === 1 && !failedOnce) {
        failedOnce = true
        const wrong = page.locator(`[data-testid^="option-"]:not([data-testid="option-${correct}"])`)
        await wrong.nth(0).click()
        await wrong.nth(1).click()
        await expect(page.getByTestId('trainingRevealed')).toBeVisible()
        await page.screenshot({ path: 'build/visual/training-revealed.png' })
        await page.keyboard.press('Space')
      } else if (exercise === 2 && !keyedOnce) {
        keyedOnce = true
        const ids = await page.locator('[data-testid^="option-"]').evaluateAll((nodes) => nodes.map((n) => (n as HTMLElement).dataset.testid))
        await page.screenshot({ path: 'build/visual/training-numbered-options.png' })
        await page.keyboard.press(String(ids.indexOf(`option-${correct}`) + 1))
      } else {
        await page.getByTestId(`option-${correct}`).click()
      }
    } else if (exercise === 3) {
      if (!typedOnce) await page.screenshot({ path: 'build/visual/training-letters.png' })
      if (!typedOnce && !answer.includes(' ')) {
        typedOnce = true
        await page.getByTestId('keyboardInput').click()
        await page.getByTestId('lettersInput').pressSequentially(answer)
      } else {
        for (const token of answer.includes(' ') ? answer.split(' ') : [...answer]) {
          await page.getByTestId(`letter-${token}`).first().click()
        }
      }
    } else if (exercise === 5) {
      // Exercise 5 (on by default) is ungraded; skipping the last exercise must open the summary.
      await page.keyboard.press('0')
    } else {
      if (!reorderTyped && !answer.includes(' ')) {
        reorderTyped = true
        await page.screenshot({ path: 'build/visual/training-reorder.png' })
        if (!(await page.getByTestId('lettersInput').isVisible())) await page.getByTestId('keyboardInput').click()
        await page.getByTestId('lettersInput').pressSequentially(answer)
      } else {
        await solveReorderByTaps(page, answer)
      }
    }
    // Success advances on its own after a short pause.
    await expect.poll(async () => (await page.getByTestId('trainingTotals').isVisible())
      || !(await page.getByTestId('trainingFixture').count())
      || (await fixture(page)).join('|') !== before, { timeout: 5000, message: `step did not advance: ${before}` }).toBe(true)
  }
  expect(failedOnce).toBe(true)
  expect(reorderTyped).toBe(true)
  expect(keyedOnce).toBe(true)
  await expect(page.getByTestId('trainingTotals')).toContainText('Не знав: 1')
  await expect(page.getByTestId('repeatUnknown')).toBeVisible()
  await page.screenshot({ path: 'build/visual/training-summary.png' })
  await page.getByTestId('trainingDone').click()
  await expect(page.getByTestId('trainingScreen')).toHaveCount(0)
})

test('клавіші: 0 пропускає, пробіл відкриває поле, цифри в полі не є ходами', async ({ page }) => {
  await openTraining(page, 'testRecording&voice=system')
  await page.getByTestId('trainingContinue').click()
  await page.getByTestId('trainingStart').click()
  const title = page.getByTestId('exerciseTitle')
  await expect(title).toContainText('Вправа 1')
  await expect(page.getByTestId('skipExercise')).toHaveText('Пропустити вправу (0 або Esc)')
  await page.keyboard.press('0')
  await expect(title).toContainText('Вправа 2')
  await page.keyboard.press('Escape')
  await expect(title).toContainText('Вправа 3')

  // Single words get the keyboard button; phrases use word tiles without it.
  const keyboard = page.getByTestId('keyboardInput')
  for (let i = 0; i < 4 && !(await keyboard.isVisible()); i++) {
    for (const token of (await fixture(page))[1].split(' ')) await page.getByTestId(`letter-${token}`).first().click()
    await page.waitForTimeout(900)
  }
  await expect(keyboard).toHaveText('Ввести з клавіатури (пробіл)')
  await page.keyboard.press('Space')
  const field = page.getByTestId('lettersInput')
  await expect(field).toBeFocused()
  await page.screenshot({ path: 'build/visual/training-shortcuts.png' })
  const before = await page.getByTestId('lettersSlots').getAttribute('aria-label')
  await field.pressSequentially('7')
  await expect(page.getByTestId('trainingRevealed')).toHaveCount(0)
  expect(await page.getByTestId('lettersSlots').getAttribute('aria-label')).toBe(before)
  await expect(title).toContainText('Вправа 3')

  // 0 typed into the field still skips the exercise.
  await field.pressSequentially('0')
  await expect(title).toContainText('Вправа 4')

  // Exercise 4 starts again with the space hint; a phrase is solved by tapping tiles first.
  for (let i = 0; i < 2 && !(await keyboard.isVisible()); i++) {
    const current = (await fixture(page)).join('|')
    await solveReorderByTaps(page, current.split('|')[1])
    await expect.poll(async () => (await fixture(page)).join('|') !== current, { timeout: 3000 }).toBe(true)
  }
  await expect(keyboard).toHaveText('Ввести з клавіатури (пробіл)')
  await page.keyboard.press('Space')
  await expect(field).toBeFocused()
  // Two wrong letters reveal the answer; then space typed into the field presses «Далі».
  const answer = (await fixture(page))[1]
  const wrong = [...'zqxj'].find((ch) => !answer.includes(ch))!
  await field.pressSequentially(wrong + wrong)
  await expect(page.getByTestId('trainingRevealed')).toBeVisible()
  const revealed = (await fixture(page)).join('|')
  await page.keyboard.press('Space')
  await expect.poll(async () => !(await page.getByTestId('trainingRevealed').isVisible())
    || (await fixture(page)).join('|') !== revealed, { timeout: 3000 }).toBe(true)
})

async function onlyPronunciation(page: Page) {
  const fifth = page.getByTestId('trainingExercise-5')
  await expect(fifth).toHaveAttribute('aria-checked', 'true')
  for (let index = 1; index <= 4; index++) {
    const toggle = page.getByTestId(`trainingExercise-${index}`)
    await toggle.click()
    await expect(toggle).toHaveAttribute('aria-checked', 'false')
  }
  await page.getByTestId('trainingContinue').click()
  await page.getByTestId('trainingStart').click()
}

test('вправа 5: запис із колом, дії, «Далі» пробілом і підсумок', async ({ page }) => {
  await openTraining(page, 'testRecording&voice=system')
  await onlyPronunciation(page)
  await expect(page.getByTestId('exerciseTitle')).toHaveText('Вправа 1 з 1 · Вимова')
  const status = page.getByTestId('pronunciationStatus')
  await expect(status).toContainText('Говоріть', { timeout: 15000 })
  await page.screenshot({ path: 'build/visual/training-pronunciation-recording.png' })
  const next = page.getByTestId('pronunciationNext')
  await expect(next).toBeVisible({ timeout: 20000 })
  await expect(page.getByTestId('playMine')).toHaveText('Моя вимова (1)')
  await page.screenshot({ path: 'build/visual/training-pronunciation-ready.png' })
  await page.keyboard.press('1')
  await page.getByTestId('replayReference').click()
  await page.keyboard.press('3')
  await expect(status).toContainText('Говоріть', { timeout: 5000 })
  await expect(next).toBeVisible({ timeout: 20000 })
  const word = await page.getByTestId('pronunciationWord').textContent()
  await page.keyboard.press('Space')
  await expect.poll(async () => (await page.getByTestId('trainingTotals').isVisible())
    || (await page.getByTestId('pronunciationWord').textContent()) !== word, { timeout: 5000 }).toBe(true)
  // 0 skips the rest; skipping the last exercise must still open the summary.
  await page.keyboard.press('0')
  await expect(page.getByTestId('trainingTotals')).toContainText('Знав: 0')
})

test('вправа 5: зразок звучить до й після запису для кожного слова', async ({ page }) => {
  await openTraining(page, 'testRecording&voice=system')
  await onlyPronunciation(page)
  const next = page.getByTestId('pronunciationNext')
  const heard = page.getByTestId('pronunciationHeard')
  for (let word = 1; word <= 2; word++) {
    await expect(next).toBeVisible({ timeout: 40000 })
    await expect(heard, `word ${word}`).toHaveText('heard:2')
    await next.click()
  }
})
