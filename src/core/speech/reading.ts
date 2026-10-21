// Port of ReadingController.swift: reads the book aloud sentence by sentence from a starting sentence.
import { signal } from '@preact/signals'
import { errorMessage, isAbort, type SpeechEngine } from '../../contracts.ts'
import { sentenceText, type Book, type ParagraphRef, type SentenceRef } from '../model/book.ts'
import { acquireWakeLock, releaseWakeLock, setMediaPlaybackState, setMediaSessionHandlers } from './audio.ts'
import { makeEngine } from './engines.ts'

export type ReadingState = 'idle' | 'loading' | 'playing' | 'paused'

/** Delay before the single retry of a sentence that failed to play. */
export const RETRY_DELAY_MS = 1000

const sameRef = (a: SentenceRef, b: SentenceRef) =>
  a.paragraph.chapter === b.paragraph.chapter && a.paragraph.paragraph === b.paragraph.paragraph && a.sentence === b.sentence

export class ReadingController {
  readonly state = signal<ReadingState>('idle')
  readonly current = signal<SentenceRef | null>(null)
  readonly errorMessage = signal<string | null>(null)

  private engine: SpeechEngine | null = null
  /** Bumped on every play/stop so a cancelled loop never touches the state again. */
  private generation = 0
  private queue: SentenceRef[] = []
  private index = 0
  /** The current sentence was cut off by another sound: resuming plays it again from its start. */
  private interrupted = false
  /** Sentence chosen by the reader during the pause: resuming starts there. */
  private chosen: SentenceRef | null = null

  constructor(private readonly book: Book, private readonly createEngine: () => SpeechEngine = () => makeEngine()) {}

  get isActive(): boolean {
    return this.state.value !== 'idle'
  }

  /** Starts at the sentence, or at the first sentence of the paragraph. */
  play(from: SentenceRef | ParagraphRef) {
    this.stop()
    const start = 'sentence' in from ? from : { paragraph: from, sentence: 0 }
    const queue = ReadingController.sentences(this.book, start.paragraph)
      .filter((ref) => ref.paragraph.chapter !== start.paragraph.chapter || ref.paragraph.paragraph !== start.paragraph.paragraph
        || ref.sentence >= start.sentence)
    if (queue.length === 0) return
    this.engine = this.createEngine()
    this.queue = queue
    setMediaSessionHandlers({ play: () => this.resume(), pause: () => this.pause(), stop: () => this.stop() }, this.book.title)
    void acquireWakeLock()
    this.start(0)
  }

  private start(index: number) {
    const engine = this.engine
    if (!engine) return
    const generation = ++this.generation
    this.index = index
    this.interrupted = false
    this.chosen = null
    this.state.value = 'loading'
    setMediaPlaybackState('playing')
    void this.run(engine, generation)
  }

  private async run(engine: SpeechEngine, generation: number) {
    let retried = false
    while (this.index < this.queue.length) {
      if (generation !== this.generation) return
      const ref = this.queue[this.index]
      this.current.value = ref
      if (this.state.value !== 'paused') this.state.value = 'loading'
      if (this.index + 1 < this.queue.length) engine.prefetch(sentenceText(this.book, this.queue[this.index + 1]))
      try {
        await engine.speak(sentenceText(this.book, ref), () => {
          if (generation === this.generation && this.state.value === 'loading') this.state.value = 'playing'
        })
      } catch (error) {
        if (generation !== this.generation) return
        if (isAbort(error)) {
          // Another sound took the audio (sentence speech, word pronunciation, iOS interruption).
          this.interrupted = true
          this.state.value = 'paused'
          setMediaPlaybackState('paused')
          return
        }
        if (!retried) {
          retried = true
          await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS))
          continue
        }
        this.errorMessage.value = errorMessage(error)
        this.finish()
        return
      }
      if (generation !== this.generation) return
      retried = false
      this.index += 1
    }
    if (generation === this.generation) this.finish()
  }

  pause() {
    if (this.state.value !== 'playing' && this.state.value !== 'loading') return
    this.engine?.pause()
    this.state.value = 'paused'
    setMediaPlaybackState('paused')
  }

  /** Releases the audio for another sound; `resume()` then replays the current sentence. */
  interrupt() {
    if (!this.isActive || !this.engine) return
    this.generation++
    this.engine.stop()
    this.interrupted = true
    this.state.value = 'paused'
    setMediaPlaybackState('paused')
  }

  /** Called when the reader selects a sentence; while paused it becomes the place to resume from. */
  choose(ref: SentenceRef | null) {
    if (this.state.value === 'paused') this.chosen = ref
  }

  /** Continues where reading paused, or from the sentence chosen during the pause. */
  resume() {
    if (this.state.value !== 'paused' || !this.engine) return
    const current = this.queue[this.index]
    const from = this.chosen
    if (from && current && !sameRef(from, current)) {
      const index = this.queue.findIndex((ref) => sameRef(ref, from))
      if (index >= 0) {
        this.engine.stop()
        this.start(index)
      } else {
        this.play(from)
      }
      return
    }
    if (this.interrupted) {
      this.engine.stop()
      this.start(this.index)
      return
    }
    this.engine.resume()
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
    this.queue = []
    this.index = 0
    this.interrupted = false
    this.chosen = null
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
