// Bottom bar of the audiobook player: a full-width scrubber over the current track, ±5 s, play/pause,
// track, speed and the switch back to reading aloud with the voice.
import { useRef, useState } from 'preact/hooks'
import type { JSX } from 'preact'
import { RATES, SKIP_SECONDS } from '../../core/audiobook/player.ts'
import { formatNumber, formatTime } from '../../core/util/format.ts'
import { Button, IconButton, MenuPopover, ProgressSpinner } from '../components/index.ts'
import { Icon } from '../icons.tsx'
import type { ReaderModel } from './model.ts'

/** "1,0×", "1,25×", "0,75×". */
export const rateLabel = (rate: number) => `${formatNumber(rate, 2, 1)}×`

export function Scrubber({ time, duration, onSeek }: { time: number; duration: number; onSeek: (time: number) => void }) {
  const bar = useRef<HTMLDivElement>(null)
  const [drag, setDrag] = useState<{ pointer: number; fraction: number } | null>(null)
  const known = duration > 0
  const fraction = drag?.fraction ?? (known ? Math.min(1, time / duration) : 0)

  const fractionAt = (clientX: number) => {
    const rect = bar.current!.getBoundingClientRect()
    return rect.width > 0 ? Math.min(1, Math.max(0, (clientX - rect.left) / rect.width)) : 0
  }
  const down = (event: JSX.TargetedPointerEvent<HTMLDivElement>) => {
    if (!known) return
    event.preventDefault()
    event.currentTarget.setPointerCapture?.(event.pointerId)
    setDrag({ pointer: event.pointerId, fraction: fractionAt(event.clientX) })
  }
  const move = (event: JSX.TargetedPointerEvent<HTMLDivElement>) => {
    if (drag && event.pointerId === drag.pointer) setDrag({ ...drag, fraction: fractionAt(event.clientX) })
  }
  // The new place is applied when the finger lifts, so dragging does not stutter the sound.
  const up = (event: JSX.TargetedPointerEvent<HTMLDivElement>) => {
    if (!drag || event.pointerId !== drag.pointer) return
    onSeek(fractionAt(event.clientX) * duration)
    setDrag(null)
  }
  const key = (event: JSX.TargetedKeyboardEvent<HTMLDivElement>) => {
    const step = { ArrowLeft: -5, ArrowDown: -5, ArrowRight: 5, ArrowUp: 5, PageDown: -60, PageUp: 60 }[event.key]
    if (step !== undefined) onSeek(time + step)
    else if (event.key === 'Home') onSeek(0)
    else if (event.key === 'End') onSeek(duration)
    else return
    event.preventDefault()
  }

  return (
    <div class="scrubber-row">
      <span class="scrubber-time" data-testid="audioTime">{formatTime(drag ? fraction * duration : time)}</span>
      <div ref={bar} class={drag ? 'scrubber is-dragging' : 'scrubber'} role="slider" tabIndex={0}
        aria-label="Місце прослуховування" aria-valuemin={0} aria-valuemax={Math.round(duration)} aria-valuenow={Math.round(time)}
        aria-valuetext={`${formatTime(time)} з ${formatTime(duration)}`} aria-disabled={!known}
        onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={() => setDrag(null)} onKeyDown={key}
        data-testid="audioScrubber">
        <div class="scrubber-track">
          <div class="scrubber-fill" style={{ width: `${fraction * 100}%` }} />
        </div>
        <div class="scrubber-thumb" style={{ left: `${fraction * 100}%` }} />
        {drag && <div class="scrubber-bubble" style={{ left: `${fraction * 100}%` }} data-testid="scrubberBubble">{formatTime(fraction * duration)}</div>}
      </div>
      <span class="scrubber-time is-end" data-testid="audioDuration">{known ? formatTime(duration) : '–:––'}</span>
    </div>
  )
}

function SkipButton({ back = false, onClick }: { back?: boolean; onClick: () => void }) {
  return (
    <button type="button" class="skip-button" onClick={onClick} aria-label={back ? `Назад на ${SKIP_SECONDS} с` : `Уперед на ${SKIP_SECONDS} с`}
      data-testid={back ? 'audioBack' : 'audioForward'}>
      <Icon name={back ? 'gobackward' : 'goforward'} size={30} strokeWidth={1.8} />
      <span class="skip-label">{SKIP_SECONDS}</span>
    </button>
  )
}

export function AudioBar({ model }: { model: ReaderModel }) {
  const player = model.audiobook
  const state = player.state.value
  const playing = state === 'playing' || state === 'loading'
  const tracks = player.tracks.value
  const rate = player.rate.value
  const [rateMenu, setRateMenu] = useState<{ x: number; y: number } | null>(null)
  // The menu opens above the chip: the bar is at the bottom of the window.
  const openRates = (event: JSX.TargetedMouseEvent<HTMLButtonElement>) => {
    const rect = event.currentTarget.getBoundingClientRect()
    setRateMenu({ x: rect.left + rect.width / 2, y: rect.top - 56 * RATES.length - 20 })
  }
  return (
    <footer class="playback-bar audio-bar" data-testid="audioBar">
      <Scrubber time={player.time.value} duration={player.duration.value} onSeek={(t) => player.seek(t)} />
      <div class="audio-controls">
        <SkipButton back onClick={() => player.skip(-SKIP_SECONDS)} />
        {playing
          ? <Button variant="bordered" icon="pause.fill" testID="audioPause" onClick={() => model.toggleListening()}>Пауза</Button>
          : <Button variant="bordered" icon="play.fill" testID="audioPlay" onClick={() => model.toggleListening()}>Слухати</Button>}
        <SkipButton onClick={() => player.skip(SKIP_SECONDS)} />
        {state === 'loading' && <ProgressSpinner size="small" />}
        <span class="pane-spacer" />
        <button type="button" class="audio-chip" onClick={() => { model.audioSheetOpen.value = true }} data-testid="audioTrackButton">
          {tracks.length > 1 ? `Доріжка ${player.track.value + 1} з ${tracks.length}` : 'Аудіокнига'}
        </button>
        <button type="button" class="audio-chip" onClick={openRates} aria-label={`Швидкість ${rateLabel(rate)}`} aria-haspopup="menu"
          data-testid="audioRate">{rateLabel(rate)}</button>
        {rateMenu && (
          <MenuPopover x={rateMenu.x} y={rateMenu.y} onClose={() => setRateMenu(null)}
            actions={RATES.map((value) => ({
              label: rateLabel(value),
              icon: value === rate ? 'checkmark' : undefined,
              onSelect: () => player.setRate(value),
              testID: `audioRate-${value}`,
            }))} />
        )}
        <IconButton icon="waveform" label="Читати голосом" onClick={() => model.switchBarMode()} testID="voiceMode" />
      </div>
    </footer>
  )
}
