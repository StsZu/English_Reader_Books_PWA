// Settings-tab content of the reader panel: theme tiles and the four sections (ReaderPanel.swift, D3–D6).
import type { ComponentChildren } from 'preact'
import { useEffect, useState } from 'preact/hooks'
import {
  defaultExplanationTemplate, enabledDictionaries, isExpanded, openAIVoices, ranges, settings, toggleSection,
  allDictionaries, type ReaderPanelSection,
} from '../../../core/storage/settings.ts'
import { formatNumber, linesLabel } from '../../../core/util/format.ts'
import { playSample, stopSample } from '../../../core/speech/engines.ts'
import { unlockAudio } from '../../../core/speech/audio.ts'
import { Disclosure, Segmented, Stepper, TextArea, Toggle } from '../../components/index.ts'
import { Icon, type IconName } from '../../icons.tsx'
import { readerThemes } from '../../theme/themes.ts'
import { bookFonts, fontInfo } from '../../theme/fonts.ts'
import type { VoiceEngineKind } from '../../../contracts.ts'

/** Same as ReaderPanel.number: fixed fraction digits with a decimal comma. */
const number = (value: number, digits: number) => formatNumber(value, digits, digits)

export function ThemeTiles() {
  const current = settings.theme.value
  return (
    <div class="rp-themes">
      {readerThemes.map((theme) => {
        const selected = current === theme.name
        return (
          <button
            key={theme.name}
            type="button"
            class={selected ? 'rp-theme is-selected' : 'rp-theme'}
            onClick={() => { settings.theme.value = theme.name }}
            aria-pressed={selected}
            aria-label={theme.label}
            data-testid={`theme-${theme.name}`}
          >
            <span class="rp-theme-sample" style={{ background: theme.background, color: theme.text }}>Аа</span>
            <span class="rp-theme-label">{theme.label}</span>
          </button>
        )
      })}
    </div>
  )
}

function Section({ id, title, icon, children }: { id: ReaderPanelSection; title: string; icon: IconName; children: ComponentChildren }) {
  return (
    <Disclosure title={title} icon={icon} expanded={isExpanded(id)} onToggle={() => toggleSection(id)} testID={`panelSection-${id}`}>
      {children}
    </Disclosure>
  )
}

function BookText() {
  const [showFonts, setShowFonts] = useState(false)
  const font = fontInfo(settings.bookFont.value)
  return (
    <>
      <button
        type="button"
        class="rp-font-row"
        onClick={() => setShowFonts(!showFonts)}
        aria-expanded={showFonts}
        data-testid="panel-font"
        data-value={font.label}
      >
        <span class="rp-font-title">Шрифт</span>
        <span class="rp-font-value">{font.label}</span>
        <Icon name={showFonts ? 'chevron.up' : 'chevron.down'} size={13} strokeWidth={2.6} class="rp-font-chevron" />
      </button>
      {showFonts && (
        <div class="rp-fonts" role="listbox" aria-label="Шрифт">
          {bookFonts.map((item) => (
            <button
              key={item.name}
              type="button"
              role="option"
              aria-selected={item.name === font.name}
              class="rp-font-option"
              onClick={() => { settings.bookFont.value = item.name }}
              data-testid={`font-${item.name}`}
            >
              <span style={{ fontFamily: item.cssFamily }}>{item.label}</span>
              {item.name === font.name && <Icon name="checkmark" size={18} strokeWidth={2.6} class="rp-check" />}
            </button>
          ))}
        </div>
      )}
      <div class="rp-divider" />
      <Stepper title="Розмір шрифту" display={number(settings.fontSize.value, 0)} id="fontSize"
        value={settings.fontSize.value} min={ranges.fontSize[0]} max={ranges.fontSize[1]} step={ranges.fontSize[2]}
        onChange={(v) => { settings.fontSize.value = v }} />
      <Stepper title="Міжрядковий інтервал" display={number(settings.lineSpacingFactor.value, 2)} id="lineSpacing"
        value={settings.lineSpacingFactor.value} min={ranges.lineSpacingFactor[0]} max={ranges.lineSpacingFactor[1]}
        step={ranges.lineSpacingFactor[2]} onChange={(v) => { settings.lineSpacingFactor.value = v }} />
      <Stepper title="Відступи від країв" display={number(settings.sideMargin.value, 0)} id="sideMargin"
        value={settings.sideMargin.value} min={ranges.sideMargin[0]} max={ranges.sideMargin[1]} step={ranges.sideMargin[2]}
        onChange={(v) => { settings.sideMargin.value = v }} />
      <Stepper title="Відступ першого рядка абзацу" display={number(settings.firstLineIndent.value, 2)} id="firstLineIndent"
        value={settings.firstLineIndent.value} min={ranges.firstLineIndent[0]} max={ranges.firstLineIndent[1]}
        step={ranges.firstLineIndent[2]} onChange={(v) => { settings.firstLineIndent.value = v }} />
      <Stepper title="Відстань між абзацами" display={number(settings.paragraphSpacingFactor.value, 1)} id="paragraphSpacing"
        value={settings.paragraphSpacingFactor.value} min={ranges.paragraphSpacingFactor[0]} max={ranges.paragraphSpacingFactor[1]}
        step={ranges.paragraphSpacingFactor[2]} onChange={(v) => { settings.paragraphSpacingFactor.value = v }} />
      <Toggle label="Вирівнювання за шириною" checked={settings.justifyText.value}
        onChange={(v) => { settings.justifyText.value = v }} testID="panel-justify" />
    </>
  )
}

function ParallelTranslation() {
  const autoHide = settings.parallelTranslationAutoHide.value
  return (
    <>
      <Toggle label="Увімкнути паралельний переклад" checked={settings.showTranslation.value}
        onChange={(v) => { settings.showTranslation.value = v }} testID="parallelTranslationEnabled" />
      <Stepper title="Розмір перекладу" display={`${number(settings.parallelTranslationScale.value, 1)}×`} id="parallelTranslationScale"
        value={settings.parallelTranslationScale.value} min={ranges.parallelTranslationScale[0]}
        max={ranges.parallelTranslationScale[1]} step={ranges.parallelTranslationScale[2]}
        onChange={(v) => { settings.parallelTranslationScale.value = v }} />
      <Toggle label="Багаторядковий переклад" checked={settings.parallelTranslationMultiline.value}
        onChange={(v) => { settings.parallelTranslationMultiline.value = v }} testID="parallelTranslationMultiline" />
      <Toggle label="Автоприховування перекладу" checked={autoHide}
        onChange={(v) => { settings.parallelTranslationAutoHide.value = v }} testID="parallelTranslationAutoHide" />
      <Stepper title="Приховувати після прокручування" display={linesLabel(settings.parallelTranslationAutoHideLines.value)}
        id="parallelTranslationAutoHideLines" disabled={!autoHide}
        value={settings.parallelTranslationAutoHideLines.value} min={ranges.parallelTranslationAutoHideLines[0]}
        max={ranges.parallelTranslationAutoHideLines[1]} step={ranges.parallelTranslationAutoHideLines[2]}
        onChange={(v) => { settings.parallelTranslationAutoHideLines.value = v }} />
      <p class="rp-footnote">
        Торкніться речення — переклад у панелі над текстом; наступний дотик до слова відкриває картку; утримуйте
        перекладене речення, щоб прослухати. Автоприховування очищає переклад після ручного прокручування на задану
        кількість рядків.
      </p>
    </>
  )
}

function DictionaryTranslation({ onManage }: { onManage: () => void }) {
  const template = settings.explanationTemplate.value
  return (
    <>
      <Toggle label="Рівень складності слова" checked={settings.showWordLevel.value}
        onChange={(v) => { settings.showWordLevel.value = v }} testID="showWordLevel" />
      <Toggle label="Форми слова" checked={settings.showWordForms.value}
        onChange={(v) => { settings.showWordForms.value = v }} testID="showWordForms" />
      <Stepper title="Розмір картки" display={`${number(settings.wordCardScale.value, 1)}×`} id="wordCardScale"
        value={settings.wordCardScale.value} min={ranges.wordCardScale[0]} max={ranges.wordCardScale[1]}
        step={ranges.wordCardScale[2]} onChange={(v) => { settings.wordCardScale.value = v }} />
      <button type="button" class="rp-link-row" onClick={onManage} data-testid="manageDictionaries">
        <span class="rp-font-title">Керування словниками</span>
        <span class="rp-font-value">{enabledDictionaries().length} з {allDictionaries.length}</span>
        <Icon name="chevron.right" size={13} strokeWidth={2.6} class="rp-font-chevron" />
      </button>
      <Toggle label="Підсвічувати збережені слова" checked={settings.highlightSavedWords.value}
        onChange={(v) => { settings.highlightSavedWords.value = v }} testID="highlightSavedWords" />
      <div class="rp-template">
        <span class="rp-template-title">Запит «Пояснити детальніше»</span>
        <TextArea value={template} onInput={(v) => { settings.explanationTemplate.value = v }}
          placeholder="Шаблон" ariaLabel="Шаблон" testID="explanationTemplate" rows={6} />
        <div class="rp-template-footer">
          <span class="rp-footnote">{'{слово} і {контекст} замінюються словом і реченням.'}</span>
          <button type="button" class="rp-text-button" disabled={template === defaultExplanationTemplate}
            onClick={() => { settings.explanationTemplate.value = defaultExplanationTemplate }}
            data-testid="resetExplanationTemplate">
            Відновити типовий
          </button>
        </div>
      </div>
      <p class="rp-footnote">
        Рівень і форми приходять з тим самим запитом картки слова. «Пояснити детальніше» — окремий платний запит до
        OpenAI на кожне нове пояснення; збережене пояснення повторно не оплачується.
      </p>
    </>
  )
}

function Pronunciation() {
  const [previewError, setPreviewError] = useState<string | null>(null)
  useEffect(() => () => stopSample(), [])
  const engine = settings.voiceEngine.value
  async function preview() {
    unlockAudio()
    setPreviewError(null)
    setPreviewError(await playSample())
  }
  return (
    <>
      <div class="rp-segment">
        <Segmented<VoiceEngineKind>
          ariaLabel="Голос"
          testID="panel-voiceEngine"
          value={engine}
          onChange={(v) => { settings.voiceEngine.value = v }}
          items={[{ value: 'openAI', label: 'ШІ-голос' }, { value: 'system', label: 'Системний' }]}
        />
      </div>
      {engine === 'openAI' && (
        <label class="rp-picker-row">
          <span class="rp-font-title">Голос OpenAI</span>
          <span class="rp-picker">
            <select value={settings.openAIVoice.value} aria-label="Голос OpenAI" data-testid="panel-openAIVoice"
              onChange={(e) => { settings.openAIVoice.value = e.currentTarget.value }}>
              {openAIVoices.map((voice) => (
                <option key={voice} value={voice}>{voice.charAt(0).toUpperCase() + voice.slice(1)}</option>
              ))}
            </select>
            <Icon name="chevron.down" size={13} strokeWidth={2.6} />
          </span>
        </label>
      )}
      <Stepper title="Швидкість" display={`${number(settings.speechRate.value, 2)}×`} id="speechRate"
        value={settings.speechRate.value} min={ranges.speechRate[0]} max={ranges.speechRate[1]} step={ranges.speechRate[2]}
        onChange={(v) => { settings.speechRate.value = v }} />
      <button type="button" class="rp-text-button rp-sample" onClick={() => void preview()} data-testid="previewVoice">
        Прослухати зразок
      </button>
      {previewError && <p class="rp-error" data-testid="previewError">{previewError}</p>}
      <p class="rp-footnote">Ці параметри діють для вимови слів і речень, а також для читання книги вголос.</p>
    </>
  )
}

export function SettingsTab({ onManageDictionaries }: { onManageDictionaries: () => void }) {
  return (
    <div class="rp-scroll rp-settings">
      <ThemeTiles />
      <Section id="text" title="Текст книги" icon="textformat.size"><BookText /></Section>
      <Section id="parallel" title="Паралельний переклад" icon="character.bubble"><ParallelTranslation /></Section>
      <Section id="dictionary" title="Словниковий переклад" icon="books.vertical">
        <DictionaryTranslation onManage={onManageDictionaries} />
      </Section>
      <Section id="pronunciation" title="Вимова слів" icon="speaker.wave.2"><Pronunciation /></Section>
    </div>
  )
}
