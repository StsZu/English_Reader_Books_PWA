// Port of EnglishReader/Views/ReaderViewModel.swift without the Apple offline fallback (V-01).
// State is held in signals so the reader view re-renders only what changed.
import { batch, signal } from '@preact/signals'
import {
  aiErrorText, errorMessage, isAbort, isAIError, needsSettings, ReplayMissingError, type TranslationProvider,
} from '../../contracts.ts'
import {
  paragraphKey, paragraphText, sameParagraph, sameSentence, type Book, type Chapter, type ParagraphRef, type SentenceRef,
} from '../../core/model/book.ts'
import { wordRanges, type WordRange } from '../../core/model/segmenter.ts'
import { makeTranslationProvider, translateFragment, TranslationStore } from '../../core/ai/translation.ts'
import { ExplanationService, WordLookupService } from '../../core/ai/word.ts'
import { OpenAISpeechEngine } from '../../core/speech/openai-speech.ts'
import { SystemSpeechEngine } from '../../core/speech/system-speech.ts'
import { currentVoiceEngine, pronounceWord, stopPronunciation } from '../../core/speech/engines.ts'
import { ReadingController } from '../../core/speech/reading.ts'
import { loadPosition, savePosition } from '../../core/storage/positions.ts'
import { settings } from '../../core/storage/settings.ts'
import {
  isSaved, pendingSentence, quoteFor, removeQuote, removeWordByLemma, saveQuote, saveWord, setPendingSentence,
  type SavedPlace,
} from '../../core/saved/saved.ts'
import type { WordLookup } from './types.ts'

export type TranslationState =
  | { kind: 'loading' }
  | { kind: 'done'; lines: string[] }
  | { kind: 'failed'; message: string }

export type SpeechKey = { kind: 'sentence'; ref: SentenceRef } | { kind: 'fragment'; text: string }

export const speechKeyID = (key: SpeechKey): string =>
  key.kind === 'sentence' ? `s:${paragraphKey(key.ref.paragraph)}:${key.ref.sentence}` : `f:${key.text}`

export interface SentenceSpeech {
  key: SpeechKey
  phase: 'preparing' | 'playing'
}

/** Position of a word inside a paragraph: sentence index and word index within the sentence. */
export interface WordPosition {
  sentence: number
  word: number
}

export const comparePositions = (a: WordPosition, b: WordPosition): number => a.sentence - b.sentence || a.word - b.word

export interface FragmentSelection {
  paragraph: ParagraphRef
  lower: WordPosition
  upper: WordPosition
  text: string
  context: string
}

export const selectionContains = (s: FragmentSelection, p: WordPosition): boolean =>
  comparePositions(s.lower, p) <= 0 && comparePositions(p, s.upper) <= 0

export type FragmentTranslation =
  | { kind: 'loading' }
  | { kind: 'done'; line: string }
  | { kind: 'failed'; message: string }
  | { kind: 'needsSettings'; message: string }

export const FRAGMENT_LIMIT = 600

let lookupCounter = 0

export class ReaderModel {
  readonly reading: ReadingController
  readonly chapter = signal(0)
  readonly topParagraph = signal(0)
  readonly translations = signal<ReadonlyMap<string, TranslationState>>(new Map())
  /** A blocking problem (missing or invalid key) shown once instead of on every paragraph. */
  readonly translationNotice = signal<string | null>(null)
  readonly wordLookup = signal<WordLookup | null>(null)
  readonly pronunciationNotice = signal<string | null>(null)
  readonly activeSentence = signal<SentenceRef | null>(null)
  /** Short playback of one selected sentence or fragment (long press, «Ще раз», «Прослухати»). */
  readonly sentenceSpeech = signal<SentenceSpeech | null>(null)
  readonly sentenceSpeechNotice = signal<string | null>(null)
  readonly selection = signal<FragmentSelection | null>(null)
  readonly fragmentTranslation = signal<FragmentTranslation | null>(null)
  readonly fragmentCopied = signal(false)
  /** Bumped when the view should scroll to `topParagraph` inside the current chapter. */
  readonly scrollRequest = signal(0)
  /** Speech keys whose audio is ready for «Ще раз» (AI: saved file; system: spoken this session). */
  readonly replayable = signal<ReadonlySet<string>>(new Set())
  readonly ready = signal(false)

  private readonly store: TranslationStore
  private readonly provider: () => TranslationProvider
  private pending: ParagraphRef[] = []
  private running = 0
  private readonly maxConcurrent = 2
  private readonly wordRangeCache = new Map<string, WordRange[]>()
  private readonly sentenceSpeakerAI: OpenAISpeechEngine
  private sentenceSpeakerSystem: SystemSpeechEngine | null = null
  private sentenceSpeechToken: number | null = null
  private speechCounter = 0
  private readonly spokenWithSystemVoice = new Set<string>()
  private fragmentToken = 0
  private selectionAnchor: WordPosition | null = null
  private longPressInProgress = false
  private lastLongPressEnd = 0

  constructor(readonly book: Book, options: { provider?: () => TranslationProvider; sentenceSpeaker?: OpenAISpeechEngine } = {}) {
    this.store = new TranslationStore(book.id)
    this.provider = options.provider ?? (() => makeTranslationProvider(settings.textModel.value))
    this.sentenceSpeakerAI = options.sentenceSpeaker
      ?? new OpenAISpeechEngine(settings.openAIVoice.value, settings.ttsModel.value, settings.speechRate.value)
    this.reading = new ReadingController(book)
  }

  /** Restores the saved position and selects a sentence opened from the saved list. */
  async load() {
    const saved = await loadPosition(this.book.id)
    const chapter = Math.min(saved?.chapter ?? 0, Math.max(0, this.book.chapters.length - 1))
    const count = this.book.chapters[chapter]?.paragraphs.length ?? 1
    batch(() => {
      this.chapter.value = chapter
      this.topParagraph.value = saved ? Math.min(saved.paragraph, count - 1) : 0
      this.ready.value = true
    })
    const pending = pendingSentence
    if (pending && pending.bookID === this.book.id) {
      setPendingSentence(null)
      if (this.isValid(pending.ref) && settings.showTranslation.value) this.select(pending.ref)
    }
  }

  get currentChapter(): Chapter {
    return this.book.chapters[this.chapter.value]
  }

  get position(): ParagraphRef {
    return { chapter: this.chapter.value, paragraph: this.topParagraph.value }
  }

  /** «Слухати»: from the selected sentence, otherwise from the top paragraph. */
  startReading() {
    this.stopSentenceSpeech()
    const active = this.activeSentence.value
    this.reading.play(active && this.isValid(active) ? active : this.position)
  }

  savePosition() {
    if (this.ready.value) void savePosition(this.book.id, this.position)
  }

  goToChapter(index: number, paragraph = 0) {
    if (index < 0 || index >= this.book.chapters.length) return
    this.hideParallelTranslation()
    batch(() => {
      this.topParagraph.value = paragraph
      this.chapter.value = index
    })
    this.savePosition()
  }

  // MARK: Translation

  isValid(ref: SentenceRef): boolean {
    const sentences = this.book.chapters[ref.paragraph.chapter]?.paragraphs[ref.paragraph.paragraph]?.sentences
    return !!sentences && ref.sentence >= 0 && ref.sentence < sentences.length
  }

  text(ref: SentenceRef): string {
    return this.book.chapters[ref.paragraph.chapter].paragraphs[ref.paragraph.paragraph].sentences[ref.sentence]
  }

  private setActive(ref: SentenceRef | null) {
    if (sameSentence(this.activeSentence.value, ref) || (!ref && !this.activeSentence.value)) return
    this.activeSentence.value = ref
    this.reading.choose(ref)
    this.stopSentenceSpeech()
    this.sentenceSpeechNotice.value = null
    if (ref) void this.refreshReplayable({ kind: 'sentence', ref })
  }

  handleWordTap(word: string, ref: SentenceRef) {
    if (!this.isValid(ref) || this.isSuppressedByLongPress) return
    if (this.selection.value) this.clearSelection()
    if (settings.showTranslation.value && !sameSentence(this.activeSentence.value, ref)) {
      this.select(ref)
    } else {
      this.lookUp(word, this.text(ref), ref)
    }
  }

  private place(ref: SentenceRef): SavedPlace {
    return {
      bookID: this.book.id, bookTitle: this.book.title,
      chapter: ref.paragraph.chapter, paragraph: ref.paragraph.paragraph, sentence: ref.sentence,
    }
  }

  get isLookupSaved(): boolean {
    const card = this.wordLookup.value?.card
    return !!card && isSaved(card.lemma || card.headword)
  }

  toggleSaveWord() {
    const lookup = this.wordLookup.value
    if (!lookup?.card || !lookup.ref) return
    if (this.isLookupSaved) void removeWordByLemma(lookup.card.lemma || lookup.card.headword)
    else void saveWord(lookup.card, lookup.sentence, this.place(lookup.ref))
  }

  get isFragmentSaved(): boolean {
    const selection = this.selection.value
    return !!selection && !!quoteFor(selection.text, this.book.id, selection.paragraph)
  }

  saveFragment() {
    const selection = this.selection.value
    const translation = this.fragmentTranslation.value
    if (!selection || translation?.kind !== 'done') return
    const existing = quoteFor(selection.text, this.book.id, selection.paragraph)
    if (existing) void removeQuote(existing.id)
    else void saveQuote(selection.text, translation.line, false,
      this.place({ paragraph: selection.paragraph, sentence: selection.lower.sentence }))
  }

  /** Goes to a saved place in this book and selects its sentence (G1). */
  show(place: SavedPlace) {
    const ref: SentenceRef = { paragraph: { chapter: place.chapter, paragraph: place.paragraph }, sentence: place.sentence }
    if (place.bookID !== this.book.id || !this.isValid(ref)) return
    if (place.chapter !== this.chapter.value) {
      this.goToChapter(place.chapter, place.paragraph)
    } else {
      this.hideParallelTranslation()
      this.topParagraph.value = place.paragraph
      this.scrollRequest.value++
      this.savePosition()
    }
    if (settings.showTranslation.value) this.select(ref)
  }

  private select(ref: SentenceRef) {
    this.setActive(ref)
    const map = new Map(this.translations.value)
    for (const queued of this.pending) if (!sameParagraph(queued, ref.paragraph)) map.delete(paragraphKey(queued))
    this.translations.value = map
    this.pending = this.pending.filter((p) => sameParagraph(p, ref.paragraph))
    this.requestTranslation(ref.paragraph)
  }

  /** True when the translation of this sentence is currently shown in the top panel. */
  isTranslationShown(ref: SentenceRef): boolean {
    if (!settings.showTranslation.value || !sameSentence(this.activeSentence.value, ref) || this.translationNotice.value) return false
    const state = this.translations.value.get(paragraphKey(ref.paragraph))
    return state?.kind === 'done' && ref.sentence < state.lines.length
  }

  translationState(ref: ParagraphRef): TranslationState | undefined {
    return this.translations.value.get(paragraphKey(ref))
  }

  private setTranslation(ref: ParagraphRef, state: TranslationState | null) {
    const map = new Map(this.translations.value)
    if (state) map.set(paragraphKey(ref), state)
    else map.delete(paragraphKey(ref))
    this.translations.value = map
  }

  requestTranslation(ref: ParagraphRef) {
    if (!settings.showTranslation.value || this.translationNotice.value || this.translationState(ref)) return
    this.setTranslation(ref, { kind: 'loading' })
    this.pending.push(ref)
    this.pump()
  }

  retry(ref: ParagraphRef) {
    this.setTranslation(ref, null)
    this.requestTranslation(ref)
  }

  /** Called after settings change: clears blocking errors and failed paragraphs. */
  retryFailed() {
    this.translationNotice.value = null
    const map = new Map(this.translations.value)
    for (const [key, state] of map) if (state.kind === 'failed') map.delete(key)
    this.translations.value = map
    const active = this.activeSentence.value
    if (active) this.requestTranslation(active.paragraph)
    if (this.selection.value && this.fragmentTranslation.value && this.fragmentTranslation.value.kind !== 'done') this.retryFragment()
  }

  private pump() {
    while (this.running < this.maxConcurrent && this.pending.length > 0) {
      // Visible paragraphs were requested last; serve them first.
      const ref = this.pending.pop()!
      this.running++
      void this.translate(ref).finally(() => {
        this.running--
        this.pump()
      })
    }
  }

  private async translate(ref: ParagraphRef) {
    const cached = await this.store.translation(ref)
    if (cached) {
      this.setTranslation(ref, { kind: 'done', lines: cached })
      return
    }
    if (this.translationNotice.value) {
      this.setTranslation(ref, null)
      return
    }
    const chapter = this.book.chapters[ref.chapter]
    const paragraph = chapter.paragraphs[ref.paragraph]
    const context = ref.paragraph > 0 ? paragraphText(chapter.paragraphs[ref.paragraph - 1]) : null
    try {
      const result = await this.provider().translate(paragraph.sentences, context)
      await this.store.save(result, ref)
      if (this.translationState(ref)) this.setTranslation(ref, { kind: 'done', lines: result })
    } catch (error) {
      const message = errorMessage(error)
      if (isAIError(error) && needsSettings(error.error)) {
        batch(() => {
          this.translationNotice.value = message
          const map = new Map(this.translations.value)
          map.delete(paragraphKey(ref))
          for (const queued of this.pending) map.delete(paragraphKey(queued))
          this.translations.value = map
          this.pending = []
        })
      } else {
        this.setTranslation(ref, { kind: 'failed', message })
      }
    }
  }

  hideParallelTranslation() {
    this.clearSelection()
    this.setActive(null)
    const map = new Map(this.translations.value)
    for (const queued of this.pending) map.delete(paragraphKey(queued))
    this.translations.value = map
    this.pending = []
  }

  // MARK: Long press (G4–G7)

  /** A tap that ends a long press must not also select a sentence or open a word card. */
  private get isSuppressedByLongPress(): boolean {
    return this.longPressInProgress || Date.now() - this.lastLongPressEnd < 500
  }

  longPressBegan() {
    this.longPressInProgress = true
  }

  /** `ref` and `word` are under the finger when the press was recognized; `moved` selects a fragment. */
  longPressEnded(ref: SentenceRef | null, word: WordPosition | null, moved: boolean) {
    this.longPressInProgress = false
    this.lastLongPressEnd = Date.now()
    if (moved) {
      if (this.selectionAnchor) this.finishSelection()
      return
    }
    if (!ref || !this.isValid(ref) || !settings.showTranslation.value) return
    const selection = this.selection.value
    if (selection && sameParagraph(selection.paragraph, ref.paragraph) && word && selectionContains(selection, word)) {
      this.speakFragment(false)
      return
    }
    if (this.isTranslationShown(ref)) this.speakSentence(ref, false)
    else if (!sameSentence(this.activeSentence.value, ref)) this.select(ref)
  }

  // MARK: Fragment selection (X1–X8)

  wordRanges(sentence: string): WordRange[] {
    let ranges = this.wordRangeCache.get(sentence)
    if (!ranges) {
      ranges = wordRanges(sentence)
      this.wordRangeCache.set(sentence, ranges)
    }
    return ranges
  }

  private wordsIn(paragraph: ParagraphRef): WordRange[][] {
    return this.book.chapters[paragraph.chapter].paragraphs[paragraph.paragraph].sentences.map((s) => this.wordRanges(s))
  }

  private isValidPosition(position: WordPosition, paragraph: ParagraphRef): boolean {
    if (!this.book.chapters[paragraph.chapter]?.paragraphs[paragraph.paragraph]) return false
    const ranges = this.wordsIn(paragraph)
    return position.sentence >= 0 && position.sentence < ranges.length
      && position.word >= 0 && position.word < ranges[position.sentence].length
  }

  /** English text from the start of `lower` to the end of `upper`, plus the full sentences around it. */
  fragmentText(paragraph: ParagraphRef, lower: WordPosition, upper: WordPosition): { text: string; context: string } {
    const sentences = this.book.chapters[paragraph.chapter].paragraphs[paragraph.paragraph].sentences
    const ranges = this.wordsIn(paragraph)
    const start = ranges[lower.sentence][lower.word].start
    const end = ranges[upper.sentence][upper.word].end
    let text: string
    if (lower.sentence === upper.sentence) {
      text = sentences[lower.sentence].slice(start, end)
    } else {
      text = [
        sentences[lower.sentence].slice(start),
        ...sentences.slice(lower.sentence + 1, upper.sentence),
        sentences[upper.sentence].slice(0, end),
      ].join(' ')
    }
    return { text, context: sentences.slice(lower.sentence, upper.sentence + 1).join(' ') }
  }

  /** Called while the finger moves after a long press; `anchor` is the word where the press began. */
  updateSelection(paragraph: ParagraphRef, anchor: WordPosition, focus: WordPosition) {
    if (!settings.showTranslation.value || !this.isValidPosition(anchor, paragraph) || !this.isValidPosition(focus, paragraph)) return
    if (!this.selectionAnchor || !sameParagraph(this.selection.value?.paragraph, paragraph)) {
      this.clearSelection()
      this.setActive(null)
      this.selectionAnchor = anchor
      this.reading.pause()
    }
    const [lower, upper] = comparePositions(anchor, focus) <= 0 ? [anchor, focus] : [focus, anchor]
    const current = this.selection.value
    if (current && comparePositions(current.lower, lower) === 0 && comparePositions(current.upper, upper) === 0) return
    const fragment = this.fragmentText(paragraph, lower, upper)
    // Stop growing at the limit; keep the last selection that fitted.
    if (fragment.text.length > FRAGMENT_LIMIT && current) return
    this.selection.value = { paragraph, lower, upper, text: fragment.text, context: fragment.context }
  }

  private finishSelection() {
    this.selectionAnchor = null
    const selection = this.selection.value
    if (selection) this.translateSelection(selection)
  }

  clearSelection() {
    this.selectionAnchor = null
    this.fragmentToken++
    if (this.sentenceSpeech.value?.key.kind === 'fragment') this.stopSentenceSpeech()
    batch(() => {
      this.selection.value = null
      this.fragmentTranslation.value = null
      this.fragmentCopied.value = false
    })
  }

  private translateSelection(fragment: FragmentSelection) {
    const token = ++this.fragmentToken
    this.fragmentCopied.value = false
    this.fragmentTranslation.value = { kind: 'loading' }
    void this.refreshReplayable({ kind: 'fragment', text: fragment.text })
    void (async () => {
      let result: FragmentTranslation
      try {
        result = { kind: 'done', line: await translateFragment(this.book.id, fragment.text, fragment.context, this.provider()) }
      } catch (error) {
        const message = errorMessage(error)
        result = isAIError(error) && needsSettings(error.error) ? { kind: 'needsSettings', message } : { kind: 'failed', message }
      }
      if (this.fragmentToken === token) this.fragmentTranslation.value = result
    })()
  }

  retryFragment() {
    const selection = this.selection.value
    if (selection) this.translateSelection(selection)
  }

  speakFragment(replay: boolean) {
    const selection = this.selection.value
    if (selection) this.speak({ kind: 'fragment', text: selection.text }, selection.text, replay)
  }

  async copyFragment() {
    const selection = this.selection.value
    if (!selection) return
    const parts = [selection.text]
    const translation = this.fragmentTranslation.value
    if (translation?.kind === 'done') parts.push(translation.line)
    try {
      await navigator.clipboard.writeText(parts.join('\n'))
    } catch {
      // Clipboard can be unavailable outside a user gesture; the label still confirms the attempt.
    }
    this.fragmentCopied.value = true
  }

  // MARK: Sentence speech (G4–G8)

  canReplay(key: SpeechKey): boolean {
    return this.replayable.value.has(speechKeyID(key))
  }

  private markReplayable(key: SpeechKey, ready: boolean) {
    const id = speechKeyID(key)
    if (this.replayable.value.has(id) === ready) return
    const next = new Set(this.replayable.value)
    if (ready) next.add(id)
    else next.delete(id)
    this.replayable.value = next
  }

  private keyText(key: SpeechKey): string {
    return key.kind === 'sentence' ? this.text(key.ref) : key.text
  }

  /** Re-checks whether audio for the key is ready with the current voice settings. */
  async refreshReplayable(key: SpeechKey) {
    if (currentVoiceEngine() === 'system') {
      this.markReplayable(key, this.spokenWithSystemVoice.has(speechKeyID(key)))
      return
    }
    this.configureSentenceSpeaker()
    this.markReplayable(key, await this.sentenceSpeakerAI.hasAudio(this.keyText(key)))
  }

  private configureSentenceSpeaker() {
    this.sentenceSpeakerAI.voice = settings.openAIVoice.value
    this.sentenceSpeakerAI.model = settings.ttsModel.value
    this.sentenceSpeakerAI.rate = settings.speechRate.value
    if (this.sentenceSpeakerSystem) this.sentenceSpeakerSystem.rate = settings.speechRate.value
  }

  /** Speaks one sentence once. `replay` plays only saved audio and never requests synthesis. */
  speakSentence(ref: SentenceRef, replay: boolean) {
    if (this.isValid(ref)) this.speak({ kind: 'sentence', ref }, this.text(ref), replay)
  }

  private speak(key: SpeechKey, text: string, replay: boolean) {
    const current = this.sentenceSpeech.value
    if (current && speechKeyID(current.key) === speechKeyID(key) && current.phase === 'preparing') return
    this.stopSentenceSpeech()
    this.reading.interrupt()
    stopPronunciation()
    this.configureSentenceSpeaker()
    const token = ++this.speechCounter
    batch(() => {
      this.sentenceSpeechNotice.value = null
      this.sentenceSpeechToken = token
      this.sentenceSpeech.value = { key, phase: 'preparing' }
    })
    const onStart = () => {
      if (this.sentenceSpeechToken === token) this.sentenceSpeech.value = { key, phase: 'playing' }
    }
    const system = () => (this.sentenceSpeakerSystem ??= new SystemSpeechEngine(settings.speechRate.value))
    void (async () => {
      try {
        if (currentVoiceEngine() === 'system') {
          this.spokenWithSystemVoice.add(speechKeyID(key))
          this.markReplayable(key, true)
          await system().speak(text, onStart).catch(() => {})
          return
        }
        try {
          if (replay) await this.sentenceSpeakerAI.replay(text, onStart)
          else await this.sentenceSpeakerAI.speak(text, onStart)
          this.markReplayable(key, true)
        } catch (error) {
          if (isAbort(error) || this.sentenceSpeechToken !== token) {
            // Stopped while preparing: the audio may still have been saved, so «Ще раз» can use it.
            void this.refreshReplayable(key)
            return
          }
          if (error instanceof ReplayMissingError) {
            this.sentenceSpeechNotice.value = error.message
            this.markReplayable(key, false)
            return
          }
          this.sentenceSpeechNotice.value = `ШІ-голос недоступний (${isAIError(error) ? aiErrorText(error.error) : 'помилка'}). Звучить системний голос.`
          await system().speak(text, onStart).catch(() => {})
        }
      } finally {
        if (this.sentenceSpeechToken === token) {
          this.sentenceSpeech.value = null
          this.sentenceSpeechToken = null
        }
      }
    })()
  }

  stopSentenceSpeech() {
    this.sentenceSpeechToken = null
    this.sentenceSpeakerAI.stop()
    this.sentenceSpeakerSystem?.stop()
    if (this.sentenceSpeech.value) this.sentenceSpeech.value = null
  }

  // MARK: Words

  lookUp(word: string, sentence: string, ref: SentenceRef | null = null) {
    this.reading.pause()
    const id = ++lookupCounter
    this.pronunciationNotice.value = null
    this.wordLookup.value = {
      id, word, sentence, ref, card: null, error: null, needsSettings: false,
      explanation: null, explaining: false, explanationError: null, explanationNeedsSettings: false,
    }
    const update = (patch: Partial<WordLookup>) => {
      const current = this.wordLookup.value
      if (current?.id === id) this.wordLookup.value = { ...current, ...patch }
    }
    const template = settings.explanationTemplate.value
    const model = settings.textModel.value
    // A saved explanation is shown at once; showing it never sends a request.
    void ExplanationService.cached(word, sentence, template, model).then((saved) => {
      if (saved) update({ explanation: saved })
    })
    void WordLookupService.lookup(word, sentence, model).then(
      (card) => update({ card }),
      (error) => update({ error: errorMessage(error), needsSettings: isAIError(error) && needsSettings(error.error) }),
    )
  }

  closeWordCard() {
    this.wordLookup.value = null
    this.stopPronunciation()
  }

  /** «Пояснити детальніше»: one paid request unless the explanation is saved; `regenerate` asks again. */
  explainWord(regenerate = false) {
    const lookup = this.wordLookup.value
    if (!lookup || lookup.explaining) return
    const id = lookup.id
    const update = (patch: Partial<WordLookup>) => {
      const current = this.wordLookup.value
      if (current?.id === id) this.wordLookup.value = { ...current, ...patch }
    }
    update({ explaining: true, explanationError: null, explanationNeedsSettings: false })
    void ExplanationService.explain(lookup.word, lookup.sentence, settings.explanationTemplate.value, settings.textModel.value, regenerate)
      .then(
        (text) => update({ explanation: text, explaining: false }),
        (error) => update({
          explanationError: errorMessage(error),
          explanationNeedsSettings: isAIError(error) && needsSettings(error.error),
          explaining: false,
        }),
      )
  }

  pronounce(text: string) {
    this.stopSentenceSpeech()
    this.reading.interrupt()
    this.pronunciationNotice.value = null
    void pronounceWord(text).then((result) => {
      if (result.fallbackReason) this.pronunciationNotice.value = result.fallbackReason
    })
  }

  stopPronunciation() {
    stopPronunciation()
  }

  /** Stops every sound owned by the reader (leaving the reader). */
  dispose() {
    this.savePosition()
    this.reading.stop()
    this.stopPronunciation()
    this.stopSentenceSpeech()
  }
}

