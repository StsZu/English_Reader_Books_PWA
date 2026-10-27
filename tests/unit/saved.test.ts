import { beforeEach, describe, expect, it } from 'vitest'
import type { WordCard } from '../../src/contracts.ts'
import {
  CONTEXT_LIMIT, csvField, decodeWord, filterQuotes, filterWords, highlightForms, initSaved, isSaved, quotes, quotesText,
  removeAllForTests, removeQuote, removeWordByLemma, saveQuote, saveWord, seedForTests, words, wordsCSV, type SavedPlace,
} from '../../src/core/saved/saved.ts'
import { fixtureSavedWords } from '../../src/core/language.ts'
import { closeDB } from '../../src/core/storage/db.ts'

const card = (word: string, lemma: string, forms = ''): WordCard => ({
  headword: word, lemma, ipa: 'x', partOfSpeech: 'дієслово', contextTranslation: `переклад ${word}`,
  otherTranslations: ['інше'], note: '', level: 'B1', forms, irregular: false,
})

const place = (book: string, sentence = 0): SavedPlace => ({ bookID: book, bookTitle: 'Book', chapter: 0, paragraph: 2, sentence })

async function reload() {
  await closeDB()
  await initSaved()
}

beforeEach(async () => {
  await removeAllForTests()
})

describe('збережені слова', () => {
  // testSavedWordsMergeContextsByLemmaAndPersist
  it('зливають контексти за lemma і зберігаються', async () => {
    const book = crypto.randomUUID()
    await saveWord(card('went', 'go', 'go — went — gone'), 'She went home.', place(book))
    await saveWord(card('goes', 'Go'), 'He goes away.', place(book, 1))
    expect(words.value.length).toBe(1)
    expect(words.value[0].contexts.map((c) => c.sentence)).toEqual(['He goes away.', 'She went home.'])
    await saveWord(card('went', 'go'), 'She went home.', place(book))
    expect(words.value[0].contexts.length).toBe(2)
    expect(words.value[0].contexts[0].sentence).toBe('She went home.')
    for (let i = 0; i < 6; i++) await saveWord(card('go', 'go'), `Sentence ${i}.`, place(book))
    expect(words.value[0].contexts.length).toBe(CONTEXT_LIMIT)
    await saveWord(card('table', 'table'), 'On the table.', place(crypto.randomUUID()))
    expect(words.value[0].lemma).toBe('table')
    const forms = highlightForms()
    for (const f of ['go', 'went', 'gone', 'table']) expect(forms.has(f)).toBe(true)

    const before = structuredClone(words.value)
    await reload()
    expect(words.value).toEqual(before)
    expect(filterWords(book, '').map((w) => w.lemma)).toEqual(['go'])
    expect(filterWords(null, 'ПЕРЕКЛАД TABLE').map((w) => w.lemma)).toEqual(['table'])
    expect(filterWords(null, 'sentence 5').map((w) => w.lemma)).toEqual(['go'])
    await removeWordByLemma('GO')
    expect(isSaved('go')).toBe(false)
    await reload()
    expect(words.value.length).toBe(1)
  })

  it('пошук не залежить від діакритики', async () => {
    await saveWord(card('cafe', 'café'), 'At the café.', place('b'))
    expect(filterWords(null, 'CAFE').length).toBe(1)
    expect(filterWords(null, 'café').length).toBe(1)
  })

  // testOldSavedWordsDecodeWithoutTrainingFields
  it('старі записи без полів тренування читаються', () => {
    const word = decodeWord({ id: '0F3A1E2D-0000-4000-8000-000000000001', headword: 'go', lemma: 'go', ipa: '', partOfSpeech: '',
      level: '', forms: '', contextTranslation: 'йти', otherTranslations: [], contexts: [], updatedAt: '2026-10-20T00:00:00.000Z' })
    expect(word.trainingLevel).toBe(0)
    expect(word.nextReview).toBeNull()
    expect(word.lastResultUnknown).toBe(false)
  })

  it('тестовий набір містить чотири слова з фразою (language.ts)', async () => {
    await seedForTests()
    expect(words.value.map((w) => w.headword)).toEqual(fixtureSavedWords.map(([word]) => word))
  })
})

describe('цитати й експорт', () => {
  // testSavedQuotesAreUniqueAndExportEscapes
  it('цитати без дублікатів, CSV з екрануванням', async () => {
    const book = crypto.randomUUID()
    await saveQuote('woman. I have seldom', 'жінка. Я рідко', false, place(book))
    await saveQuote('woman. I have seldom', 'інше', true, place(book))
    expect(quotes.value.length).toBe(1)
    expect(filterQuotes(book, 'рідко').length).toBe(1)
    expect(filterQuotes(crypto.randomUUID(), '').length).toBe(0)
    expect(csvField('a;b "c"')).toBe('"a;b ""c"""')
    expect(csvField('plain')).toBe('plain')
    await saveWord(card('say', 'say'), 'He said; "no".', place(book))
    const csv = wordsCSV(words.value)
    expect(csv.startsWith('слово;lemma;IPA;переклад;рівень;форми;контекст\n')).toBe(true)
    expect(csv).toContain('"He said; ""no""."')
    expect(quotesText(quotes.value)).toContain('жінка. Я рідко\n— Book')
    await removeQuote(quotes.value[0].id)
    await reload()
    expect(quotes.value).toEqual([])
  })
})
