// FR-32: in a Safari tab (not installed) data can be evicted after 7 days without visits,
// so the library suggests adding the app to the Home Screen once, until dismissed.
import { useState } from 'preact/hooks'
import { appName, settingsPrefix } from '../core/language.ts'
import { IconButton } from '../ui/components/index.ts'
import { Icon } from '../ui/icons.tsx'
import { testFlags } from './test-mode.ts'

const KEY = `${settingsPrefix}installHintDismissed`

function isAppleTouchDevice(): boolean {
  return /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
}

function isInstalled(): boolean {
  return (navigator as Navigator & { standalone?: boolean }).standalone === true
    || matchMedia('(display-mode: standalone)').matches
}

function dismissed(): boolean {
  try { return localStorage.getItem(KEY) === '1' } catch { return false }
}

export function InstallHint() {
  // Automated tests emulate an iPad; the hint would cover the bottom of the library there.
  const testHidden = __TEST_MODE__ && !testFlags.installHint
  const [hidden, setHidden] = useState(() => testHidden || dismissed() || isInstalled() || !isAppleTouchDevice())
  if (hidden) return null
  const close = () => {
    try { localStorage.setItem(KEY, '1') } catch { /* private mode */ }
    setHidden(true)
  }
  return (
    <aside class="install-hint" role="note" data-testid="installHint">
      <Icon name="square.and.arrow.up" size={22} />
      <span>
        Додайте {appName} на початковий екран: «Поділитися» → «На початковий екран».
        Так застосунок відкриватиметься на весь екран, а книжки й збережене не видалятимуться автоматично.
      </span>
      <IconButton icon="xmark" label="Закрити підказку" tone="secondary" onClick={close} testID="installHintClose" />
    </aside>
  )
}
