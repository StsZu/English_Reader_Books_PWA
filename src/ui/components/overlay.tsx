// Shared overlay plumbing: portal into <body>, mount/unmount presence for animations, Esc and focus trap.
import { render, type ComponentChildren } from 'preact'
import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks'

/** Renders children into a host element at the end of <body>, outside any transformed ancestor. */
export function Portal({ children }: { children: ComponentChildren }) {
  const host = useRef<HTMLDivElement | null>(null)
  if (!host.current && typeof document !== 'undefined') {
    host.current = document.createElement('div')
    host.current.className = 'portal-host'
  }
  useLayoutEffect(() => {
    const el = host.current!
    document.body.appendChild(el)
    return () => {
      render(null, el)
      el.remove()
    }
  }, [])
  useLayoutEffect(() => {
    render(<>{children}</>, host.current!)
  })
  return null
}

/** Keeps an overlay mounted while its exit animation runs. `visible` flips one frame after mount. */
export function usePresence(open: boolean, exitMs: number): { mounted: boolean; visible: boolean } {
  const [mounted, setMounted] = useState(open)
  const [visible, setVisible] = useState(false)
  useEffect(() => {
    if (open) {
      setMounted(true)
      const frame = requestAnimationFrame(() => requestAnimationFrame(() => setVisible(true)))
      return () => cancelAnimationFrame(frame)
    }
    setVisible(false)
    const timer = setTimeout(() => setMounted(false), exitMs)
    return () => clearTimeout(timer)
  }, [open, exitMs])
  return { mounted, visible }
}

const focusableSelector =
  'button:not([disabled]), [href], input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])'

/** Esc closes; Tab stays inside the container; focus returns to the opener on close. */
export function useDialogFocus(active: boolean, container: { current: HTMLElement | null }, onEscape?: () => void) {
  useEffect(() => {
    if (!active) return
    const previous = document.activeElement as HTMLElement | null
    const node = container.current
    const first = node?.querySelector<HTMLElement>('[data-autofocus]') ?? node?.querySelector<HTMLElement>(focusableSelector)
    first?.focus({ preventScroll: true })
    function onKey(event: KeyboardEvent) {
      if (event.key === 'Escape' && onEscape) {
        event.preventDefault()
        event.stopPropagation()
        onEscape()
        return
      }
      if (event.key !== 'Tab' || !node) return
      const items = Array.from(node.querySelectorAll<HTMLElement>(focusableSelector)).filter((el) => el.offsetParent !== null)
      if (items.length === 0) return
      const firstItem = items[0]
      const lastItem = items[items.length - 1]
      if (event.shiftKey && document.activeElement === firstItem) {
        event.preventDefault()
        lastItem.focus()
      } else if (!event.shiftKey && document.activeElement === lastItem) {
        event.preventDefault()
        firstItem.focus()
      }
    }
    document.addEventListener('keydown', onKey, true)
    return () => {
      document.removeEventListener('keydown', onKey, true)
      previous?.focus?.({ preventScroll: true })
    }
  }, [active])
}

export const cx = (...names: (string | false | null | undefined)[]): string => names.filter(Boolean).join(' ')
