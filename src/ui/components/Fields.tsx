// Text inputs in iOS style: rounded fields, secure field, multi-line editor, search field.
import type { JSX } from 'preact'
import { Icon } from '../icons.tsx'
import { cx } from './overlay.tsx'

interface BaseFieldProps {
  value: string
  onInput: (value: string) => void
  placeholder?: string
  ariaLabel?: string
  testID?: string
  disabled?: boolean
  autoFocus?: boolean
  onEnter?: () => void
  class?: string
  inputRef?: { current: HTMLInputElement | null }
}

function keyHandler(onEnter?: () => void) {
  return onEnter ? (event: JSX.TargetedKeyboardEvent<HTMLInputElement>) => { if (event.key === 'Enter') onEnter() } : undefined
}

export function TextField({ value, onInput, placeholder, ariaLabel, testID, disabled, autoFocus, onEnter, class: className, inputRef }: BaseFieldProps) {
  return (
    <input
      ref={inputRef}
      class={cx('field', className)}
      type="text"
      value={value}
      placeholder={placeholder}
      aria-label={ariaLabel ?? placeholder}
      disabled={disabled}
      autoFocus={autoFocus}
      autocomplete="off"
      autocapitalize="off"
      spellcheck={false}
      onInput={(e) => onInput(e.currentTarget.value)}
      onKeyDown={keyHandler(onEnter)}
      data-testid={testID}
    />
  )
}

export function SecureField({ value, onInput, placeholder, ariaLabel, testID, disabled, onEnter }: BaseFieldProps) {
  return (
    <input
      class="field"
      type="password"
      value={value}
      placeholder={placeholder}
      aria-label={ariaLabel ?? placeholder}
      disabled={disabled}
      autocomplete="off"
      autocapitalize="off"
      spellcheck={false}
      onInput={(e) => onInput(e.currentTarget.value)}
      onKeyDown={keyHandler(onEnter)}
      data-testid={testID}
    />
  )
}

export function TextArea({ value, onInput, placeholder, ariaLabel, testID, rows = 4 }: Omit<BaseFieldProps, 'onEnter'> & { rows?: number }) {
  return (
    <textarea
      class="field field-area"
      value={value}
      rows={rows}
      placeholder={placeholder}
      aria-label={ariaLabel ?? placeholder}
      onInput={(e) => onInput(e.currentTarget.value)}
      data-testid={testID}
    />
  )
}

export function SearchField({ value, onInput, placeholder = 'Пошук', testID }: Omit<BaseFieldProps, 'onEnter'>) {
  return (
    <div class="search-field">
      <Icon name="magnifyingglass" size={17} class="search-icon" />
      <input
        type="search"
        value={value}
        placeholder={placeholder}
        aria-label={placeholder}
        autocomplete="off"
        autocapitalize="off"
        spellcheck={false}
        enterkeyhint="search"
        onInput={(e) => onInput(e.currentTarget.value)}
        data-testid={testID}
      />
      {value && (
        <button type="button" class="search-clear" aria-label="Очистити" onClick={() => onInput('')}>
          <Icon name="xmark.circle.fill" size={17} />
        </button>
      )}
    </div>
  )
}
