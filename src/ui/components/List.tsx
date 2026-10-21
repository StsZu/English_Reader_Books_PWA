// Inset grouped lists (SwiftUI Form / List(.insetGrouped)) and disclosure rows.
import type { ComponentChildren, JSX } from 'preact'
import { Icon, type IconName } from '../icons.tsx'
import { cx } from './overlay.tsx'

export function List({ children, class: className, testID }: { children: ComponentChildren; class?: string; testID?: string }) {
  return <div class={cx('list', className)} data-testid={testID}>{children}</div>
}

export interface SectionProps {
  header?: ComponentChildren
  footer?: ComponentChildren
  children: ComponentChildren
  testID?: string
  /** Plain card without row separators (ReaderPanel sections). */
  plain?: boolean
}

export function Section({ header, footer, children, testID, plain }: SectionProps) {
  return (
    <section class="list-section" data-testid={testID}>
      {header && <div class="list-header">{header}</div>}
      <div class={cx('list-card', plain && 'is-plain')}>{children}</div>
      {footer && <div class="list-footer">{footer}</div>}
    </section>
  )
}

export interface RowProps {
  title?: ComponentChildren
  subtitle?: ComponentChildren
  /** Trailing content (value text, controls). */
  value?: ComponentChildren
  icon?: IconName
  iconTone?: 'accent' | 'secondary'
  onClick?: (event: JSX.TargetedMouseEvent<HTMLElement>) => void
  chevron?: boolean
  destructive?: boolean
  selected?: boolean
  testID?: string
  children?: ComponentChildren
  disabled?: boolean
}

export function Row({ title, subtitle, value, icon, iconTone = 'accent', onClick, chevron, destructive, selected, testID, children, disabled }: RowProps) {
  const content = (
    <>
      {icon && <span class={cx('row-icon', `tone-${iconTone}`)}><Icon name={icon} size={20} /></span>}
      <span class="row-main">
        {title && <span class={cx('row-title', destructive && 'is-destructive')}>{title}</span>}
        {subtitle && <span class="row-subtitle">{subtitle}</span>}
        {children}
      </span>
      {value !== undefined && <span class="row-value">{value}</span>}
      {selected && <span class="row-check"><Icon name="checkmark" size={18} strokeWidth={2.6} /></span>}
      {chevron && <span class="row-chevron"><Icon name="chevron.right" size={15} strokeWidth={2.6} /></span>}
    </>
  )
  if (onClick) {
    return (
      <button type="button" class="row is-button" onClick={onClick} data-testid={testID} disabled={disabled} aria-pressed={selected}>
        {content}
      </button>
    )
  }
  return <div class="row" data-testid={testID}>{content}</div>
}

export interface DisclosureProps {
  title: string
  icon: IconName
  expanded: boolean
  onToggle: () => void
  children: ComponentChildren
  testID?: string
}

/** ReaderPanel section: icon, semibold title, chevron up/down; content below when expanded. */
export function Disclosure({ title, icon, expanded, onToggle, children, testID }: DisclosureProps) {
  return (
    <div class={cx('disclosure', expanded && 'is-expanded')}>
      <button
        type="button"
        class="disclosure-header"
        onClick={onToggle}
        aria-expanded={expanded}
        aria-label={`${title}, ${expanded ? 'розгорнуто' : 'згорнуто'}`}
        data-testid={testID}
      >
        <span class="disclosure-icon"><Icon name={icon} size={20} /></span>
        <span class="disclosure-title">{title}</span>
        <span class="disclosure-chevron"><Icon name="chevron.down" size={18} strokeWidth={2.4} /></span>
      </button>
      {expanded && <div class="disclosure-content">{children}</div>}
    </div>
  )
}
