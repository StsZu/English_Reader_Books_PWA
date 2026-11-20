// Port of OpenAISpeechEngine (EnglishReader/Services/SpeechEngines.swift): MP3 per sentence,
// cached in Cache Storage under the same SHA-256 key the Swift app used for its file names.
import { abortError, AIError, ReplayMissingError, type ReplayableSpeech } from '../../contracts.ts'
import { speechInstructions } from '../language.ts'
import { testFlags } from '../../app/test-mode.ts'
import { sha256Hex } from '../util/hash.ts'
import { AudioUnplayableError, pauseAudio, playURL, resumeAudio, stopAudio } from './audio.ts'
import { speech } from '../ai/openai.ts'
import { isQuotaError } from '../storage/db.ts'

/** Same text as OpenAISpeechEngine.instructions; part of the cache key. */
export const SPEECH_INSTRUCTIONS = speechInstructions

export type Synthesizer = (model: string, voice: string, text: string) => Promise<ArrayBuffer>

const CACHE_NAME = 'tts'
/** V-23: saved MP3 files kept; the oldest go first. */
export const MAX_CACHED_AUDIO = 1000
/** V-23: audio that could not be saved stays playable in this tab; the oldest go first. */
export const MAX_MEMORY_AUDIO = 8

type AudioCache = Pick<Cache, 'match' | 'put' | 'delete' | 'keys'>

/** Deletes the oldest entries so that at most `keep` remain (Cache Storage lists keys in insertion order). */
async function trimCache(cache: AudioCache, keep: number) {
  const keys = await cache.keys()
  for (const request of keys.slice(0, Math.max(0, keys.length - keep))) await cache.delete(request)
}

/** Saves the file; when storage is full, drops the oldest half once and tries again. */
async function saveAudio(cache: AudioCache, key: string, data: ArrayBuffer) {
  const put = () => cache.put(key, new Response(data, { headers: { 'Content-Type': 'audio/mpeg' } }))
  try {
    await put()
  } catch (error) {
    if (!isQuotaError(error)) throw error
    await trimCache(cache, Math.floor((await cache.keys()).length / 2))
    await put()
  }
  await trimCache(cache, MAX_CACHED_AUDIO)
}

/** Network synthesis; replaced only by tests and the test-mode fixture. */
const networkSynthesizer: Synthesizer = (model, voice, text) => speech(model, voice, text, SPEECH_INSTRUCTIONS)

/** Silent 16-bit mono PCM WAV used instead of network audio in tests. */
export function silentWAV(seconds: number): ArrayBuffer {
  const sampleRate = 8000
  const samples = Math.floor(sampleRate * seconds)
  const buffer = new ArrayBuffer(44 + samples * 2)
  const view = new DataView(buffer)
  const ascii = (offset: number, s: string) => { for (let i = 0; i < s.length; i++) view.setUint8(offset + i, s.charCodeAt(i)) }
  ascii(0, 'RIFF'); view.setUint32(4, 36 + samples * 2, true); ascii(8, 'WAVE'); ascii(12, 'fmt ')
  view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true); view.setUint32(24, sampleRate, true)
  view.setUint32(28, sampleRate * 2, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true)
  ascii(36, 'data'); view.setUint32(40, samples * 2, true)
  return buffer
}

const fixtureNamespace = testFlags.speech ? `uitest-${crypto.randomUUID()}` : ''
const fixtureSynthesizer: Synthesizer = async () => {
  await new Promise((resolve) => setTimeout(resolve, 800))
  return silentWAV(4)
}

export class OpenAISpeechEngine implements ReplayableSpeech {
  /** Separates fixture audio from real cached audio. Empty for normal use. */
  static defaultCacheNamespace = fixtureNamespace
  static defaultSynthesizer: Synthesizer = testFlags.speech ? fixtureSynthesizer : networkSynthesizer
  /** Number of synthesis requests started in this page. */
  static synthesisCount = 0
  /** Audio whose cache write failed, by cache key (V-23). */
  static unsavedAudio = new Map<string, Blob>()

  readonly prefersShortParts = true

  synthesize: Synthesizer = OpenAISpeechEngine.defaultSynthesizer
  cacheNamespace = OpenAISpeechEngine.defaultCacheNamespace
  private downloads = new Map<string, Promise<string>>()
  private objectURL: string | null = null
  /** True while this engine owns the shared audio element. */
  private active = false
  /** Pause requested while audio was still being prepared: playback then starts paused. */
  private paused = false

  constructor(public voice: string, public model: string, public rate: number) {}

  async cacheKey(text: string): Promise<string> {
    const prefix = this.cacheNamespace ? `${this.cacheNamespace}|` : ''
    const digest = await sha256Hex(`${prefix}${this.model}|${this.voice}|${SPEECH_INSTRUCTIONS}|${text}`)
    return `https://tts.local/${digest}.mp3`
  }

  /** Saved audio from Cache Storage or, when that write failed, from this tab's memory. */
  private async savedAudio(key: string): Promise<Blob | null> {
    const response = await (await caches.open(CACHE_NAME)).match(key)
    if (response) return response.blob()
    return OpenAISpeechEngine.unsavedAudio.get(key) ?? null
  }

  private async hasSaved(key: string): Promise<boolean> {
    if (OpenAISpeechEngine.unsavedAudio.has(key)) return true
    return (await (await caches.open(CACHE_NAME)).match(key)) !== undefined
  }

  private static keepUnsaved(key: string, data: ArrayBuffer) {
    const memory = OpenAISpeechEngine.unsavedAudio
    memory.delete(key)
    memory.set(key, new Blob([data], { type: 'audio/mpeg' }))
    while (memory.size > MAX_MEMORY_AUDIO) memory.delete(memory.keys().next().value!)
  }

  /** True when audio for the text with the current model and voice is already saved. */
  async hasAudio(text: string): Promise<boolean> {
    return this.hasSaved(await this.cacheKey(text))
  }

  /** Returns the cache key of saved audio, synthesizing it once if needed (shared by concurrent callers). */
  async audioURL(text: string): Promise<string> {
    const key = await this.cacheKey(text)
    if (await this.hasSaved(key)) return key
    const running = this.downloads.get(key)
    if (running) return running
    const { model, voice, synthesize } = this
    OpenAISpeechEngine.synthesisCount += 1
    const task = (async () => {
      const data = await synthesize(model, voice, text)
      try {
        await saveAudio(await caches.open(CACHE_NAME), key, data)
      } catch (error) {
        console.warn('Speech cache write failed:', error)
        OpenAISpeechEngine.keepUnsaved(key, data)
      }
      return key
    })()
    this.downloads.set(key, task)
    try {
      return await task
    } finally {
      this.downloads.delete(key)
    }
  }

  prefetch(text: string) {
    this.audioURL(text).catch(() => {})
  }

  async speak(text: string, onStart: () => void): Promise<void> {
    this.stop()
    const generation = this.generation
    const key = await this.audioURL(text)
    // stop() while the audio was being prepared: a late file must not start playing (G8).
    if (generation !== this.generation) throw abortError()
    await this.play(key, false, onStart)
  }

  /** Plays previously saved audio; never sends a synthesis request. */
  async replay(text: string, onStart: () => void): Promise<void> {
    this.stop()
    const key = await this.cacheKey(text)
    const generation = this.generation
    if (!(await this.hasSaved(key))) throw new ReplayMissingError()
    if (generation !== this.generation) throw abortError()
    await this.play(key, true, onStart)
  }

  private async play(key: string, replay: boolean, onStart: () => void): Promise<void> {
    const fail = async (): Promise<never> => {
      OpenAISpeechEngine.unsavedAudio.delete(key)
      await (await caches.open(CACHE_NAME)).delete(key)
      throw replay ? new ReplayMissingError() : new AIError({ kind: 'badResponse', detail: 'аудіо не відтворюється' })
    }
    const blob = await this.savedAudio(key)
    if (!blob || blob.size < 44) return fail()
    this.releaseURL()
    const url = URL.createObjectURL(blob)
    this.objectURL = url
    this.active = true
    try {
      const playback = playURL(url, Math.min(2, Math.max(0.5, this.rate)), onStart)
      if (this.paused) pauseAudio()
      await playback
    } catch (error) {
      if ((error as { name?: string })?.name === 'AbortError') throw error
      // Only a file that cannot be played is removed; a stall or interruption keeps the paid audio for the retry.
      if (error instanceof AudioUnplayableError) return fail()
      throw new AIError({ kind: 'badResponse', detail: 'аудіо не відтворюється' })
    } finally {
      if (this.objectURL === url) {
        this.active = false
        this.releaseURL()
      }
    }
  }

  /** Bumped by stop(); a speak/replay that started earlier is cancelled when it resumes. */
  private generation = 0

  private releaseURL() {
    if (this.objectURL) URL.revokeObjectURL(this.objectURL)
    this.objectURL = null
  }

  pause() {
    this.paused = true
    if (this.active) pauseAudio()
  }

  resume() {
    this.paused = false
    if (this.active) resumeAudio()
  }

  stop() {
    this.generation++
    if (this.active) stopAudio()
    this.active = false
    this.paused = false
  }
}
