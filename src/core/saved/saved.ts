// Port of EnglishReader/Services/SavedStore.swift: saved words (one per lemma) and quotes,
// stored as {words, quotes} in meta `saved`. Never sent to any service.
import { signal } from '@preact/signals'
import { fixtureSavedWords, fixtureSentence } from '../language.ts'
import type { WordCard } from '../../contracts.ts'
import type { ParagraphRef, SentenceRef } from '../model/book.ts'
import { DB_NAME, getValue, storageError, storageErrorText, transact } from '../storage/db.ts'
import { fold, wordForm } from '../util/fold.ts'

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

export const wordKey = (word: Pick<SavedWord, 'lemma'>): string => wordForm(word.lemma)

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

interface SavedLists {
  words: SavedWord[]
  quotes: SavedQuote[]
}

type StoredLists = { words?: Record<string, unknown>[]; quotes?: SavedQuote[] } | undefined

const decodeLists = (stored: StoredLists): SavedLists => ({
  words: Array.isArray(stored?.words) ? stored.words.map(decodeWord) : [],
  quotes: Array.isArray(stored?.quotes) ? stored.quotes : [],
})

/** Tells other tabs to reload the lists (the channel the library and restore already use). */
let channel: BroadcastChannel | null = null
function listenToOtherTabs() {
  if (channel || typeof BroadcastChannel === 'undefined') return
  channel = new BroadcastChannel(`${DB_NAME}-library`)
  channel.onmessage = (event) => { if (event.data !== 'library' && writing === 0) void initSaved().catch(() => {}) }
  ;(channel as BroadcastChannel & { unref?: () => void }).unref?.()
}

export async function initSaved(): Promise<void> {
  listenToOtherTabs()
  const lists = decodeLists(await getValue<StoredLists>('meta', KEY))
  words.value = lists.words
  quotes.value = lists.quotes
}

/** Changes still being written; the lists on screen are replaced by the stored ones after the last. */
let writing = 0

/**
 * Applies one change to the lists on screen at once, then to the stored lists in one transaction, so a change
 * made in another tab is kept, not overwritten with this tab's copy. On failure the lists are read back from
 * storage, so the screen never shows a word or quote that was not saved, and the reason is shown (R7).
 */
async function update(change: (lists: SavedLists) => SavedLists): Promise<void> {
  const shown = change({ words: words.value, quotes: quotes.value })
  words.value = shown.words
  quotes.value = shown.quotes
  writing++
  try {
    const stored = await transact(['meta'], async (tx) => {
      const next = change(decodeLists(await tx.objectStore('meta').get(KEY)))
      await tx.objectStore('meta').put({ words: next.words, quotes: next.quotes }, KEY)
      return next
    })
    if (writing === 1) {
      words.value = stored.words
      quotes.value = stored.quotes
    }
    channel?.postMessage('saved')
  } catch (error) {
    storageError.value = `Не вдалося зберегти: ${storageErrorText(error)}`
    if (writing === 1) await initSaved().catch(() => {})
  } finally {
    writing--
  }
}

export function wordFor(lemma: string): SavedWord | undefined {
  const key = wordForm(lemma)
  return words.value.find((w) => wordKey(w) === key)
}

export const isSaved = (lemma: string): boolean => wordFor(lemma) !== undefined

export async function saveWord(card: WordCard, sentence: string, place: SavedPlace): Promise<void> {
  const lemma = card.lemma || card.headword
  const now = nowISO()
  const context: SavedContext = { sentence, translation: card.contextTranslation, place, date: now }
  const created: SavedWord = {
    id: uuid(), headword: card.headword, lemma, ipa: card.ipa, partOfSpeech: card.partOfSpeech, level: card.level,
    forms: card.forms, contextTranslation: card.contextTranslation, otherTranslations: card.otherTranslations,
    contexts: [context], updatedAt: now, trainingLevel: 0, nextReview: null, lastTrained: null, lastResultUnknown: false,
  }
  await update((lists) => {
    const list = [...lists.words]
    const index = list.findIndex((w) => wordKey(w) === wordForm(lemma))
    if (index >= 0) {
      const [existing] = list.splice(index, 1)
      const contexts = existing.contexts.filter((c) => !(c.sentence === sentence && c.place.bookID === place.bookID))
      contexts.unshift(context)
      list.unshift({ ...existing, contexts: contexts.slice(0, CONTEXT_LIMIT), updatedAt: now })
    } else {
      list.unshift(created)
    }
    return { ...lists, words: list }
  })
}

export async function removeWordByLemma(lemma: string): Promise<void> {
  const key = wordForm(lemma)
  await update((lists) => ({ ...lists, words: lists.words.filter((w) => wordKey(w) !== key) }))
}

export async function removeWord(id: string): Promise<void> {
  await update((lists) => ({ ...lists, words: lists.words.filter((w) => w.id !== id) }))
}

export async function applyTraining(updates: Map<string, TrainingUpdate>, date: Date): Promise<void> {
  await update((lists) => ({
    ...lists,
    words: lists.words.map((w) => {
      const result = updates.get(w.id)
      if (!result) return w
      return { ...w, trainingLevel: result.level, nextReview: result.nextReview, lastResultUnknown: result.unknown, lastTrained: date.toISOString() }
    }),
  }))
}

export function quoteFor(text: string, bookID: string, paragraph: ParagraphRef): SavedQuote | undefined {
  return quotes.value.find((q) => q.text === text && q.place.bookID === bookID
    && q.place.chapter === paragraph.chapter && q.place.paragraph === paragraph.paragraph)
}

export async function saveQuote(text: string, translation: string, apple: boolean, place: SavedPlace): Promise<void> {
  if (quoteFor(text, place.bookID, placeParagraph(place))) return
  const quote: SavedQuote = { id: uuid(), text, translation, apple, place, date: nowISO() }
  const same = (q: SavedQuote) => q.text === text && q.place.bookID === place.bookID
    && q.place.chapter === place.chapter && q.place.paragraph === place.paragraph
  await update((lists) => (lists.quotes.some(same) ? lists : { ...lists, quotes: [quote, ...lists.quotes] }))
}

export async function removeQuote(id: string): Promise<void> {
  await update((lists) => ({ ...lists, quotes: lists.quotes.filter((q) => q.id !== id) }))
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
    forms.add(wordForm(w.headword))
    forms.add(wordForm(w.lemma))
    for (const form of w.forms.split('—')) {
      const trimmed = wordForm(form.trim())
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
  const seeded = fixtureSavedWords.map(([word, translation, part]): SavedWord => ({
    id: uuid(), headword: word, lemma: word, ipa: '', partOfSpeech: part, level: '', forms: '', contextTranslation: translation,
    otherTranslations: [], contexts: [{ sentence: fixtureSentence(word), translation, place, date: nowISO() }], updatedAt: nowISO(),
    trainingLevel: 0, nextReview: null, lastTrained: null, lastResultUnknown: false,
  }))
  await update((lists) => ({ ...lists, words: seeded }))
}

export async function removeAllForTests(): Promise<void> {
  await update(() => ({ words: [], quotes: [] }))
}
