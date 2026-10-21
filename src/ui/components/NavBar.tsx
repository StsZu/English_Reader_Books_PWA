import type { ComponentChildren } from 'preact'
import { Icon } from '../icons.tsx'
import { cx } from './overlay.tsx'

export interface NavBarProps {
  title?: ComponentChildren
  /** Large title under the bar (NavigationStack root, «Мої книжки»). */
  largeTitle?: string
  leading?: ComponentChildren
  trailing?: ComponentChildren
  onBack?: () => void
  backLabel?: string
  /** Transparent background that blends into the reader theme. */
  tone?: 'bar' | 'reader' | 'grouped'
  testID?: string
}

/** Inline navigation bar: title centered, actions left and right, «bar» material. */
export function NavBar({ title, largeTitle, leading, trailing, onBack, backLabel = 'Назад', tone = 'bar', testID }: NavBarProps) {
  return (
    <header class={cx('navbar', `navbar-${tone}`, largeTitle && 'has-large-title')} data-testid={testID}>
      <div class="navbar-row">
        <div class="navbar-side navbar-leading">
          {onBack && (
            <button type="button" class="navbar-back" onClick={onBack} aria-label={backLabel} data-testid="backButton">
              <Icon name="chevron.left" size={26} strokeWidth={2.4} />
              <span>{backLabel}</span>
            </button>
          )}
          {leading}
        </div>
        <div class="navbar-title" role="heading" aria-level={1}>{title}</div>
        <div class="navbar-side navbar-trailing">{trailing}</div>
      </div>
      {largeTitle && <h1 class="navbar-large-title">{largeTitle}</h1>}
    </header>
  )
}
