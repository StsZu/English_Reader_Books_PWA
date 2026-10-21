// Port of EnglishReader/Services/TranslationService.swift (AI part) and the fragment cache from
// Views/ReaderViewModel.swift. The Apple on-device fallback is not ported (spec.md V-01).
import { AIError, type TranslationProvider } from '../../contracts.ts'
import { testFlags } from '../../app/test-mode.ts'
import { paragraphKey, type ParagraphRef } from '../model/book.ts'
import { cache } from '../storage/db.ts'
import { sha256Hex } from '../util/hash.ts'
import { chatJSON } from './openai.ts'
import { translationSystemPrompt } from './prompts.ts'

/** Number of translation requests started in this page (tests). */
export const translationStats = { requests: 0 }

const validateTranslations = (value: unknown): string[] | null => {
  const list = (value as { translations?: unknown } | null)?.translations
  return Array.isArray(list) && list.every((item) => typeof item === 'string') ? list : null
}

export class OpenAITranslationProvider implements TranslationProvider {
  constructor(readonly model: string) {}

  async translate(sentences: string[], context?: string | null, signal?: AbortSignal): Promise<string[]> {
    const payload: Record<string, unknown> = { sentences }
    if (context) payload.context = context.slice(-600)
    const user = JSON.stringify(payload)
    let lastError = new AIError({ kind: 'badResponse', detail: 'кількість речень не збігається' })
    for (let attempt = 0; attempt < 2; attempt++) {
      translationStats.requests++
      try {
        const result = await chatJSON(this.model, translationSystemPrompt, user, validateTranslations, signal)
        if (result.length === sentences.length) return result
        lastError = new AIError({ kind: 'badResponse', detail: 'кількість речень не збігається' })
      } catch (error) {
        if (error instanceof AIError && error.error.kind === 'badResponse') {
          lastError = error
          continue
        }
        throw error
      }
    }
    throw lastError
  }
}

/** Debug fixture (`?testTranslation`, analogue of -uiTestTranslation): long Ukrainian text without network. */
export class TestTranslationProvider implements TranslationProvider {
  static readonly line =
    'Для Шерлока Голмса вона завжди залишалася тією жінкою. Цей довгий український переклад використовується лише для перевірки перенесення рядків, прокручування панелі та незмінного розташування англійського тексту під час вибору речення.'

  async translate(sentences: string[]): Promise<string[]> {
    translationStats.requests++
    return sentences.map(() => TestTranslationProvider.line)
  }
}

/** Provider for the reader: the test fixture when requested in a test build, otherwise OpenAI. */
export function makeTranslationProvider(model: string): TranslationProvider {
  if (__TEST_MODE__ && testFlags.translation) return new TestTranslationProvider()
  return new OpenAITranslationProvider(model)
}

/** Per-book translation cache: paragraph key → sentence translations (translations.json in Swift). */
export class TranslationStore {
  private readonly store

  constructor(readonly bookID: string, storeName: 'translations' | 'fragments' = 'translations') {
    this.store = cache<string[]>(storeName, `${bookID}|`)
  }

  translation(ref: ParagraphRef): Promise<string[] | undefined> {
    return this.store.get(paragraphKey(ref))
  }

  translationForKey(key: string): Promise<string[] | undefined> {
    return this.store.get(key)
  }

  save(translations: string[], ref: ParagraphRef): Promise<void> {
    return this.store.set(paragraphKey(ref), translations)
  }

  saveForKey(translations: string[], key: string): Promise<void> {
    return this.store.set(key, translations)
  }
}

/** Fragment cache key: SHA-256 of "text|context" (ReaderViewModel.cacheKey). */
export const fragmentCacheKey = (text: string, context: string): Promise<string> => sha256Hex(`${text}|${context}`)

/**
 * Translates a selected fragment with the surrounding sentences as context, cached per book
 * (fragments.json in Swift: key → [line]).
 */
export async function translateFragment(
  bookID: string,
  text: string,
  context: string,
  provider: TranslationProvider,
): Promise<string> {
  const store = new TranslationStore(bookID, 'fragments')
  const key = await fragmentCacheKey(text, context)
  const cached = (await store.translationForKey(key))?.[0]
  if (cached !== undefined) return cached
  const lines = await provider.translate([text], context)
  const line = lines[0]
  if (line === undefined) throw new AIError({ kind: 'badResponse', detail: 'порожня відповідь' })
  await store.saveForKey([line], key)
  return line
}
