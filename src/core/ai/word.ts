// Port of EnglishReader/Services/WordLookupService.swift: the context-aware word card and
// «Пояснити детальніше» (DT6), with the same JSON schema and cache keys.
import { AIError, type WordCard } from '../../contracts.ts'
import { testFlags } from '../../app/test-mode.ts'
import { cache, getValue, setValue } from '../storage/db.ts'
import { sha256Hex } from '../util/hash.ts'
import { chatJSON } from './openai.ts'
import { explanationSystemPrompt, wordCardSystemPrompt } from './prompts.ts'

const levels = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2']

/** On-disk / API JSON shape of a card (snake_case keys, as WordCard.CodingKeys). */
export interface WordCardJSON {
  headword: string
  lemma: string
  ipa: string
  part_of_speech: string
  context_translation: string
  other_translations: string[]
  note: string
  level: string
  forms: string
  irregular: boolean
}

const str = (value: unknown): string | undefined => (typeof value === 'string' ? value : undefined)

/** Decodes like WordCard.init(from:): headword and context_translation are required; others default. */
export function decodeWordCard(value: unknown): WordCard | null {
  if (!value || typeof value !== 'object') return null
  const v = value as Record<string, unknown>
  const headword = str(v.headword)
  const contextTranslation = str(v.context_translation)
  if (headword === undefined || contextTranslation === undefined) return null
  const others = Array.isArray(v.other_translations) && v.other_translations.every((x) => typeof x === 'string')
    ? (v.other_translations as string[])
    : []
  const rawLevel = (str(v.level) ?? '').toUpperCase().trim()
  return {
    headword,
    lemma: str(v.lemma) ?? headword,
    ipa: str(v.ipa) ?? '',
    partOfSpeech: str(v.part_of_speech) ?? '',
    contextTranslation,
    otherTranslations: others,
    note: str(v.note) ?? '',
    level: levels.includes(rawLevel) ? rawLevel : '',
    forms: str(v.forms) ?? '',
    irregular: typeof v.irregular === 'boolean' ? v.irregular : false,
  }
}

export function encodeWordCard(card: WordCard): WordCardJSON {
  return {
    headword: card.headword,
    lemma: card.lemma,
    ipa: card.ipa,
    part_of_speech: card.partOfSpeech,
    context_translation: card.contextTranslation,
    other_translations: card.otherTranslations,
    note: card.note,
    level: card.level,
    forms: card.forms,
    irregular: card.irregular,
  }
}

/** UI-test fixture card (`?testWordCard`, as in EnglishReaderApp.swift). */
export function fixtureCard(word: string): WordCard {
  return {
    headword: word, lemma: word.toLowerCase(), ipa: 'ˈwʊmən', partOfSpeech: 'іменник',
    contextTranslation: 'жінка', otherTranslations: ['дружина', 'служниця'], note: '',
    level: 'A1', forms: 'woman — women', irregular: true,
  }
}

export const wordCacheKey = (word: string, sentence: string): string => `${word.toLowerCase()}|${sentence}`

/** Context-aware dictionary card: the meaning of the word in *this* sentence first. */
export const WordLookupService = {
  /** Replaced by tests; defaults to the fixture only in a test build with `?testWordCard`. */
  fixture: null as ((word: string) => WordCard) | null,

  async cached(word: string, sentence: string): Promise<WordCard | null> {
    const stored = await getValue<WordCardJSON>('wordCache', wordCacheKey(word, sentence))
    return stored ? decodeWordCard(stored) : null
  },

  async lookup(word: string, sentence: string, model: string, signal?: AbortSignal): Promise<WordCard> {
    const key = wordCacheKey(word, sentence)
    const stored = await getValue<WordCardJSON>('wordCache', key)
    const cachedCard = stored ? decodeWordCard(stored) : null
    if (cachedCard) return cachedCard
    const fixture = this.fixture ?? (__TEST_MODE__ && testFlags.wordCard ? fixtureCard : null)
    if (fixture) return fixture(word)
    const user = JSON.stringify({ word, sentence })
    const card = await chatJSON(model, wordCardSystemPrompt, user, decodeWordCard, signal)
    await setValue('wordCache', key, encodeWordCard(card))
    return card
  },
}

/** «Пояснити детальніше»: a separate paid request built from an editable template. */
export const ExplanationService = {
  /** Number of explanation requests started in this page. */
  requestCount: 0,
  fixture: null as ((word: string) => string) | null,

  prompt(template: string, word: string, sentence: string): string {
    return template.replaceAll('{слово}', word).replaceAll('{контекст}', sentence)
  },

  key(word: string, sentence: string, template: string, model: string): Promise<string> {
    return sha256Hex(`${word.toLowerCase()}|${sentence}|${template}|${model}`)
  },

  async cached(word: string, sentence: string, template: string, model: string): Promise<string | null> {
    return (await cache<string>('explanations').get(await this.key(word, sentence, template, model))) ?? null
  },

  /** Returns the saved explanation unless `regenerate` is set; otherwise sends one request. */
  async explain(word: string, sentence: string, template: string, model: string, regenerate = false, signal?: AbortSignal): Promise<string> {
    const key = await this.key(word, sentence, template, model)
    const store = cache<string>('explanations')
    if (!regenerate) {
      const saved = await store.get(key)
      if (saved !== undefined) return saved
    }
    this.requestCount++
    const fixture = this.fixture ?? (__TEST_MODE__ && testFlags.wordCard
      ? (w: string) => `Тестове пояснення слова «${w}» без мережевого запиту.`
      : null)
    let text: string
    if (fixture) {
      text = fixture(word)
    } else {
      const validate = (value: unknown) => {
        const explanation = (value as { explanation?: unknown } | null)?.explanation
        return typeof explanation === 'string' ? explanation : null
      }
      text = (await chatJSON(model, explanationSystemPrompt, this.prompt(template, word, sentence), validate, signal)).trim()
      if (!text) throw new AIError({ kind: 'badResponse', detail: 'порожнє пояснення' })
    }
    await store.set(key, text)
    return text
  },
}
