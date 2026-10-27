import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Book } from '../../src/core/model/book.ts'
import { DB_NAME, closeDB, getValue, setValue } from '../../src/core/storage/db.ts'
import { addBook, books, deleteBook, initLibrary, loadBook, resetAll, seedDemoIfNeeded } from '../../src/core/storage/library.ts'
import { clearPosition, loadPosition, savePosition } from '../../src/core/storage/positions.ts'
import { deleteKey, hasStoredKey, initKey, openAIKey, saveKey } from '../../src/core/storage/key.ts'
import { settings } from '../../src/core/storage/settings.ts'

function book(title: string, id = crypto.randomUUID()): Book {
  return {
    id, title, author: 'A', format: 'txt', importedAt: new Date().toISOString(),
    chapters: [{ title: 'C', paragraphs: [{ kind: 'text', sentences: ['One.', 'Two.'] }, { kind: 'heading', sentences: ['H'] }] }],
  }
}

/** Simulates a relaunch: the connection and in-memory state are rebuilt from IndexedDB. */
async function relaunch() {
  await closeDB()
  await initLibrary()
  await initKey()
}

beforeEach(async () => {
  await resetAll()
  await deleteKey()
})

afterEach(() => vi.restoreAllMocks())

/** Makes every write to the store fail as Safari does when the storage is full. */
function failWritesTo(store: string) {
  const put = IDBObjectStore.prototype.put
  vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(function (this: IDBObjectStore, ...args: Parameters<IDBObjectStore['put']>) {
    if (this.name === store) throw new DOMException('The quota has been exceeded.', 'QuotaExceededError')
    return put.apply(this, args)
  })
}

describe('бібліотека', () => {
  it('додає першою, зберігає індекс і книжку після перезапуску', async () => {
    await addBook(book('First'))
    const second = await addBook(book('Second'))
    expect(books.value.map((b) => b.title)).toEqual(['Second', 'First'])
    expect(second.chapterCount).toBe(1)
    expect(second.sentenceCount).toBe(3)
    await relaunch()
    expect(books.value.map((b) => b.title)).toEqual(['Second', 'First'])
    expect((await loadBook(second.id))?.chapters[0].paragraphs[0].sentences).toEqual(['One.', 'Two.'])
  })

  it('видалення прибирає книжку, позицію й кеші перекладу цієї книжки', async () => {
    const kept = await addBook(book('Kept'))
    const gone = await addBook(book('Gone'))
    await savePosition(gone.id, { chapter: 0, paragraph: 1 })
    await setValue('translations', `${gone.id}|0-0`, ['a'])
    await setValue('fragments', `${gone.id}|abc`, 'b')
    await setValue('translations', `${kept.id}|0-0`, ['c'])
    await deleteBook(gone.id)
    expect(books.value.map((b) => b.title)).toEqual(['Kept'])
    expect(await loadBook(gone.id)).toBeNull()
    expect(await loadPosition(gone.id)).toBeNull()
    expect(await getValue('translations', `${gone.id}|0-0`)).toBeUndefined()
    expect(await getValue('fragments', `${gone.id}|abc`)).toBeUndefined()
    expect(await getValue('translations', `${kept.id}|0-0`)).toEqual(['c'])
  })

  it('збій запису індексу: книжки немає ні в списку, ні в базі (R1)', async () => {
    const kept = await addBook(book('Kept'))
    failWritesTo('meta')
    const lost = book('Lost')
    await expect(addBook(lost)).rejects.toThrow('Не вдалося зберегти книжку: на пристрої недостатньо місця')
    expect(books.value.map((b) => b.title)).toEqual(['Kept'])
    vi.restoreAllMocks()
    expect(await loadBook(lost.id)).toBeNull()
    await relaunch()
    expect(books.value.map((b) => b.id)).toEqual([kept.id])
  })

  it('застарілий список у пам\'яті (інша вкладка) не ховає й не повертає книжки (R1)', async () => {
    const first = await addBook(book('First'))
    // Another tab added «Other» and deleted «First»; this tab still shows only «First».
    const other = book('Other')
    await setValue('books', other.id, other)
    await setValue('meta', 'library', [{ ...first, id: other.id, title: 'Other' }])
    expect(books.value.map((b) => b.title)).toEqual(['First'])
    await addBook(book('Third'))
    expect(books.value.map((b) => b.title)).toEqual(['Third', 'Other'])
    await deleteBook(other.id)
    await relaunch()
    expect(books.value.map((b) => b.title)).toEqual(['Third'])
  })

  it('інші вкладки отримують повідомлення про зміну бібліотеки (R1)', async () => {
    await initLibrary()
    const listener = new BroadcastChannel(`${DB_NAME}-library`)
    const heard = new Promise((resolve) => { listener.onmessage = (event) => resolve(event.data) })
    await addBook(book('Shared'))
    expect(await heard).toBe('library')
    listener.close()
  })

  it('демо-книжка додається лише один раз', async () => {
    let calls = 0
    const loadDemo = async () => { calls++; return book('Demo') }
    await seedDemoIfNeeded(loadDemo)
    await relaunch()
    await seedDemoIfNeeded(loadDemo)
    expect(calls).toBe(1)
    expect(books.value.map((b) => b.title)).toEqual(['Demo'])
  })

  it('тестове скидання очищає книжки й налаштування', async () => {
    await addBook(book('X'))
    settings.fontSize.value = 30
    await resetAll()
    expect(books.value).toEqual([])
    expect(settings.fontSize.value).toBe(22)
    await relaunch()
    expect(books.value).toEqual([])
  })
})

describe('позиція читання', () => {
  // testReadingPositionPersists
  it('зберігається, переживає перезапуск і очищається', async () => {
    const id = crypto.randomUUID()
    await savePosition(id, { chapter: 2, paragraph: 7 })
    await relaunch()
    expect(await loadPosition(id)).toEqual({ chapter: 2, paragraph: 7 })
    await clearPosition(id)
    expect(await loadPosition(id)).toBeNull()
  })
})

describe('ключ OpenAI', () => {
  it('обрізає пробіли, переживає перезапуск, порожній рядок видаляє', async () => {
    expect(openAIKey()).toBeNull()
    await saveKey('  sk-test-value \n')
    expect(openAIKey()).toBe('sk-test-value')
    expect(hasStoredKey.value).toBe(true)
    await relaunch()
    expect(openAIKey()).toBe('sk-test-value')
    await saveKey('   ')
    expect(openAIKey()).toBeNull()
    expect(hasStoredKey.value).toBe(false)
    await relaunch()
    expect(openAIKey()).toBeNull()
  })
})
