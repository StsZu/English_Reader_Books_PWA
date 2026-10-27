// Port of `enum Training` from EnglishReader/Services/Training.swift: set selection, distractors,
// tokens and spaced-repetition levels.
import type { SavedWord, TrainingUpdate } from '../saved/saved.ts'
import { sourceLanguageName } from '../language.ts'
import { wordKey } from '../saved/saved.ts'

/** Random source returning values in [0, 1); injectable for deterministic tests. */
export type Rng = () => number

export const defaultRng: Rng = Math.random

export function shuffled<T>(items: readonly T[], rng: Rng = defaultRng): T[] {
  const result = [...items]
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1))
    ;[result[i], result[j]] = [result[j], result[i]]
  }
  return result
}

export type TrainingMode = 'automatic' | 'manual' | 'random'

export const modeTitle: Record<TrainingMode, string> = {
  automatic: 'Автоматично',
  manual: 'Вибрати самому',
  random: 'Випадково',
}

export const modes: TrainingMode[] = ['automatic', 'manual', 'random']

export enum Exercise {
  listen = 1,
  translate = 2,
  letters = 3,
  reorder = 4,
  pronunciation = 5,
}

export const allExercises: Exercise[] = [Exercise.listen, Exercise.translate, Exercise.letters, Exercise.reorder, Exercise.pronunciation]

export const exerciseTitle: Record<Exercise, string> = {
  [Exercise.listen]: 'Почути й вибрати переклад',
  [Exercise.translate]: `Вибрати ${sourceLanguageName.adjectiveNeuter} слово`,
  [Exercise.letters]: 'Набрати слово з літер',
  [Exercise.reorder]: 'Переставити літери',
  [Exercise.pronunciation]: 'Вимова',
}

export const isGraded = (exercise: Exercise): boolean => exercise !== Exercise.pronunciation

export const minimumWords = 4
export const setSizes = [10, 20, 30]
/** Days until the next review for each level. */
export const intervals: Record<number, number> = { 1: 1, 2: 2, 3: 4, 4: 8, 5: 16 }

/** Recording length for the pronunciation exercise: 2–4 s by word length. */
export function recordingDuration(word: string): number {
  return Math.min(4, Math.max(2, 1.5 + 0.12 * [...word].length))
}

const time = (iso: string | null): number => (iso ? Date.parse(iso) : -Infinity)

/** Unknown first, then due, then trained longest ago, then new (newest saved first). */
export function automaticSet(words: SavedWord[], count: number, now: Date = new Date()): SavedWord[] {
  const t = now.getTime()
  const isDue = (w: SavedWord) => w.nextReview !== null && time(w.nextReview) <= t
  const unknown = words.filter((w) => w.lastResultUnknown).sort((a, b) => time(a.lastTrained) - time(b.lastTrained))
  const due = words.filter((w) => !w.lastResultUnknown && isDue(w)).sort((a, b) => time(a.nextReview) - time(b.nextReview))
  const trained = words.filter((w) => !w.lastResultUnknown && w.lastTrained !== null && !isDue(w))
    .sort((a, b) => time(a.lastTrained) - time(b.lastTrained))
  const fresh = words.filter((w) => w.lastTrained === null && !w.lastResultUnknown)
    .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt))
  return [...unknown, ...due, ...trained, ...fresh].slice(0, count)
}

export function randomSet(words: SavedWord[], count: number, rng: Rng = defaultRng): SavedWord[] {
  return shuffled(words, rng).slice(0, count)
}

/** Answer plus up to three distractors: same part of speech first, no duplicates, never the word's own meanings. */
export function options(word: SavedWord, pool: SavedWord[], value: (w: SavedWord) => string, count = 4, rng: Rng = defaultRng): string[] {
  const answer = value(word)
  const excluded = new Set([answer.toLowerCase(), ...word.otherTranslations.map((t) => t.toLowerCase())])
  const rank = (w: SavedWord) => (w.partOfSpeech === word.partOfSpeech ? 0 : 1)
  const candidates = shuffled(pool.filter((w) => wordKey(w) !== wordKey(word)), rng).sort((a, b) => rank(a) - rank(b))
  const result = [answer]
  for (const candidate of candidates) {
    if (result.length >= count) break
    const text = value(candidate)
    if (!text || excluded.has(text.toLowerCase())) continue
    excluded.add(text.toLowerCase())
    result.push(text)
  }
  return shuffled(result, rng)
}

/** Letters of a word, or words of a phrase. */
export function tokens(answer: string): string[] {
  const trimmed = answer.trim()
  if (trimmed.includes(' ')) return trimmed.split(' ').filter(Boolean)
  return [...trimmed]
}

export const isPhrase = (answer: string): boolean => answer.trim().includes(' ')

/** New level and next review after a session; null when the word got no result. */
export function update(level: number, outcomes: boolean[], now: Date): TrainingUpdate | null {
  if (outcomes.length === 0) return null
  const unknown = outcomes.includes(false)
  const newLevel = unknown ? 1 : Math.min(5, level + 1)
  const next = new Date(now)
  next.setDate(next.getDate() + (intervals[newLevel] ?? 1))
  return { level: newLevel, nextReview: next.toISOString(), unknown }
}
