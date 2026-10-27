// Port of EnglishReader/Views/SettingsView.swift («ШІ-сервіси»): OpenAI key, connection check, models,
// plus the storage state that the web version needs (V-03, FR-32).
import { useEffect, useState } from 'preact/hooks'
import { translationCheckSentence } from '../../core/language.ts'
import { deleteKey, hasStoredKey, saveKey } from '../../core/storage/key.ts'
import { isPersisted, requestPersistence } from '../../core/storage/db.ts'
import { settings, settingDefaults } from '../../core/storage/settings.ts'
import { OpenAITranslationProvider } from '../../core/ai/translation.ts'
import { errorMessage } from '../../contracts.ts'
import { Button, FormSheet, List, ProgressSpinner, Row, SecureField, Section, TextField } from '../components/index.ts'
import './settings.css'

export function AIServices({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [keyInput, setKeyInput] = useState('')
  const [checking, setChecking] = useState(false)
  const [checkResult, setCheckResult] = useState<string | null>(null)
  const [persisted, setPersisted] = useState<boolean | null>(null)

  useEffect(() => {
    if (!open) return
    setCheckResult(null)
    void isPersisted().then(setPersisted)
  }, [open])

  async function checkConnection() {
    setChecking(true)
    try {
      const result = await new OpenAITranslationProvider(settings.textModel.value)
        .translate([translationCheckSentence], null)
      setCheckResult(`Працює: «${result[0] ?? ''}»`)
    } catch (error) {
      setCheckResult(errorMessage(error))
    } finally {
      setChecking(false)
    }
  }

  async function save() {
    await saveKey(keyInput)
    setKeyInput('')
  }

  async function persist() {
    setPersisted(await requestPersistence())
  }

  const standalone = typeof matchMedia !== 'undefined'
    && (matchMedia('(display-mode: standalone)').matches || (navigator as { standalone?: boolean }).standalone === true)

  return (
    <FormSheet open={open} onClose={onClose} title="ШІ-сервіси" ariaLabel="ШІ-сервіси" doneTestID="settingsDone"
      testID="aiServices" width={620}>
      <List class="settings-list">
        <Section
          header="Штучний інтелект"
          footer="Переклад, картки слів і ШІ-озвучення використовують OpenAI. Ключ зберігається лише в цьому браузері на цьому пристрої, а запити йдуть напряму до OpenAI — без сторонніх серверів і скриптів. Не зберігайте ключ на чужих пристроях. Запити оплачуються з вашого облікового запису OpenAI."
        >
          {hasStoredKey.value ? (
            <>
              <Row title="Ключ OpenAI" value={<span data-testid="keyState">збережено на цьому пристрої</span>} />
              <Row title="Видалити ключ" destructive testID="deleteKey" onClick={() => void deleteKey()} />
            </>
          ) : (
            <>
              <div class="settings-field-row">
                <SecureField value={keyInput} onInput={setKeyInput} placeholder="sk-…" ariaLabel="Ключ OpenAI"
                  testID="apiKeyField" onEnter={() => { if (keyInput.trim()) void save() }} />
              </div>
              <Row title="Зберегти ключ" testID="saveKey" disabled={!keyInput.trim()} onClick={() => void save()} />
            </>
          )}
          <Row
            title="Перевірити переклад"
            testID="checkTranslation"
            disabled={checking}
            onClick={() => void checkConnection()}
            value={checking ? <ProgressSpinner size="small" label="Перевіряю" /> : undefined}
          />
          {checkResult && <div class="settings-note" data-testid="checkResult">{checkResult}</div>}
        </Section>

        <Section header="Моделі" footer="Типово: gpt-5.4-mini для перекладу й карток слів, gpt-4o-mini-tts для озвучення.">
          <div class="settings-field-row">
            <span class="settings-field-label">Модель тексту</span>
            <TextField value={settings.textModel.value} onInput={(v) => { settings.textModel.value = v }}
              placeholder={settingDefaults.textModel} ariaLabel="Модель тексту" testID="textModelField" />
          </div>
          <div class="settings-field-row">
            <span class="settings-field-label">Модель мовлення</span>
            <TextField value={settings.ttsModel.value} onInput={(v) => { settings.ttsModel.value = v }}
              placeholder={settingDefaults.ttsModel} ariaLabel="Модель мовлення" testID="ttsModelField" />
          </div>
        </Section>

        <Section
          header="Сховище"
          footer={standalone
            ? 'Книжки, переклади, аудіо й збережені слова зберігаються лише на цьому пристрої.'
            : 'Книжки, переклади, аудіо й збережені слова зберігаються лише на цьому пристрої. Щоб Safari не видаляв дані, додайте застосунок на початковий екран: «Поділитися» → «На початковий екран».'}
        >
          <Row
            title="Стан сховища"
            testID="storageState"
            value={persisted === null ? '…' : persisted ? 'Дані захищені від автоматичного видалення' : 'Може бути очищене браузером'}
          />
          {persisted === false && (
            <div class="settings-button-row">
              <Button variant="bordered" testID="persistStorage" onClick={() => void persist()}>Захистити дані</Button>
            </div>
          )}
        </Section>
      </List>
    </FormSheet>
  )
}
