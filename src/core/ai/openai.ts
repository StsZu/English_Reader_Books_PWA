// Port of EnglishReader/Services/OpenAIClient.swift: Chat Completions in JSON mode and text-to-speech,
// with HTTP and network failures mapped to AIServiceError.
import { AIError, abortError, type AIServiceError } from '../../contracts.ts'
import { openAIKey } from '../storage/key.ts'

export const baseURL = 'https://api.openai.com/v1/'

type KeyProvider = () => Promise<string | null>

let keyProvider: KeyProvider = async () => openAIKey()

/** Replaces where the API key comes from (tests, live tests). */
export function setKeyProvider(provider: KeyProvider) {
  keyProvider = provider
}

async function apiKey(): Promise<string> {
  const key = (await keyProvider())?.trim()
  if (!key) throw new AIError({ kind: 'missingKey' })
  return key
}

export function mapError(status: number, body: string): AIServiceError {
  let parsed: { error?: { message?: string; code?: string; type?: string } } | null = null
  try {
    parsed = JSON.parse(body)
  } catch {
    parsed = null
  }
  const error = parsed?.error
  if (status === 401 || status === 403) return { kind: 'unauthorized' }
  if (status === 429) {
    if (error?.code === 'insufficient_quota' || error?.type === 'insufficient_quota') return { kind: 'quotaExceeded' }
    return { kind: 'rateLimited' }
  }
  if (status >= 500 && status <= 599) return { kind: 'server', status }
  return { kind: 'http', status, message: (error?.message ?? '').slice(0, 160) }
}

/**
 * POST with one deadline for the whole exchange (R3): headers, body and `read` of the body. A body that
 * stops arriving ends with `timeout`, and an abort stops the read even if the body itself ignores it.
 */
async function post<T>(path: string, json: unknown, timeoutMs: number, read: (response: Response) => Promise<T>, signal?: AbortSignal): Promise<T> {
  const key = await apiKey()
  if (signal?.aborted) throw abortError()
  const controller = new AbortController()
  let timedOut = false
  const timer = setTimeout(() => {
    timedOut = true
    controller.abort()
  }, timeoutMs)
  const onAbort = () => controller.abort()
  signal?.addEventListener('abort', onAbort)
  try {
    let response: Response
    try {
      response = await fetch(baseURL + path, {
        method: 'POST',
        headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(json),
        signal: controller.signal,
      })
    } catch (error) {
      if (timedOut) throw new AIError({ kind: 'timeout' })
      if (signal?.aborted) throw abortError()
      if (error instanceof TypeError || (typeof navigator !== 'undefined' && navigator.onLine === false)) {
        throw new AIError({ kind: 'offline' })
      }
      throw new AIError({ kind: 'http', status: -1, message: error instanceof Error ? error.message : String(error) })
    }
    const aborted = new Promise<never>((_, reject) => {
      const stop = () => {
        response.body?.cancel().catch(() => {})
        reject(abortError())
      }
      if (controller.signal.aborted) stop()
      else controller.signal.addEventListener('abort', stop, { once: true })
    })
    aborted.catch(() => {})
    if (!response.ok) throw new AIError(mapError(response.status, await Promise.race([response.text().catch(() => ''), aborted])))
    return await Promise.race([read(response), aborted])
  } catch (error) {
    if (timedOut) throw new AIError({ kind: 'timeout' })
    if (signal?.aborted) throw abortError()
    throw error
  } finally {
    clearTimeout(timer)
    signal?.removeEventListener('abort', onAbort)
  }
}

interface ChatResponse {
  choices?: { message?: { content?: string | null }; finish_reason?: string | null }[]
}

/**
 * Chat Completions call in JSON mode; returns the assistant JSON validated by `validate`,
 * which returns the typed value or null when the JSON does not match the schema.
 */
export async function chatJSON<T>(
  model: string,
  system: string,
  user: string,
  validate: (value: unknown) => T | null,
  signal?: AbortSignal,
): Promise<T> {
  const body: Record<string, unknown> = {
    model,
    response_format: { type: 'json_object' },
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: user },
    ],
  }
  if (model.startsWith('gpt-5') || model.startsWith('o')) body.reasoning_effort = 'low'
  const parsed = await post('chat/completions', body, 60_000, async (response): Promise<ChatResponse> => {
    try {
      return await response.json()
    } catch {
      throw new AIError({ kind: 'badResponse', detail: 'немає choices' })
    }
  }, signal)
  const choice = parsed.choices?.[0]
  if (!choice) throw new AIError({ kind: 'badResponse', detail: 'немає choices' })
  if (choice.finish_reason === 'length') throw new AIError({ kind: 'badResponse', detail: 'відповідь обрізана' })
  const content = choice.message?.content
  if (content == null) throw new AIError({ kind: 'badResponse', detail: 'порожній вміст' })
  let value: unknown
  try {
    value = JSON.parse(content)
  } catch {
    throw new AIError({ kind: 'badResponse', detail: 'JSON не відповідає схемі' })
  }
  const result = validate(value)
  if (result === null) throw new AIError({ kind: 'badResponse', detail: 'JSON не відповідає схемі' })
  return result
}

export const SPEECH_TIMEOUT_MS = 60_000

/** Text-to-speech; returns MP3 bytes. */
export async function speech(model: string, voice: string, input: string, instructions: string, signal?: AbortSignal): Promise<ArrayBuffer> {
  // The audio arrives as a stream: the time limit of post() covers the body too, not only the headers.
  return post('audio/speech', { model, voice, input, instructions, response_format: 'mp3' }, SPEECH_TIMEOUT_MS, async (response) => {
    const data = await response.arrayBuffer()
    if (data.byteLength <= 512) throw new AIError({ kind: 'badResponse', detail: 'порожнє аудіо' })
    return data
  }, signal)
}
