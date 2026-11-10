// Port of ReaderView.swift → PlaybackBar and ChapterNavigation.
import { Button, IconButton, ProgressSpinner, cx } from '../components/index.ts'
import type { IconName } from '../icons.tsx'
import { AudioBar } from './AudioBar.tsx'
import type { ReaderModel } from './model.ts'

export function PlaybackBar({ model }: { model: ReaderModel }) {
  if (model.audioMode) return <AudioBar model={model} />
  return <VoiceBar model={model} />
}

const VOICE_TITLES = ['Слухати', 'Пауза', 'Продовжити']

const LISTEN: Record<'idle' | 'loading' | 'playing' | 'paused', { title: string; icon: IconName; testID: string }> = {
  idle: { title: 'Слухати', icon: 'play.fill', testID: 'playButton' },
  loading: { title: 'Пауза', icon: 'pause.fill', testID: 'pauseButton' },
  playing: { title: 'Пауза', icon: 'pause.fill', testID: 'pauseButton' },
  paused: { title: 'Продовжити', icon: 'play.fill', testID: 'resumeButton' },
}

function VoiceBar({ model }: { model: ReaderModel }) {
  const reading = model.reading
  const hasAudio = model.audiobook.hasAudio
  const state = reading.state.value
  const status = {
    idle: `Розділ ${model.chapter.value + 1} з ${model.book.chapters.length} · абзац ${model.topParagraph.value + 1}`,
    loading: 'Завантаження',
    playing: 'Відтворення',
    paused: 'Пауза',
  }[state]
  const listen = LISTEN[state]
  return (
    <footer class="playback-bar">
      {/* One button for all states: the panel does not move and focus stays on it (specs/012-player-button). */}
      <Button variant="bordered" class="playback-toggle" icon={listen.icon} testID={listen.testID} reserve={VOICE_TITLES}
        onClick={() => model.toggleListening()}>{listen.title}</Button>
      <Button variant="bordered" icon="stop.fill" disabled={state === 'idle'} testID="stopButton" onClick={() => reading.stop()}>Стоп</Button>
      <span class={cx('playback-loading', state !== 'loading' && 'is-hidden')} aria-hidden={state !== 'loading'}>
        <ProgressSpinner size="small" /><span class="playback-loading-title">Готую аудіо…</span>
      </span>
      <span class="pane-spacer" />
      <span class="playback-status" data-testid="playbackStatus">{status}</span>
      <IconButton icon="headphones" label={hasAudio ? 'Аудіокнига' : 'Додати аудіокнигу'} testID="audiobookMode" onClick={() => {
        if (hasAudio) model.switchBarMode()
        else model.audioSheetOpen.value = true
      }} />
    </footer>
  )
}

export function ChapterNav({ model }: { model: ReaderModel }) {
  const chapter = model.chapter.value
  return (
    <nav class="chapter-nav">
      {chapter > 0 && (
        <Button variant="bordered" icon="chevron.left" testID="previousChapter" onClick={() => model.goToChapter(chapter - 1)}>Попередній розділ</Button>
      )}
      <span class="pane-spacer" />
      {chapter + 1 < model.book.chapters.length && (
        <Button variant="bordered" icon="chevron.right" testID="nextChapter" onClick={() => model.goToChapter(chapter + 1)}>Наступний розділ</Button>
      )}
    </nav>
  )
}
