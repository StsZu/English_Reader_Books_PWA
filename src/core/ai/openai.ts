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

async function post(path: string, json: unknown, timeoutMs: number, signal?: AbortSignal): Promise<Response> {
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
    if (!response.ok) throw new AIError(mapError(response.status, await response.text().catch(() => '')))
    return response
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
  const response = await post('chat/completions', body, 60_000, signal)
  let parsed: ChatResponse
  try {
    parsed = await response.json()
  } catch {
    throw new AIError({ kind: 'badResponse', detail: 'немає choices' })
  }
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
  // The audio arrives as a stream: the time limit covers the body too, not only the headers.
  const controller = new AbortController()
  let timedOut = false
  const timer = setTimeout(() => {
    timedOut = true
    controller.abort()
  }, SPEECH_TIMEOUT_MS)
  const onAbort = () => controller.abort()
  signal?.addEventListener('abort', onAbort)
  try {
    const response = await post('audio/speech', { model, voice, input, instructions, response_format: 'mp3' }, SPEECH_TIMEOUT_MS, controller.signal)
    // post() no longer forwards the abort once the headers arrived, so the body read races it.
    const aborted = new Promise<never>((_, reject) => {
      if (controller.signal.aborted) reject(abortError())
      controller.signal.addEventListener('abort', () => {
        response.body?.cancel().catch(() => {})
        reject(abortError())
      }, { once: true })
    })
    const data = await Promise.race([response.arrayBuffer(), aborted])
    if (data.byteLength <= 512) throw new AIError({ kind: 'badResponse', detail: 'порожнє аудіо' })
    return data
  } catch (error) {
    if (timedOut) throw new AIError({ kind: 'timeout' })
    if (signal?.aborted) throw abortError()
    throw error
  } finally {
    clearTimeout(timer)
    signal?.removeEventListener('abort', onAbort)
  }
}
