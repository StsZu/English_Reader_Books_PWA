// Backup and restore of everything the reader keeps on this device (specs/006-backup): one gzip file of
// JSON lines with all stores of the main database and the settings. Not in it: the OpenAI key, audiobooks, TTS cache.
import { appName, databaseName, settingsPrefix } from '../language.ts'
import { decodeWordCard } from '../ai/word.ts'
import { DB_NAME, STORES, db, storageErrorText, transact, type StoreName } from './db.ts'

export const BACKUP_FORMAT = 'reader-backup'
export const BACKUP_VERSION = 1
/** Unpacked size limit: the one restore transaction needs every record in memory (as the EPUB budget, R4). */
export const maxBackupSize = 200 * 1024 * 1024

/** Date of the last backup on this device (ISO); never part of a backup. */
export const lastBackupKey = `${settingsPrefix}lastBackup`

const KEY_RECORD = 'openaiKey'
const DEMO_FLAG = 'demoSeeded.v1'

export const backupErrors = {
  notBackup: `Це не файл копії ${appName}.`,
  newerVersion: 'Копію зроблено новішою версією застосунку. Оновіть застосунок.',
  damaged: 'Файл копії пошкоджений або неповний.',
  tooLarge: 'Копія завелика для відновлення на цьому пристрої.',
  otherApp: (name: string) => `Це копія ${name}. Відновіть її в ${name}.`,
}

export class BackupError extends Error {}

export interface BackupRecord {
  store: StoreName
  key: string
  value: unknown
}

export interface Backup {
  /** ISO 8601. */
  created: string
  records: BackupRecord[]
  /** localStorage values by key without the app prefix. */
  settings: Record<string, string>
  books: number
  words: number
  quotes: number
}

/** "English Reader — копія 2026-10-27.json.gz" (local date). */
export function backupFileName(date: Date): string {
  const day = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
  return `${appName} — копія ${day}.json.gz`
}

/** "english-reader" → "English Reader". */
const appTitle = (id: string): string => id.split('-').map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ')

function storedSettings(): Record<string, string> {
  const result: Record<string, string> = {}
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i)
      if (!key?.startsWith(settingsPrefix) || key === lastBackupKey) continue
      const value = localStorage.getItem(key)
      if (value !== null) result[key.slice(settingsPrefix.length)] = value
    }
  } catch {
    // Storage may be unavailable (private mode): the settings then live only in this session.
  }
  return result
}

async function collect(stream: ReadableStream<Uint8Array>): Promise<Uint8Array[]> {
  const chunks: Uint8Array[] = []
  const reader = stream.getReader()
  for (;;) {
    const { done, value } = await reader.read()
    if (done) return chunks
    chunks.push(value)
  }
}

/** Reads every store in one transaction (a consistent snapshot) and returns the gzip file. */
export async function createBackup(now = new Date()): Promise<Blob> {
  const tx = (await db()).transaction([...STORES], 'readonly')
  const records: BackupRecord[] = []
  for (const store of STORES) {
    const os = tx.objectStore(store)
    const [keys, values] = await Promise.all([os.getAllKeys(), os.getAll()])
    keys.forEach((key, i) => {
      if (store === 'meta' && key === KEY_RECORD) return
      records.push({ store, key: String(key), value: values[i] })
    })
  }
  await tx.done
  const lines = [
    JSON.stringify({ format: BACKUP_FORMAT, version: BACKUP_VERSION, app: databaseName, build: __APP_VERSION__, created: now.toISOString() }),
    ...records.map((r) => JSON.stringify(r)),
    JSON.stringify({ settings: storedSettings() }),
    JSON.stringify({ end: { books: records.filter((r) => r.store === 'books').length, records: records.length } }),
  ]
  const text = new Blob(lines.map((line) => line + '\n'))
  const chunks = await collect(text.stream().pipeThrough(new CompressionStream('gzip')))
  return new Blob(chunks as BlobPart[], { type: 'application/gzip' })
}

// MARK: - Reading

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const isString = (value: unknown): value is string => typeof value === 'string'

const isStringArray = (value: unknown): value is string[] => Array.isArray(value) && value.every(isString)

const isRef = (value: unknown): boolean =>
  isObject(value) && Number.isInteger(value.chapter) && Number.isInteger(value.paragraph)

const isPlace = (value: unknown): boolean => isObject(value) && isString(value.bookID) && isRef(value)

const isBook = (value: unknown): boolean =>
  isObject(value) && isString(value.id) && isString(value.title) && Array.isArray(value.chapters)
  && value.chapters.every((c) => isObject(c) && isString(c.title) && Array.isArray(c.paragraphs)
    && c.paragraphs.every((p) => isObject(p) && (p.kind === 'text' || p.kind === 'heading') && isStringArray(p.sentences)))

const isIndex = (value: unknown): boolean =>
  Array.isArray(value) && value.every((b) => isObject(b) && isString(b.id) && isString(b.title))

const isSaved = (value: unknown): boolean =>
  isObject(value)
  && Array.isArray(value.words) && value.words.every((w) => isObject(w) && isString(w.id) && isString(w.lemma)
    && (w.contexts === undefined || (Array.isArray(w.contexts) && w.contexts.every((c) => isObject(c) && isPlace(c.place)))))
  && Array.isArray(value.quotes) && value.quotes.every((q) => isObject(q) && isString(q.id) && isString(q.text) && isPlace(q.place))

/** The same shapes the app reads at start (library index, saved lists, ParagraphRef, word cards). */
const validators: Record<StoreName, (key: string, value: unknown) => boolean> = {
  meta: (key, value) =>
    key === 'library' ? isIndex(value) : key === 'saved' ? isSaved(value) : key === DEMO_FLAG ? typeof value === 'boolean' : false,
  books: (key, value) => isBook(value) && (value as { id: string }).id === key,
  positions: (_, value) => isRef(value),
  translations: (_, value) => isStringArray(value),
  fragments: (_, value) => isStringArray(value),
  wordCache: (_, value) => decodeWordCard(value) !== null,
  explanations: (_, value) => isString(value),
}

/** Unpacked bytes of the file: gzip, or plain JSON lines when the Files app has already unpacked it. */
async function* textLines(file: Blob, limit: number): AsyncGenerator<string> {
  const magic = new Uint8Array(await file.slice(0, 2).arrayBuffer())
  const gzip = magic[0] === 0x1f && magic[1] === 0x8b
  const stream = gzip ? file.stream().pipeThrough(new DecompressionStream('gzip')) : file.stream()
  const reader = stream.getReader()
  const decoder = new TextDecoder()
  let size = 0
  let rest = ''
  for (;;) {
    let chunk: ReadableStreamReadResult<Uint8Array>
    try {
      chunk = await reader.read()
    } catch {
      throw new BackupError(backupErrors.damaged)
    }
    if (chunk.done) break
    size += chunk.value.byteLength
    if (size > limit) {
      void reader.cancel().catch(() => {})
      throw new BackupError(backupErrors.tooLarge)
    }
    const lines = (rest + decoder.decode(chunk.value, { stream: true })).split('\n')
    rest = lines.pop() ?? ''
    yield* lines
  }
  rest += decoder.decode()
  if (rest) yield rest
}

/** Reads and checks the whole file; any unknown or malformed line rejects the backup before anything changes. */
export async function readBackup(file: Blob, limit = maxBackupSize): Promise<Backup> {
  const records: BackupRecord[] = []
  let header: Record<string, unknown> | null = null
  let settings: Record<string, string> | null = null
  let end: Record<string, unknown> | null = null
  for await (const line of textLines(file, limit)) {
    if (!line.trim()) continue
    let item: unknown
    try {
      item = JSON.parse(line)
    } catch {
      throw new BackupError(header ? backupErrors.damaged : backupErrors.notBackup)
    }
    if (!header) {
      if (!isObject(item) || item.format !== BACKUP_FORMAT) throw new BackupError(backupErrors.notBackup)
      if (item.app !== databaseName) throw new BackupError(backupErrors.otherApp(appTitle(String(item.app))))
      if (typeof item.version !== 'number' || item.version > BACKUP_VERSION) throw new BackupError(backupErrors.newerVersion)
      if (!isString(item.created)) throw new BackupError(backupErrors.damaged)
      header = item
      continue
    }
    if (end || !isObject(item)) throw new BackupError(backupErrors.damaged)
    if ('store' in item) {
      const store = item.store as StoreName
      if (!STORES.includes(store) || !isString(item.key) || !validators[store](item.key, item.value)) {
        throw new BackupError(backupErrors.damaged)
      }
      records.push({ store, key: item.key, value: item.value })
    } else if ('settings' in item && !settings) {
      if (!isObject(item.settings) || !Object.values(item.settings).every(isString)) throw new BackupError(backupErrors.damaged)
      settings = item.settings as Record<string, string>
    } else if ('end' in item && isObject(item.end)) {
      end = item.end
    } else {
      throw new BackupError(backupErrors.damaged)
    }
  }
  if (!header) throw new BackupError(backupErrors.notBackup)
  const bookIDs = new Set(records.filter((r) => r.store === 'books').map((r) => r.key))
  if (!end || !settings || end.records !== records.length || end.books !== bookIDs.size) {
    throw new BackupError(backupErrors.damaged)
  }
  const meta = (key: string) => records.find((r) => r.store === 'meta' && r.key === key)?.value
  const index = (meta('library') ?? []) as { id: string }[]
  if (!index.every((b) => bookIDs.has(b.id))) throw new BackupError(backupErrors.damaged)
  const saved = meta('saved') as { words: unknown[]; quotes: unknown[] } | undefined
  return {
    created: header.created as string,
    records,
    settings,
    books: index.length,
    words: saved?.words.length ?? 0,
    quotes: saved?.quotes.length ?? 0,
  }
}

/** Ids of the books in the backup (to count the audio that the restore leaves without a book). */
export const backupBookIDs = (backup: Backup): string[] =>
  backup.records.filter((r) => r.store === 'books').map((r) => r.key)

// MARK: - Restore

/**
 * Replaces all stores with the backup in one transaction: on failure the database keeps what it had.
 * The OpenAI key stays. Then the settings are replaced; the caller relaunches the page so every signal re-reads.
 */
export async function restoreBackup(backup: Backup): Promise<void> {
  try {
    await transact([...STORES], async (tx) => {
      const key = await tx.objectStore('meta').get(KEY_RECORD)
      await Promise.all(STORES.map((store) => tx.objectStore(store).clear()))
      // Not awaited one by one: a failed request aborts the transaction, and `transact` reports it from `tx.done`.
      for (const r of backup.records) tx.objectStore(r.store).put(r.value, r.key).catch(() => {})
      if (key !== undefined) await tx.objectStore('meta').put(key, KEY_RECORD)
      // The demo book was offered on the device the backup came from; it must not come back.
      await tx.objectStore('meta').put(true, DEMO_FLAG)
    })
  } catch (error) {
    throw new Error(`Не вдалося відновити: ${storageErrorText(error)}`)
  }
  try {
    const keys: string[] = []
    for (let i = 0; i < localStorage.length; i++) keys.push(localStorage.key(i) ?? '')
    for (const key of keys) if (key.startsWith(settingsPrefix) && key !== lastBackupKey) localStorage.removeItem(key)
    for (const [key, value] of Object.entries(backup.settings)) localStorage.setItem(settingsPrefix + key, value)
  } catch {
    // Without localStorage the settings keep their defaults.
  }
  if (typeof BroadcastChannel !== 'undefined') {
    const channel = new BroadcastChannel(`${DB_NAME}-library`)
    channel.postMessage('library')
    channel.close()
  }
}

export function lastBackupDate(): Date | null {
  try {
    const value = localStorage.getItem(lastBackupKey)
    const date = value ? new Date(value) : null
    return date && !Number.isNaN(date.getTime()) ? date : null
  } catch {
    return null
  }
}

export function setLastBackupDate(date: Date) {
  try {
    localStorage.setItem(lastBackupKey, date.toISOString())
  } catch {
    // Private mode: the date is not remembered.
  }
}
