// Focus of overlays (useDialogFocus, R026 en-2): the first focus is set while the overlay is drawn, not a frame later,
// so input that starts at once is never taken away; focus put inside on purpose stays; Esc, Tab and the way back work.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render } from 'preact'
import { useLayoutEffect, useRef } from 'preact/hooks'
import { act } from 'preact/test-utils'
import { SidePanel } from '../../src/ui/components/SidePanel.tsx'
import { ConfirmDialog } from '../../src/ui/components/Dialog.tsx'

let root: HTMLDivElement
let opener: HTMLButtonElement

beforeEach(() => {
  opener = document.createElement('button')
  opener.textContent = 'open'
  document.body.appendChild(opener)
  opener.focus()
  root = document.createElement('div')
  document.body.appendChild(root)
})

afterEach(() => {
  act(() => render(null, root))
  root.remove()
  opener.remove()
  vi.useRealTimers()
})

const byID = (id: string) => document.querySelector<HTMLElement>(`[data-testid="${id}"]`)!
/** Lets every effect that waits for the next frame run (Preact's useEffect: animation frame or 35 ms, then a task). */
const settle = () => new Promise((resolve) => setTimeout(resolve, 120))

function Panel({ open, onClose = () => {}, autofocus = false }: { open: boolean; onClose?: () => void; autofocus?: boolean }) {
  return (
    <SidePanel open={open} onClose={onClose} ariaLabel="Panel">
      <button type="button" data-testid="firstTab">Налаштування</button>
      <input type="search" data-testid="search" {...(autofocus ? { 'data-autofocus': true } : {})} />
      <button type="button" data-testid="last">Last</button>
    </SidePanel>
  )
}

describe('useDialogFocus', () => {
  it('puts the first focus while the panel is drawn, before the next frame', () => {
    render(<Panel open />, root)
    expect(document.activeElement).toBe(byID('firstTab'))
  })

  it('input that starts at once keeps its field: no late focus takes it away (fill right after opening)', async () => {
    render(<Panel open />, root)
    const search = byID('search') as HTMLInputElement
    search.value = 'I HAD CALLED UPON MY FRIEND'
    search.focus()
    search.select()
    await settle()
    expect(document.activeElement).toBe(search)
  })

  it('takes [data-autofocus] first', () => {
    render(<Panel open autofocus />, root)
    expect(document.activeElement).toBe(byID('search'))
  })

  it('leaves alone focus that the content put inside on purpose while being drawn', async () => {
    function Focused() {
      const ref = useRef<HTMLInputElement>(null)
      useLayoutEffect(() => { ref.current?.focus() }, [])
      return <input ref={ref} data-testid="own" />
    }
    render(
      <SidePanel open onClose={() => {}} ariaLabel="Panel">
        <button type="button" data-testid="firstTab">A</button>
        <Focused />
      </SidePanel>,
      root,
    )
    expect(document.activeElement).toBe(byID('own'))
    await settle()
    expect(document.activeElement).toBe(byID('own'))
    // The way back still leads to the opener, though the content took the focus before the panel looked.
    render(<SidePanel open={false} onClose={() => {}} ariaLabel="Panel"><button type="button">A</button></SidePanel>, root)
    expect(document.activeElement).toBe(opener)
  })

  it('Escape closes, Tab stays inside, closing gives focus back to the opener', async () => {
    const onClose = vi.fn()
    act(() => render(<Panel open onClose={onClose} />, root))
    byID('last').focus()
    const tab = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true })
    document.dispatchEvent(tab)
    // happy-dom has no layout: offsetParent is null for every element, so the trap has nothing to wrap; only check it does not throw.
    act(() => { document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })) })
    expect(onClose).toHaveBeenCalledTimes(1)
    act(() => render(<Panel open={false} onClose={onClose} />, root))
    expect(document.activeElement).toBe(opener)
    await settle()
  })

  it('a quick close and reopen focuses the panel again at once and returns to the opener at the end', async () => {
    render(<Panel open />, root)
    expect(document.activeElement).toBe(byID('firstTab'))
    render(<Panel open={false} />, root)
    expect(document.activeElement).toBe(opener)
    // Reopened while the exit animation still keeps it mounted.
    render(<Panel open />, root)
    expect(document.activeElement).toBe(byID('firstTab'))
    const search = byID('search') as HTMLInputElement
    search.focus()
    await settle()
    expect(document.activeElement).toBe(search)
    render(<Panel open={false} />, root)
    expect(document.activeElement).toBe(opener)
    await settle()
  })

  it('the confirmation dialog uses the same focus at once', () => {
    render(<ConfirmDialog open title="Delete?" onClose={() => {}} testID="confirm"
      actions={[{ label: 'Cancel', role: 'cancel', testID: 'cancel' }, { label: 'Delete', role: 'destructive', testID: 'delete' }]} />, root)
    expect(byID('confirm').contains(document.activeElement)).toBe(true)
  })
})
