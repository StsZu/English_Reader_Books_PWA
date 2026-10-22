// «Швидкі клавіші»: the reader's keyboard shortcuts (iPadOS lists shortcuts on holding ⌘ only for App Store apps).
import { FormSheet } from '../components/index.ts'
import { SHORTCUTS } from './shortcuts.ts'

export function ShortcutsSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <FormSheet open={open} onClose={onClose} ariaLabel="Швидкі клавіші" title="Швидкі клавіші" doneTestID="shortcutsDone" testID="shortcutsSheet" width={520}>
      <dl class="shortcuts">
        {SHORTCUTS.map((item) => (
          <div key={item.keys} class="shortcut-row">
            <dt><kbd>{item.keys}</kbd></dt>
            <dd>{item.action}</dd>
          </div>
        ))}
      </dl>
      <p class="shortcuts-note">Клавіші діють у читалці з клавіатурою iPad за будь-якої розкладки, крім часу, коли відкрито аркуш, меню чи панель або курсор у полі введення.</p>
    </FormSheet>
  )
}
