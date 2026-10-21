import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render } from 'preact'
import { act } from 'preact/test-utils'
import { resetAllSettings, settings } from '../../src/core/storage/settings.ts'
import { WordCard, type WordCardProps } from '../../src/ui/word/WordCard.tsx'
import type { WordLookup } from '../../src/ui/reader/types.ts'

const card = {
  headword: 'woman', lemma: 'woman', ipa: 'ˈwʊmən', partOfSpeech: 'іменник', contextTranslation: 'жінка',
  otherTranslations: ['дружина', 'служниця'], note: '', level: 'A1', forms: 'woman — women', irregular: true,
}

function lookup(overrides: Partial<WordLookup> = {}): WordLookup {
  return {
    id: 1, word: 'woman', sentence: 'To Sherlock Holmes she is always the woman.',
    ref: { paragraph: { chapter: 0, paragraph: 1 }, sentence: 0 }, card, error: null, needsSettings: false,
    explanation: null, explaining: false, explanationError: null, explanationNeedsSettings: false, ...overrides,
  }
}

let root: HTMLDivElement

function mount(props: Partial<WordCardProps> = {}) {
  const all: WordCardProps = {
    lookup: lookup(), notice: null, saved: false, onToggleSave: vi.fn(), onPronounce: vi.fn(), onExplain: vi.fn(),
    onOpenSettings: vi.fn(), onClose: vi.fn(), ...props,
  }
  act(() => render(<WordCard {...all} />, root))
  return all
}

const byID = (id: string) => document.querySelector(`[data-testid="${id}"]`) as HTMLElement | null

beforeEach(() => {
  resetAllSettings()
  root = document.createElement('div')
  document.body.appendChild(root)
})

afterEach(() => {
  act(() => render(null, root))
  document.body.innerHTML = ''
})

describe('WordCard', () => {
  it('shows level, forms, context translation and default dictionaries', () => {
    mount()
    expect(byID('wordHeadword')?.textContent).toBe('woman')
    expect(byID('wordLevel')?.getAttribute('aria-label')).toBe('Рівень A1')
    expect(byID('wordForms')?.textContent).toBe('woman — women')
    expect(byID('wordIrregular')).not.toBeNull()
    expect(byID('wordContextTranslation')?.textContent).toBe('жінка')
    const ids = [...document.querySelectorAll('[data-testid^="dictionary-"]')].map((e) => e.getAttribute('data-testid'))
    expect(ids).toEqual(['dictionary-cambridge', 'dictionary-reverso', 'dictionary-google', 'dictionary-deepl', 'dictionary-glosbe'])
  })

  it('hides level and forms by settings and follows dictionary order', () => {
    settings.showWordLevel.value = false
    settings.showWordForms.value = false
    settings.dictionaryOrder.value = 'forvo,glosbe'
    settings.enabledDictionaries.value = 'glosbe,forvo'
    mount()
    expect(byID('wordLevel')).toBeNull()
    expect(byID('wordForms')).toBeNull()
    const ids = [...document.querySelectorAll('[data-testid^="dictionary-"]')].map((e) => e.getAttribute('data-testid'))
    expect(ids).toEqual(['dictionary-forvo', 'dictionary-glosbe'])
  })

  it('save, pronounce and explain call back; label follows saved state', () => {
    const props = mount()
    expect(byID('saveWordButton')?.textContent).toBe('Зберегти')
    byID('saveWordButton')!.click()
    expect(props.onToggleSave).toHaveBeenCalledOnce()
    byID('pronounceButton')!.click()
    expect(props.onPronounce).toHaveBeenCalledWith('woman')
    byID('explainButton')!.click()
    expect(props.onExplain).toHaveBeenCalledWith(false)
    mount({ saved: true, lookup: lookup({ explanation: 'Пояснення.' }) })
    expect(byID('saveWordButton')?.textContent).toBe('Збережено')
    expect(byID('wordExplanation')?.textContent).toBe('Пояснення.')
    byID('explainAgainButton')!.click()
  })

  it('applies the card scale and shows loading and errors', () => {
    settings.wordCardScale.value = 1.3
    mount({ lookup: lookup({ card: null }) })
    expect(byID('wordCardContent')?.style.getPropertyValue('--card-scale')).toBe('1.3')
    expect(byID('wordLoading')?.textContent).toContain('Шукаю значення в контексті…')
    expect(byID('saveWordButton')).toBeNull()
    const props = mount({ lookup: lookup({ card: null, error: 'Не вказано ключ OpenAI.', needsSettings: true }) })
    expect(byID('wordError')?.textContent).toContain('Не вказано ключ OpenAI.')
    byID('wordOpenSettings')!.click()
    expect(props.onOpenSettings).toHaveBeenCalledOnce()
  })
})
