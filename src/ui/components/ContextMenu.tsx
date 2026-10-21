// .contextMenu: long press (0.5 s) lifts the item and shows a blurred menu of actions.
import type { ComponentChildren } from 'preact'
import { useEffect, useRef, useState } from 'preact/hooks'
import { Icon, type IconName } from '../icons.tsx'
import { Portal, cx, useDialogFocus } from './overlay.tsx'

export interface MenuAction {
  label: string
  icon?: IconName
  destructive?: boolean
  onSelect: () => void
  testID?: string
}

export interface ContextMenuProps {
  actions: MenuAction[]
  children: ComponentChildren
  /** Long-press duration in ms. */
  delay?: number
  testID?: string
}

export function ContextMenu({ actions, children, delay = 500, testID }: ContextMenuProps) {
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const origin = useRef<{ x: number; y: number } | null>(null)
  const fired = useRef(false)
  const wrapper = useRef<HTMLDivElement>(null)

  const cancel = () => {
    if (timer.current) clearTimeout(timer.current)
    timer.current = null
    origin.current = null
  }

  function open(x: number, y: number) {
    fired.current = true
    setMenu({ x, y })
  }

  function onPointerDown(event: PointerEvent) {
    fired.current = false
    origin.current = { x: event.clientX, y: event.clientY }
    timer.current = setTimeout(() => origin.current && open(origin.current.x, origin.current.y), delay)
  }
  function onPointerMove(event: PointerEvent) {
    if (!origin.current) return
    if (Math.hypot(event.clientX - origin.current.x, event.clientY - origin.current.y) > 10) cancel()
  }
  function onClickCapture(event: MouseEvent) {
    // The click that ends a long press must not also activate the item.
    if (fired.current) {
      event.preventDefault()
      event.stopPropagation()
      fired.current = false
    }
  }
  function onContextMenu(event: MouseEvent) {
    event.preventDefault()
    cancel()
    open(event.clientX, event.clientY)
  }

  useEffect(() => cancel, [])

  return (
    <div
      ref={wrapper}
      class={cx('context-target', menu && 'is-lifted')}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={cancel}
      onPointerCancel={cancel}
      onClickCapture={onClickCapture}
      onContextMenu={onContextMenu}
      data-testid={testID}
    >
      {children}
      {menu && <MenuPopover x={menu.x} y={menu.y} actions={actions} onClose={() => setMenu(null)} />}
    </div>
  )
}

export function MenuPopover({ x, y, actions, onClose }: { x: number; y: number; actions: MenuAction[]; onClose: () => void }) {
  const box = useRef<HTMLDivElement>(null)
  useDialogFocus(true, box, onClose)
  const width = 250
  const left = Math.min(Math.max(12, x - width / 2), window.innerWidth - width - 12)
  const top = Math.min(y + 12, window.innerHeight - 56 * actions.length - 24)
  return (
    <Portal>
      <div class="menu-root">
        <div class="menu-backdrop" onClick={onClose} onContextMenu={(e) => { e.preventDefault(); onClose() }} />
        <div ref={box} class="menu" role="menu" style={{ left: `${left}px`, top: `${Math.max(12, top)}px`, width: `${width}px` }}>
          {actions.map((action) => (
            <button
              key={action.label}
              type="button"
              role="menuitem"
              class={cx('menu-item', action.destructive && 'is-destructive')}
              onClick={() => { onClose(); action.onSelect() }}
              data-testid={action.testID}
            >
              <span>{action.label}</span>
              {action.icon && <Icon name={action.icon} size={19} />}
            </button>
          ))}
        </div>
      </div>
    </Portal>
  )
}
