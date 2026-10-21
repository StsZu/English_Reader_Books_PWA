// Port of EnglishReader/Services/AppSettings.swift: the same keys, defaults and ranges.
// Values live in localStorage (the analogue of @AppStorage) and are exposed as signals.
import { computed, effect, signal, type Signal } from '@preact/signals'
import type { VoiceEngineKind } from '../../contracts.ts'

export type ReaderThemeName = 'light' | 'sepia' | 'dark'
export type BookFontName = 'system' | 'systemSans' | 'georgia' | 'charter' | 'iowan' | 'palatino' | 'baskerville'
export type ReaderPanelSection = 'text' | 'parallel' | 'dictionary' | 'pronunciation'
export type ExternalDictionaryID =
  | 'cambridge' | 'reverso' | 'google' | 'deepl' | 'glosbe' | 'oxford' | 'merriamWebster' | 'urban' | 'forvo'

export const panelSections: ReaderPanelSection[] = ['text', 'parallel', 'dictionary', 'pronunciation']
export const allDictionaries: ExternalDictionaryID[] =
  ['cambridge', 'reverso', 'google', 'deepl', 'glosbe', 'oxford', 'merriamWebster', 'urban', 'forvo']
export const defaultEnabledDictionaries: ExternalDictionaryID[] = ['cambridge', 'reverso', 'google', 'deepl', 'glosbe']
export const openAIVoices = ['coral', 'sage', 'alloy', 'ash', 'ballad', 'echo', 'fable', 'nova', 'onyx', 'shimmer', 'verse']

export const defaultExplanationTemplate =
  'Поясни українською значення слова «{слово}» у реченні: «{контекст}». Опиши відтінки значення й типові словосполучення та дай 2–3 короткі приклади вживання англійською з перекладом.'

export const ranges = {
  fontSize: [14, 40, 1],
  lineSpacingFactor: [0, 1, 0.05],
  sideMargin: [0, 120, 10],
  firstLineIndent: [0, 3, 0.25],
  paragraphSpacingFactor: [0, 2, 0.1],
  parallelTranslationScale: [0.5, 1.5, 0.1],
  parallelTranslationAutoHideLines: [0.5, 5, 0.5],
  wordCardScale: [0.8, 1.5, 0.1],
  speechRate: [0.6, 1.4, 0.05],
} as const satisfies Record<string, readonly [number, number, number]>

const defaults = {
  showTranslation: true,
  parallelTranslationScale: 0.7,
  parallelTranslationMultiline: false,
  parallelTranslationAutoHide: true,
  parallelTranslationAutoHideLines: 1.0,
  fontSize: 22,
  bookFont: 'system' as BookFontName,
  lineSpacingFactor: 0.25,
  sideMargin: 40,
  firstLineIndent: 0,
  paragraphSpacingFactor: 0.9,
  justifyText: false,
  expandedPanelSections: 'text',
  showWordLevel: true,
  showWordForms: true,
  wordCardScale: 1.0,
  dictionaryOrder: allDictionaries.join(','),
  enabledDictionaries: defaultEnabledDictionaries.join(','),
  explanationTemplate: defaultExplanationTemplate,
  highlightSavedWords: false,
  theme: 'sepia' as ReaderThemeName,
  voiceEngine: 'openAI' as VoiceEngineKind,
  openAIVoice: 'coral',
  speechRate: 1.0,
  textModel: 'gpt-5.4-mini',
  ttsModel: 'gpt-4o-mini-tts',
  /** Training settings (TrainingView.swift @AppStorage). */
  trainingCount: 10,
  trainingMode: 'automatic' as 'automatic' | 'manual' | 'random',
  trainingExercises: '1,2,3,4,5',
}

export type SettingsValues = typeof defaults
export type SettingKey = keyof SettingsValues

const PREFIX = 'er.'

function read<K extends SettingKey>(key: K): SettingsValues[K] {
  try {
    const raw = localStorage.getItem(PREFIX + key)
    if (raw === null) return defaults[key]
    const value = JSON.parse(raw)
    return typeof value === typeof defaults[key] ? value : defaults[key]
  } catch {
    return defaults[key]
  }
}

function write(key: SettingKey, value: unknown) {
  try {
    if (value === defaults[key]) localStorage.removeItem(PREFIX + key)
    else localStorage.setItem(PREFIX + key, JSON.stringify(value))
  } catch {
    // Storage may be unavailable (private mode); settings then last for the session.
  }
}

type SettingsSignals = { [K in SettingKey]: Signal<SettingsValues[K]> }

function makeSignals(): SettingsSignals {
  const result = {} as Record<string, Signal<unknown>>
  for (const key of Object.keys(defaults) as SettingKey[]) {
    const s = signal(read(key))
    effect(() => write(key, s.value))
    result[key] = s
  }
  return result as SettingsSignals
}

export const settings = makeSignals()

/** Translation font size: base size × scale, clamped to 10–40. */
export const parallelTranslationFontSize = computed(() =>
  Math.min(40, Math.max(10, settings.fontSize.value * settings.parallelTranslationScale.value)))

export const bookLineSpacing = computed(() => settings.fontSize.value * settings.lineSpacingFactor.value)

export function clampStep(key: keyof typeof ranges, value: number): number {
  const [min, max, step] = ranges[key]
  const stepped = Math.round(value / step) * step
  return Math.min(max, Math.max(min, Number(stepped.toFixed(4))))
}

export function isExpanded(section: ReaderPanelSection): boolean {
  return settings.expandedPanelSections.value.split(',').includes(section)
}

export function toggleSection(section: ReaderPanelSection) {
  const set = new Set(settings.expandedPanelSections.value.split(',').filter(Boolean))
  if (set.has(section)) set.delete(section)
  else set.add(section)
  settings.expandedPanelSections.value = panelSections.filter((s) => set.has(s)).join(',')
}

/** All dictionaries in the user's order; ones missing from the stored order are appended. */
export function dictionaryOrder(): ExternalDictionaryID[] {
  const stored = settings.dictionaryOrder.value.split(',').filter((id): id is ExternalDictionaryID =>
    (allDictionaries as string[]).includes(id))
  return [...stored, ...allDictionaries.filter((d) => !stored.includes(d))]
}

export function setDictionaryOrder(order: ExternalDictionaryID[]) {
  settings.dictionaryOrder.value = order.join(',')
}

export function isDictionaryEnabled(id: ExternalDictionaryID): boolean {
  return settings.enabledDictionaries.value.split(',').includes(id)
}

export function setDictionaryEnabled(id: ExternalDictionaryID, enabled: boolean) {
  const set = new Set(settings.enabledDictionaries.value.split(',').filter(Boolean))
  if (enabled) set.add(id)
  else set.delete(id)
  settings.enabledDictionaries.value = dictionaryOrder().filter((d) => set.has(d)).join(',')
}

export function enabledDictionaries(): ExternalDictionaryID[] {
  const set = new Set(settings.enabledDictionaries.value.split(','))
  return dictionaryOrder().filter((d) => set.has(d))
}

/** Restores every setting to its default (UI-test reset). */
export function resetAllSettings() {
  for (const key of Object.keys(defaults) as SettingKey[]) {
    (settings[key] as Signal<unknown>).value = defaults[key]
  }
}

export const settingDefaults: Readonly<SettingsValues> = defaults
