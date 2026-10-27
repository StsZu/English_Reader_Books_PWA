// Audio files of a book (an audiobook the reader adds from «Файли»), kept on the device only.
// A separate IndexedDB database, so the book database schema (db.ts) stays as it is.
import { openDB, type IDBPDatabase } from 'idb'
import { DB_NAME } from '../storage/db.ts'

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

let dbPromise: Promise<IDBPDatabase> | null = null

function db(): Promise<IDBPDatabase> {
  dbPromise ??= openDB(AUDIO_DB, 1, {
    upgrade(database) {
      for (const name of STORES) {
        if (!database.objectStoreNames.contains(name)) database.createObjectStore(name)
      }
    },
  })
  return dbPromise
}

/** Test hook: forget the open connection (simulates a relaunch). */
export async function closeAudioDB() {
  if (dbPromise) (await dbPromise).close()
  dbPromise = null
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

interface StoredBytes {
  audioBytes: ArrayBuffer
  type: string
}

/** Blob first; Safari in private mode cannot store a Blob in IndexedDB, then the bytes are stored. */
async function putFile(database: IDBPDatabase, id: string, file: File) {
  try {
    await database.put('files', file, id)
  } catch (error) {
    if ((error as { name?: string })?.name === 'QuotaExceededError') throw error
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

/** Deletes every audio file of the book and its listening place. */
export async function deleteAudio(bookID: string): Promise<void> {
  const database = await db()
  for (const track of await listTracks(bookID)) await database.delete('files', track.id)
  await database.delete('tracks', bookID)
  await database.delete('positions', bookID)
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
}

export const totalSize = (tracks: AudioTrack[]) => tracks.reduce((sum, t) => sum + t.size, 0)
