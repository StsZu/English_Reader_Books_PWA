// Port of EnglishReader/Views/SettingsView.swift («ШІ-сервіси»): OpenAI key, connection check, models,
// plus the storage state that the web version needs (V-03, FR-32) and the backup (V-15, specs/006-backup).
import type { JSX } from 'preact'
import { useEffect, useRef, useState } from 'preact/hooks'
import { translationCheckSentence } from '../../core/language.ts'
import { deleteKey, hasStoredKey, saveKey } from '../../core/storage/key.ts'
import { isPersisted, requestPersistence } from '../../core/storage/db.ts'
import { settings, settingDefaults } from '../../core/storage/settings.ts'
import {
  backupBookIDs, backupFileName, createBackup, lastBackupDate, readBackup, restoreBackup, setLastBackupDate, type Backup,
} from '../../core/storage/backup.ts'
import { audioBookIDs } from '../../core/audiobook/store.ts'
import { OpenAITranslationProvider } from '../../core/ai/translation.ts'
import { errorMessage } from '../../contracts.ts'
import { formatBytes, formatDate } from '../../core/util/format.ts'
import { shareFile, type ExportFile } from '../saved/export.ts'
import { Button, ConfirmDialog, FormSheet, List, ProgressSpinner, Row, SecureField, Section, TextField } from '../components/index.ts'
import './settings.css'

/** Reopens the app on the restored data; `?reset` (test mode) would wipe it again. */
function relaunch() {
  const url = new URL(location.href)
  url.searchParams.delete('reset')
  location.replace(url.href)
}

export function AIServices({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [keyInput, setKeyInput] = useState('')
  const [checking, setChecking] = useState(false)
  const [checkResult, setCheckResult] = useState<string | null>(null)
  const [persisted, setPersisted] = useState<boolean | null>(null)
  const [backupBusy, setBackupBusy] = useState<'save' | 'restore' | null>(null)
  const [lastBackup, setLastBackup] = useState(lastBackupDate)
  const [prepared, setPrepared] = useState<ExportFile<Blob> | null>(null)
  const [pending, setPending] = useState<{ backup: Backup; orphanAudio: number } | null>(null)
  const [backupAlert, setBackupAlert] = useState<{ title: string; message: string } | null>(null)
  const restoreInput = useRef<HTMLInputElement>(null)

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

  /** The file is prepared first and shared from a second tap: Safari shares only right after a user action. */
  async function prepareBackup() {
    setBackupBusy('save')
    try {
      const now = new Date()
      setPrepared({ name: backupFileName(now), type: 'application/gzip', contents: await createBackup(now) })
    } catch (error) {
      setBackupAlert({ title: 'Не вдалося зберегти копію', message: errorMessage(error) })
    } finally {
      setBackupBusy(null)
    }
  }

  async function saveBackup(file: ExportFile<Blob>) {
    if (await shareFile(file) === 'cancelled') return
    const date = new Date()
    setLastBackupDate(date)
    setLastBackup(date)
  }

  async function chooseBackup(event: JSX.TargetedEvent<HTMLInputElement>) {
    const input = event.currentTarget
    const file = input.files?.[0]
    input.value = ''
    if (!file) return
    setBackupBusy('restore')
    try {
      const backup = await readBackup(file)
      const kept = new Set(backupBookIDs(backup))
      const orphanAudio = (await audioBookIDs().catch(() => [])).filter((id) => !kept.has(id)).length
      setPending({ backup, orphanAudio })
    } catch (error) {
      setBackupAlert({ title: 'Відновлення з копії', message: errorMessage(error) })
    } finally {
      setBackupBusy(null)
    }
  }

  async function restore(backup: Backup) {
    setBackupBusy('restore')
    try {
      await restoreBackup(backup)
      relaunch()
    } catch (error) {
      setBackupAlert({ title: 'Відновлення з копії', message: errorMessage(error) })
      setBackupBusy(null)
    }
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
          <Row
            title="Зберегти копію"
            subtitle={lastBackup ? <span data-testid="lastBackup">Остання копія: {formatDate(lastBackup)}</span> : undefined}
            testID="saveBackup"
            disabled={backupBusy !== null}
            onClick={() => void prepareBackup()}
            value={backupBusy === 'save' ? <ProgressSpinner size="small" label="Готую копію" /> : undefined}
          />
          <Row
            title="Відновити з копії"
            testID="restoreBackup"
            disabled={backupBusy !== null}
            onClick={() => restoreInput.current?.click()}
            value={backupBusy === 'restore' ? <ProgressSpinner size="small" label="Перевіряю копію" /> : undefined}
          />
          <input ref={restoreInput} type="file" accept=".gz,.json" class="library-input" data-testid="restoreInput"
            onChange={(e) => void chooseBackup(e)} />
        </Section>
      </List>
      <ConfirmDialog
        open={prepared !== null}
        title="Копію підготовлено"
        message={prepared && `«${prepared.name}», ${formatBytes(prepared.contents.size)}. Ключа OpenAI й аудіокниг у копії немає.`}
        actions={[
          { label: 'Зберегти', role: 'default', testID: 'backupShare', onSelect: () => { if (prepared) void saveBackup(prepared) } },
          { label: 'Скасувати', role: 'cancel' },
        ]}
        onClose={() => setPrepared(null)}
        testID="backupPrepared"
      />
      <ConfirmDialog
        open={pending !== null}
        title="Відновити з копії?"
        message={pending && [
          `Копія від ${formatDate(new Date(pending.backup.created))}: книжок ${pending.backup.books}, слів ${pending.backup.words}, цитат ${pending.backup.quotes}.`,
          'Книжки, слова, цитати й налаштування на цьому пристрої буде замінено даними копії. Ключ OpenAI і аудіокниги не змінюються.',
          pending.orphanAudio > 0 ? `Аудіо книжок, яких немає в копії, буде видалено: ${pending.orphanAudio}.` : '',
        ].filter(Boolean).join(' ')}
        actions={[
          { label: 'Замінити', role: 'destructive', testID: 'restoreConfirm', onSelect: () => { if (pending) void restore(pending.backup) } },
          { label: 'Скасувати', role: 'cancel', testID: 'restoreCancel' },
        ]}
        onClose={() => setPending(null)}
        testID="restoreSummary"
      />
      <ConfirmDialog
        open={backupAlert !== null}
        title={backupAlert?.title ?? ''}
        message={backupAlert?.message ?? ''}
        actions={[{ label: 'Гаразд', role: 'cancel', testID: 'backupAlertOK' }]}
        onClose={() => setBackupAlert(null)}
        testID="backupAlert"
      />
    </FormSheet>
  )
}
