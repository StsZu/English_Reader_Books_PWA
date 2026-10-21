// Reader side panel (ReaderView.panelOverlay): slides in from the right over the dimmed book.
import type { ComponentChildren } from 'preact'
import { useRef, useState } from 'preact/hooks'
import { Portal, cx, useDialogFocus, usePresence } from './overlay.tsx'

export interface SidePanelProps {
  open: boolean
  onClose: () => void
  children: ComponentChildren
  width?: number
  ariaLabel: string
  testID?: string
}

export function SidePanel({ open, onClose, children, width = 420, ariaLabel, testID = 'readerPanel' }: SidePanelProps) {
  const { mounted, visible } = usePresence(open, 220)
  const panel = useRef<HTMLDivElement>(null)
  const start = useRef<{ x: number; y: number } | null>(null)
  const [dx, setDx] = useState(0)
  useDialogFocus(open && mounted, panel, onClose)
  if (!mounted) return null

  function down(event: PointerEvent) {
    if (event.pointerType === 'mouse') return
    start.current = { x: event.clientX, y: event.clientY }
  }
  function move(event: PointerEvent) {
    if (!start.current) return
    const x = event.clientX - start.current.x
    const y = event.clientY - start.current.y
    if (x > 30 && Math.abs(y) < x) setDx(x - 30)
  }
  function up(event: PointerEvent) {
    if (!start.current) return
    const x = event.clientX - start.current.x
    const y = event.clientY - start.current.y
    start.current = null
    setDx(0)
    // DragGesture(minimumDistance: 30): translation.width > 80 and mostly horizontal closes.
    if (x > 80 && Math.abs(y) < x) onClose()
  }

  return (
    <Portal>
      <div class={cx('side-root', visible && 'is-visible')}>
        <div class="side-backdrop" onClick={onClose} role="button" aria-label="Закрити панель" data-testid="panelBackdrop" />
        <div
          ref={panel}
          class="side-panel"
          role="dialog"
          aria-modal="true"
          aria-label={ariaLabel}
          data-testid={testID}
          style={{ width: `min(${width}px, 100vw)`, ...(dx ? { transform: `translateX(${dx}px)`, transition: 'none' } : {}) }}
          onPointerDown={down}
          onPointerMove={move}
          onPointerUp={up}
          onPointerCancel={() => { start.current = null; setDx(0) }}
        >
          {children}
        </div>
      </div>
    </Portal>
  )
}
