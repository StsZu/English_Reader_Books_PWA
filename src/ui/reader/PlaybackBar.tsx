// Port of ReaderView.swift → PlaybackBar and ChapterNavigation.
import { Button, ProgressSpinner } from '../components/index.ts'
import { unlockAudio } from '../../core/speech/audio.ts'
import type { ReaderModel } from './model.ts'

export function PlaybackBar({ model }: { model: ReaderModel }) {
  const reading = model.reading
  const state = reading.state.value
  const status = {
    idle: `Розділ ${model.chapter.value + 1} з ${model.book.chapters.length} · абзац ${model.topParagraph.value + 1}`,
    loading: 'Завантаження',
    playing: 'Відтворення',
    paused: 'Пауза',
  }[state]
  return (
    <footer class="playback-bar">
      {state === 'idle' && (
        <Button variant="bordered" icon="play.fill" testID="playButton" onClick={() => {
          unlockAudio()
          model.startReading()
        }}>Слухати</Button>
      )}
      {(state === 'loading' || state === 'playing') && (
        <Button variant="bordered" icon="pause.fill" testID="pauseButton" onClick={() => reading.pause()}>Пауза</Button>
      )}
      {state === 'paused' && (
        <Button variant="bordered" icon="play.fill" testID="resumeButton" onClick={() => {
          unlockAudio()
          model.stopSentenceSpeech()
          reading.resume()
        }}>Продовжити</Button>
      )}
      <Button variant="bordered" icon="stop.fill" disabled={state === 'idle'} testID="stopButton" onClick={() => reading.stop()}>Стоп</Button>
      {state === 'loading' && (
        <span class="playback-loading"><ProgressSpinner size="small" /><span>Готую аудіо…</span></span>
      )}
      <span class="pane-spacer" />
      <span class="playback-status" data-testid="playbackStatus">{status}</span>
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
