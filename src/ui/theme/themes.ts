// Port of ReaderTheme (EnglishReader/Services/AppSettings.swift). Colors live in tokens.css as --reader-*.
import type { ReaderThemeName } from '../../core/storage/settings.ts'

export interface ReaderThemeInfo {
  name: ReaderThemeName
  label: string
  /** Exact background/text RGB for previews (theme tiles) and the browser chrome. */
  background: string
  text: string
  dark: boolean
}

export const readerThemes: ReaderThemeInfo[] = [
  { name: 'light', label: 'День', background: 'rgb(255, 255, 255)', text: 'rgb(26, 26, 26)', dark: false },
  { name: 'sepia', label: 'Сепія', background: 'rgb(245, 237, 217)', text: 'rgb(51, 38, 26)', dark: false },
  { name: 'dark', label: 'Ніч', background: 'rgb(28, 28, 31)', text: 'rgb(224, 222, 214)', dark: true },
]

export const themeInfo = (name: ReaderThemeName): ReaderThemeInfo =>
  readerThemes.find((t) => t.name === name) ?? readerThemes[1]

/** Sets data-theme on <html> (switching the system scheme to dark for «Ніч») and the status-bar color. */
export function applyTheme(name: ReaderThemeName) {
  const info = themeInfo(name)
  document.documentElement.dataset.theme = info.name
  let meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]')
  if (!meta) {
    meta = document.createElement('meta')
    meta.name = 'theme-color'
    document.head.appendChild(meta)
  }
  meta.content = info.background
}
