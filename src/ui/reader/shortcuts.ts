// Keyboard shortcuts of the reader (specs/003-resume-and-shortcuts). Keys are matched by their place on the
// keyboard (`code`), so they work the same with the English, Ukrainian and Polish layouts.
import { useEffect } from 'preact/hooks'
import { SKIP_SECONDS } from '../../core/audiobook/player.ts'
import type { ReaderModel } from './model.ts'

export const LONG_SKIP_SECONDS = 30

/** The list shown in «Швидкі клавіші». */
export const SHORTCUTS: { keys: string; action: string }[] = [
  { keys: 'Пробіл', action: '«Слухати» / «Пауза»' },
  { keys: '← / →', action: `Аудіокнига: назад / вперед на ${SKIP_SECONDS} с` },
  { keys: 'Shift + ← / →', action: `Аудіокнига: назад / вперед на ${LONG_SKIP_SECONDS} с` },
  { keys: '[ / ]', action: 'Аудіокнига: повільніше / швидше' },
  { keys: ', / .', action: 'Аудіокнига: попередня / наступна доріжка' },
  { keys: 'A', action: 'Перемкнути «Аудіокнига» ↔ «Голос»' },
  { keys: '↑ / ↓', action: 'Попереднє / наступне речення' },
  { keys: 'Option + ← / →', action: 'Попереднє / наступне слово речення' },
  { keys: 'Enter', action: 'Картка вибраного слова; без слова — прослухати речення' },
  { keys: '⌘F', action: 'Пошук у книжці' },
  { keys: '?', action: 'Цей список' },
  { keys: 'Esc', action: 'Закрити аркуш, меню чи панель; прибрати вибір слова' },
]

const isTextInput = (target: EventTarget | null) =>
  target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement
  || (target instanceof HTMLElement && target.isContentEditable)

/** A sheet, dialog, side panel or menu keeps its own keys. */
const overlayOpen = () => !!document.querySelector('[aria-modal="true"], [role="menu"]')

/** ⌘F also works from the open reader panel and its search field, not from other sheets. */
const otherOverlayOpen = () => !!document.querySelector('[aria-modal="true"]:not([data-testid="readerPanel"]), [role="menu"]')

/** The action for a key press in the reader, or null when the key is not a shortcut here. */
export function readerShortcut(
  event: KeyboardEvent, model: ReaderModel, showHelp: () => void, showSearch: () => void = () => {},
): (() => void) | null {
  if (event.code === 'KeyF' && (event.metaKey || event.ctrlKey) && !event.altKey && !event.shiftKey) {
    // Search in the book (specs/010-library, F4) instead of the browser's search on the page.
    return otherOverlayOpen() ? null : showSearch
  }
  if (event.metaKey || event.ctrlKey || isTextInput(event.target) || overlayOpen()) return null
  const target = event.target instanceof HTMLElement ? event.target : null
  const arrow = event.code === 'ArrowLeft' || event.code === 'ArrowRight'
  if (event.altKey) {
    // Option + ← / →: the word cursor (specs/008-phone-accessibility, A3); other Option combinations stay with the system.
    if (!arrow || event.shiftKey || !model.activeSentence.value) return null
    return () => model.moveWord(event.code === 'ArrowLeft' ? -1 : 1)
  }
  const audio = model.audioMode
  const player = model.audiobook
  switch (event.code) {
    case 'Space':
      return () => model.toggleListening()
    case 'ArrowUp':
    case 'ArrowDown':
      // A focused slider keeps its own arrows.
      if (event.shiftKey || target?.closest('[role="slider"], input[type="range"]')) return null
      return () => model.moveSentence(event.code === 'ArrowUp' ? -1 : 1)
    case 'ArrowLeft':
    case 'ArrowRight': {
      if (!audio) return null
      const seconds = event.shiftKey ? LONG_SKIP_SECONDS : SKIP_SECONDS
      return () => player.skip(event.code === 'ArrowLeft' ? -seconds : seconds)
    }
    case 'BracketLeft':
    case 'BracketRight':
      return audio ? () => model.stepRate(event.code === 'BracketLeft' ? -1 : 1) : null
    case 'Comma':
    case 'Period':
      return audio ? () => void player.selectTrack(player.track.value + (event.code === 'Comma' ? -1 : 1)) : null
    case 'KeyA':
      return player.hasAudio && !event.shiftKey ? () => model.switchBarMode() : null
    case 'Enter':
    case 'NumpadEnter':
      // A focused button or link keeps Enter.
      if (target?.closest('button, a, [role="slider"]') || !model.activeSentence.value) return null
      return model.wordCursor.value !== null ? () => model.lookUpCursorWord() : () => model.speakActiveSentence()
    case 'Escape':
      return model.wordCursor.value !== null ? () => { model.wordCursor.value = null } : null
    case 'Slash':
      return event.shiftKey ? showHelp : null
  }
  return event.key === '?' ? showHelp : null
}

export function useReaderShortcuts(model: ReaderModel, showHelp: () => void, showSearch: () => void) {
  useEffect(() => {
    let spaceHandled = false
    const onKey = (event: KeyboardEvent) => {
      const action = readerShortcut(event, model, showHelp, showSearch)
      if (!action) return
      // Also keeps Space from pressing a focused button (a second toggle) and from scrolling the page.
      event.preventDefault()
      // The focused scrubber would also move by its own arrow keys.
      event.stopPropagation()
      if (event.code === 'Space') spaceHandled = true
      if (!event.repeat || event.code.startsWith('Arrow')) action()
    }
    // A button is pressed by Space when the key goes up.
    const onKeyUp = (event: KeyboardEvent) => {
      if (event.code !== 'Space' || !spaceHandled) return
      spaceHandled = false
      event.preventDefault()
    }
    window.addEventListener('keydown', onKey, true)
    window.addEventListener('keyup', onKeyUp, true)
    return () => {
      window.removeEventListener('keydown', onKey, true)
      window.removeEventListener('keyup', onKeyUp, true)
    }
  }, [model])
}
