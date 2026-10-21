// confirmationDialog / alert in iOS style (never window.confirm: it blocks and looks foreign).
import type { ComponentChildren } from 'preact'
import { useRef } from 'preact/hooks'
import { Portal, cx, useDialogFocus, usePresence } from './overlay.tsx'

export interface DialogAction {
  label: string
  role?: 'default' | 'destructive' | 'cancel'
  onSelect?: () => void
  testID?: string
}

export interface ConfirmDialogProps {
  open: boolean
  title: string
  message?: ComponentChildren
  actions: DialogAction[]
  onClose: () => void
  /** `alert`: centered 270 px box; `actionSheet`: the iPad popover-like list. */
  style?: 'alert' | 'actionSheet'
  testID?: string
}

export function ConfirmDialog({ open, title, message, actions, onClose, style = 'alert', testID }: ConfirmDialogProps) {
  const { mounted, visible } = usePresence(open, 200)
  const box = useRef<HTMLDivElement>(null)
  useDialogFocus(open && mounted, box, onClose)
  if (!mounted) return null
  const ordered = style === 'alert' && actions.length === 2
    ? [...actions].sort((a, b) => (a.role === 'cancel' ? -1 : 0) - (b.role === 'cancel' ? -1 : 0))
    : [...actions.filter((a) => a.role !== 'cancel'), ...actions.filter((a) => a.role === 'cancel')]
  const select = (action: DialogAction) => {
    onClose()
    action.onSelect?.()
  }
  return (
    <Portal>
      <div class={cx('dialog-root', `dialog-${style}`, visible && 'is-visible')}>
        <div class="dialog-backdrop" onClick={onClose} />
        <div ref={box} class="dialog-box" role="alertdialog" aria-modal="true" aria-label={title} data-testid={testID}>
          <div class="dialog-text">
            <div class="dialog-title">{title}</div>
            {message && <div class="dialog-message">{message}</div>}
          </div>
          <div class={cx('dialog-actions', style === 'alert' && ordered.length === 2 && 'is-row')}>
            {ordered.map((action) => (
              <button
                key={action.label}
                type="button"
                class={cx('dialog-action', action.role && `is-${action.role}`)}
                onClick={() => select(action)}
                data-testid={action.testID}
              >
                {action.label}
              </button>
            ))}
          </div>
        </div>
      </div>
    </Portal>
  )
}
