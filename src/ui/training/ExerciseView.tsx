// Port of ExerciseView (TrainingView.swift): exercises 1–4, feedback, skip and hardware-keyboard shortcuts.
import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks'
import type { JSX } from 'preact'
import type { TrainingSession, Token } from '../../core/training/session.ts'
import { Exercise, exerciseTitle, isPhrase } from '../../core/training/training.ts'
import type { PronunciationRecorder } from '../../core/training/recorder.ts'
import { Button } from '../components/index.ts'
import { Icon } from '../icons.tsx'
import type { TrainingAudio } from './training-audio.ts'
import { Pronunciation } from './Pronunciation.tsx'

/** Letters, apostrophes and hyphens are part of a word; other keys are not moves. */
const isWordCharacter = (ch: string) => /^[\p{L}'-]$/u.test(ch)

const isTextInput = (target: EventTarget | null) =>
  target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement

interface Props {
  session: TrainingSession
  audio: TrainingAudio
  recorder: PronunciationRecorder
  /** The session is observed here, so the end of the last exercise is reported from here. */
  onFinish: () => void
}

export function ExerciseView({ session, audio, recorder, onFinish }: Props) {
  void session.revision.value
  // Keyboard mode belongs to one exercise: every exercise starts with «Ввести з клавіатури (пробіл)», as exercise 3 does.
  // Keyed by the exercise index (not reset in an effect), so a key pressed right after the switch is never undone.
  const [keyboardFor, setKeyboardFor] = useState<number | null>(null)
  const [flashIndex, setFlashIndex] = useState<number | null>(null)
  const fieldRef = useRef<HTMLInputElement | null>(null)
  const typedRef = useRef('')
  const bodyRef = useRef<HTMLDivElement>(null)

  const exercise = session.exercise
  const word = session.word
  const keyboardMode = keyboardFor === session.exerciseIndex
  const phrase = isPhrase(session.answer)
  const typing = (exercise === Exercise.letters || exercise === Exercise.reorder) && !phrase

  const state = useRef({ keyboardMode, typing })
  state.current = { keyboardMode, typing }

  const openKeyboard = () => setKeyboardFor(session.exerciseIndex)

  useLayoutEffect(() => { if (keyboardMode) fieldRef.current?.focus() }, [keyboardMode])

  useEffect(() => { if (session.finished) onFinish() }, [session.finished])

  // A new word: clear the field and speak the word in exercise 1.
  useEffect(() => {
    typedRef.current = ''
    if (fieldRef.current) fieldRef.current.value = ''
    if (session.exercise === Exercise.listen && session.word) audio.speak(session.word.headword)
  }, [session.position, session.exerciseIndex])

  // Success advances on its own after a short pause.
  useEffect(() => {
    if (!session.solved || session.revealed) return
    const position = session.position
    const index = session.exerciseIndex
    const timer = setTimeout(() => {
      if (session.position === position && session.exerciseIndex === index) session.next()
    }, 700)
    return () => clearTimeout(timer)
  }, [session.solved, session.revealed, session.position, session.exerciseIndex])

  // Let «Далі (пробіл)» receive the space instead of the text field once the word is over.
  useEffect(() => { if (session.revealed) fieldRef.current?.blur() }, [session.revealed])

  // Horizontal shake after a wrong move.
  useEffect(() => {
    if (session.lastMistake === 0) return
    bodyRef.current?.animate?.(
      [{ transform: 'translateX(0)' }, { transform: 'translateX(-8px)' }, { transform: 'translateX(8px)' },
        { transform: 'translateX(-6px)' }, { transform: 'translateX(6px)' }, { transform: 'translateX(0)' }],
      { duration: 360, easing: 'ease-out' })
  }, [session.lastMistake])

  // A letter put in place by the keyboard flashes bright green for a moment.
  const flashID = session.flash?.id
  useEffect(() => {
    const flash = session.flash
    if (!flash) return
    setFlashIndex(flash.index)
    const timer = setTimeout(() => { if (session.flash?.id === flash.id) setFlashIndex(null) }, 250)
    return () => clearTimeout(timer)
  }, [flashID])

  // Hardware keyboard: 1–4 choose an option, 0 or Esc skips, space opens the field or presses «Далі»,
  // letters type the word in exercises 3–4.
  // Registered in a layout effect so a key pressed right after the screen appears is not lost.
  useLayoutEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey) return
      // An alert over the training (close confirmation) keeps its own keys.
      if (document.querySelector('[role="alertdialog"]')) return
      if (event.key === 'Escape') {
        // The training covers the saved list's sheet: Esc skips the exercise instead of closing it.
        event.preventDefault()
        event.stopPropagation()
        session.skipExercise()
        return
      }
      if (isTextInput(event.target)) return
      if (event.key === '0') {
        event.preventDefault()
        session.skipExercise()
        return
      }
      if (session.exercise === Exercise.pronunciation) return
      if (event.key === ' ') {
        event.preventDefault()
        if (session.revealed) session.next()
        else if (state.current.typing && !state.current.keyboardMode && !session.isOver) openKeyboard()
        return
      }
      if ((session.exercise === Exercise.listen || session.exercise === Exercise.translate) && /^[1-4]$/.test(event.key)) {
        event.preventDefault()
        const option = session.options[Number(event.key) - 1]
        if (option !== undefined && !session.isOver && !session.wrongOptions.has(option)) session.choose(option)
        return
      }
      if (state.current.typing && event.key.length === 1 && isWordCharacter(event.key)) {
        event.preventDefault()
        session.key(event.key)
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [session])

  const onFieldInput = (event: JSX.TargetedEvent<HTMLInputElement>) => {
    const value = event.currentTarget.value
    const old = typedRef.current
    typedRef.current = value
    // Only newly typed characters count; deletions are ignored.
    if (value.length <= old.length) return
    const added = value.startsWith(old) ? value.slice(old.length) : value.slice(old.length - value.length)
    for (const ch of added) {
      if (isWordCharacter(ch)) {
        session.key(ch)
      } else if (ch === '0') {
        // The field holds the keyboard; 0 still skips the exercise and space still means «Далі».
        session.skipExercise()
        return
      } else if (ch === ' ' && session.isOver) {
        session.next()
        return
      }
    }
  }

  const progress = session.queue.length ? Math.min(session.position, session.queue.length) / session.queue.length : 0

  const keyboardInput = () => {
    if (keyboardMode) {
      return (
        <input
          ref={fieldRef}
          class="training-field"
          type="text"
          inputMode="text"
          autoCapitalize="none"
          autoCorrect="off"
          autoComplete="off"
          spellcheck={false}
          placeholder="Введіть слово"
          aria-label="Введіть слово"
          data-testid="lettersInput"
          onInput={onFieldInput}
        />
      )
    }
    if (session.isOver) return null
    return (
      <Button icon="keyboard" variant="plain" testID="keyboardInput" onClick={openKeyboard}>Ввести з клавіатури (пробіл)</Button>
    )
  }

  const prompt = (
    <div class="training-prompt" data-testid="trainingPrompt">{word?.contextTranslation ?? ''}</div>
  )

  const choices = (
    <div class="training-options">
      {session.options.map((option, index) => {
        const wrong = session.wrongOptions.has(option)
        const right = session.isOver && option === session.correctOption
        return (
          <button key={option} type="button" class={`training-option${wrong ? ' is-wrong' : ''}${right ? ' is-right' : ''}`}
            disabled={session.isOver || wrong} aria-label={option} title={`Клавіша ${index + 1}`}
            data-testid={`option-${option}`} onClick={() => session.choose(option)}>
            <span class="training-option-number">{index + 1}</span>
            <span class="training-option-text">{option}</span>
          </button>
        )
      })}
    </div>
  )

  let content: JSX.Element | null = null
  switch (exercise) {
    case Exercise.listen:
      content = (
        <div class="training-stack">
          <button type="button" class="training-listen" aria-label="Прослухати ще раз" data-testid="replayWord"
            onClick={() => { if (session.word) audio.speak(session.word.headword) }}>
            <Icon name="speaker.wave.3.fill" size={44} />
          </button>
          <div class="training-listen-answer" data-testid="listenAnswer">{session.isOver ? session.answer : ' '}</div>
          {choices}
        </div>
      )
      break
    case Exercise.translate:
      content = <div class="training-stack">{prompt}{choices}</div>
      break
    case Exercise.letters: {
      const tokens = session.answerTokens
      content = (
        <div class="training-stack is-wide">
          {prompt}
          <div class={`training-slots${phrase ? ' is-phrase' : ''}${session.isOver ? (session.revealed ? ' is-revealed' : ' is-solved') : ''}`}
            data-testid="lettersSlots" aria-label={tokens.slice(0, session.filled).join(phrase ? ' ' : '')}>
            {tokens.map((token, index) => (
              <span key={index} class="training-slot">
                {index < session.filled ? token : (phrase ? '_'.repeat(token.length) : '_')}
              </span>
            ))}
          </div>
          <FlowTiles tokens={session.bank} onTap={(token) => session.enter(token.text, token.id)} />
          {!phrase && keyboardInput()}
        </div>
      )
      break
    }
    case Exercise.reorder:
      content = (
        <div class="training-stack is-wide">
          {prompt}
          <ReorderTiles session={session} flashIndex={flashIndex} />
          <p class="training-hint">
            {phrase
              ? 'Перетягніть слово на його місце або торкніться двох слів, щоб поміняти їх.'
              : 'Перетягніть літеру на її місце, торкніться двох літер, щоб поміняти їх, або набирайте слово з клавіатури з першої літери.'}
          </p>
          {!phrase && keyboardInput()}
        </div>
      )
      break
    case Exercise.pronunciation:
      content = word
        ? <Pronunciation key={`${session.position}-${word.id}`} session={session} audio={audio} recorder={recorder} word={word} />
        : null
      break
  }

  const notice = audio.notice.value
  return (
    <div class="training-exercise">
      <div class="training-header">
        <div class="training-title" data-testid="exerciseTitle">
          Вправа {session.exerciseIndex + 1} з {session.exercises.length} · {exerciseTitle[exercise]}
        </div>
        <div class="training-progress" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(progress * 100)}>
          <span class="training-progress-fill" style={{ width: `${progress * 100}%` }} />
        </div>
      </div>
      <div class="training-content" ref={bodyRef}>{content}</div>
      <div class="training-feedback">
        {session.revealed ? (
          <>
            <div class="training-revealed" data-testid="trainingRevealed">
              Не знав. Правильно: {exercise === Exercise.listen ? session.correctOption : session.answer}
            </div>
            <Button variant="borderedProminent" testID="trainingNext" onClick={() => session.next()}>Далі (пробіл)</Button>
          </>
        ) : session.solved && exercise !== Exercise.pronunciation ? (
          <div class="training-solved" data-testid="trainingSolved">
            <Icon name="checkmark.circle.fill" size={20} /> {session.mistakes === 0 ? 'Знав' : 'Правильно'}
          </div>
        ) : notice ? (
          <div class="training-notice">{notice}</div>
        ) : null}
      </div>
      <div class="training-spacer" />
      <div class="training-skip">
        <Button variant="plain" testID="skipExercise" onClick={() => session.skipExercise()}>Пропустити вправу (0 або Esc)</Button>
      </div>
      {__TEST_MODE__ && (
        <span class="training-fixture" data-testid="trainingFixture">
          {`${exercise}|${session.answer}|${session.correctOption}`}
        </span>
      )}
    </div>
  )
}

/** Letter or word tiles that wrap onto several rows. */
function FlowTiles({ tokens, onTap }: { tokens: Token[]; onTap: (token: Token) => void }) {
  return (
    <div class="training-bank">
      {tokens.map((token) => (
        <button key={token.id} type="button" class="training-tile is-bank" data-testid={`letter-${token.text}`}
          onClick={() => onTap(token)}>
          {token.text}
        </button>
      ))}
    </div>
  )
}

interface Drag {
  index: number
  pointerID: number
  x: number
  y: number
  element: HTMLElement
  moved: boolean
}

/** Exercise 4: tiles swap by dragging one onto another or by tapping two of them. */
function ReorderTiles({ session, flashIndex }: { session: TrainingSession; flashIndex: number | null }) {
  const drag = useRef<Drag | null>(null)

  const end = (event: PointerEvent, cancelled: boolean) => {
    const current = drag.current
    if (!current || current.pointerID !== event.pointerId) return
    drag.current = null
    current.element.style.transform = ''
    current.element.classList.remove('is-dragging')
    if (cancelled) return
    if (!current.moved) {
      session.tapTile(current.index)
      return
    }
    const target = document.elementsFromPoint(event.clientX, event.clientY)
      .find((node) => node !== current.element && (node as HTMLElement).dataset?.tile !== undefined) as HTMLElement | undefined
    if (target) session.move(current.index, Number(target.dataset.tile))
  }

  return (
    <div class="training-reorder">
      {session.arrangement.map((token, index) => {
        const correct = session.isCorrect(index)
        const classes = ['training-tile', 'is-reorder']
        if (flashIndex === index) classes.push('is-flash')
        else if (correct) classes.push('is-correct')
        else if (session.selectedTile === index) classes.push('is-selected')
        return (
          <div key={token.id} role="button" tabIndex={0} class={classes.join(' ')} data-tile={index}
            aria-label={token.text} aria-description={correct ? 'на місці' : undefined} data-testid={`tile-${index}`}
            onPointerDown={(event) => {
              if (event.button !== 0 || session.isOver) return
              const element = event.currentTarget as HTMLElement
              element.setPointerCapture?.(event.pointerId)
              drag.current = { index, pointerID: event.pointerId, x: event.clientX, y: event.clientY, element, moved: false }
            }}
            onPointerMove={(event) => {
              const current = drag.current
              if (!current || current.pointerID !== event.pointerId || session.isCorrect(current.index)) return
              const dx = event.clientX - current.x
              const dy = event.clientY - current.y
              if (!current.moved && Math.hypot(dx, dy) > 8) {
                current.moved = true
                current.element.classList.add('is-dragging')
              }
              if (current.moved) current.element.style.transform = `translate(${dx}px, ${dy}px) scale(1.06)`
            }}
            onPointerUp={(event) => end(event, false)}
            onPointerCancel={(event) => end(event, true)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault()
                session.tapTile(index)
              }
            }}>
            {token.text}
          </div>
        )
      })}
    </div>
  )
}
