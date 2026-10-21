import { describe, expect, it } from 'vitest'
import type { SavedWord, TrainingUpdate } from '../../src/core/saved/saved.ts'
import { testFlags } from '../../src/app/test-mode.ts'
import { PronunciationRecorder, silentWAV } from '../../src/core/training/recorder.ts'
import { TrainingSession } from '../../src/core/training/session.ts'
import { Exercise, automaticSet, options, recordingDuration, tokens, update } from '../../src/core/training/training.ts'

const DAY = 86_400_000
const iso = (ms: number) => new Date(ms).toISOString()

function trainingWord(word: string, translation: string, o: {
  part?: string; other?: string[]; level?: number; next?: number; trained?: number; unknown?: boolean; updated?: number
} = {}): SavedWord {
  return {
    id: crypto.randomUUID(), headword: word, lemma: word, ipa: '', partOfSpeech: o.part ?? 'іменник', level: '', forms: '',
    contextTranslation: translation, otherTranslations: o.other ?? [], contexts: [], updatedAt: iso(o.updated ?? Date.now()),
    trainingLevel: o.level ?? 0, nextReview: o.next !== undefined ? iso(o.next) : null,
    lastTrained: o.trained !== undefined ? iso(o.trained) : null, lastResultUnknown: o.unknown ?? false,
  }
}

describe('набір і рівні', () => {
  // testAutomaticSetOrderAndLevels
  it('автоматичний порядок, рівні, інтервали, токени', () => {
    const now = Date.now()
    const fresh = trainingWord('fresh', 'новий', { updated: now })
    const longAgo = trainingWord('old', 'старий', { level: 2, next: now + DAY, trained: now - 30 * DAY })
    const recent = trainingWord('recent', 'недавній', { level: 2, next: now + DAY, trained: now - DAY })
    const due = trainingWord('due', 'час', { level: 3, next: now - DAY, trained: now - 5 * DAY })
    const unknown = trainingWord('missed', 'пропущений', { level: 1, next: now + DAY, trained: now - DAY, unknown: true })
    const nowDate = new Date(now)
    expect(automaticSet([fresh, recent, due, longAgo, unknown], 10, nowDate).map((w) => w.headword))
      .toEqual(['missed', 'due', 'old', 'recent', 'fresh'])
    expect(automaticSet([fresh, recent, due], 2, nowDate).map((w) => w.headword)).toEqual(['due', 'recent'])

    expect(update(2, [], nowDate)).toBeNull()
    const known = update(2, [true, true], nowDate)!
    expect(known.level).toBe(3)
    expect(known.unknown).toBe(false)
    expect(Math.round((Date.parse(known.nextReview!) - now) / DAY)).toBe(4)
    expect(update(4, [true, false], nowDate)?.level).toBe(1)
    expect(update(5, [true], nowDate)?.level).toBe(5)
    expect(tokens('look up')).toEqual(['look', 'up'])
    expect(tokens('river')).toEqual(['r', 'i', 'v', 'e', 'r'])
  })

  // testTrainingOptionsAvoidDuplicatesAndOwnMeanings
  it('обманки без дублікатів і без власних значень, спершу та сама частина мови', () => {
    const word = trainingWord('bank', 'берег', { other: ['банк'] })
    const pool = [word, trainingWord('money', 'банк'), trainingWord('shore', 'берег'), trainingWord('river', 'річка'),
      trainingWord('tree', 'дерево'), trainingWord('run', 'бігти', { part: 'дієслово' }), trainingWord('house', 'будинок')]
    for (let i = 0; i < 20; i++) {
      const result = options(word, pool, (w) => w.contextTranslation)
      expect(result.length).toBe(4)
      expect(new Set(result).size).toBe(4)
      expect(result).toContain('берег')
      expect(result).not.toContain('банк')
      expect(result).not.toContain('бігти')
    }
  })

  it('тривалість запису 2–4 с за довжиною слова', () => {
    expect(recordingDuration('a')).toBe(2)
    expect(recordingDuration('pronunciation')).toBeCloseTo(1.5 + 0.12 * 13)
    expect(recordingDuration('a'.repeat(40))).toBe(4)
  })
})

describe('сесія тренування', () => {
  // testTrainingSessionMistakesRepeatsAndResults
  it('помилки, повтор у кінці вправи й результати', () => {
    const words = [trainingWord('cat', 'кіт', { level: 2 }), trainingWord('dog', 'пес'), trainingWord('look up', 'шукати')]
    const pool = [...words, trainingWord('cow', 'корова'), trainingWord('hen', 'курка')]
    let applied = new Map<string, TrainingUpdate>()
    const session = new TrainingSession(words, pool, [Exercise.listen, Exercise.letters, Exercise.reorder], (u) => { applied = u })
    expect(session.queue.length).toBe(3)

    const first = session.word!
    const wrong = session.options.filter((o) => o !== session.correctOption)
    session.choose(wrong[0])
    expect(session.isOver).toBe(false)
    session.choose(wrong[0])
    expect(session.mistakes).toBe(1)
    session.choose(wrong[1])
    expect(session.revealed).toBe(true)
    expect(session.queue.length).toBe(4)
    expect(session.queue.at(-1)).toEqual({ wordID: first.id, isRepeat: true })
    session.next()
    while (session.exerciseIndex === 0) {
      session.choose(session.correctOption)
      expect(session.solved).toBe(true)
      session.next()
    }
    expect(session.results.get(first.id)?.get(Exercise.listen)).toBe(false)

    expect(session.exercise).toBe(Exercise.letters)
    while (session.exerciseIndex === 1) {
      const answer = session.answerTokens
      if (session.word?.headword === 'dog') session.enter('x')
      for (const token of answer) session.enter(token)
      expect(session.solved).toBe(true)
      expect(session.filled).toBe(answer.length)
      session.next()
    }

    expect(session.exercise).toBe(Exercise.reorder)
    while (!session.finished) {
      if (!session.isOver) {
        const answer = session.answerTokens
        answer.forEach((_, target) => {
          if (session.isCorrect(target)) return
          const source = session.arrangement.findIndex((t, i) => i > target && !session.isCorrect(i) && t.text === answer[target])
          if (source < 0) return
          session.move(source, target)
          expect(session.isCorrect(target)).toBe(true)
          session.move(target, source)
          expect(session.isCorrect(target)).toBe(true)
        })
        expect(session.solved).toBe(true)
      }
      session.next()
    }
    expect(session.unknownWords.map((w) => w.id)).toEqual([first.id])
    expect(session.knownWords.length).toBe(2)
    expect(applied.get(first.id)?.level).toBe(1)
    expect(applied.get(first.id)?.unknown).toBe(true)
    if (words[0].id !== first.id) expect(applied.get(words[0].id)?.level).toBe(3)
  })

  const fourWords = () => [trainingWord('planet', 'планета'), trainingWord('dog', 'пес'), trainingWord('sun', 'сонце'), trainingWord('tree', 'дерево')]

  // testReorderWrongMoveCountsAndSkipLeavesNoResult
  it('неправильний хід у вправі 4 — помилка; пропуск вправи не дає результату', () => {
    const words = [trainingWord('planet', 'планета'), trainingWord('xyz', 'хуз'), trainingWord('dog', 'пес'), trainingWord('sun', 'сонце')]
    let applied: Map<string, TrainingUpdate> | null = null
    const wrongMove = (s: TrainingSession): [number, number] | null => {
      const answer = s.answerTokens
      for (let source = 0; source < s.arrangement.length; source++) {
        if (s.isCorrect(source)) continue
        for (let destination = 0; destination < s.arrangement.length; destination++) {
          if (destination === source || s.isCorrect(destination)) continue
          if (s.arrangement[source].text !== answer[destination]) return [source, destination]
        }
      }
      return null
    }
    let found: TrainingSession | null = null
    for (let i = 0; i < 200 && !found; i++) {
      const s = new TrainingSession(words, words, [Exercise.reorder, Exercise.translate], (u) => { applied = u })
      const firstMove = s.answer === 'planet' ? wrongMove(s) : null
      if (!firstMove) continue
      s.move(...firstMove)
      const secondMove = !s.isOver ? wrongMove(s) : null
      if (!secondMove) continue
      s.move(...secondMove)
      found = s
    }
    const session = found!
    expect(session).not.toBeNull()
    expect(session.mistakes).toBe(2)
    expect(session.revealed).toBe(true)
    expect(session.arrangement.map((t) => t.text)).toEqual(session.answerTokens)
    expect(session.queue.at(-1)?.isRepeat).toBe(true)
    session.skipExercise()
    expect(session.exercise).toBe(Exercise.translate)
    session.skipExercise()
    expect(session.finished).toBe(true)
    expect(applied!.size).toBe(1)
    expect([...applied!.values()][0].unknown).toBe(true)
  })

  const findSession = (predicate: (s: TrainingSession) => boolean, tries = 500): TrainingSession => {
    for (let i = 0; i < tries; i++) {
      const s = new TrainingSession(fourWords(), fourWords(), [Exercise.reorder], () => {})
      if (s.answer === 'planet' && !s.isOver && predicate(s)) return s
    }
    throw new Error('no suitable shuffle')
  }

  // testReorderKeyboardPlacesLettersLeftToRight
  it('вправа 4: неправильна літера з клавіатури — помилка без руху; слово набирається з першої літери', () => {
    const session = findSession(() => true, 50)
    const before = session.arrangement.map((t) => t.text)
    session.key('Z')
    expect(session.mistakes).toBe(1)
    expect(session.arrangement.map((t) => t.text)).toEqual(before)
    for (const letter of session.answerTokens) session.key(letter.toUpperCase())
    expect(session.solved).toBe(true)
    expect(session.mistakes).toBe(1)
    expect(session.arrangement.map((t) => t.text)).toEqual(session.answerTokens)
  })

  // testReorderKeyboardAcceptsTheWholeWord
  it('вправа 4: набір цілого слова з літерами на місці — без помилок', () => {
    const session = findSession((s) => s.arrangement.some((_, i) => s.isCorrect(i)))
    for (const letter of 'planet') session.key(letter)
    expect(session.solved).toBe(true)
    expect(session.mistakes).toBe(0)
  })

  // testReorderKeyboardAlwaysStartsFromTheFirstLetterAndFlashes
  it('вправа 4: завжди з першої літери, кожна поставлена літера блимає', () => {
    const session = findSession((s) => s.isCorrect(0))
    session.key('l')
    expect(session.mistakes).toBe(1)
    expect(session.typedPosition).toBe(0)
    expect(session.flash).toBeNull()
    session.key('p')
    expect(session.flash?.index).toBe(0)
    expect(session.typedPosition).toBe(1)
    session.key('l')
    expect(session.flash?.index).toBe(1)
    expect(session.isCorrect(1)).toBe(true)
    for (const letter of 'anet') {
      if (session.isOver) break
      session.key(letter)
      expect(session.flash).not.toBeNull()
    }
    expect(session.solved).toBe(true)
    expect(session.mistakes).toBe(1)
  })

  it('вправа 5 не записує результатів і не змінює рівнів; «Далі» лише через completePronunciation', () => {
    const words = fourWords()
    let applied: Map<string, TrainingUpdate> | null = null
    const session = new TrainingSession(words, words, [Exercise.pronunciation], (u) => { applied = u })
    session.next()
    expect(session.position).toBe(0)
    for (let i = 0; i < words.length; i++) session.completePronunciation()
    expect(session.finished).toBe(true)
    expect(applied!.size).toBe(0)
  })

  it('вправа 5 разом із вправою 1 — рівні лише за вправою 1', () => {
    const words = fourWords()
    let applied: Map<string, TrainingUpdate> | null = null
    const session = new TrainingSession(words, words, [Exercise.listen, Exercise.pronunciation], (u) => { applied = u })
    while (session.exerciseIndex === 0) { session.choose(session.correctOption); session.next() }
    while (!session.finished) session.completePronunciation()
    expect(applied!.size).toBe(4)
    for (const u of applied!.values()) expect(u.level).toBe(1)
  })

  it('ревізія змінюється на кожну дію (UI підписується)', () => {
    const words = fourWords()
    const session = new TrainingSession(words, words, [Exercise.listen], () => {})
    const before = session.revision.value
    session.choose(session.correctOption)
    expect(session.revision.value).toBeGreaterThan(before)
  })
})

describe('запис вимови', () => {
  it('тиша WAV має правильний заголовок і довжину', () => {
    const wav = silentWAV(1)
    expect(new TextDecoder().decode(wav.slice(0, 4))).toBe('RIFF')
    expect(wav.length).toBe(44 + 8000 * 2)
  })

  it('фікстура записує, cleanUp прибирає записи тренування', async () => {
    testFlags.recording = true
    try {
      const recorder = new PronunciationRecorder()
      await recorder.requestPermission()
      const url = await recorder.record(0.05)
      expect(url).toMatch(/^blob:/)
      await recorder.record(0.05)
      expect(recorder.recordingCount).toBe(2)
      recorder.cleanUp()
      expect(recorder.recordingCount).toBe(0)
      expect(recorder.lastRecording).toBeNull()
    } finally {
      testFlags.recording = false
    }
  })
})
