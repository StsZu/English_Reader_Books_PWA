// Shared contracts (plan.md → «Спільні контракти»). Every module codes against these types,
// so parallel work on core and UI converges without rework. Names follow the Swift sources.

// MARK: - AI errors (EnglishReader/Services/OpenAIClient.swift → AIServiceError)

export type AIServiceError =
  | { kind: 'missingKey' }
  | { kind: 'unauthorized' }
  | { kind: 'rateLimited' }
  | { kind: 'quotaExceeded' }
  | { kind: 'server'; status: number }
  | { kind: 'http'; status: number; message: string }
  | { kind: 'offline' }
  | { kind: 'timeout' }
  | { kind: 'badResponse'; detail: string }

/** Thrown wrapper so AI errors travel through promises and keep their kind. */
export class AIError extends Error {
  constructor(readonly error: AIServiceError) {
    super(aiErrorText(error))
    this.name = 'AIError'
  }
}

export function aiErrorText(e: AIServiceError): string {
  switch (e.kind) {
    case 'missingKey': return 'Не вказано ключ OpenAI. Додайте його в Налаштуваннях.'
    case 'unauthorized': return 'Ключ OpenAI недійсний або відкликаний. Перевірте його в Налаштуваннях.'
    case 'rateLimited': return 'Забагато запитів до OpenAI. Зачекайте кілька секунд і повторіть.'
    case 'quotaExceeded': return 'Вичерпано кредит або ліміт облікового запису OpenAI.'
    case 'server': return `Сервіс OpenAI тимчасово недоступний (${e.status}). Повторіть пізніше.`
    case 'http': return `Помилка OpenAI (${e.status})${e.message ? `: ${e.message}` : ''}.`
    case 'offline': return "Немає з'єднання з інтернетом."
    case 'timeout': return 'OpenAI не відповів вчасно. Повторіть.'
    case 'badResponse': return `Неочікувана відповідь сервісу (${e.detail}). Повторіть.`
  }
}

/** Errors that the settings screen can fix. */
export const needsSettings = (e: AIServiceError): boolean => e.kind === 'missingKey' || e.kind === 'unauthorized'

export const isAIError = (value: unknown): value is AIError => value instanceof AIError

/** Ukrainian message for any thrown value. */
export function errorMessage(value: unknown): string {
  if (value instanceof Error) return value.message
  return String(value)
}

export const isAbort = (value: unknown): boolean =>
  value instanceof DOMException ? value.name === 'AbortError' : (value as { name?: string } | null)?.name === 'AbortError'

export const abortError = (): DOMException => new DOMException('Скасовано', 'AbortError')

// MARK: - Import errors (EnglishReader/Import/BookImporter.swift → ImportError)

export type ImportErrorKind =
  | { kind: 'unsupportedFormat'; ext: string }
  | { kind: 'tooLarge' }
  | { kind: 'unreadable' }
  | { kind: 'emptyText' }
  | { kind: 'drmProtected' }
  | { kind: 'invalidEPUB'; detail: string }

export class ImportError extends Error {
  constructor(readonly error: ImportErrorKind) {
    super(importErrorText(error))
    this.name = 'ImportError'
  }
}

export function importErrorText(e: ImportErrorKind): string {
  switch (e.kind) {
    case 'unsupportedFormat': return `Формат «.${e.ext}» не підтримується. Підтримуються EPUB (без DRM), TXT і MD.`
    case 'tooLarge': return 'Файл завеликий (понад 50 МБ).'
    case 'unreadable': return 'Не вдалося прочитати файл.'
    case 'emptyText': return 'У файлі не знайдено тексту для читання.'
    case 'drmProtected': return 'Книжка захищена DRM. Імпортуйте копію без захисту.'
    case 'invalidEPUB': return `Файл EPUB пошкоджений або має нестандартну структуру (${e.detail}).`
  }
}

// MARK: - Providers and engines

/** Returns exactly one Ukrainian translation per input sentence, in order. */
export interface TranslationProvider {
  translate(sentences: string[], context?: string | null): Promise<string[]>
}

/** Port of the SpeechEngine protocol. `speak` resolves when audio ends; rejects with AbortError after stop(). */
export interface SpeechEngine {
  speak(text: string, onStart: () => void): Promise<void>
  /** Starts preparing audio for upcoming text so playback has no gap. */
  prefetch(text: string): void
  pause(): void
  resume(): void
  stop(): void
}

/** Engine that keeps synthesized audio and can replay it without a new synthesis request (G5, G6). */
export interface ReplayableSpeech extends SpeechEngine {
  hasAudio(text: string): Promise<boolean>
  /** Plays saved audio only; never synthesizes. Rejects with ReplayMissingError when there is none. */
  replay(text: string, onStart: () => void): Promise<void>
}

export class ReplayMissingError extends Error {
  constructor() {
    super('Збереженого аудіо цього речення немає або воно пошкоджене. Утримуйте речення, щоб озвучити його знову.')
    this.name = 'ReplayMissingError'
  }
}

export type VoiceEngineKind = 'openAI' | 'system'

export const voiceEngineLabel = (kind: VoiceEngineKind): string =>
  kind === 'openAI' ? 'ШІ-голос OpenAI' : 'Системний голос (офлайн)'

// MARK: - Storage

export interface KeyValueCache<T> {
  get(key: string): Promise<T | undefined>
  set(key: string, value: T): Promise<void>
}

// MARK: - Word card (EnglishReader/Services/WordLookupService.swift → WordCard)

export interface WordCard {
  headword: string
  lemma: string
  ipa: string
  partOfSpeech: string
  contextTranslation: string
  otherTranslations: string[]
  note: string
  /** CEFR A1–C2 or empty. */
  level: string
  /** Main forms joined with « — »; may be empty. */
  forms: string
  irregular: boolean
}
