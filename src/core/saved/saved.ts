// Port of EnglishReader/Services/SavedStore.swift: saved words (one per lemma) and quotes,
// stored as {words, quotes} in meta `saved`. Never sent to any service.
import { signal } from '@preact/signals'
import { fixtureSavedWords, fixtureSentence } from '../language.ts'
import type { WordCard } from '../../contracts.ts'
import type { ParagraphRef, SentenceRef } from '../model/book.ts'
import { getValue, setValue, storageError, storageErrorText } from '../storage/db.ts'

export interface SavedPlace {
  bookID: string
  bookTitle: string
  chapter: number
  paragraph: number
  sentence: number
}

export const placeParagraph = (p: SavedPlace): ParagraphRef => ({ chapter: p.chapter, paragraph: p.paragraph })
export const placeSentence = (p: SavedPlace): SentenceRef => ({ paragraph: placeParagraph(p), sentence: p.sentence })

export interface SavedContext {
  sentence: string
  translation: string
  place: SavedPlace
  /** ISO 8601. */
  date: string
}

export interface SavedWord {
  id: string
  headword: string
  lemma: string
  ipa: string
  partOfSpeech: string
  level: string
  forms: string
  contextTranslation: string
  otherTranslations: string[]
  contexts: SavedContext[]
  updatedAt: string
  trainingLevel: number
  nextReview: string | null
  lastTrained: string | null
  lastResultUnknown: boolean
}

export interface SavedQuote {
  id: string
  text: string
  translation: string
  /** Translated by the on-device fallback (kept for schema compatibility; always false in the PWA). */
  apple: boolean
  place: SavedPlace
  date: string
}

export interface TrainingUpdate {
  level: number
  nextReview: string | null
  unknown: boolean
}

export const CONTEXT_LIMIT = 5
const KEY = 'saved'

export const wordKey = (word: Pick<SavedWord, 'lemma'>): string => word.lemma.toLowerCase()

export const words = signal<SavedWord[]>([])
export const quotes = signal<SavedQuote[]>([])

/** Set when a saved place is opened from the library; the reader selects this sentence on open. */
export let pendingSentence: { bookID: string; ref: SentenceRef } | null = null
export function setPendingSentence(value: { bookID: string; ref: SentenceRef } | null) {
  pendingSentence = value
}

const uuid = (): string => crypto.randomUUID().toUpperCase()
const nowISO = (): string => new Date().toISOString()

/** Decodes a stored word, tolerating records saved before training fields existed. */
export function decodeWord(raw: Record<string, unknown>): SavedWord {
  const word = raw as unknown as SavedWord
  return {
    ...word,
    otherTranslations: Array.isArray(word.otherTranslations) ? word.otherTranslations : [],
    contexts: Array.isArray(word.contexts) ? word.contexts : [],
    trainingLevel: typeof word.trainingLevel === 'number' ? word.trainingLevel : 0,
    nextReview: typeof word.nextReview === 'string' ? word.nextReview : null,
    lastTrained: typeof word.lastTrained === 'string' ? word.lastTrained : null,
    lastResultUnknown: word.lastResultUnknown === true,
  }
}

export async function initSaved(): Promise<void> {
  const stored = await getValue<{ words?: Record<string, unknown>[]; quotes?: SavedQuote[] }>('meta', KEY)
  words.value = Array.isArray(stored?.words) ? stored.words.map(decodeWord) : []
  quotes.value = Array.isArray(stored?.quotes) ? stored.quotes : []
}

/**
 * Writes both lists. On failure the lists are read back from storage, so the screen never shows a word
 * or quote that was not saved (or hides one that was not removed), and the reason is shown (R7).
 */
async function persist() {
  try {
    await setValue('meta', KEY, { words: words.value, quotes: quotes.value })
  } catch (error) {
    storageError.value = `Не вдалося зберегти: ${storageErrorText(error)}`
    await initSaved().catch(() => {})
  }
}

export function wordFor(lemma: string): SavedWord | undefined {
  const key = lemma.toLowerCase()
  return words.value.find((w) => wordKey(w) === key)
}

export const isSaved = (lemma: string): boolean => wordFor(lemma) !== undefined

export async function saveWord(card: WordCard, sentence: string, place: SavedPlace): Promise<void> {
  const lemma = card.lemma || card.headword
  const context: SavedContext = { sentence, translation: card.contextTranslation, place, date: nowISO() }
  const list = [...words.value]
  const index = list.findIndex((w) => wordKey(w) === lemma.toLowerCase())
  if (index >= 0) {
    const [existing] = list.splice(index, 1)
    const contexts = existing.contexts.filter((c) => !(c.sentence === sentence && c.place.bookID === place.bookID))
    contexts.unshift(context)
    list.unshift({ ...existing, contexts: contexts.slice(0, CONTEXT_LIMIT), updatedAt: nowISO() })
  } else {
    list.unshift({
      id: uuid(), headword: card.headword, lemma, ipa: card.ipa, partOfSpeech: card.partOfSpeech, level: card.level,
      forms: card.forms, contextTranslation: card.contextTranslation, otherTranslations: card.otherTranslations,
      contexts: [context], updatedAt: nowISO(), trainingLevel: 0, nextReview: null, lastTrained: null, lastResultUnknown: false,
    })
  }
  words.value = list
  await persist()
}

export async function removeWordByLemma(lemma: string): Promise<void> {
  const key = lemma.toLowerCase()
  words.value = words.value.filter((w) => wordKey(w) !== key)
  await persist()
}

export async function removeWord(id: string): Promise<void> {
  words.value = words.value.filter((w) => w.id !== id)
  await persist()
}

export async function applyTraining(updates: Map<string, TrainingUpdate>, date: Date): Promise<void> {
  words.value = words.value.map((w) => {
    const update = updates.get(w.id)
    if (!update) return w
    return { ...w, trainingLevel: update.level, nextReview: update.nextReview, lastResultUnknown: update.unknown, lastTrained: date.toISOString() }
  })
  await persist()
}

export function quoteFor(text: string, bookID: string, paragraph: ParagraphRef): SavedQuote | undefined {
  return quotes.value.find((q) => q.text === text && q.place.bookID === bookID
    && q.place.chapter === paragraph.chapter && q.place.paragraph === paragraph.paragraph)
}

export async function saveQuote(text: string, translation: string, apple: boolean, place: SavedPlace): Promise<void> {
  if (quoteFor(text, place.bookID, placeParagraph(place))) return
  quotes.value = [{ id: uuid(), text, translation, apple, place, date: nowISO() }, ...quotes.value]
  await persist()
}

export async function removeQuote(id: string): Promise<void> {
  quotes.value = quotes.value.filter((q) => q.id !== id)
  await persist()
}

/** Letters that NFD keeps whole, with their Latin base for search. */
const baseLetters: Record<string, string> = { ł: 'l', đ: 'd', ø: 'o', ß: 'ss', æ: 'ae', œ: 'oe' }

/** Case- and diacritic-insensitive form for search («lodz» finds «Łódź»). */
export function fold(text: string): string {
  return text.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/[łđøßæœ]/gu, (letter) => baseLetters[letter])
}

export function matches(query: string, fields: string[]): boolean {
  const trimmed = fold(query.trim())
  if (!trimmed) return true
  return fields.some((f) => fold(f).includes(trimmed))
}

export function filterWords(bookID: string | null, query: string, list: SavedWord[] = words.value): SavedWord[] {
  return list.filter((w) => (bookID === null || w.contexts.some((c) => c.place.bookID === bookID))
    && matches(query, [w.headword, w.lemma, w.contextTranslation, w.forms, ...w.otherTranslations, ...w.contexts.map((c) => c.sentence)]))
}

export function filterQuotes(bookID: string | null, query: string, list: SavedQuote[] = quotes.value): SavedQuote[] {
  return list.filter((q) => (bookID === null || q.place.bookID === bookID) && matches(query, [q.text, q.translation]))
}

/** Lower-cased word forms to underline in the book: headword, lemma and one-word forms. */
export function highlightForms(list: SavedWord[] = words.value): Set<string> {
  const forms = new Set<string>()
  for (const w of list) {
    forms.add(w.headword.toLowerCase())
    forms.add(w.lemma.toLowerCase())
    for (const form of w.forms.split('—')) {
      const trimmed = form.trim().toLowerCase()
      if (trimmed && !trimmed.includes(' ')) forms.add(trimmed)
    }
  }
  return forms
}

export function csvField(value: string): string {
  // A leading = + - @ (or tab, carriage return) runs as a formula in Numbers or Excel; «'» keeps it text (R5, OWASP).
  const text = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value
  if (!/[;"\n]/.test(text)) return text
  return `"${text.replaceAll('"', '""')}"`
}

export function wordsCSV(list: SavedWord[]): string {
  const header = 'слово;lemma;IPA;переклад;рівень;форми;контекст'
  const rows = list.map((w) => [w.headword, w.lemma, w.ipa, w.contextTranslation, w.level, w.forms, w.contexts[0]?.sentence ?? '']
    .map(csvField).join(';'))
  return [header, ...rows].join('\n') + '\n'
}

export function quotesText(list: SavedQuote[]): string {
  return list.map((q) => `${q.text}\n${q.translation}\n— ${q.place.bookTitle}`).join('\n\n') + '\n'
}

/** UI-test fixture (`?testSavedWords`): four words including a phrase (language.ts). */
export async function seedForTests(): Promise<void> {
  const place: SavedPlace = { bookID: uuid(), bookTitle: 'Тест', chapter: 0, paragraph: 0, sentence: 0 }
  const entries = fixtureSavedWords
  words.value = entries.map(([word, translation, part]) => ({
    id: uuid(), headword: word, lemma: word, ipa: '', partOfSpeech: part, level: '', forms: '', contextTranslation: translation,
    otherTranslations: [], contexts: [{ sentence: fixtureSentence(word), translation, place, date: nowISO() }], updatedAt: nowISO(),
    trainingLevel: 0, nextReview: null, lastTrained: null, lastResultUnknown: false,
  }))
  await persist()
}

export async function removeAllForTests(): Promise<void> {
  words.value = []
  quotes.value = []
  await persist()
}
