import type { ComponentChildren, JSX } from 'preact'
import { Icon, type IconName } from '../icons.tsx'
import { cx } from './overlay.tsx'

export type ButtonVariant = 'plain' | 'bordered' | 'borderedProminent' | 'destructive' | 'borderedDestructive'

export interface ButtonProps {
  children?: ComponentChildren
  icon?: IconName
  /** `titleAndIcon` (SwiftUI Label default in toolbars here), `iconOnly`, `titleOnly`. */
  labelStyle?: 'titleAndIcon' | 'iconOnly' | 'titleOnly'
  variant?: ButtonVariant
  size?: 'regular' | 'small' | 'large'
  disabled?: boolean
  selected?: boolean
  onClick?: (event: JSX.TargetedMouseEvent<HTMLButtonElement>) => void
  ariaLabel?: string
  testID?: string
  class?: string
  type?: 'button' | 'submit'
  fullWidth?: boolean
}

export function Button({
  children, icon, labelStyle = 'titleAndIcon', variant = 'plain', size = 'regular', disabled, selected, onClick,
  ariaLabel, testID, class: className, type = 'button', fullWidth,
}: ButtonProps) {
  const showIcon = icon && labelStyle !== 'titleOnly'
  const showTitle = children !== undefined && labelStyle !== 'iconOnly'
  return (
    <button
      type={type}
      class={cx('btn', `btn-${variant}`, `btn-${size}`, selected && 'is-selected', fullWidth && 'btn-full', className)}
      disabled={disabled}
      onClick={onClick}
      aria-label={ariaLabel ?? (labelStyle === 'iconOnly' && typeof children === 'string' ? children : undefined)}
      aria-pressed={selected === undefined ? undefined : selected}
      data-testid={testID}
    >
      {showIcon && <Icon name={icon} size={size === 'small' ? 16 : 19} />}
      {showTitle && <span class="btn-title">{children}</span>}
    </button>
  )
}

export interface IconButtonProps {
  icon: IconName
  label: string
  onClick?: (event: JSX.TargetedMouseEvent<HTMLButtonElement>) => void
  disabled?: boolean
  selected?: boolean
  testID?: string
  size?: number
  tone?: 'accent' | 'secondary' | 'label' | 'destructive'
  class?: string
}

/** 44×44 target with an icon only (toolbar buttons, close buttons). */
export function IconButton({ icon, label, onClick, disabled, selected, testID, size = 22, tone = 'accent', class: className }: IconButtonProps) {
  return (
    <button
      type="button"
      class={cx('icon-btn', `tone-${tone}`, selected && 'is-selected', className)}
      aria-label={label}
      title={label}
      aria-pressed={selected === undefined ? undefined : selected}
      disabled={disabled}
      onClick={onClick}
      data-testid={testID}
    >
      <Icon name={icon} size={size} />
    </button>
  )
}
