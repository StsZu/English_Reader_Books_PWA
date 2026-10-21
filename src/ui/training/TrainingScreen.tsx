// Port of TrainingView.swift: full-screen training of saved words (stages 2.4–2.5):
// set, introduction, exercises 1–5, summary.
import { useEffect, useMemo, useState } from 'preact/hooks'
import { Circle } from 'lucide-preact'
import { settings } from '../../core/storage/settings.ts'
import { applyTraining, filterWords, words as savedWords, type SavedWord } from '../../core/saved/saved.ts'
import {
  Exercise, allExercises, automaticSet, exerciseTitle, minimumWords, modeTitle, modes, randomSet, setSizes,
  type TrainingMode,
} from '../../core/training/training.ts'
import { TrainingSession } from '../../core/training/session.ts'
import { PronunciationRecorder } from '../../core/training/recorder.ts'
import { unlockAudio } from '../../core/speech/audio.ts'
import { ConfirmDialog, IconButton, List, NavBar, Portal, Row, Section, Segmented, TextField, Toggle } from '../components/index.ts'
import { Icon } from '../icons.tsx'
import { TrainingAudio } from './training-audio.ts'
import { ExerciseView } from './ExerciseView.tsx'
import './training.css'

type Stage = 'setup' | 'intro' | 'exercise' | 'summary'

export interface TrainingScreenProps {
  onClose: () => void
}

function enabledExercises(): Exercise[] {
  return settings.trainingExercises.value.split(',').map(Number)
    .filter((n): n is Exercise => (allExercises as number[]).includes(n))
    .filter((e) => e !== Exercise.pronunciation || PronunciationRecorder.hasMicrophone)
}

const modeHint = (mode: TrainingMode, count: number): string => {
  switch (mode) {
    case 'automatic': return 'Спершу слова, яких ви не знали минулого разу, потім ті, кого час повторити, потім ті, що найдовше не тренувались, потім нові.'
    case 'manual': return `Позначте слова в списку; не більше ${count}.`
    case 'random': return 'Випадкові слова зі збереженого.'
  }
}

export function TrainingScreen({ onClose }: TrainingScreenProps) {
  const [stage, setStage] = useState<Stage>('setup')
  const [set, setSet] = useState<SavedWord[]>([])
  const [session, setSession] = useState<TrainingSession | null>(null)
  const [confirmClose, setConfirmClose] = useState(false)
  const audio = useMemo(() => new TrainingAudio(), [])
  const recorder = useMemo(() => new PronunciationRecorder(), [])

  useEffect(() => {
    audio.configure()
    return () => {
      audio.stop()
      recorder.cleanUp()
    }
  }, [])

  const close = () => {
    audio.stop()
    recorder.cleanUp()
    onClose()
  }

  const prepare = (words: SavedWord[]) => {
    unlockAudio()
    audio.configure()
    audio.prefetch(words.map((w) => w.headword))
    setSet(words)
    setStage('intro')
  }

  const start = () => {
    unlockAudio()
    setSession(new TrainingSession(set, savedWords.value, enabledExercises(), (updates) => {
      void applyTraining(updates, new Date())
    }))
    setStage('exercise')
  }

  // A full-screen cover above sheets (the saved list stays open underneath), like SwiftUI fullScreenCover.
  return (
    <Portal>
      <div class="training-screen" role="dialog" aria-modal="true" aria-label="Тренування" data-testid="trainingScreen">
        <NavBar
          title="Тренування"
          leading={<IconButton icon="xmark" label="Закрити" testID="closeTraining"
            onClick={() => (stage === 'exercise' ? setConfirmClose(true) : close())} />}
        />
        <div class="training-body">
          {stage === 'setup' && <Setup onContinue={prepare} />}
          {stage === 'intro' && <Intro set={set} audio={audio} onStart={start} />}
          {stage === 'exercise' && session && (
            <ExerciseView session={session} audio={audio} recorder={recorder} onFinish={() => {
              recorder.cleanUp()
              setStage('summary')
            }} />
          )}
          {stage === 'summary' && session && (
            <Summary session={session} onDone={close} onRepeat={() => {
              const unknown = new Set(session.unknownWords.map((w) => w.id))
              prepare(savedWords.value.filter((w) => unknown.has(w.id)))
            }} />
          )}
        </div>
        <ConfirmDialog
          open={confirmClose}
          style="actionSheet"
          title="Завершити тренування? Результати цієї сесії не збережуться."
          onClose={() => setConfirmClose(false)}
          actions={[
            { label: 'Завершити', role: 'destructive', onSelect: close, testID: 'confirmCloseTraining' },
            { label: 'Скасувати', role: 'cancel' },
          ]}
        />
      </div>
    </Portal>
  )
}

// MARK: Setup (T1, T2, T14)

function Setup({ onContinue }: { onContinue: (words: SavedWord[]) => void }) {
  const [chosen, setChosen] = useState<Set<string>>(new Set())
  const [query, setQuery] = useState('')
  const [book, setBook] = useState('')
  const all = savedWords.value
  const count = settings.trainingCount.value
  const mode = settings.trainingMode.value
  const exercises = enabledExercises()

  if (all.length < minimumWords) {
    return (
      <List>
        <Section>
          <Row>
            <span data-testid="trainingNotEnough">
              Для тренування потрібно щонайменше {minimumWords} збережені слова. Збережіть слова кнопкою «Зберегти» в картці слова.
            </span>
          </Row>
        </Section>
      </List>
    )
  }

  const books = [...new Set(all.flatMap((w) => w.contexts.map((c) => c.place.bookTitle)))].sort()
  const toggleExercise = (exercise: Exercise, on: boolean) => {
    const list = new Set(exercises)
    if (on) list.add(exercise)
    else if (list.size > 1) list.delete(exercise)
    settings.trainingExercises.value = [...list].sort((a, b) => a - b).join(',')
  }

  const prepareSet = () => {
    switch (mode) {
      case 'automatic': onContinue(automaticSet(all, count)); break
      case 'random': onContinue(randomSet(all, count)); break
      case 'manual': onContinue(all.filter((w) => chosen.has(w.id))); break
    }
  }

  const listed = mode === 'manual'
    ? filterWords(null, query).filter((w) => !book || w.contexts.some((c) => c.place.bookTitle === book))
    : []

  return (
    <List class="training-form">
      <Section header="Скільки слів">
        <div class="training-segment">
          <Segmented ariaLabel="Кількість" testID="trainingCount" value={count}
            items={setSizes.map((n) => ({ value: n, label: String(n), testID: `trainingCount-${n}` }))}
            onChange={(value) => { settings.trainingCount.value = value }} />
        </div>
      </Section>
      <Section header="Які слова" footer={modeHint(mode, count)}>
        <div class="training-segment">
          <Segmented ariaLabel="Спосіб" testID="trainingMode" value={mode}
            items={modes.map((m) => ({ value: m, label: modeTitle[m], testID: `trainingMode-${m}` }))}
            onChange={(value) => { settings.trainingMode.value = value }} />
        </div>
      </Section>
      {mode === 'manual' && (
        <Section header={`Слова (${chosen.size} з ${count})`}>
          <div class="training-search">
            <TextField value={query} onInput={setQuery} placeholder="Пошук" ariaLabel="Пошук" testID="trainingSearch" />
          </div>
          {books.length > 1 && (
            <Row title="Книжка" value={
              <select class="training-select" value={book} aria-label="Книжка"
                onChange={(e) => setBook((e.target as HTMLSelectElement).value)}>
                <option value="">Усі</option>
                {books.map((title) => <option key={title} value={title}>{title}</option>)}
              </select>
            } />
          )}
          {listed.map((word) => {
            const on = chosen.has(word.id)
            return (
              <button key={word.id} type="button" class="row is-button training-choose" data-testid={`chooseWord-${word.headword}`}
                aria-pressed={on}
                onClick={() => {
                  const next = new Set(chosen)
                  if (on) next.delete(word.id)
                  else if (next.size < count) next.add(word.id)
                  setChosen(next)
                }}>
                <span class={on ? 'training-check is-on' : 'training-check'}>
                  {on ? <Icon name="checkmark.circle.fill" size={22} /> : <Circle size={22} strokeWidth={1.6} aria-hidden="true" />}
                </span>
                <span class="training-choose-word">{word.headword}</span>
                <span class="training-secondary">{word.contextTranslation}</span>
              </button>
            )
          })}
        </Section>
      )}
      <Section header="Вправи" footer={PronunciationRecorder.hasMicrophone
        ? 'Вправа «Вимова» записує ваш голос лише на цей iPad і не оцінює його; записи видаляються після тренування. Вимкніть її, якщо поруч люди.'
        : 'На цьому iPad немає мікрофона, тому вправа «Вимова» недоступна.'}>
        {allExercises.map((exercise) => {
          const unavailable = exercise === Exercise.pronunciation && !PronunciationRecorder.hasMicrophone
          return (
            <Toggle key={exercise} label={`${exercise}. ${exerciseTitle[exercise]}`} testID={`trainingExercise-${exercise}`}
              checked={exercises.includes(exercise) && !unavailable} disabled={unavailable}
              onChange={(on) => toggleExercise(exercise, on)} />
          )
        })}
      </Section>
      <Section>
        <button type="button" class="row is-button training-action" data-testid="trainingContinue"
          disabled={mode === 'manual' && chosen.size === 0} onClick={prepareSet}>
          <span class="row-main"><span class="row-title">Далі</span></span>
        </button>
      </Section>
    </List>
  )
}

// MARK: Introduction (T3)

function Intro({ set, audio, onStart }: { set: SavedWord[]; audio: TrainingAudio; onStart: () => void }) {
  const notice = audio.notice.value
  return (
    <List class="training-form">
      <Section header={`Слова для вивчення (${set.length}). Торкніться слова, щоб почути його.`}
        footer={notice ? <span class="training-notice">{notice}</span> : undefined}>
        {set.map((word) => (
          <button key={word.id} type="button" class="row is-button training-intro-row" data-testid={`introWord-${word.headword}`}
            onClick={() => { unlockAudio(); audio.speak(word.headword) }}>
            <span class="training-intro-icon"><Icon name="speaker.wave.2" size={20} /></span>
            <span class="training-intro-text">
              <span class="training-intro-line">
                <span class="training-serif-word">{word.headword}</span>
                <span class="training-secondary">{word.contextTranslation}</span>
              </span>
              {word.contexts[0] && <span class="training-context">{word.contexts[0].sentence}</span>}
            </span>
          </button>
        ))}
      </Section>
      <Section>
        <button type="button" class="row is-button training-action is-headline" data-testid="trainingStart" onClick={onStart}>
          <span class="row-main"><span class="row-title">Почати</span></span>
        </button>
      </Section>
    </List>
  )
}

// MARK: Summary (T12)

function Summary({ session, onDone, onRepeat }: { session: TrainingSession; onDone: () => void; onRepeat: () => void }) {
  const unknown = session.unknownWords
  const known = session.knownWords
  return (
    <List class="training-form">
      <Section>
        <div class="training-totals" data-testid="trainingTotals"
          aria-label={`Знав: ${known.length}, Не знав: ${unknown.length}`}>
          <span class="training-known"><Icon name="checkmark.circle.fill" size={22} /> Знав: {known.length}</span>
          <span class="training-unknown"><Icon name="xmark.circle.fill" size={22} /> Не знав: {unknown.length}</span>
        </div>
      </Section>
      <Section header="Слова">
        {session.words.map((word) => {
          const mistakes = session.exercisesWithMistakes(word)
          return (
            <div key={word.id} class="row training-summary-row" data-testid={`summary-${word.headword}`}>
              <span class="training-serif-word is-body">{word.headword}</span>
              <span class="training-secondary">{word.contextTranslation}</span>
              <span class="training-spacer" />
              <span class={mistakes.length ? 'training-unknown' : 'training-known'}>
                {mistakes.length ? `Не знав (вправи ${mistakes.join(', ')})` : 'Знав'}
              </span>
            </div>
          )
        })}
      </Section>
      <Section>
        {unknown.length > 0 && (
          <button type="button" class="row is-button training-action" data-testid="repeatUnknown" onClick={onRepeat}>
            <span class="row-main"><span class="row-title">Повторити незнані</span></span>
          </button>
        )}
        <button type="button" class="row is-button training-action" data-testid="trainingDone" onClick={onDone}>
          <span class="row-main"><span class="row-title">Готово</span></span>
        </button>
      </Section>
    </List>
  )
}

