import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { render } from 'preact'
import { act } from 'preact/test-utils'
import { TrainingScreen } from '../../src/ui/training/TrainingScreen.tsx'
import { removeAllForTests, seedForTests, words } from '../../src/core/saved/saved.ts'
import { resetAllSettings, settings } from '../../src/core/storage/settings.ts'

let root: HTMLElement

// The training is a full-screen cover rendered into a portal on <body>.
const byTestID = (id: string) => document.querySelector<HTMLElement>(`[data-testid="${id}"]`)
const fixture = () => (byTestID('trainingFixture')?.textContent ?? '').split('|')
const title = () => byTestID('exerciseTitle')?.textContent ?? ''

async function click(id: string) {
  const element = byTestID(id)
  expect(element, id).toBeTruthy()
  await act(async () => { element!.click() })
}

async function key(value: string) {
  await act(async () => {
    document.dispatchEvent(new KeyboardEvent('keydown', { key: value, bubbles: true, cancelable: true }))
  })
}

async function startTraining() {
  await act(async () => { render(<TrainingScreen onClose={() => {}} />, root) })
  await click('trainingContinue')
  await click('trainingStart')
}

beforeEach(() => {
  resetAllSettings()
  settings.voiceEngine.value = 'system'
  root = document.createElement('div')
  document.body.appendChild(root)
})

afterEach(async () => {
  await act(async () => { render(null, root) })
  root.remove()
  removeAllForTests()
})

describe('TrainingScreen', () => {
  it('needs at least four saved words', async () => {
    removeAllForTests()
    await act(async () => { render(<TrainingScreen onClose={() => {}} />, root) })
    expect(byTestID('trainingNotEnough')?.textContent).toContain('щонайменше 4 збережені слова')
    expect(byTestID('trainingContinue')).toBeNull()
  })

  it('chooses an option with a number key and reveals the answer after two mistakes', async () => {
    seedForTests()
    expect(words.value.length).toBe(4)
    await startTraining()
    expect(title()).toMatch(/^Вправа 1 з 4 · Почути й вибрати переклад/)

    // Number key of the correct option: exercise 1 asks for the translation.
    let [exercise, , correct] = fixture()
    expect(exercise).toBe('1')
    const options = [...document.querySelectorAll<HTMLButtonElement>('[data-testid^="option-"]')]
    const index = options.findIndex((o) => o.dataset.testid === `option-${correct}`)
    await key(String(index + 1))
    expect(byTestID('trainingSolved')?.textContent).toContain('Знав')
    await act(async () => { await new Promise((r) => setTimeout(r, 800)) })

    // Two wrong options reveal the answer; space presses «Далі».
    ;[exercise, , correct] = fixture()
    const wrong = [...document.querySelectorAll<HTMLButtonElement>('[data-testid^="option-"]')]
      .filter((o) => o.dataset.testid !== `option-${correct}`)
    await act(async () => { wrong[0].click() })
    await act(async () => { wrong[1].click() })
    expect(byTestID('trainingRevealed')?.textContent).toContain(`Правильно: ${correct}`)
    expect(wrong[0].disabled).toBe(true)
    const before = fixture().join('|')
    await key(' ')
    expect(fixture().join('|')).not.toBe(before)
  })

  it('skips exercises with 0 and Esc and shows the summary', async () => {
    seedForTests()
    await startTraining()
    await key('0')
    expect(title()).toMatch(/^Вправа 2 з 4/)
    await key('Escape')
    expect(title()).toMatch(/^Вправа 3 з 4/)
    await key('0')
    await key('0')
    expect(byTestID('trainingTotals')?.textContent).toContain('Знав: 0')
    expect(byTestID('trainingTotals')?.textContent).toContain('Не знав: 0')
    expect(byTestID('trainingDone')).toBeTruthy()
  })

  it('types the word from the keyboard in exercise 3 and ignores digits in the field', async () => {
    seedForTests()
    settings.trainingExercises.value = '3'
    await startTraining()
    // Phrases use word tiles; solve them by tapping until a single word comes.
    for (let i = 0; i < 4 && !byTestID('keyboardInput'); i++) {
      for (const token of fixture()[1].split(' ')) {
        await act(async () => { document.querySelector<HTMLElement>(`[data-testid="letter-${token}"]`)!.click() })
      }
      await act(async () => { await new Promise((r) => setTimeout(r, 800)) })
    }
    expect(byTestID('keyboardInput')?.textContent).toContain('Ввести з клавіатури (пробіл)')
    await key(' ')
    const field = document.querySelector<HTMLInputElement>('[data-testid="lettersInput"]')!
    expect(field).toBeTruthy()
    const slots = byTestID('lettersSlots')!.getAttribute('aria-label')
    await act(async () => {
      field.value = '7'
      field.dispatchEvent(new Event('input', { bubbles: true }))
    })
    expect(byTestID('trainingRevealed')).toBeNull()
    expect(byTestID('lettersSlots')!.getAttribute('aria-label')).toBe(slots)
    const answer = fixture()[1]
    await act(async () => {
      field.value = '7' + answer
      field.dispatchEvent(new Event('input', { bubbles: true }))
    })
    expect(byTestID('trainingSolved')).toBeTruthy()
  })
})
