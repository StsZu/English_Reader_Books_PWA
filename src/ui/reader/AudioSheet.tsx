// «Аудіокнига»: the book's audio files — add from «Файли», choose, reorder, delete; storage used.
import { useEffect, useRef, useState } from 'preact/hooks'
import { AUDIO_ACCEPT, totalSize } from '../../core/audiobook/store.ts'
import { requestPersistence } from '../../core/storage/db.ts'
import { formatBytes, formatTime } from '../../core/util/format.ts'
import { Button, ConfirmDialog, FormSheet, IconButton, ProgressSpinner } from '../components/index.ts'
import type { ReaderModel } from './model.ts'

async function freeSpace(): Promise<number | null> {
  try {
    const estimate = await navigator.storage?.estimate?.()
    return estimate?.quota !== undefined && estimate.usage !== undefined ? Math.max(0, estimate.quota - estimate.usage) : null
  } catch {
    return null
  }
}

export function AudioSheet({ model }: { model: ReaderModel }) {
  const player = model.audiobook
  const open = model.audioSheetOpen.value
  const tracks = player.tracks.value
  const current = player.track.value
  const input = useRef<HTMLInputElement>(null)
  const [adding, setAdding] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const [confirmRemoveAll, setConfirmRemoveAll] = useState(false)
  const [free, setFree] = useState<number | null>(null)

  useEffect(() => {
    if (open) void freeSpace().then(setFree)
    else setNotice(null)
  }, [open, tracks.length])

  const close = () => { model.audioSheetOpen.value = false }

  async function onFiles(event: Event) {
    const element = event.currentTarget as HTMLInputElement
    const files = [...(element.files ?? [])]
    element.value = ''
    if (!files.length) return
    setAdding(true)
    setNotice(null)
    try {
      const added = await player.add(files)
      if (added === 0) setNotice('Серед вибраних файлів немає аудіо (MP3, M4A, M4B, AAC, WAV).')
      else {
        model.barMode.value = 'audio'
        void requestPersistence()
      }
    } catch {
      setNotice('Не вдалося зберегти файли: на пристрої замало місця для цього сайту.')
    } finally {
      setAdding(false)
    }
  }

  const size = totalSize(tracks)
  return (
    <FormSheet open={open} onClose={close} ariaLabel="Аудіокнига" title="Аудіокнига" doneTestID="audioSheetDone" testID="audioSheet" width={620}>
      <div class="audio-sheet">
        {tracks.length === 0 ? (
          <p class="audio-sheet-intro">
            Додайте аудіофайли цієї книжки (MP3, M4A, M4B) з «Файлів». Кілька файлів стануть доріжками в порядку їхніх назв.
            Файли зберігаються лише на цьому пристрої.
          </p>
        ) : (
          <ol class="audio-tracks" data-testid="audioTracks">
            {tracks.map((track, index) => (
              <li key={track.id} class={index === current ? 'audio-track is-current' : 'audio-track'} data-testid={`audioTrack-${index}`}>
                <button type="button" class="audio-track-main" onClick={() => void player.selectTrack(index)} data-testid={`selectTrack-${index}`}>
                  <span class="audio-track-number">{index + 1}</span>
                  <span class="audio-track-text">
                    <span class="audio-track-name">{track.name}</span>
                    <span class="audio-track-meta">{[track.duration ? formatTime(track.duration) : null, formatBytes(track.size)].filter(Boolean).join(' · ')}</span>
                  </span>
                </button>
                <IconButton icon="chevron.up" label={`Вище: ${track.name}`} disabled={index === 0}
                  onClick={() => void player.move(index, index - 1)} testID={`moveTrackUp-${index}`} />
                <IconButton icon="chevron.down" label={`Нижче: ${track.name}`} disabled={index === tracks.length - 1}
                  onClick={() => void player.move(index, index + 1)} testID={`moveTrackDown-${index}`} />
                <IconButton icon="trash" label={`Видалити: ${track.name}`} tone="destructive"
                  onClick={() => void player.remove(index)} testID={`removeTrack-${index}`} />
              </li>
            ))}
          </ol>
        )}
        {notice && <p class="audio-sheet-notice" role="alert" data-testid="audioNotice">{notice}</p>}
        <div class="audio-sheet-actions">
          <Button variant="borderedProminent" icon="plus" disabled={adding} onClick={() => input.current?.click()} testID="addAudio">
            Додати файли…
          </Button>
          {adding && <ProgressSpinner size="small" />}
          <span class="pane-spacer" />
          {tracks.length > 0 && (
            <Button variant="borderedDestructive" icon="trash" onClick={() => setConfirmRemoveAll(true)} testID="removeAllAudio">Видалити все аудіо</Button>
          )}
        </div>
        <p class="audio-sheet-footnote" data-testid="audioStorage">
          {tracks.length > 0 ? `Аудіо книжки займає ${formatBytes(size)}.` : ''}
          {free !== null ? ` Вільно для застосунку: близько ${formatBytes(free)}.` : ''}
        </p>
        <input ref={input} type="file" multiple accept={AUDIO_ACCEPT} class="library-input" onChange={(e) => void onFiles(e)} data-testid="audioInput" />
      </div>
      <ConfirmDialog open={confirmRemoveAll} style="actionSheet" title="Видалити всі аудіофайли цієї книжки?"
        actions={[
          { label: 'Видалити', role: 'destructive', testID: 'confirmRemoveAudio', onSelect: () => {
            void player.removeAll()
            model.barMode.value = 'voice'
          } },
          { label: 'Скасувати', role: 'cancel' },
        ]}
        onClose={() => setConfirmRemoveAll(false)} testID="removeAudioDialog" />
    </FormSheet>
  )
}
