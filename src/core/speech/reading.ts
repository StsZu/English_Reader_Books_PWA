// Port of ReadingController.swift: reads the book aloud sentence by sentence from a starting paragraph.
import { signal } from '@preact/signals'
import { errorMessage, isAbort, type SpeechEngine } from '../../contracts.ts'
import { sentenceText, type Book, type ParagraphRef, type SentenceRef } from '../model/book.ts'
import { acquireWakeLock, releaseWakeLock, setMediaPlaybackState, setMediaSessionHandlers } from './audio.ts'
import { makeEngine } from './engines.ts'

export type ReadingState = 'idle' | 'loading' | 'playing' | 'paused'

export class ReadingController {
  readonly state = signal<ReadingState>('idle')
  readonly current = signal<SentenceRef | null>(null)
  readonly errorMessage = signal<string | null>(null)

  private engine: SpeechEngine | null = null
  /** Bumped on every play/stop so a cancelled loop never touches the state again. */
  private generation = 0

  constructor(private readonly book: Book, private readonly createEngine: () => SpeechEngine = () => makeEngine()) {}

  get isActive(): boolean {
    return this.state.value !== 'idle'
  }

  play(from: ParagraphRef) {
    this.stop()
    const queue = ReadingController.sentences(this.book, from)
    if (queue.length === 0) return
    const engine = this.createEngine()
    this.engine = engine
    const generation = ++this.generation
    this.state.value = 'loading'
    setMediaSessionHandlers({ play: () => this.resume(), pause: () => this.pause(), stop: () => this.stop() }, this.book.title)
    setMediaPlaybackState('playing')
    void acquireWakeLock()
    void this.run(queue, engine, generation)
  }

  private async run(queue: SentenceRef[], engine: SpeechEngine, generation: number) {
    for (let index = 0; index < queue.length; index++) {
      if (generation !== this.generation) return
      const ref = queue[index]
      this.current.value = ref
      if (this.state.value !== 'paused') this.state.value = 'loading'
      if (index + 1 < queue.length) engine.prefetch(sentenceText(this.book, queue[index + 1]))
      try {
        await engine.speak(sentenceText(this.book, ref), () => {
          if (generation === this.generation && this.state.value === 'loading') this.state.value = 'playing'
        })
      } catch (error) {
        if (isAbort(error) || generation !== this.generation) return
        this.errorMessage.value = errorMessage(error)
        this.finish()
        return
      }
    }
    if (generation === this.generation) this.finish()
  }

  pause() {
    if (this.state.value !== 'playing' && this.state.value !== 'loading') return
    this.engine?.pause()
    this.state.value = 'paused'
    setMediaPlaybackState('paused')
  }

  resume() {
    if (this.state.value !== 'paused') return
    this.engine?.resume()
    this.state.value = 'playing'
    setMediaPlaybackState('playing')
  }

  stop() {
    this.generation++
    this.engine?.stop()
    this.engine = null
    this.finish()
  }

  private finish() {
    this.generation++
    this.engine = null
    this.state.value = 'idle'
    this.current.value = null
    setMediaPlaybackState('none')
    setMediaSessionHandlers(null)
    void releaseWakeLock()
  }

  static sentences(book: Book, start: ParagraphRef, limit = 2000): SentenceRef[] {
    const result: SentenceRef[] = []
    let chapter = start.chapter
    let paragraph = start.paragraph
    while (chapter < book.chapters.length && result.length < limit) {
      const paragraphs = book.chapters[chapter].paragraphs
      while (paragraph < paragraphs.length && result.length < limit) {
        const ref = { chapter, paragraph }
        for (let index = 0; index < paragraphs[paragraph].sentences.length; index++) {
          result.push({ paragraph: ref, sentence: index })
        }
        paragraph += 1
      }
      chapter += 1
      paragraph = 0
    }
    return result
  }
}
