// IndexedDB schema (spec.md → «Схема даних»). One database, plain key–value object stores,
// so every module persists the same JSON shapes the Swift app wrote to Application Support.
import { openDB, type IDBPDatabase } from 'idb'
import { databaseName } from '../language.ts'
import type { KeyValueCache } from '../../contracts.ts'

export const DB_NAME = databaseName
const DB_VERSION = 1

/**
 * Stores:
 * - `meta`: `library` → BookSummary[], `saved` → {words, quotes}, `demoSeeded.v1` → true
 * - `books`: book id → Book
 * - `positions`: book id → ParagraphRef
 * - `translations`: `${bookID}|${chapter}-${paragraph}` → string[]
 * - `fragments`: `${bookID}|${sha256}` → string
 * - `wordCache`: `${word lower}|${sentence}` → WordCard
 * - `explanations`: sha256 → string
 */
export const STORES = ['meta', 'books', 'positions', 'translations', 'fragments', 'wordCache', 'explanations'] as const
export type StoreName = (typeof STORES)[number]

let dbPromise: Promise<IDBPDatabase> | null = null

export function db(): Promise<IDBPDatabase> {
  dbPromise ??= openDB(DB_NAME, DB_VERSION, {
    upgrade(database) {
      for (const name of STORES) {
        if (!database.objectStoreNames.contains(name)) database.createObjectStore(name)
      }
    },
  })
  return dbPromise
}

/** Test hook: forget the open connection so the next call reopens (simulates a relaunch). */
export async function closeDB() {
  if (dbPromise) (await dbPromise).close()
  dbPromise = null
}

export async function getValue<T>(store: StoreName, key: string): Promise<T | undefined> {
  return (await db()).get(store, key) as Promise<T | undefined>
}

export async function setValue(store: StoreName, key: string, value: unknown): Promise<void> {
  await (await db()).put(store, value, key)
}

export async function deleteValue(store: StoreName, key: string): Promise<void> {
  await (await db()).delete(store, key)
}

/** Deletes every key in the store that starts with the prefix. */
export async function deletePrefix(store: StoreName, prefix: string): Promise<void> {
  const database = await db()
  const range = IDBKeyRange.bound(prefix, prefix + '￿')
  await database.delete(store, range)
}

export async function clearStore(store: StoreName): Promise<void> {
  await (await db()).clear(store)
}

/** Key–value cache over one store with an optional key prefix (e.g. per book). */
export function cache<T>(store: StoreName, prefix = ''): KeyValueCache<T> {
  return {
    get: (key) => getValue<T>(store, prefix + key),
    set: (key, value) => setValue(store, prefix + key, value),
  }
}

/** Asks the browser to keep data even under storage pressure (Safari ITP eviction otherwise). */
export async function requestPersistence(): Promise<boolean> {
  try {
    if (await navigator.storage?.persisted?.()) return true
    return (await navigator.storage?.persist?.()) ?? false
  } catch {
    return false
  }
}

export async function isPersisted(): Promise<boolean> {
  try {
    return (await navigator.storage?.persisted?.()) ?? false
  } catch {
    return false
  }
}
