// Ported from EnglishReaderTests/ServiceTests.swift: sentence speech (G4–G8) and the reading queue.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ReplayMissingError, abortError, type SpeechEngine } from '../../src/contracts.ts'
import type { Book } from '../../src/core/model/book.ts'
import { setAudioBackend, type AudioBackend } from '../../src/core/speech/audio.ts'
import { OpenAISpeechEngine, silentWAV } from '../../src/core/speech/openai-speech.ts'
import { ReadingController } from '../../src/core/speech/reading.ts'
import { SystemSpeechEngine, bestEnglishVoice } from '../../src/core/speech/system-speech.ts'

// MARK: - Minimal Cache Storage (happy-dom has none)

class MemoryCache {
  entries = new Map<string, { body: ArrayBuffer; type: string }>()
  async match(key: string) {
    const entry = this.entries.get(key)
    return entry ? new Response(entry.body.slice(0), { headers: { 'Content-Type': entry.type } }) : undefined
  }
  async put(key: string, response: Response) {
    this.entries.set(key, { body: await response.arrayBuffer(), type: response.headers.get('Content-Type') ?? '' })
  }
  async delete(key: string) {
    return this.entries.delete(key)
  }
}

const memoryCaches = new Map<string, MemoryCache>()
Object.defineProperty(globalThis, 'caches', {
  configurable: true,
  value: {
    open: async (name: string) => {
      if (!memoryCaches.has(name)) memoryCaches.set(name, new MemoryCache())
      return memoryCaches.get(name)!
    },
  },
})

// MARK: - Fake playback

class FakeBackend implements AudioBackend {
  plays = 0
  private pending: { resolve: () => void; reject: (e: unknown) => void } | null = null
  async play(_url: string, _rate: number, onStart: () => void) {
    this.stop()
    this.plays += 1
    onStart()
    await new Promise<void>((resolve, reject) => {
      this.pending = { resolve, reject }
      setTimeout(() => {
        if (this.pending?.resolve === resolve) {
          this.pending = null
          resolve()
        }
      }, 5)
    })
  }
  pause() {}
  resume() {}
  stop() {
    const pending = this.pending
    this.pending = null
    pending?.reject(abortError())
  }
}

let backend: FakeBackend

beforeEach(() => {
  backend = new FakeBackend()
  setAudioBackend(backend)
})

afterEach(() => setAudioBackend(null))

function fixtureEngine() {
  const counter = { calls: 0 }
  const engine = new OpenAISpeechEngine('coral', 'gpt-4o-mini-tts', 1)
  engine.cacheNamespace = `unit-${crypto.randomUUID()}`
  engine.synthesize = async () => {
    counter.calls += 1
    await new Promise((resolve) => setTimeout(resolve, 20))
    return silentWAV(0.2)
  }
  return { engine, counter }
}

describe('OpenAISpeechEngine', () => {
  it('replays saved audio without synthesis; another voice and damaged audio never synthesize', async () => {
    const { engine, counter } = fixtureEngine()
    const text = `Replay ${crypto.randomUUID()}.`
    expect(await engine.hasAudio(text)).toBe(false)
    await engine.speak(text, () => {})
    expect(counter.calls).toBe(1)
    expect(await engine.hasAudio(text)).toBe(true)
    for (let i = 0; i < 3; i++) await engine.replay(text, () => {})
    await engine.speak(text, () => {})
    expect(counter.calls).toBe(1)

    engine.voice = 'sage'
    expect(await engine.hasAudio(text)).toBe(false)
    await expect(engine.replay(text, () => {})).rejects.toBeInstanceOf(ReplayMissingError)
    expect(counter.calls).toBe(1)

    engine.voice = 'coral'
    const cache = await caches.open('tts')
    await cache.put(await engine.cacheKey(text), new Response('broken'))
    await expect(engine.replay(text, () => {})).rejects.toBeInstanceOf(ReplayMissingError)
    expect(await engine.hasAudio(text)).toBe(false)
    expect(counter.calls).toBe(1)
  })

  it('concurrent requests share one synthesis', async () => {
    const { engine, counter } = fixtureEngine()
    const text = `Shared ${crypto.randomUUID()}.`
    const [first, second] = await Promise.all([engine.audioURL(text), engine.audioURL(text)])
    expect(first).toBe(second)
    expect(counter.calls).toBe(1)
  })

  it('cache key uses model, voice, instructions and text like the Swift engine', async () => {
    const engine = new OpenAISpeechEngine('coral', 'gpt-4o-mini-tts', 1)
    engine.cacheNamespace = ''
    const key = await engine.cacheKey('Hello.')
    expect(key).toMatch(/^https:\/\/tts\.local\/[0-9a-f]{64}\.mp3$/)
    engine.model = 'other'
    expect(await engine.cacheKey('Hello.')).not.toBe(key)
  })

  it('stop rejects the running speech with AbortError', async () => {
    const { engine } = fixtureEngine()
    const text = `Stop ${crypto.randomUUID()}.`
    await engine.audioURL(text)
    const speaking = engine.speak(text, () => {})
    await new Promise((resolve) => setTimeout(resolve, 1))
    engine.stop()
    await expect(speaking).rejects.toMatchObject({ name: 'AbortError' })
  })
})

// MARK: - System voice

class FakeSynthesis {
  speaking = false
  paused = false
  pending = false
  current: SpeechSynthesisUtterance | null = null
  spoken: string[] = []
  speak(u: SpeechSynthesisUtterance) {
    this.current = u
    this.speaking = true
    this.spoken.push(u.text)
  }
  pause() { this.paused = true }
  resume() { /* WebKit bug: does not resume */ }
  cancel() {
    this.speaking = false
    this.current = null
  }
  getVoices() { return [] }
  end() {
    const u = this.current
    this.current = null
    this.speaking = false
    u?.onend?.(new Event('end') as SpeechSynthesisEvent)
  }
}

describe('SystemSpeechEngine', () => {
  let fake: FakeSynthesis
  beforeEach(() => {
    fake = new FakeSynthesis()
    vi.stubGlobal('speechSynthesis', fake)
    vi.stubGlobal('SpeechSynthesisUtterance', class {
      text: string; voice = null; lang = ''; rate = 1
      onend: ((e: Event) => void) | null = null
      onerror = null; onresume = null; onboundary = null
      constructor(text: string) { this.text = text }
    })
  })
  afterEach(() => vi.unstubAllGlobals())

  it('resolves at the end of the phrase and rejects with AbortError on stop', async () => {
    const engine = new SystemSpeechEngine(1)
    const done = engine.speak('One.', () => {})
    fake.end()
    await expect(done).resolves.toBeUndefined()
    const stopped = engine.speak('Two.', () => {})
    engine.stop()
    await expect(stopped).rejects.toMatchObject({ name: 'AbortError' })
  })

  it('restarts the phrase when resume does not continue (V-08)', async () => {
    vi.useFakeTimers()
    const engine = new SystemSpeechEngine(1)
    const done = engine.speak('Phrase.', () => {})
    engine.pause()
    engine.resume()
    vi.advanceTimersByTime(1100)
    expect(fake.spoken).toEqual(['Phrase.', 'Phrase.'])
    fake.end()
    await expect(done).resolves.toBeUndefined()
    vi.useRealTimers()
  })

  it('prefers higher-quality voices, then British English', () => {
    const voice = (name: string, lang: string, localService = true) => ({ name, lang, localService }) as SpeechSynthesisVoice
    const voices = [voice('Daniel', 'en-GB'), voice('Samantha (Enhanced)', 'en-US'), voice('Thomas', 'fr-FR')]
    expect(bestEnglishVoice(voices)?.name).toBe('Samantha (Enhanced)')
    expect(bestEnglishVoice([voice('Alex', 'en-US'), voice('Daniel', 'en-GB')])?.name).toBe('Daniel')
  })
})

// MARK: - Reading queue

const book: Book = {
  id: 'b', title: 't', author: '', format: 'txt', importedAt: '2026-10-21T00:00:00Z',
  chapters: [
    { title: '1', paragraphs: [{ kind: 'text', sentences: ['A.', 'B.'] }, { kind: 'text', sentences: ['C.'] }] },
    { title: '2', paragraphs: [{ kind: 'text', sentences: ['D.'] }] },
  ],
}

const label = (refs: { paragraph: { chapter: number; paragraph: number }; sentence: number }[]) =>
  refs.map((r) => `${r.paragraph.chapter}-${r.paragraph.paragraph}-${r.sentence}`)

class ScriptedEngine implements SpeechEngine {
  spoken: string[] = []
  pauses = 0
  resumes = 0
  private pending: { resolve: () => void; reject: (e: unknown) => void } | null = null
  speak(text: string, onStart: () => void) {
    this.spoken.push(text)
    onStart()
    return new Promise<void>((resolve, reject) => { this.pending = { resolve, reject } })
  }
  finishCurrent() {
    const p = this.pending
    this.pending = null
    p?.resolve()
  }
  prefetch() {}
  pause() { this.pauses++ }
  resume() { this.resumes++ }
  stop() {
    const p = this.pending
    this.pending = null
    p?.reject(abortError())
  }
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 0))

describe('ReadingController', () => {
  it('queue crosses chapters', () => {
    expect(label(ReadingController.sentences(book, { chapter: 0, paragraph: 1 }))).toEqual(['0-1-0', '1-0-0'])
  })

  it('queue respects the limit per whole paragraph', () => {
    expect(label(ReadingController.sentences(book, { chapter: 0, paragraph: 0 }, 1))).toEqual(['0-0-0', '0-0-1'])
    expect(ReadingController.sentences(book, { chapter: 0, paragraph: 0 })).toHaveLength(4)
  })

  it('plays, pauses, resumes and stops', async () => {
    const engine = new ScriptedEngine()
    const controller = new ReadingController(book, () => engine)
    controller.play({ chapter: 0, paragraph: 0 })
    await tick()
    expect(controller.state.value).toBe('playing')
    expect(controller.current.value?.sentence).toBe(0)
    controller.pause()
    expect(controller.state.value).toBe('paused')
    controller.resume()
    expect(controller.state.value).toBe('playing')
    expect([engine.pauses, engine.resumes]).toEqual([1, 1])
    engine.finishCurrent()
    await tick()
    expect(engine.spoken).toEqual(['A.', 'B.'])
    controller.stop()
    await tick()
    expect(controller.state.value).toBe('idle')
    expect(controller.current.value).toBeNull()
    expect(controller.isActive).toBe(false)
  })

  it('finishes after the last sentence and reports errors', async () => {
    const engine = new ScriptedEngine()
    const controller = new ReadingController(book, () => engine)
    controller.play({ chapter: 1, paragraph: 0 })
    await tick()
    engine.finishCurrent()
    await tick()
    expect(controller.state.value).toBe('idle')

    const failing: SpeechEngine = { ...engine, speak: () => Promise.reject(new Error('Немає звуку')), prefetch() {}, pause() {}, resume() {}, stop() {} }
    const second = new ReadingController(book, () => failing)
    second.play({ chapter: 0, paragraph: 0 })
    await tick()
    expect(second.errorMessage.value).toBe('Немає звуку')
    expect(second.state.value).toBe('idle')
  })
})
