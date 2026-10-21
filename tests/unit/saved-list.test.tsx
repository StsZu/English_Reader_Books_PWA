import { render } from 'preact'
import { act } from 'preact/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { WordCard } from '../../src/contracts.ts'
import { quotes, removeAllForTests, saveQuote, saveWord, words, type SavedPlace } from '../../src/core/saved/saved.ts'
import { trainingOpen } from '../../src/app/router.ts'
import { SavedList, trainingStatus } from '../../src/ui/saved/SavedList.tsx'
import { wordsFile } from '../../src/ui/saved/export.ts'

const card = (word: string, translation: string): WordCard => ({
  headword: word, lemma: word, ipa: 'ˈwʊmən', partOfSpeech: 'іменник', contextTranslation: translation,
  otherTranslations: ['дружина'], note: '', level: 'A1', forms: '', irregular: false,
})

const BOOK = 'BOOK-A'
const OTHER = 'BOOK-B'
const GONE = 'BOOK-GONE'
const place = (bookID: string, bookTitle: string, sentence = 0): SavedPlace =>
  ({ bookID, bookTitle, chapter: 0, paragraph: 1, sentence })

let root: HTMLDivElement

async function mount(props: Partial<Parameters<typeof SavedList>[0]> = {}) {
  const onOpen = vi.fn()
  await act(() => {
    render(
      <SavedList
        currentBookID={BOOK}
        existingBooks={new Set([BOOK, OTHER])}
        canOpen={(p) => p.bookID === BOOK}
        onOpen={onOpen}
        {...props}
      />,
      root,
    )
  })
  return onOpen
}

const q = (id: string) => root.querySelector<HTMLElement>(`[data-testid="${id}"]`)
const all = (id: string) => Array.from(root.querySelectorAll<HTMLElement>(`[data-testid="${id}"]`))
const click = async (el: HTMLElement | null) => { await act(() => { el!.click() }) }
async function type(id: string, text: string) {
  const input = q(id) as HTMLInputElement
  await act(() => {
    input.value = text
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

beforeEach(async () => {
  await removeAllForTests()
  await saveWord(card('woman', 'жінка'), 'She is always the woman.', place(BOOK, 'Holmes'))
  await saveWord(card('river', 'річка'), 'The river ran.', place(OTHER, 'Other'))
  await saveWord(card('bright', 'яскравий'), 'A bright day.', place(GONE, 'Gone'))
  await saveQuote('the woman. I have seldom', 'жінка. Я рідко', false, place(BOOK, 'Holmes'))
  root = document.createElement('div')
  document.body.append(root)
})

afterEach(() => {
  render(null, root)
  root.remove()
  trainingOpen.value = false
})

describe('SavedList', () => {
  it('показує лічильники сегментів і фільтр поточної книжки', async () => {
    await mount()
    expect(q('savedKindWords')!.textContent).toBe('Слова (1)')
    expect(q('savedKindQuotes')!.textContent).toBe('Цитати (1)')
    expect(q('savedWord-woman')).not.toBeNull()
    expect(q('savedWord-river')).toBeNull()

    await click(q('savedAllBooks'))
    expect(q('savedKindWords')!.textContent).toBe('Слова (3)')
    expect(q('savedWord-river')).not.toBeNull()
  })

  it('у бібліотеці немає перемикача «Усі книжки» і видно всі записи', async () => {
    await mount({ currentBookID: null })
    expect(q('savedAllBooks')).toBeNull()
    expect(q('savedKindWords')!.textContent).toBe('Слова (3)')
  })

  it('шукає українською без урахування регістру', async () => {
    await mount({ currentBookID: null })
    await type('savedSearch', 'РІЧК')
    expect(q('savedKindWords')!.textContent).toBe('Слова (1)')
    expect(q('savedWord-river')).not.toBeNull()
    await type('savedSearch', 'нічого')
    expect(q('savedEmpty')!.textContent).toContain('Збережених слів немає')
  })

  it('розгорнуте слово показує деталі й місця: перехід, «відкривається з бібліотеки», «книжку видалено»', async () => {
    const onOpen = await mount({ currentBookID: BOOK })
    await click(q('savedAllBooks'))

    await click(q('savedWord-woman'))
    expect(root.textContent).toContain('/ˈwʊmən/ · іменник')
    expect(root.textContent).toContain('Інші значення: дружина')
    await click(q('savedContext-woman'))
    expect(onOpen).toHaveBeenCalledWith(expect.objectContaining({ bookID: BOOK, paragraph: 1 }))

    await click(q('savedWord-river'))
    expect(q('savedContext-river')).toBeNull()
    expect(root.textContent).toContain('відкривається з бібліотеки')

    await click(q('savedWord-bright'))
    expect(root.textContent).toContain('книжку видалено')
  })

  it('цитати: текст, переклад і перехід до місця', async () => {
    const onOpen = await mount()
    await click(q('savedKindQuotes'))
    expect(root.textContent).toContain('the woman. I have seldom')
    expect(root.textContent).toContain('жінка. Я рідко')
    await click(q('savedQuote'))
    expect(onOpen).toHaveBeenCalledTimes(1)
  })

  it('видаляє слово й цитату', async () => {
    await mount({ currentBookID: null })
    await click(q('savedWord-river'))
    await click(q('savedWordDelete-river'))
    expect(words.value.map((w) => w.lemma)).not.toContain('river')

    await click(q('savedKindQuotes'))
    await click(all('savedDelete')[0])
    expect(quotes.value).toHaveLength(0)
    expect(q('savedEmpty')!.textContent).toContain('Збережених цитат немає')
  })

  it('«Тренування» відкриває тренування', async () => {
    await mount()
    await click(q('startTraining'))
    expect(trainingOpen.value).toBe(true)
  })

  it('стан навчання й файл експорту', () => {
    const word = { ...words.value[0], trainingLevel: 2, nextReview: new Date(2026, 9, 23).toISOString() }
    expect(trainingStatus(word)).toBe('рівень 2 · повторити 23.10')
    expect(trainingStatus({ ...word, trainingLevel: 5 })).toBe('вивчено')
    const file = wordsFile(words.value)
    expect(file.name).toBe('Слова.csv')
    expect(file.contents.split('\n')[0]).toBe('слово;lemma;IPA;переклад;рівень;форми;контекст')
  })
})
