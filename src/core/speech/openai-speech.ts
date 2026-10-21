// Port of OpenAISpeechEngine (EnglishReader/Services/SpeechEngines.swift): MP3 per sentence,
// cached in Cache Storage under the same SHA-256 key the Swift app used for its file names.
import { abortError, AIError, ReplayMissingError, type ReplayableSpeech } from '../../contracts.ts'
import { testFlags } from '../../app/test-mode.ts'
import { sha256Hex } from '../util/hash.ts'
import { pauseAudio, playURL, resumeAudio, stopAudio } from './audio.ts'
import { speech } from '../ai/openai.ts'

/** Same text as OpenAISpeechEngine.instructions; part of the cache key. */
export const SPEECH_INSTRUCTIONS =
  'Read this sentence from a book aloud in clear, natural English with a neutral British accent, at a calm pace suitable for a language learner.'

export type Synthesizer = (model: string, voice: string, text: string) => Promise<ArrayBuffer>

const CACHE_NAME = 'tts'

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

  /** True when audio for the text with the current model and voice is already saved. */
  async hasAudio(text: string): Promise<boolean> {
    const cache = await caches.open(CACHE_NAME)
    return (await cache.match(await this.cacheKey(text))) !== undefined
  }

  /** Returns the cache key of saved audio, synthesizing it once if needed (shared by concurrent callers). */
  async audioURL(text: string): Promise<string> {
    const key = await this.cacheKey(text)
    const cache = await caches.open(CACHE_NAME)
    if (await cache.match(key)) return key
    const running = this.downloads.get(key)
    if (running) return running
    const { model, voice, synthesize } = this
    OpenAISpeechEngine.synthesisCount += 1
    const task = (async () => {
      const data = await synthesize(model, voice, text)
      await cache.put(key, new Response(data, { headers: { 'Content-Type': 'audio/mpeg' } }))
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
    const cache = await caches.open(CACHE_NAME)
    const generation = this.generation
    if (!(await cache.match(key))) throw new ReplayMissingError()
    if (generation !== this.generation) throw abortError()
    await this.play(key, true, onStart)
  }

  private async play(key: string, replay: boolean, onStart: () => void): Promise<void> {
    const cache = await caches.open(CACHE_NAME)
    const response = await cache.match(key)
    const fail = async (): Promise<never> => {
      await cache.delete(key)
      throw replay ? new ReplayMissingError() : new AIError({ kind: 'badResponse', detail: 'аудіо не відтворюється' })
    }
    if (!response) return fail()
    const blob = await response.blob()
    if (blob.size < 44) return fail()
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
      return fail()
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
