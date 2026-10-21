// Port of PronunciationExercise (TrainingView.swift), exercise 5: listen, record yourself while the green
// ring fills, listen to the reference again, then «Моя вимова», «Ще раз слово», «Записати ще раз» or «Далі».
import { useEffect, useLayoutEffect, useState } from 'preact/hooks'
import { Ear, Mic } from 'lucide-preact'
import { errorMessage } from '../../contracts.ts'
import type { TrainingSession } from '../../core/training/session.ts'
import { recordingDuration } from '../../core/training/training.ts'
import { PronunciationRecorder } from '../../core/training/recorder.ts'
import type { SavedWord } from '../../core/saved/saved.ts'
import { Button } from '../components/index.ts'
import { Icon } from '../icons.tsx'
import type { TrainingAudio } from './training-audio.ts'

type Phase = 'explain' | 'listening' | 'recording' | 'reference' | 'ready' | { failed: string }

/** Recorders whose user has read the microphone explanation in this training (V-05). */
const explained = new WeakSet<PronunciationRecorder>()

async function permissionGranted(): Promise<boolean> {
  if (PronunciationRecorder.isFixture) return true
  try {
    const status = await navigator.permissions?.query({ name: 'microphone' as PermissionName })
    return status?.state === 'granted'
  } catch {
    return false
  }
}

const RADIUS = 64
const CIRCUMFERENCE = 2 * Math.PI * RADIUS

interface Props {
  session: TrainingSession
  audio: TrainingAudio
  recorder: PronunciationRecorder
  word: SavedWord
}

export function Pronunciation({ session, audio, recorder, word }: Props) {
  const [phase, setPhase] = useState<Phase>('listening')
  const [run, setRun] = useState(0)
  const [ring, setRing] = useState<'empty' | 'filling' | 'full'>('empty')
  const [playingMine, setPlayingMine] = useState(false)
  /** References heard to the end for this word (exposed to tests). */
  const [heard, setHeard] = useState(0)
  const duration = recordingDuration(word.headword)

  // Reference → recording with the ring → reference again → ready, also after «Записати ще раз».
  useEffect(() => {
    let cancelled = false
    const cycle = async () => {
      if (!explained.has(recorder) && !(await permissionGranted())) {
        if (!cancelled) setPhase('explain')
        return
      }
      explained.add(recorder)
      try {
        await recorder.requestPermission()
      } catch (error) {
        if (!cancelled) setPhase({ failed: errorMessage(error) || 'Мікрофон недоступний.' })
        return
      }
      if (cancelled) return
      setPhase('listening')
      if (await audio.say(word.headword)) setHeard((n) => n + 1)
      if (cancelled) return
      setPhase('recording')
      setRing('filling')
      try {
        await recorder.record(duration)
      } catch (error) {
        if (!cancelled) setPhase({ failed: errorMessage(error) || 'Не вдалося записати.' })
        return
      }
      if (cancelled) return
      setRing('full')
      setPhase('reference')
      if (await audio.say(word.headword)) setHeard((n) => n + 1)
      if (cancelled) return
      setPhase('ready')
    }
    void cycle()
    return () => { cancelled = true }
  }, [run])

  // Only the recorder is stopped here: the next word's view appears before this one disappears,
  // and stopping the shared audio would cut off the next word's first reference.
  useEffect(() => () => recorder.stop(), [])

  const playMine = async () => {
    if (playingMine) return
    setPlayingMine(true)
    await recorder.playLastRecording()
    setPlayingMine(false)
  }
  const replayReference = () => audio.speak(word.headword)
  const recordAgain = () => setRun((n) => n + 1)
  const next = () => session.completePronunciation()

  useLayoutEffect(() => {
    if (phase !== 'ready') return
    const onKey = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey || document.querySelector('[role="alertdialog"]')) return
      const target = event.target
      if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) return
      const actions: Record<string, () => void> = { '1': () => void playMine(), '2': replayReference, '3': recordAgain, ' ': next }
      const action = actions[event.key]
      if (!action) return
      event.preventDefault()
      action()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [phase, playingMine])

  const failed = typeof phase === 'object'
  const status = failed ? phase.failed
    : phase === 'explain' ? 'Мікрофон потрібен лише для вправи «Вимова»: запис звучить тільки на цьому iPad і видаляється після тренування.'
      : phase === 'listening' ? 'Послухайте слово'
        : phase === 'recording' ? 'Говоріть: запис іде, поки заповнюється коло'
          : phase === 'reference' ? 'Послухайте ще раз, як звучить слово'
            : 'Порівняйте свою вимову зі зразком'

  return (
    <div class="training-stack pronunciation">
      <div class="pronunciation-word" data-testid="pronunciationWord">{word.headword}</div>
      <div class="pronunciation-translation">{word.contextTranslation}</div>
      <div class={`pronunciation-ring${phase === 'recording' ? ' is-recording' : ''}`} role="img" aria-label={status}
        data-testid="pronunciationRing">
        <svg viewBox="0 0 140 140" width="140" height="140" aria-hidden="true">
          <circle class="ring-track" cx="70" cy="70" r={RADIUS} />
          <circle
            key={`${run}-${ring}`}
            class={`ring-fill is-${ring}`}
            cx="70" cy="70" r={RADIUS}
            style={{
              strokeDasharray: String(CIRCUMFERENCE),
              strokeDashoffset: String(ring === 'full' ? 0 : CIRCUMFERENCE),
              animationDuration: `${duration}s`,
              ['--ring-length' as string]: String(CIRCUMFERENCE),
            }}
          />
        </svg>
        <span class="pronunciation-ring-icon">
          {phase === 'recording' ? <Mic size={40} aria-hidden="true" /> : <Icon name="speaker.wave.2" size={40} />}
        </span>
      </div>
      <div class={`pronunciation-status${failed ? ' is-failure' : ''}`} data-testid="pronunciationStatus">{status}</div>
      {phase === 'explain' && (
        <Button variant="borderedProminent" icon="mic" testID="allowMicrophone"
          onClick={() => { explained.add(recorder); setRun((n) => n + 1) }}>
          Дозволити мікрофон
        </Button>
      )}
      {phase === 'ready' && (
        <>
          <div class="pronunciation-actions">
            <button type="button" class="btn btn-bordered btn-regular" data-testid="playMine" disabled={playingMine}
              onClick={() => void playMine()}>
              <Ear size={19} aria-hidden="true" /><span class="btn-title">Моя вимова (1)</span>
            </button>
            <Button variant="bordered" icon="speaker.wave.2" testID="replayReference" onClick={replayReference}>Ще раз слово (2)</Button>
            <Button variant="bordered" icon="mic" testID="recordAgain" onClick={recordAgain}>Записати ще раз (3)</Button>
          </div>
          <Button variant="borderedProminent" testID="pronunciationNext" onClick={next}>Далі (пробіл)</Button>
        </>
      )}
      {__TEST_MODE__ && <span class="training-fixture" data-testid="pronunciationHeard">{`heard:${heard}`}</span>}
    </div>
  )
}
