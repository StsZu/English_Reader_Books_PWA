// Port of `TrainingSession` from EnglishReader/Services/Training.swift.
// State changes bump `revision`, so a component that reads `session.revision.value` re-renders.
import { signal } from '@preact/signals'
import type { SavedWord, TrainingUpdate } from '../saved/saved.ts'
import { Exercise, allExercises, defaultRng, isGraded, options as makeOptions, shuffled, tokens as makeTokens, update, type Rng } from './training.ts'

export interface Item {
  wordID: string
  isRepeat: boolean
}

export interface Token {
  id: number
  text: string
}

export interface Flash {
  index: number
  id: number
}

export type FinishHandler = (updates: Map<string, TrainingUpdate>) => void

let flashCounter = 0

export class TrainingSession {
  readonly revision = signal(0)
  readonly words: SavedWord[]
  readonly pool: SavedWord[]
  readonly exercises: Exercise[]
  private readonly onFinish: FinishHandler
  private readonly rng: Rng

  exerciseIndex = 0
  queue: Item[] = []
  position = 0
  mistakes = 0
  solved = false
  revealed = false
  finished = false
  /** Changes on every mistake (drives the shake animation). */
  lastMistake = 0
  options: string[] = []
  wrongOptions = new Set<string>()
  filled = 0
  bank: Token[] = []
  arrangement: Token[] = []
  selectedTile: number | null = null
  typedPosition = 0
  flash: Flash | null = null
  /** wordID → exercise → known. */
  readonly results = new Map<string, Map<Exercise, boolean>>()

  constructor(words: SavedWord[], pool: SavedWord[], exercises: Exercise[], onFinish: FinishHandler, rng: Rng = defaultRng) {
    this.words = words
    this.pool = pool
    this.exercises = exercises.length ? exercises : allExercises
    this.onFinish = onFinish
    this.rng = rng
    this.startExercise()
  }

  private changed() {
    this.revision.value++
  }

  get exercise(): Exercise {
    return this.exercises[Math.min(this.exerciseIndex, this.exercises.length - 1)]
  }

  get item(): Item | null {
    return this.queue[this.position] ?? null
  }

  get word(): SavedWord | null {
    const item = this.item
    return item ? this.words.find((w) => w.id === item.wordID) ?? null : null
  }

  get answer(): string {
    return this.word?.headword ?? ''
  }

  get answerTokens(): string[] {
    return makeTokens(this.answer)
  }

  get isOver(): boolean {
    return this.solved || this.revealed
  }

  get correctOption(): string {
    const word = this.word
    if (!word) return ''
    return this.exercise === Exercise.listen ? word.contextTranslation : word.headword
  }

  private startExercise() {
    this.queue = shuffled(this.words, this.rng).map((w) => ({ wordID: w.id, isRepeat: false }))
    this.position = 0
    this.prepareItem()
  }

  private prepareItem() {
    this.mistakes = 0
    this.solved = false
    this.revealed = false
    this.wrongOptions = new Set()
    this.selectedTile = null
    this.typedPosition = 0
    this.flash = null
    const word = this.word
    if (!word) return
    switch (this.exercise) {
      case Exercise.listen:
        this.options = makeOptions(word, this.pool, (w) => w.contextTranslation, 4, this.rng)
        break
      case Exercise.translate:
        this.options = makeOptions(word, this.pool, (w) => w.headword, 4, this.rng)
        break
      case Exercise.letters:
        this.filled = 0
        this.bank = shuffled(this.answerTokens.map((text, id) => ({ id, text })), this.rng)
        break
      case Exercise.pronunciation:
        break
      case Exercise.reorder: {
        const ordered = this.answerTokens.map((text, id) => ({ id, text }))
        const same = (a: Token[]) => a.map((t) => t.text).join('\u0000') === ordered.map((t) => t.text).join('\u0000')
        let arrangement = ordered
        for (let i = 0; i < 12 && same(arrangement); i++) arrangement = shuffled(arrangement, this.rng)
        this.arrangement = arrangement
        if (same(arrangement)) this.solved = true
        break
      }
    }
  }

  next() {
    if (!this.isOver) return
    this.position += 1
    if (this.position < this.queue.length) {
      this.prepareItem()
    } else {
      this.exerciseIndex += 1
      if (this.exerciseIndex < this.exercises.length) this.startExercise()
      else this.finish()
    }
    this.changed()
  }

  skipExercise() {
    this.position = this.queue.length
    this.solved = true
    this.next()
  }

  private record(known: boolean) {
    const item = this.item
    if (!item || item.isRepeat || !isGraded(this.exercise)) return
    let entry = this.results.get(item.wordID)
    if (!entry) this.results.set(item.wordID, (entry = new Map()))
    entry.set(this.exercise, known)
  }

  private succeed() {
    this.solved = true
    this.record(true)
  }

  private mistake() {
    this.mistakes += 1
    this.lastMistake += 1
    const item = this.item
    if (this.mistakes < 2 || !item) return
    this.revealed = true
    this.record(false)
    this.revealAnswer()
    if (!item.isRepeat) this.queue = [...this.queue, { wordID: item.wordID, isRepeat: true }]
  }

  private revealAnswer() {
    switch (this.exercise) {
      case Exercise.letters:
        this.filled = this.answerTokens.length
        this.bank = []
        break
      case Exercise.reorder:
        this.arrangement = this.answerTokens.map((text, id) => ({ id, text }))
        break
      default:
        break
    }
  }

  choose(option: string) {
    if (this.isOver || this.wrongOptions.has(option)) return
    if (option === this.correctOption) {
      this.succeed()
    } else {
      this.wrongOptions = new Set([...this.wrongOptions, option])
      this.mistake()
    }
    this.changed()
  }

  completePronunciation() {
    if (this.exercise !== Exercise.pronunciation) return
    this.solved = true
    this.next()
  }

  /** Exercise 3: the next letter (or phrase word), typed or tapped. */
  enter(text: string, tokenID?: number) {
    const answer = this.answerTokens
    if (this.isOver || this.filled >= answer.length) return
    if (text.toLowerCase() !== answer[this.filled].toLowerCase()) {
      this.mistake()
      this.changed()
      return
    }
    let index = tokenID !== undefined ? this.bank.findIndex((t) => t.id === tokenID) : -1
    if (index < 0) index = this.bank.findIndex((t) => t.text.toLowerCase() === text.toLowerCase())
    if (index >= 0) this.bank = this.bank.filter((_, i) => i !== index)
    this.filled += 1
    if (this.filled === answer.length) this.succeed()
    this.changed()
  }

  /** A key from the keyboard in exercises 3–4. */
  key(text: string) {
    if (this.exercise === Exercise.letters) this.enter(text)
    else if (this.exercise === Exercise.reorder) this.place(text)
  }

  /** Exercise 4 keyboard input: the word is always typed from its first letter. */
  place(text: string) {
    const answer = this.answerTokens
    if (this.isOver || this.typedPosition >= answer.length) return
    if (text.toLowerCase() !== answer[this.typedPosition].toLowerCase()) {
      this.mistake()
      this.changed()
      return
    }
    const letter = text.toLowerCase()
    if (!this.isCorrect(this.typedPosition)) {
      const source = this.arrangement.findIndex((t, i) => i !== this.typedPosition && !this.isCorrect(i) && t.text.toLowerCase() === letter)
      if (source < 0) {
        this.mistake()
        this.changed()
        return
      }
      this.selectedTile = null
      this.moveTiles(source, this.typedPosition)
    }
    this.flash = { index: this.typedPosition, id: ++flashCounter }
    this.typedPosition += 1
    this.changed()
  }

  isCorrect(index: number): boolean {
    const answer = this.answerTokens
    return index >= 0 && index < this.arrangement.length && index < answer.length && this.arrangement[index].text === answer[index]
  }

  tapTile(index: number) {
    if (this.isOver || index < 0 || index >= this.arrangement.length || this.isCorrect(index)) return
    if (this.selectedTile !== null) {
      const selected = this.selectedTile
      this.selectedTile = null
      if (selected !== index) this.moveTiles(selected, index)
    } else {
      this.selectedTile = index
    }
    this.changed()
  }

  /** Swaps two tiles; a tile moved to a wrong place is a mistake, correct tiles are fixed. */
  move(source: number, destination: number) {
    this.moveTiles(source, destination)
    this.changed()
  }

  private moveTiles(source: number, destination: number) {
    const n = this.arrangement.length
    if (this.isOver || source < 0 || destination < 0 || source >= n || destination >= n || source === destination
      || this.isCorrect(source) || this.isCorrect(destination)) return
    const next = [...this.arrangement]
    ;[next[source], next[destination]] = [next[destination], next[source]]
    this.arrangement = next
    if (next.every((_, i) => this.isCorrect(i))) this.succeed()
    else if (!this.isCorrect(destination)) this.mistake()
  }

  isUnknown(word: SavedWord): boolean {
    return [...(this.results.get(word.id)?.values() ?? [])].includes(false)
  }

  exercisesWithMistakes(word: SavedWord): Exercise[] {
    return [...(this.results.get(word.id) ?? new Map<Exercise, boolean>()).entries()]
      .filter(([, known]) => !known).map(([e]) => e).sort((a, b) => a - b)
  }

  get unknownWords(): SavedWord[] {
    return this.words.filter((w) => this.isUnknown(w))
  }

  get knownWords(): SavedWord[] {
    return this.words.filter((w) => this.results.has(w.id) && !this.isUnknown(w))
  }

  private finish() {
    this.finished = true
    const now = new Date()
    const updates = new Map<string, TrainingUpdate>()
    for (const word of this.words) {
      const result = update(word.trainingLevel, [...(this.results.get(word.id)?.values() ?? [])], now)
      if (result) updates.set(word.id, result)
    }
    this.onFinish(updates)
  }
}
