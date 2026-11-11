// One import of a prepared book at a time, and no cleanup while one runs, across the tabs of one app
// (specs/015-reader-book-container, R021). Another tab that starts during an import waits for it instead of taking its
// audio, time and translations for leftovers. A crashed or closed tab releases the lock; its journal entry tells the
// next start what to remove.
import { DB_NAME } from '../storage/db.ts'
import { deleteBook, removeOrphanTranslations, storedBookIDs } from '../storage/library.ts'
import { journalDelete, journalEntries, removeOrphanAudio } from '../audiobook/store.ts'

export const IMPORT_LOCK = `${DB_NAME}-prepared-import`

interface Locks {
  request<T>(name: string, options: { mode: 'exclusive' }, callback: () => Promise<T>): Promise<T>
}

let override: Locks | null | undefined

/** Tests: a lock manager (or null for a browser without one); undefined — the browser's own. */
export function setLocksForTests(locks: Locks | null | undefined) {
  override = locks
}

function locks(): Locks | null {
  if (override !== undefined) return override
  return (globalThis.navigator as unknown as { locks?: Locks } | undefined)?.locks ?? null
}

export const canCoordinate = (): boolean => locks() !== null

/** Runs `work` holding the import lock of this app's database. Without Web Locks an import is refused. */
export async function withImportLock<T>(work: () => Promise<T>): Promise<T> {
  const manager = locks()
  if (!manager) throw new Error('Книжку не імпортовано: цей браузер не підтримує безпечний імпорт (Web Locks).')
  return manager.request(IMPORT_LOCK, { mode: 'exclusive' }, work)
}

/** At start: finish what crashed imports left, then remove leftovers of books not stored — under the lock. */
export async function cleanupAtStart(): Promise<void> {
  const run = async () => {
    const stored = new Set(await storedBookIDs())
    for (const entry of await journalEntries()) {
      if (!stored.has(entry.bookId)) await deleteBook(entry.bookId).catch(() => {})
      await journalDelete(entry.bookId)
    }
    const ids = await storedBookIDs()
    await removeOrphanAudio(ids).catch(() => {})
    await removeOrphanTranslations(ids).catch(() => {})
  }
  // Without Web Locks no import can run (withImportLock refuses), so the cleanup cannot meet one.
  return locks() ? withImportLock(run) : run()
}
