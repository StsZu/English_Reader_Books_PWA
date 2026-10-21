// Form controls styled after UIKit/SwiftUI: tabs with underline, stepper rows, switch, segmented control.
import type { ComponentChildren } from 'preact'
import { Icon } from '../icons.tsx'
import { cx } from './overlay.tsx'

export interface TabItem<T extends string> {
  value: T
  label: string
  testID?: string
}

/** Text tabs with an accent underline under the active one (ReaderPanel header). */
export function Tabs<T extends string>({ items, value, onChange, ariaLabel }: {
  items: TabItem<T>[]
  value: T
  onChange: (value: T) => void
  ariaLabel?: string
}) {
  return (
    <div class="tabs" role="tablist" aria-label={ariaLabel}>
      {items.map((item) => (
        <button
          key={item.value}
          type="button"
          role="tab"
          aria-selected={item.value === value}
          class={cx('tab', item.value === value && 'is-active')}
          onClick={() => onChange(item.value)}
          data-testid={item.testID}
        >
          <span class="tab-label">{item.label}</span>
          <span class="tab-underline" />
        </button>
      ))}
    </div>
  )
}

export interface StepperProps {
  title: ComponentChildren
  /** Text of the current value, already formatted (`0,25`, `0,7×`, `1 рядок`). */
  display: string
  value: number
  min: number
  max: number
  step: number
  onChange: (value: number) => void
  disabled?: boolean
  /** Prefix of test ids: `panel-${id}-minus|value|plus` as in the Swift accessibility identifiers. */
  id: string
  /** Plain-text title for the accessibility labels when `title` is not a string. */
  label?: string
}

/** StepRow: «назва — − значення +»; a button is disabled at its range limit. Buttons are 28×32 as in Swift. */
export function Stepper({ title, display, value, min, max, step, onChange, disabled, id, label }: StepperProps) {
  const name = label ?? (typeof title === 'string' ? title : id)
  const change = (direction: number) => {
    const next = Math.round((value + direction * step) / step) * step
    onChange(Math.min(max, Math.max(min, Number(next.toFixed(4)))))
  }
  return (
    <div class={cx('stepper-row', disabled && 'is-disabled')}>
      <span class="stepper-title">{title}</span>
      <div class="stepper-controls">
        <button
          type="button"
          class="stepper-btn"
          disabled={disabled || value - step < min - 0.0001}
          onClick={() => change(-1)}
          aria-label={`Зменшити: ${name}`}
          data-testid={`panel-${id}-minus`}
        >
          <Icon name="minus" size={17} strokeWidth={2.4} />
        </button>
        <span class="stepper-value" data-testid={`panel-${id}-value`} aria-live="polite">{display}</span>
        <button
          type="button"
          class="stepper-btn"
          disabled={disabled || value + step > max + 0.0001}
          onClick={() => change(1)}
          aria-label={`Збільшити: ${name}`}
          data-testid={`panel-${id}-plus`}
        >
          <Icon name="plus" size={17} strokeWidth={2.4} />
        </button>
      </div>
    </div>
  )
}

export interface ToggleProps {
  checked: boolean
  onChange: (checked: boolean) => void
  label?: ComponentChildren
  /** Accessible name when `label` is not plain text. */
  ariaLabel?: string
  disabled?: boolean
  testID?: string
  /** Secondary text under the label. */
  detail?: ComponentChildren
}

/** iOS switch (51×31, green when on). With `label` it renders a full Toggle row. */
export function Toggle({ checked, onChange, label, ariaLabel, disabled, testID, detail }: ToggleProps) {
  const control = (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={ariaLabel ?? (typeof label === 'string' ? label : undefined)}
      class={cx('switch', checked && 'is-on')}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      data-testid={testID}
    >
      <span class="switch-knob" />
    </button>
  )
  if (label === undefined) return control
  return (
    <div class={cx('toggle-row', disabled && 'is-disabled')}>
      <div class="toggle-text" onClick={() => !disabled && onChange(!checked)}>
        <span>{label}</span>
        {detail && <span class="toggle-detail">{detail}</span>}
      </div>
      {control}
    </div>
  )
}

export interface SegmentItem<T extends string | number> {
  value: T
  label: string
  testID?: string
}

/** UISegmentedControl with a sliding white thumb. */
export function Segmented<T extends string | number>({ items, value, onChange, ariaLabel, testID }: {
  items: SegmentItem<T>[]
  value: T
  onChange: (value: T) => void
  ariaLabel: string
  testID?: string
}) {
  const index = Math.max(0, items.findIndex((i) => i.value === value))
  return (
    <div class="segmented" role="radiogroup" aria-label={ariaLabel} data-testid={testID}
      style={{ '--segments': String(items.length), '--index': String(index) }}>
      <span class="segmented-thumb" />
      {items.map((item) => (
        <button
          key={String(item.value)}
          type="button"
          role="radio"
          aria-checked={item.value === value}
          class={cx('segment', item.value === value && 'is-active')}
          onClick={() => onChange(item.value)}
          data-testid={item.testID}
        >
          {item.label}
        </button>
      ))}
    </div>
  )
}
