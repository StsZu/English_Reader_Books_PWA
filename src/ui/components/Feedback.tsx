// ContentUnavailableView, NoticeBar, ProgressView, capsule badges.
import type { ComponentChildren } from 'preact'
import { Icon, type IconName } from '../icons.tsx'
import { cx } from './overlay.tsx'

export function ContentUnavailable({ icon, title, description, children, testID }: {
  icon: IconName
  title: string
  description?: ComponentChildren
  children?: ComponentChildren
  testID?: string
}) {
  return (
    <div class="unavailable" data-testid={testID}>
      <Icon name={icon} size={56} strokeWidth={1.6} class="unavailable-icon" />
      <div class="unavailable-title">{title}</div>
      {description && <div class="unavailable-description">{description}</div>}
      {children && <div class="unavailable-actions">{children}</div>}
    </div>
  )
}

/** Orange warning line with an action button (ReaderView.NoticeBar). */
export function NoticeBar({ text, actionTitle, onAction, testID = 'noticeBar' }: {
  text: ComponentChildren
  actionTitle?: string
  onAction?: () => void
  testID?: string
}) {
  return (
    <div class="notice-bar" role="status" data-testid={testID}>
      <Icon name="exclamationmark.triangle.fill" size={18} class="notice-icon" />
      <span class="notice-text" data-testid="noticeText">{text}</span>
      {actionTitle && (
        <button type="button" class="btn btn-bordered btn-small" onClick={onAction}>
          <span class="btn-title">{actionTitle}</span>
        </button>
      )}
    </div>
  )
}

/** UIActivityIndicatorView: twelve fading spokes. */
export function ProgressSpinner({ size = 'regular', label = 'Завантаження' }: { size?: 'small' | 'regular' | 'large'; label?: string }) {
  return (
    <span class={cx('spinner', `spinner-${size}`)} role="progressbar" aria-label={label}>
      {Array.from({ length: 12 }, (_, i) => <span key={i} class="spinner-spoke" style={{ '--i': String(i) }} />)}
    </span>
  )
}

export function Badge({ children, tone = 'accent', testID }: {
  children: ComponentChildren
  tone?: 'accent' | 'secondary' | 'orange' | 'green' | 'red' | 'translation'
  testID?: string
}) {
  return <span class={cx('badge', `badge-${tone}`)} data-testid={testID}>{children}</span>
}
