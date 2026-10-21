// Sheets as SwiftUI presents them on iPad: a centered form sheet in regular width,
// a bottom sheet with medium/large detents in compact width (or when `bottom` is forced).
import type { ComponentChildren } from 'preact'
import { useEffect, useRef, useState } from 'preact/hooks'
import { NavBar } from './NavBar.tsx'
import { Portal, cx, useDialogFocus, usePresence } from './overlay.tsx'

export type Detent = 'medium' | 'large'

export interface SheetProps {
  open: boolean
  onClose: () => void
  children: ComponentChildren
  /** Bottom-sheet detents; the first one is the initial height. */
  detents?: Detent[]
  /** Force the bottom presentation even on wide screens. */
  bottom?: boolean
  ariaLabel: string
  testID?: string
  /** Optional navigation bar of the sheet. */
  title?: string
  leading?: ComponentChildren
  trailing?: ComponentChildren
  /** Width of the centered form sheet. */
  width?: number
  /** Height of the centered form sheet (default fits the content up to 85 % of the viewport). */
  height?: number
  /** Disables dismissal by backdrop tap and swipe (interactiveDismissDisabled). */
  modal?: boolean
}

const EXIT_MS = 280

function useWide(): boolean {
  const query = '(min-width: 700px) and (min-height: 600px)'
  const [wide, setWide] = useState(() => typeof matchMedia !== 'undefined' && matchMedia(query).matches)
  useEffect(() => {
    const list = matchMedia(query)
    const update = () => setWide(list.matches)
    list.addEventListener('change', update)
    return () => list.removeEventListener('change', update)
  }, [])
  return wide
}

export function Sheet({
  open, onClose, children, detents = ['medium', 'large'], bottom = false, ariaLabel, testID, title, leading, trailing,
  width = 600, height, modal = false,
}: SheetProps) {
  const { mounted, visible } = usePresence(open, EXIT_MS)
  const wide = useWide()
  const form = wide && !bottom
  const [detent, setDetent] = useState<Detent>(detents[0])
  const [drag, setDrag] = useState(0)
  const panel = useRef<HTMLDivElement>(null)
  const start = useRef<{ y: number; t: number } | null>(null)
  useDialogFocus(open && mounted, panel, modal ? undefined : onClose)

  useEffect(() => {
    if (open) setDetent(detents[0])
  }, [open])

  if (!mounted) return null

  function onPointerDown(event: PointerEvent) {
    if (form) return
    start.current = { y: event.clientY, t: performance.now() }
    ;(event.currentTarget as HTMLElement).setPointerCapture(event.pointerId)
  }
  function onPointerMove(event: PointerEvent) {
    if (!start.current) return
    const dy = event.clientY - start.current.y
    setDrag(dy < 0 && detent === 'large' ? dy / 4 : dy)
  }
  function onPointerUp(event: PointerEvent) {
    if (!start.current) return
    const dy = event.clientY - start.current.y
    const velocity = dy / Math.max(1, performance.now() - start.current.t)
    start.current = null
    setDrag(0)
    if (dy < -60 && detent === 'medium' && detents.includes('large')) setDetent('large')
    else if ((dy > 80 || velocity > 0.6) && detent === 'large' && detents.includes('medium') && dy < 260) setDetent('medium')
    else if ((dy > 120 || velocity > 0.8) && !modal) onClose()
  }

  const dragStyle = drag !== 0 ? { transform: `translateY(${Math.max(drag, -40)}px)`, transition: 'none' } : undefined
  const sizeStyle = form ? { width: `min(${width}px, calc(100vw - 48px))`, ...(height ? { height: `min(${height}px, 88vh)` } : {}) } : undefined

  return (
    <Portal>
      <div class={cx('sheet-root', form ? 'sheet-form' : 'sheet-bottom', visible && 'is-visible')}>
        <div class="sheet-backdrop" onClick={modal ? undefined : onClose} data-testid={testID ? `${testID}-backdrop` : undefined} />
        <div
          ref={panel}
          class={cx('sheet-panel', !form && `detent-${detent}`)}
          role="dialog"
          aria-modal="true"
          aria-label={ariaLabel}
          data-testid={testID}
          style={{ ...sizeStyle, ...dragStyle }}
        >
          {!form && (
            <div class="sheet-grabber-area" onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={onPointerUp}>
              <div class="sheet-grabber" />
            </div>
          )}
          {(title || leading || trailing) && <NavBar title={title} leading={leading} trailing={trailing} tone="grouped" />}
          <div class="sheet-content">{children}</div>
        </div>
      </div>
    </Portal>
  )
}

/** Centered modal form sheet with a «Готово» button (SwiftUI .sheet + NavigationStack on iPad). */
export function FormSheet(props: Omit<SheetProps, 'bottom' | 'detents'> & { doneLabel?: string; doneTestID?: string }) {
  const { doneLabel = 'Готово', doneTestID, trailing, ...rest } = props
  return (
    <Sheet
      {...rest}
      trailing={trailing ?? (
        <button type="button" class="navbar-text-btn is-bold" onClick={props.onClose} data-testid={doneTestID}>{doneLabel}</button>
      )}
    />
  )
}
