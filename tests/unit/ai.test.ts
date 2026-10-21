// Ported from EnglishReaderTests/ServiceTests.swift (AI part) with a fake fetch; no network.
import { existsSync, readFileSync } from 'node:fs'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AIError, aiErrorText, needsSettings, type AIServiceError } from '../../src/contracts.ts'
import { SPEECH_TIMEOUT_MS, chatJSON, mapError, setKeyProvider, speech } from '../../src/core/ai/openai.ts'
import * as prompts from '../../src/core/ai/prompts.ts'
import {
  OpenAITranslationProvider, TestTranslationProvider, TranslationStore, fragmentCacheKey, translateFragment, translationStats,
} from '../../src/core/ai/translation.ts'
import { ExplanationService, WordLookupService, decodeWordCard, encodeWordCard } from '../../src/core/ai/word.ts'
import { closeDB } from '../../src/core/storage/db.ts'
import { explanationDefaultTemplate } from '../../src/core/ai/prompts.ts'
import { defaultExplanationTemplate } from '../../src/core/storage/settings.ts'

type Handler = (url: string, body: Record<string, unknown>) => Response | Promise<Response>

let requests: { url: string; body: Record<string, unknown> }[] = []

function stubFetch(handler: Handler) {
  requests = []
  vi.stubGlobal('fetch', async (input: string, init: RequestInit) => {
    const body = JSON.parse(String(init.body))
    requests.push({ url: input, body })
    return handler(input, body)
  })
}

const chat = (content: unknown, finish = 'stop') =>
  new Response(JSON.stringify({ choices: [{ message: { content: typeof content === 'string' ? content : JSON.stringify(content) }, finish_reason: finish }] }), { status: 200 })

const kindOf = async (promise: Promise<unknown>): Promise<AIServiceError['kind'] | 'ok' | string> => {
  try {
    await promise
    return 'ok'
  } catch (error) {
    return error instanceof AIError ? error.error.kind : String(error)
  }
}

beforeEach(() => setKeyProvider(async () => 'test-key'))
afterEach(() => vi.unstubAllGlobals())

describe('OpenAI client', () => {
  it('maps HTTP errors (testHTTPErrorMapping)', () => {
    expect(mapError(401, '')).toEqual({ kind: 'unauthorized' })
    expect(mapError(403, '')).toEqual({ kind: 'unauthorized' })
    expect(mapError(429, '')).toEqual({ kind: 'rateLimited' })
    const quota = '{"error":{"message":"You exceeded your current quota","type":"insufficient_quota","code":"insufficient_quota"}}'
    expect(mapError(429, quota)).toEqual({ kind: 'quotaExceeded' })
    expect(mapError(503, '')).toEqual({ kind: 'server', status: 503 })
    expect(mapError(400, '{"error":{"message":"Invalid model"}}')).toEqual({ kind: 'http', status: 400, message: 'Invalid model' })
    expect(mapError(400, JSON.stringify({ error: { message: 'x'.repeat(300) } }))).toMatchObject({ message: 'x'.repeat(160) })
    expect(needsSettings({ kind: 'missingKey' })).toBe(true)
    expect(needsSettings({ kind: 'unauthorized' })).toBe(true)
    expect(needsSettings({ kind: 'offline' })).toBe(false)
    expect(aiErrorText({ kind: 'offline' })).toBe("Немає з'єднання з інтернетом.")
  })

  it('reports a missing key before any network request (testMissingKeyIsReportedBeforeNetwork)', async () => {
    setKeyProvider(async () => null)
    stubFetch(() => chat({ translations: ['x'] }))
    expect(await kindOf(new OpenAITranslationProvider('gpt-5.4-mini').translate(['Hi.']))).toBe('missingKey')
    expect(requests).toHaveLength(0)
  })

  it('sends JSON mode and low reasoning effort only for gpt-5/o models', async () => {
    stubFetch(() => chat({ ok: 1 }))
    await chatJSON('gpt-5.4-mini', 'sys', 'user', (v) => v)
    await chatJSON('gpt-4o-mini', 'sys', 'user', (v) => v)
    expect(requests[0].url).toBe('https://api.openai.com/v1/chat/completions')
    expect(requests[0].body).toMatchObject({ model: 'gpt-5.4-mini', response_format: { type: 'json_object' }, reasoning_effort: 'low' })
    expect(requests[0].body.messages).toEqual([{ role: 'system', content: 'sys' }, { role: 'user', content: 'user' }])
    expect(requests[1].body.reasoning_effort).toBeUndefined()
  })

  it('classifies bad responses, network failures and timeouts', async () => {
    stubFetch(() => chat({ a: 1 }, 'length'))
    expect(await kindOf(chatJSON('m', 's', 'u', (v) => v))).toBe('badResponse')
    stubFetch(() => chat('not json'))
    await expect(chatJSON('m', 's', 'u', (v) => v)).rejects.toThrow('JSON не відповідає схемі')
    stubFetch(() => chat({ a: 1 }))
    await expect(chatJSON('m', 's', 'u', () => null)).rejects.toThrow('JSON не відповідає схемі')
    stubFetch(() => { throw new TypeError('Load failed') })
    expect(await kindOf(chatJSON('m', 's', 'u', (v) => v))).toBe('offline')
    stubFetch(() => new Response('{"error":{"message":"boom"}}', { status: 500 }))
    expect(await kindOf(chatJSON('m', 's', 'u', (v) => v))).toBe('server')
  })

  it('times out after 60 s', async () => {
    vi.useFakeTimers()
    try {
      vi.stubGlobal('fetch', (_: string, init: RequestInit) => new Promise((_, reject) => {
        init.signal!.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')))
      }))
      const result = kindOf(chatJSON('m', 's', 'u', (v) => v))
      await vi.advanceTimersByTimeAsync(60_001)
      expect(await result).toBe('timeout')
    } finally {
      vi.useRealTimers()
    }
  })

  it('passes an external abort through as AbortError', async () => {
    vi.stubGlobal('fetch', (_: string, init: RequestInit) => new Promise((_, reject) => {
      init.signal!.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')))
    }))
    const controller = new AbortController()
    const promise = chatJSON('m', 's', 'u', (v) => v, controller.signal)
    controller.abort()
    await expect(promise).rejects.toMatchObject({ name: 'AbortError' })
  })

  it('times out speech whose audio stream never ends', async () => {
    vi.useFakeTimers()
    try {
      vi.stubGlobal('fetch', async () => new Response(new ReadableStream({
        start(controller) { controller.enqueue(new Uint8Array(1024)) },
      }), { status: 200 }))
      const result = kindOf(speech('gpt-4o-mini-tts', 'coral', 'Hi', 'i'))
      await vi.advanceTimersByTimeAsync(SPEECH_TIMEOUT_MS + 10)
      expect(await result).toBe('timeout')
    } finally {
      vi.useRealTimers()
    }
  })

  it('rejects empty speech audio and returns MP3 bytes', async () => {
    stubFetch(() => new Response(new Uint8Array(100), { status: 200 }))
    expect(await kindOf(speech('gpt-4o-mini-tts', 'coral', 'Hi', 'i'))).toBe('badResponse')
    stubFetch(() => new Response(new Uint8Array(4096), { status: 200 }))
    expect((await speech('gpt-4o-mini-tts', 'coral', 'Hi', 'i')).byteLength).toBe(4096)
    expect(requests[0].url).toBe('https://api.openai.com/v1/audio/speech')
    expect(requests[0].body).toEqual({ model: 'gpt-4o-mini-tts', voice: 'coral', input: 'Hi', instructions: 'i', response_format: 'mp3' })
  })
})

describe('translation', () => {
  it('sends sentences with the previous paragraph as context (last 600 chars)', async () => {
    stubFetch(() => chat({ translations: ['Один.', 'Два.'] }))
    const result = await new OpenAITranslationProvider('gpt-5.4-mini').translate(['One.', 'Two.'], 'c'.repeat(700))
    expect(result).toEqual(['Один.', 'Два.'])
    const user = JSON.parse((requests[0].body.messages as { content: string }[])[1].content)
    expect(user.sentences).toEqual(['One.', 'Two.'])
    expect(user.context).toHaveLength(600)
    expect((requests[0].body.messages as { content: string }[])[0].content).toBe(prompts.translationSystemPrompt)
  })

  it('retries once when the count does not match, then fails', async () => {
    let calls = 0
    stubFetch(() => chat({ translations: ++calls === 1 ? ['only one'] : ['Один.', 'Два.'] }))
    expect(await new OpenAITranslationProvider('m').translate(['One.', 'Two.'])).toEqual(['Один.', 'Два.'])
    expect(calls).toBe(2)
    stubFetch(() => chat({ translations: ['only one'] }))
    await expect(new OpenAITranslationProvider('m').translate(['One.', 'Two.'])).rejects.toThrow('кількість речень не збігається')
    expect(requests).toHaveLength(2)
  })

  it('does not retry non-response errors', async () => {
    stubFetch(() => new Response('', { status: 401 }))
    expect(await kindOf(new OpenAITranslationProvider('m').translate(['One.']))).toBe('unauthorized')
    expect(requests).toHaveLength(1)
  })

  it('keeps the paragraph cache across instances (testTranslationStorePersistsAcrossInstances)', async () => {
    await new TranslationStore('book-1').save(['Один.', 'Два.'], { chapter: 0, paragraph: 3 })
    await closeDB()
    expect(await new TranslationStore('book-1').translation({ chapter: 0, paragraph: 3 })).toEqual(['Один.', 'Два.'])
    expect(await new TranslationStore('book-2').translation({ chapter: 0, paragraph: 3 })).toBeUndefined()
  })

  it('translates a fragment once and caches it by text and context', async () => {
    let calls = 0
    const provider = { translate: async (s: string[], c?: string | null) => { calls++; expect(c).toBe('ctx'); return s.map(() => 'жінка. Я рідко') } }
    expect(await translateFragment('b', 'woman. I have seldom', 'ctx', provider)).toBe('жінка. Я рідко')
    expect(await translateFragment('b', 'woman. I have seldom', 'ctx', provider)).toBe('жінка. Я рідко')
    expect(calls).toBe(1)
    expect(await fragmentCacheKey('a', 'b')).toMatch(/^[0-9a-f]{64}$/)
    expect(await new TranslationStore('b', 'fragments').translationForKey(await fragmentCacheKey('woman. I have seldom', 'ctx'))).toEqual(['жінка. Я рідко'])
  })

  it('test provider returns the long fixture line per sentence and counts requests', async () => {
    const before = translationStats.requests
    const lines = await new TestTranslationProvider().translate(['a', 'b'])
    expect(lines).toEqual([TestTranslationProvider.line, TestTranslationProvider.line])
    expect(translationStats.requests).toBe(before + 1)
  })
})

describe('word card', () => {
  it('tolerates missing optional fields (testWordCardDecodingToleratesMissingOptionalFields)', () => {
    const card = decodeWordCard({ headword: 'can', context_translation: 'можна' })!
    expect(card.lemma).toBe('can')
    expect(card.otherTranslations).toEqual([])
    expect(card.contextTranslation).toBe('можна')
    expect(decodeWordCard({ headword: 'can' })).toBeNull()
  })

  it('decodes level and forms, old and invalid cards (testWordCardDecodesLevelAndFormsAndOldCards)', () => {
    const card = decodeWordCard({ headword: 'went', lemma: 'go', context_translation: 'пішла', level: 'a1', forms: 'go — went — gone', irregular: true })!
    expect(card.level).toBe('A1')
    expect(card.forms).toBe('go — went — gone')
    expect(card.irregular).toBe(true)
    const old = decodeWordCard({ headword: 'can', context_translation: 'можна' })!
    expect([old.level, old.forms, old.irregular]).toEqual(['', '', false])
    expect(decodeWordCard({ headword: 'x', context_translation: 'х', level: 'X9' })!.level).toBe('')
    expect(decodeWordCard(JSON.parse(JSON.stringify(encodeWordCard(card))))).toEqual(card)
  })

  it('looks up once per word and sentence and keeps the card in the cache', async () => {
    stubFetch(() => chat({ headword: 'woman', lemma: 'woman', ipa: 'ˈwʊmən', part_of_speech: 'іменник', context_translation: 'жінка', level: 'A1', forms: 'woman — women', irregular: true }))
    const sentence = 'To Sherlock Holmes she is always the woman.'
    const card = await WordLookupService.lookup('woman', sentence, 'gpt-5.4-mini')
    expect(card.contextTranslation).toBe('жінка')
    expect(JSON.parse((requests[0].body.messages as { content: string }[])[1].content)).toEqual({ word: 'woman', sentence })
    expect((requests[0].body.messages as { content: string }[])[0].content).toBe(prompts.wordCardSystemPrompt)
    await closeDB()
    expect(await WordLookupService.lookup('Woman', sentence, 'gpt-5.4-mini')).toEqual(card)
    expect(requests).toHaveLength(1)
    expect(await WordLookupService.cached('woman', sentence)).toEqual(card)
  })
})

describe('explanation', () => {
  afterEach(() => { ExplanationService.fixture = null })

  it('is cached and regenerated only on request (testExplanationIsCachedAndRegeneratedOnlyOnRequest)', async () => {
    expect(ExplanationService.prompt('«{слово}» у «{контекст}»', 'woman', 'She is a woman.')).toBe('«woman» у «She is a woman.»')
    let answers = 0
    ExplanationService.fixture = (word) => `Пояснення ${word} №${++answers}`
    const before = ExplanationService.requestCount
    expect(await ExplanationService.cached('woman', 'S.', 'T', 'm')).toBeNull()
    const first = await ExplanationService.explain('woman', 'S.', 'T', 'm')
    const second = await ExplanationService.explain('Woman', 'S.', 'T', 'm')
    expect(second).toBe(first)
    expect(ExplanationService.requestCount).toBe(before + 1)
    const regenerated = await ExplanationService.explain('woman', 'S.', 'T', 'm', true)
    expect(regenerated).not.toBe(first)
    expect(ExplanationService.requestCount).toBe(before + 2)
    const otherTemplate = await ExplanationService.explain('woman', 'S.', 'T2', 'm')
    expect(otherTemplate).not.toBe(regenerated)
    await closeDB()
    expect(await ExplanationService.cached('woman', 'S.', 'T', 'm')).toBe(regenerated)
  })

  it('sends the filled template and rejects an empty explanation', async () => {
    stubFetch(() => chat({ explanation: '  Пояснення.  ' }))
    expect(await ExplanationService.explain('eclipses', 'She eclipses.', '{слово}|{контекст}', 'm2')).toBe('Пояснення.')
    expect((requests[0].body.messages as { content: string }[])[1].content).toBe('eclipses|She eclipses.')
    expect((requests[0].body.messages as { content: string }[])[0].content).toBe(prompts.explanationSystemPrompt)
    stubFetch(() => chat({ explanation: ' ' }))
    await expect(ExplanationService.explain('x', 'y', 'z', 'm3')).rejects.toThrow('порожнє пояснення')
  })
})

describe('verbatim Swift strings', () => {
  const file = 'build/swift-strings.json'
  const strings = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : null

  it.skipIf(!strings)('prompts match the Swift sources (run scripts/extract-swift-strings.ts first)', () => {
    expect(prompts.translationSystemPrompt).toBe(strings.translationSystemPrompt)
    expect(prompts.wordCardSystemPrompt).toBe(strings.wordCardSystemPrompt)
    expect(prompts.explanationSystemPrompt).toBe(strings.explanationSystemPrompt)
    expect(prompts.speechInstructions).toBe(strings.speechInstructions)
    expect(explanationDefaultTemplate).toBe(strings.explanationDefaultTemplate)
    expect(defaultExplanationTemplate).toBe(strings.explanationDefaultTemplate)
  })

  it.skipIf(!strings)('AI error texts match the Swift sources', () => {
    const swift = (key: string, values: Record<string, string> = {}) =>
      (strings.aiServiceErrors[key] as string).replace(/\\\((\w+)\)/g, (_, name) => values[name] ?? '')
    for (const kind of ['missingKey', 'unauthorized', 'rateLimited', 'quotaExceeded', 'offline', 'timeout'] as const) {
      expect(aiErrorText({ kind })).toBe(swift(kind))
    }
    expect(aiErrorText({ kind: 'server', status: 503 })).toBe(swift('server', { code: '503' }))
    expect(aiErrorText({ kind: 'badResponse', detail: 'x' })).toBe(swift('badResponse', { detail: 'x' }))
    expect(aiErrorText({ kind: 'http', status: 400, message: 'm' })).toBe('Помилка OpenAI (400): m.')
    expect(aiErrorText({ kind: 'http', status: 400, message: '' })).toBe('Помилка OpenAI (400).')
  })
})
