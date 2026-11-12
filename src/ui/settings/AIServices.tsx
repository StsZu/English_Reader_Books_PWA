// Port of EnglishReader/Views/SettingsView.swift («ШІ-сервіси»): OpenAI key, connection check, models,
// plus the storage state that the web version needs (V-03, FR-32), the backup (V-15, specs/006-backup)
// and the app version (V-16, specs/007-version).
import type { JSX } from 'preact'
import { useEffect, useRef, useState } from 'preact/hooks'
import { translationCheckSentence } from '../../core/language.ts'
import { deleteKey, hasStoredKey, saveKey } from '../../core/storage/key.ts'
import { isPersisted, requestPersistence } from '../../core/storage/db.ts'
import { settings, settingDefaults } from '../../core/storage/settings.ts'
import {
  backupFileName, createBackup, lastBackupDate, readBackup, restoreBackup, restorePreview, setLastBackupDate, type Backup,
  type RestorePreview,
} from '../../core/storage/backup.ts'
import { audioBookIDs, syncBookIDs } from '../../core/audiobook/store.ts'
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

interface PendingRestore {
  backup: Backup
  preview: RestorePreview
  /** The current data were saved from this dialog. */
  savedFirst: boolean
}

/** Stage 1 of specs/006-backup: the device and the backup side by side, and what the copy does not keep. */
function RestoreMessage({ backup, preview, savedFirst }: PendingRestore) {
  const { device } = preview
  const lines = [
    `На цьому пристрої: книжок ${device.books}, слів ${device.words}, цитат ${device.quotes}.`,
    `Копія від ${formatDate(new Date(backup.created))}: книжок ${backup.books}, слів ${backup.words}, цитат ${backup.quotes}.`,
    preview.deviceHasMore ? 'На цьому пристрої більше книжок, слів або цитат, ніж у копії.' : '',
    'Книжки, слова, цитати й налаштування на цьому пристрої буде замінено даними копії; те, чого немає в копії, буде втрачено. Ключ OpenAI не змінюється.',
    preview.audioRemoved > 0 ? `Аудіо книжок, яких немає в копії, буде видалено: ${preview.audioRemoved}.` : '',
    preview.timeRemoved > 0 ? `Час речень підготовлених книжок, яких немає в копії, буде видалено: ${preview.timeRemoved}.` : '',
    preview.timeKept > 0 ? `Аудіо й час речень підготовлених книжок, що є в копії, лишаються лише на цьому пристрої: ${preview.timeKept}.` : '',
    'Аудіо й час речень підготовлених книжок у копію не входять: на іншому пристрої такі книжки відновляться лише текстом з перекладом.',
    savedFirst ? 'Копію поточних даних збережено.' : '',
  ].filter(Boolean)
  return <>{lines.map((line, i) => <p key={i} class="dialog-paragraph" data-testid={i === 0 ? 'restoreDevice' : undefined}>{line}</p>)}</>
}

export function AIServices({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [keyInput, setKeyInput] = useState('')
  const [checking, setChecking] = useState(false)
  const [checkResult, setCheckResult] = useState<string | null>(null)
  const [persisted, setPersisted] = useState<boolean | null>(null)
  const [backupBusy, setBackupBusy] = useState<'save' | 'restore' | null>(null)
  const [lastBackup, setLastBackup] = useState(lastBackupDate)
  const [prepared, setPrepared] = useState<ExportFile<Blob> | null>(null)
  const [pending, setPending] = useState<PendingRestore | null>(null)
  /** The restore waiting while the current data are saved first; its dialog comes back after that. */
  const [held, setHeld] = useState<PendingRestore | null>(null)
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
      setHeld(null)
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
    setPending((p) => p && { ...p, savedFirst: true })
  }

  function saveFirst(restore: PendingRestore) {
    setHeld(restore)
    void prepareBackup()
  }

  async function chooseBackup(event: JSX.TargetedEvent<HTMLInputElement>) {
    const input = event.currentTarget
    const file = input.files?.[0]
    input.value = ''
    if (!file) return
    setBackupBusy('restore')
    try {
      const backup = await readBackup(file)
      const preview = await restorePreview(backup, await audioBookIDs().catch(() => []), await syncBookIDs().catch(() => []))
      setPending({ backup, preview, savedFirst: false })
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

        <Section header="Про застосунок">
          <Row title="Версія" value={<span data-testid="appVersion">{__APP_VERSION__}</span>} />
        </Section>
      </List>
      <ConfirmDialog
        open={prepared !== null}
        title="Копію підготовлено"
        message={prepared && `«${prepared.name}», ${formatBytes(prepared.contents.size)}. Ключа OpenAI, аудіо й часу речень підготовлених книжок у копії немає.`}
        actions={[
          { label: 'Зберегти', role: 'default', testID: 'backupShare', onSelect: () => { if (prepared) void saveBackup(prepared) } },
          { label: 'Скасувати', role: 'cancel' },
        ]}
        onClose={() => {
          setPrepared(null)
          if (held) {
            setPending(held)
            setHeld(null)
          }
        }}
        testID="backupPrepared"
      />
      <ConfirmDialog
        open={pending !== null}
        title="Відновити з копії?"
        message={pending && <RestoreMessage {...pending} />}
        actions={[
          ...(pending && !pending.savedFirst
            ? [{ label: 'Спершу зберегти поточні дані', role: 'default' as const, testID: 'restoreSaveFirst', onSelect: () => saveFirst(pending) }]
            : []),
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
