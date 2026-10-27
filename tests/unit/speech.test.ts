// Ported from EnglishReaderTests/ServiceTests.swift: sentence speech (G4–G8) and the reading queue.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ReplayMissingError, abortError, type SpeechEngine } from '../../src/contracts.ts'
import type { Book } from '../../src/core/model/book.ts'
import { setAudioBackend, type AudioBackend } from '../../src/core/speech/audio.ts'
import { OpenAISpeechEngine, silentWAV } from '../../src/core/speech/openai-speech.ts'
import { PREFETCH_PARTS, RETRY_DELAY_MS, ReadingController, speechParts } from '../../src/core/speech/reading.ts'
import { SystemSpeechEngine, phraseLimitMs } from '../../src/core/speech/system-speech.ts'

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

  it('reports a phrase cut off by another sound as AbortError, not as an error', async () => {
    const engine = new SystemSpeechEngine(1)
    const done = engine.speak('Cut.', () => {})
    const u = fake.current as unknown as { onerror: (e: { error: string }) => void }
    u.onerror({ error: 'interrupted' })
    await expect(done).rejects.toMatchObject({ name: 'AbortError' })
  })

  it('finishes when the end event never comes and fails a phrase that runs far too long', async () => {
    vi.useFakeTimers()
    const engine = new SystemSpeechEngine(1)
    const quiet = engine.speak('Quiet.', () => {})
    fake.speaking = false
    vi.advanceTimersByTime(2100)
    await expect(quiet).resolves.toBeUndefined()
    const stuck = engine.speak('Stuck.', () => {})
    const result = expect(stuck).rejects.toThrow('не відповідає')
    vi.advanceTimersByTime(phraseLimitMs('Stuck.', 1) + 1000)
    await result
    vi.useRealTimers()
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
  prefetched: string[] = []
  constructor(readonly prefersShortParts = false) {}
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
  /** Another sound took the audio: the phrase ends with AbortError although nobody called stop(). */
  cutOff() {
    const p = this.pending
    this.pending = null
    p?.reject(abortError())
  }
  prefetch(text: string) { this.prefetched.push(text) }
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

    vi.useFakeTimers()
    let attempts = 0
    const failing: SpeechEngine = {
      ...engine, speak: () => { attempts++; return Promise.reject(new Error('Немає звуку')) }, prefetch() {}, pause() {}, resume() {}, stop() {},
    }
    const second = new ReadingController(book, () => failing)
    second.play({ chapter: 0, paragraph: 0 })
    await vi.advanceTimersByTimeAsync(RETRY_DELAY_MS + 10)
    expect(attempts).toBe(2)
    expect(second.errorMessage.value).toBe('Немає звуку')
    expect(second.state.value).toBe('idle')
    vi.useRealTimers()
  })

  it('retries a failed sentence once and goes on', async () => {
    vi.useFakeTimers()
    const engine = new ScriptedEngine()
    let failed = false
    const flaky: SpeechEngine = {
      speak: (text, onStart) => {
        if (!failed) { failed = true; return Promise.reject(new Error('аудіо зависло')) }
        return engine.speak(text, onStart)
      },
      prefetch() {}, pause() {}, resume() {}, stop: () => engine.stop(),
    }
    const controller = new ReadingController(book, () => flaky)
    controller.play({ chapter: 0, paragraph: 0 })
    await vi.advanceTimersByTimeAsync(RETRY_DELAY_MS + 10)
    expect(engine.spoken).toEqual(['A.'])
    expect(controller.state.value).toBe('playing')
    expect(controller.errorMessage.value).toBeNull()
    controller.stop()
    vi.useRealTimers()
  })

  it('splits long sentences at clause boundaries, short ones stay whole', () => {
    expect(speechParts('Short one.')).toEqual(['Short one.'])
    const long = 'Pewnego razu zdarzyło się, że latarnik w Aspinwall, niedaleko Panamy, przepadł bez wieści; ponieważ stało się to wśród burzy, przypuszczano, że nieszczęśliwy musiał podejść nad sam brzeg skalistej wysepki — i został spłukany przez bałwan.'
    const parts = speechParts(long, 80)
    expect(parts.length).toBeGreaterThan(2)
    expect(parts.join(' ')).toBe(long)
    for (const part of parts) expect(part.length).toBeLessThanOrEqual(80)
    expect(parts[0].endsWith(',')).toBe(true)
    const words = speechParts('word '.repeat(60).trim(), 50)
    expect(words.join(' ')).toBe('word '.repeat(60).trim())
    for (const part of words) expect(part.length).toBeLessThanOrEqual(50)
  })

  it('speaks a long sentence in parts for the AI voice and prepares parts ahead', async () => {
    const long = `${'Alpha beta gamma delta, '.repeat(12)}end.`
    const longBook: Book = { ...book, chapters: [{ title: '1', paragraphs: [{ kind: 'text', sentences: ['Short.', long, 'Next.'] }] }] }
    const engine = new ScriptedEngine(true)
    const controller = new ReadingController(longBook, () => engine)
    controller.play({ chapter: 0, paragraph: 0 })
    await tick()
    const parts = speechParts(long)
    expect(parts.length).toBeGreaterThan(1)
    // While «Short.» plays, the parts of the long sentence after it are already being prepared.
    expect(engine.prefetched.slice(0, PREFETCH_PARTS)).toEqual([...parts, 'Next.'].slice(0, PREFETCH_PARTS))
    for (let i = 0; i <= parts.length; i++) {
      engine.finishCurrent()
      await tick()
    }
    expect(engine.spoken).toEqual(['Short.', ...parts, 'Next.'])
    expect(label([controller.current.value!])).toEqual(['0-0-2'])
    controller.stop()

    const system = new ScriptedEngine(false)
    const whole = new ReadingController(longBook, () => system)
    whole.play({ paragraph: { chapter: 0, paragraph: 0 }, sentence: 1 })
    await tick()
    expect(system.spoken).toEqual([long])
    whole.stop()
  })

  it('a long sentence cut off in the middle is replayed from its first part', async () => {
    const long = `${'Alpha beta gamma delta, '.repeat(12)}end.`
    const longBook: Book = { ...book, chapters: [{ title: '1', paragraphs: [{ kind: 'text', sentences: [long] }] }] }
    const engine = new ScriptedEngine(true)
    const controller = new ReadingController(longBook, () => engine)
    controller.play({ chapter: 0, paragraph: 0 })
    await tick()
    engine.finishCurrent()
    await tick()
    controller.interrupt()
    controller.resume()
    await tick()
    const parts = speechParts(long)
    expect(engine.spoken).toEqual([parts[0], parts[1], parts[0]])
    controller.stop()
  })

  it('starts at the selected sentence and reads on', async () => {
    const engine = new ScriptedEngine()
    const controller = new ReadingController(book, () => engine)
    controller.play({ paragraph: { chapter: 0, paragraph: 0 }, sentence: 1 })
    await tick()
    expect(label([controller.current.value!])).toEqual(['0-0-1'])
    engine.finishCurrent()
    await tick()
    engine.finishCurrent()
    await tick()
    expect(engine.spoken).toEqual(['B.', 'C.', 'D.'])
    controller.stop()
  })

  it('a sentence cut off by another sound pauses reading; resume plays it again', async () => {
    const engine = new ScriptedEngine()
    const controller = new ReadingController(book, () => engine)
    controller.play({ chapter: 0, paragraph: 0 })
    await tick()
    engine.cutOff()
    await tick()
    expect(controller.state.value).toBe('paused')
    controller.resume()
    await tick()
    expect(controller.state.value).toBe('playing')
    expect(engine.spoken).toEqual(['A.', 'A.'])
    engine.finishCurrent()
    await tick()
    expect(engine.spoken).toEqual(['A.', 'A.', 'B.'])
    controller.stop()
  })

  it('interrupt releases the audio and resume replays the current sentence', async () => {
    const engine = new ScriptedEngine()
    const controller = new ReadingController(book, () => engine)
    controller.play({ chapter: 0, paragraph: 1 })
    await tick()
    controller.pause()
    controller.interrupt()
    await tick()
    expect(controller.state.value).toBe('paused')
    controller.resume()
    await tick()
    expect(engine.spoken).toEqual(['C.', 'C.'])
    expect(engine.resumes).toBe(0)
    controller.stop()
  })

  it('resumes from a sentence chosen during the pause, not from one chosen while playing', async () => {
    const engine = new ScriptedEngine()
    const controller = new ReadingController(book, () => engine)
    controller.play({ chapter: 0, paragraph: 0 })
    await tick()
    controller.choose({ paragraph: { chapter: 1, paragraph: 0 }, sentence: 0 })
    controller.pause()
    controller.resume()
    expect(engine.resumes).toBe(1)
    controller.pause()
    controller.choose({ paragraph: { chapter: 0, paragraph: 1 }, sentence: 0 })
    controller.resume()
    await tick()
    expect(engine.spoken).toEqual(['A.', 'C.'])
    controller.pause()
    controller.choose({ paragraph: { chapter: 0, paragraph: 0 }, sentence: 0 })
    controller.resume()
    await tick()
    expect(engine.spoken).toEqual(['A.', 'C.', 'A.'])
    controller.stop()
  })
})
