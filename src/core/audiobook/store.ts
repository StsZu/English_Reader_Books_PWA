// Audio files of a book (an audiobook the reader adds from «Файли»), kept on the device only.
// A separate IndexedDB database, so the book database schema (db.ts) stays as it is.
import { openDB, type IDBPDatabase } from 'idb'
import { DB_NAME } from '../storage/db.ts'
import type { StoredSync } from '../prepared/package.ts'

export interface AudioTrack {
  id: string
  name: string
  size: number
  type: string
  /** Seconds; null until the file was opened once. */
  duration: number | null
}

export interface AudioPosition {
  track: number
  time: number
  /** Listening speed of the book; absent in places saved before it was remembered. */
  rate?: number
}

const AUDIO_DB = `${DB_NAME}-audio`
const STORES = ['tracks', 'files', 'positions'] as const
/**
 * Time of the sentences of a prepared book (specs/013-prepared-book, M5 as changed in S9): a database of its own,
 * so the audio database stays at version 1 and an older version of the app still opens it after a rollback.
 */
const SYNC_DB = `${DB_NAME}-sync`
/** Store that the 013 prototype added to the audio database (version 2); read once, never changed by migration. */
const LEGACY_SYNC = 'sync'
const LEGACY_MIGRATED = 'legacySyncCopied'

let dbPromise: Promise<IDBPDatabase> | null = null
let syncPromise: Promise<IDBPDatabase> | null = null

/**
 * Opened without a version: a new database is created at version 1 (as before 013), an existing one opens as it is —
 * also version 2 left by the 013 prototype, which is neither rejected nor downgraded.
 */
function db(): Promise<IDBPDatabase> {
  dbPromise ??= openDB(AUDIO_DB, undefined, {
    upgrade(database) {
      for (const name of STORES) {
        if (!database.objectStoreNames.contains(name)) database.createObjectStore(name)
      }
    },
  }).catch((error: unknown) => {
    // A failed open is not remembered: the next call tries again (S9).
    dbPromise = null
    throw error
  })
  return dbPromise
}

function syncDB(): Promise<IDBPDatabase> {
  syncPromise ??= openDB(SYNC_DB, 1, {
    upgrade(database) {
      database.createObjectStore('sync')
      database.createObjectStore('meta')
    },
  }).then(async (database) => {
    try {
      await copyLegacySync(database)
    } catch (error) {
      database.close()
      throw error
    }
    return database
  }).catch((error: unknown) => {
    // A failed open or copy is not remembered: the next call tries again; the copy skips what it already wrote (S9).
    syncPromise = null
    throw error
  })
  return syncPromise
}

/** Copies the time of the sentences from the audio database of the 013 prototype, once; the old store stays as it was. */
async function copyLegacySync(target: IDBPDatabase) {
  if (await target.get('meta', LEGACY_MIGRATED)) return
  const audio = await db()
  if (audio.objectStoreNames.contains(LEGACY_SYNC)) {
    const keys = await audio.getAllKeys(LEGACY_SYNC)
    for (const key of keys) {
      if (await target.get('sync', key) === undefined) await target.put('sync', await audio.get(LEGACY_SYNC, key), key)
    }
  }
  await target.put('meta', true, LEGACY_MIGRATED)
}

/** Test hook: forget the open connections (simulates a relaunch). */
export async function closeAudioDB() {
  if (dbPromise) (await dbPromise).close()
  if (syncPromise) await syncPromise.then((database) => database.close(), () => {})
  dbPromise = null
  syncPromise = null
}

export const AUDIO_EXTENSIONS = ['mp3', 'm4a', 'm4b', 'aac', 'wav', 'ogg', 'oga', 'opus', 'flac']
export const AUDIO_ACCEPT = `${AUDIO_EXTENSIONS.map((e) => `.${e}`).join(',')},audio/*`

export function isAudioFile(file: { name: string; type: string }): boolean {
  const extension = file.name.split('.').pop()?.toLowerCase() ?? ''
  return file.type.startsWith('audio/') || AUDIO_EXTENSIONS.includes(extension)
}

const collator = new Intl.Collator('uk', { numeric: true, sensitivity: 'base' })

/** «01.mp3, 2.mp3, 10.mp3»: numbers in file names compare by value. */
export const compareNames = (a: string, b: string) => collator.compare(a, b)

export async function listTracks(bookID: string): Promise<AudioTrack[]> {
  return ((await (await db()).get('tracks', bookID)) as AudioTrack[] | undefined) ?? []
}

/** Books that have audio on this device. */
export async function audioBookIDs(): Promise<string[]> {
  return (await (await db()).getAllKeys('tracks')).map(String)
}

export async function setTracks(bookID: string, tracks: AudioTrack[]): Promise<void> {
  await (await db()).put('tracks', tracks, bookID)
}

/** Adds the audio files after the existing tracks (`current`, or the stored list), ordered by name; other files are skipped. */
export async function addTracks(bookID: string, files: File[], current?: AudioTrack[]): Promise<AudioTrack[]> {
  const audio = files.filter(isAudioFile).sort((a, b) => compareNames(a.name, b.name))
  const database = await db()
  const added: AudioTrack[] = []
  try {
    for (const file of audio) {
      const track: AudioTrack = { id: crypto.randomUUID(), name: file.name, size: file.size, type: file.type, duration: null }
      await putFile(database, track.id, file)
      added.push(track)
    }
    const tracks = [...(current ?? await listTracks(bookID)), ...added]
    await setTracks(bookID, tracks)
    return tracks
  } catch (error) {
    // Files written before the failure belong to no track: remove them so they take no space (R6).
    for (const track of added) await database.delete('files', track.id).catch(() => {})
    throw error
  }
}

/** Stores the files as the book's only tracks, in the given order (a prepared book). */
export async function putTracksInOrder(bookID: string, files: File[]): Promise<AudioTrack[]> {
  const database = await db()
  const added: AudioTrack[] = []
  try {
    for (const file of files) {
      const track: AudioTrack = { id: crypto.randomUUID(), name: file.name, size: file.size, type: file.type, duration: null }
      await putFile(database, track.id, file)
      added.push(track)
    }
    await setTracks(bookID, added)
    return added
  } catch (error) {
    for (const track of added) await database.delete('files', track.id).catch(() => {})
    throw error
  }
}

/** Journal of prepared-book imports in progress (specs/015-reader-book-container, R021): in the meta store of the
 * sentence-time database, so no database gets a new version. Key `import:<book id>`. */
export interface ImportJournal { bookId: string; phase: string; startedAt: string }
const JOURNAL = 'import:'

export async function journalPut(entry: ImportJournal): Promise<void> {
  await (await syncDB()).put('meta', entry, JOURNAL + entry.bookId)
}

export async function journalDelete(bookId: string): Promise<void> {
  await (await syncDB()).delete('meta', JOURNAL + bookId)
}

export async function journalEntries(): Promise<ImportJournal[]> {
  const database = await syncDB()
  const out: ImportJournal[] = []
  for (const key of await database.getAllKeys('meta')) {
    if (typeof key === 'string' && key.startsWith(JOURNAL)) out.push(await database.get('meta', key) as ImportJournal)
  }
  return out
}

export async function loadSync(bookID: string): Promise<StoredSync | null> {
  return ((await (await syncDB()).get('sync', bookID)) as StoredSync | undefined) ?? null
}

export async function saveSync(bookID: string, sync: StoredSync): Promise<void> {
  await (await syncDB()).put('sync', sync, bookID)
}

interface StoredBytes {
  audioBytes: ArrayBuffer
  type: string
}

/**
 * Largest track kept as bytes when the browser cannot store a Blob (specs/015-reader-book-container, FR-05): the bytes
 * pass through memory whole, so a bigger track is refused instead. The stored form stays the one older versions read.
 * The value is an assumption until it is measured on an iPad (SC-02).
 */
export const MAX_FALLBACK_BYTES = 64 * 1024 * 1024

/** The track could not be stored; the message is for the user. */
export class AudioStoreError extends Error {}

/** Blob first; Safari in private mode cannot store a Blob in IndexedDB, then the bytes are stored, if small enough. */
export async function putFile(database: Pick<IDBPDatabase, 'put'>, id: string, file: File) {
  try {
    await database.put('files', file, id)
  } catch (error) {
    if ((error as { name?: string })?.name === 'QuotaExceededError') throw error
    if (file.size > MAX_FALLBACK_BYTES) {
      throw new AudioStoreError(`Цей браузер не зберігає аудіо як файл (можливо, приватний перегляд), а доріжка ${file.name} `
        + `завелика для збереження через пам'ять (${Math.round(file.size / 1048576)} МБ, межа ${MAX_FALLBACK_BYTES / 1048576} МБ).`)
    }
    await database.put('files', { audioBytes: await file.arrayBuffer(), type: file.type } satisfies StoredBytes, id)
  }
}

export async function trackFile(id: string): Promise<Blob | null> {
  const value = (await (await db()).get('files', id)) as Blob | StoredBytes | undefined
  if (!value) return null
  return 'audioBytes' in value ? new Blob([value.audioBytes], { type: value.type }) : value
}

export async function deleteTrackFile(id: string): Promise<void> {
  await (await db()).delete('files', id)
}

/** Deletes every audio file of the book, its listening place and the time of its sentences. */
export async function deleteAudio(bookID: string): Promise<void> {
  const database = await db()
  for (const track of await listTracks(bookID)) await database.delete('files', track.id)
  await database.delete('tracks', bookID)
  await database.delete('positions', bookID)
  await (await syncDB()).delete('sync', bookID)
  // The book is gone: its entry in the store of the 013 prototype must not come back with a later copy.
  if (database.objectStoreNames.contains(LEGACY_SYNC)) await database.delete(LEGACY_SYNC, bookID)
}

/**
 * Removes audio that a failed write left behind (R6): the audio of books that are no longer in the library
 * and files that no track refers to. Called once at start, before anything adds audio.
 */
export async function removeOrphanAudio(bookIDs: string[]): Promise<void> {
  const database = await db()
  const books = new Set(bookIDs)
  const referenced = new Set<string>()
  for (const key of await database.getAllKeys('tracks')) {
    const bookID = String(key)
    if (books.has(bookID)) for (const track of await listTracks(bookID)) referenced.add(track.id)
    else await deleteAudio(bookID)
  }
  for (const key of await database.getAllKeys('positions')) {
    if (!books.has(String(key))) await database.delete('positions', key)
  }
  const sync = await syncDB()
  for (const key of await sync.getAllKeys('sync')) {
    if (!books.has(String(key))) await sync.delete('sync', key)
  }
  for (const key of await database.getAllKeys('files')) {
    if (!referenced.has(String(key))) await database.delete('files', key)
  }
}

export async function loadAudioPosition(bookID: string): Promise<AudioPosition | null> {
  return ((await (await db()).get('positions', bookID)) as AudioPosition | undefined) ?? null
}

export async function saveAudioPosition(bookID: string, position: AudioPosition): Promise<void> {
  await (await db()).put('positions', position, bookID)
}

export async function clearAllAudio(): Promise<void> {
  const database = await db()
  for (const name of STORES) await database.clear(name)
  if (database.objectStoreNames.contains(LEGACY_SYNC)) await database.clear(LEGACY_SYNC)
  await (await syncDB()).clear('sync')
}

export const totalSize = (tracks: AudioTrack[]) => tracks.reduce((sum, t) => sum + t.size, 0)
