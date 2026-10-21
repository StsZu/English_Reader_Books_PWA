// Port of the reader gestures in ReaderView.swift: SpatialTapGesture for taps and
// SentenceLongPressGesture (0.5 s, 10 pt allowable movement) for long press and fragment selection.
import type { WordPosition } from './model.ts'

export const LONG_PRESS_MS = 500
export const MOVE_TOLERANCE = 10

export interface HitWord {
  paragraph: number
  position: WordPosition
  text: string
}

export interface GestureHandlers {
  tap(hit: HitWord): void
  longPressBegan(): void
  /** Finger moved past the tolerance after recognition: extend the selection. */
  longPressMoved(anchor: HitWord, focus: WordPosition): void
  /** `hit` is under the finger where the press was recognized. */
  longPressEnded(hit: HitWord | null, sentence: number | null, moved: boolean): void
  /** Any touch on the text, before anything else (unlocks audio on iOS). */
  touched(): void
}

function wordFromElement(element: Element | null): HitWord | null {
  const word = element?.closest<HTMLElement>('.w')
  const sentence = word?.closest<HTMLElement>('.s')
  const paragraph = sentence?.closest<HTMLElement>('[data-p]')
  if (!word || !sentence || !paragraph) return null
  return {
    paragraph: Number(paragraph.dataset.p),
    position: { sentence: Number(sentence.dataset.s), word: Number(word.dataset.w) },
    text: word.textContent ?? '',
  }
}

const distance = (rect: DOMRect, x: number, y: number) => {
  const dx = Math.max(rect.left - x, 0, x - rect.right)
  const dy = Math.max(rect.top - y, 0, y - rect.bottom)
  return Math.hypot(dx, dy)
}

/** Word under the point, allowing a few pixels of slack (SentenceHitMap.tappedWord). */
function wordAt(x: number, y: number, slack: number): HitWord | null {
  const direct = wordFromElement(document.elementFromPoint(x, y))
  if (direct) return direct
  const paragraph = document.elementFromPoint(x, y)?.closest<HTMLElement>('[data-p]')
  if (!paragraph) return null
  let best: { el: Element; d: number } | null = null
  for (const el of paragraph.querySelectorAll('.w')) {
    for (const rect of el.getClientRects()) {
      const d = distance(rect, x, y)
      if (!best || d < best.d) best = { el, d }
    }
  }
  return best && best.d < slack ? wordFromElement(best.el) : null
}

/** Word nearest to the point inside one paragraph; points beyond it clamp to its first or last words. */
function wordInParagraph(paragraphIndex: number, root: HTMLElement, x: number, y: number): WordPosition | null {
  const paragraph = root.querySelector<HTMLElement>(`[data-p="${paragraphIndex}"]`)
  if (!paragraph) return null
  const direct = wordFromElement(document.elementFromPoint(x, y))
  if (direct && direct.paragraph === paragraphIndex) return direct.position
  let best: { el: Element; d: number } | null = null
  for (const el of paragraph.querySelectorAll('.w')) {
    for (const rect of el.getClientRects()) {
      // Rows above/below count as distance by line first, then horizontally.
      const dy = Math.max(rect.top - y, 0, y - rect.bottom)
      const dx = Math.max(rect.left - x, 0, x - rect.right)
      const d = dy * 1000 + dx
      if (!best || d < best.d) best = { el, d }
    }
  }
  return best ? wordFromElement(best.el)?.position ?? null : null
}

function sentenceAt(paragraphIndex: number, root: HTMLElement, x: number, y: number): number | null {
  const paragraph = root.querySelector<HTMLElement>(`[data-p="${paragraphIndex}"]`)
  if (!paragraph) return null
  const direct = document.elementFromPoint(x, y)?.closest<HTMLElement>('.s')
  if (direct && paragraph.contains(direct)) return Number(direct.dataset.s)
  let best: { s: number; d: number } | null = null
  for (const el of paragraph.querySelectorAll<HTMLElement>('.s')) {
    for (const rect of el.getClientRects()) {
      const d = distance(rect, x, y)
      if (!best || d < best.d) best = { s: Number(el.dataset.s), d }
    }
  }
  return best && best.d < 24 ? best.s : null
}

/** Attaches tap / long-press / drag-select handling to the scrollable text container. */
export function attachGestures(root: HTMLElement, handlers: GestureHandlers): () => void {
  let pointerId: number | null = null
  let start = { x: 0, y: 0 }
  let timer: number | null = null
  let recognized = false
  let moved = false
  let anchor: HitWord | null = null
  let cancelled = false

  const clearTimer = () => {
    if (timer !== null) clearTimeout(timer)
    timer = null
  }

  const reset = () => {
    clearTimer()
    pointerId = null
    recognized = false
    moved = false
    anchor = null
    cancelled = false
    root.classList.remove('pressing')
  }

  const onDown = (event: PointerEvent) => {
    if (event.button !== 0 || pointerId !== null) return
    if (!(event.target as Element).closest('[data-p]')) return
    handlers.touched()
    pointerId = event.pointerId
    start = { x: event.clientX, y: event.clientY }
    recognized = false
    moved = false
    cancelled = false
    clearTimer()
    timer = window.setTimeout(() => {
      timer = null
      if (cancelled || pointerId === null) return
      recognized = true
      root.classList.add('pressing')
      anchor = wordAt(start.x, start.y, 12)
      handlers.longPressBegan()
    }, LONG_PRESS_MS)
  }

  const onMove = (event: PointerEvent) => {
    if (event.pointerId !== pointerId) return
    const travelled = Math.hypot(event.clientX - start.x, event.clientY - start.y)
    if (!recognized) {
      // Movement before recognition is scrolling: no tap, no long press.
      if (travelled > MOVE_TOLERANCE) {
        cancelled = true
        clearTimer()
      }
      return
    }
    if (travelled > MOVE_TOLERANCE) moved = true
    if (moved && anchor) {
      const focus = wordInParagraph(anchor.paragraph, root, event.clientX, event.clientY)
      if (focus) handlers.longPressMoved(anchor, focus)
    }
  }

  const onUp = (event: PointerEvent) => {
    if (event.pointerId !== pointerId) return
    if (recognized) {
      const sentence = anchor ? sentenceAt(anchor.paragraph, root, start.x, start.y) : null
      handlers.longPressEnded(anchor, sentence, moved)
    } else if (!cancelled) {
      const hit = wordAt(event.clientX, event.clientY, 8)
      if (hit) handlers.tap(hit)
    }
    reset()
  }

  const onCancel = (event: PointerEvent) => {
    if (event.pointerId !== pointerId) return
    if (recognized) handlers.longPressEnded(null, null, true)
    reset()
  }

  // After recognition the finger drags a selection: stop the page from scrolling (non-passive).
  const onTouchMove = (event: TouchEvent) => {
    if (recognized) event.preventDefault()
  }
  const onContextMenu = (event: Event) => {
    if ((event.target as Element).closest?.('[data-p]')) event.preventDefault()
  }

  root.addEventListener('pointerdown', onDown)
  window.addEventListener('pointermove', onMove)
  window.addEventListener('pointerup', onUp)
  window.addEventListener('pointercancel', onCancel)
  root.addEventListener('touchmove', onTouchMove, { passive: false })
  root.addEventListener('contextmenu', onContextMenu)
  return () => {
    clearTimer()
    root.removeEventListener('pointerdown', onDown)
    window.removeEventListener('pointermove', onMove)
    window.removeEventListener('pointerup', onUp)
    window.removeEventListener('pointercancel', onCancel)
    root.removeEventListener('touchmove', onTouchMove)
    root.removeEventListener('contextmenu', onContextMenu)
  }
}
