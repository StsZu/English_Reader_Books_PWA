// Backup and restore (specs/006-backup, B1–B4).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Book } from '../../src/core/model/book.ts'
import { appName, databaseName, settingsPrefix } from '../../src/core/language.ts'
import { encodeWordCard } from '../../src/core/ai/word.ts'
import { STORES, closeDB, db, getValue, setValue } from '../../src/core/storage/db.ts'
import { addBook, books, initLibrary, resetAll } from '../../src/core/storage/library.ts'
import { savePosition } from '../../src/core/storage/positions.ts'
import { deleteKey, initKey, openAIKey, saveKey } from '../../src/core/storage/key.ts'
import { settings } from '../../src/core/storage/settings.ts'
import {
  BACKUP_VERSION, backupErrors, backupFileName, createBackup, lastBackupKey, readBackup, restoreBackup,
} from '../../src/core/storage/backup.ts'
import { sampleCard } from '../fixtures/language.ts'

const book = (title: string): Book => ({
  id: crypto.randomUUID(), title, author: 'A', format: 'txt', importedAt: '2026-10-01T10:00:00.000Z',
  chapters: [{ title: 'C', paragraphs: [{ kind: 'text', sentences: ['One.', 'Two.'] }, { kind: 'heading', sentences: ['H'] }] }],
})

const place = (bookID: string) => ({ bookID, bookTitle: 'T', chapter: 0, paragraph: 0, sentence: 1 })

/** A device with every kind of data: a book with place and caches, a saved word and quote, settings, a key. */
async function fillDevice() {
  const summary = await addBook(book('Kept'))
  const id = summary.id
  await savePosition(id, { chapter: 0, paragraph: 1 })
  await setValue('translations', `${id}|0-0`, ['Один.', 'Два.'])
  await setValue('fragments', `${id}|abc`, ['Фрагмент'])
  await setValue('wordCache', `${sampleCard.headword}|One.`, encodeWordCard(sampleCard))
  await setValue('explanations', 'f00d', 'Пояснення')
  await setValue('meta', 'saved', {
    words: [{
      id: 'W1', headword: 'one', lemma: 'one', ipa: '', partOfSpeech: '', level: '', forms: '', contextTranslation: 'один',
      otherTranslations: [], contexts: [{ sentence: 'One.', translation: 'Один.', place: place(id), date: '2026-10-02T00:00:00.000Z' }],
      updatedAt: '2026-10-02T00:00:00.000Z', trainingLevel: 3, nextReview: '2026-10-09T00:00:00.000Z', lastTrained: null, lastResultUnknown: false,
    }],
    quotes: [{ id: 'Q1', text: 'One. Two.', translation: 'Один. Два.', apple: false, place: place(id), date: '2026-10-02T00:00:00.000Z' }],
  })
  await setValue('meta', 'demoSeeded.v1', true)
  await saveKey('sk-device-secret')
  settings.fontSize.value = 30
  localStorage.setItem(lastBackupKey, '2026-10-20T00:00:00.000Z')
  return id
}

/** Every record of the main database except the key. */
async function snapshot() {
  const database = await db()
  const result: Record<string, [IDBValidKey[], unknown[]]> = {}
  for (const store of STORES) result[store] = [await database.getAllKeys(store), await database.getAll(store)]
  return result
}

async function gunzip(blob: Blob): Promise<string> {
  return new Response(blob.stream().pipeThrough(new DecompressionStream('gzip'))).text()
}

async function gzip(text: string): Promise<Blob> {
  return new Response(new Blob([text]).stream().pipeThrough(new CompressionStream('gzip'))).blob()
}

/** The backup of the filled device as JSON lines, for files edited by the tests. */
async function backupLines(): Promise<string[]> {
  return (await gunzip(await createBackup())).trim().split('\n')
}

const fileOf = async (lines: string[]) => gzip(lines.join('\n') + '\n')

beforeEach(async () => {
  await resetAll()
  await deleteKey()
  localStorage.clear()
})

afterEach(() => vi.restoreAllMocks())

describe('резервна копія', () => {
  it('усі сховища й налаштування → копія → скидання → відновлення → ті самі дані; ключ лишається свій', async () => {
    await fillDevice()
    settings.theme.value = 'dark'
    const before = await snapshot()
    const file = await createBackup(new Date('2026-10-27T12:00:00.000Z'))
    const text = await gunzip(file)
    expect(text).not.toContain('sk-device-secret')
    expect(text).not.toContain('openaiKey')
    expect(text).not.toContain('lastBackup')
    expect(JSON.parse(text.split('\n')[0])).toEqual({
      format: 'reader-backup', version: BACKUP_VERSION, app: databaseName, created: '2026-10-27T12:00:00.000Z',
    })

    await resetAll()
    await saveKey('sk-new-device')
    localStorage.setItem(lastBackupKey, '2026-10-25T00:00:00.000Z')
    expect(localStorage.getItem(`${settingsPrefix}fontSize`)).toBeNull()

    const backup = await readBackup(file)
    expect([backup.created, backup.books, backup.words, backup.quotes]).toEqual(['2026-10-27T12:00:00.000Z', 1, 1, 1])
    await restoreBackup(backup)

    const after = await snapshot()
    const withoutKey = (s: typeof before) => {
      const [keys, values] = s.meta
      const kept = keys.map((k, i) => [k, values[i]] as const).filter(([k]) => k !== 'openaiKey')
      return { ...s, meta: [kept.map(([k]) => k), kept.map(([, v]) => v)] }
    }
    expect(withoutKey(after)).toEqual(withoutKey(before))
    expect(await getValue('meta', 'openaiKey')).toBe('sk-new-device')
    expect(localStorage.getItem(`${settingsPrefix}fontSize`)).toBe('30')
    expect(localStorage.getItem(`${settingsPrefix}theme`)).toBe('"dark"')
    expect(localStorage.getItem(lastBackupKey)).toBe('2026-10-25T00:00:00.000Z')

    await closeDB()
    await initLibrary()
    await initKey()
    expect(books.value.map((b) => b.title)).toEqual(['Kept'])
    expect(openAIKey()).toBe('sk-new-device')
  })

  it('ім\'я файла з назвою застосунку й датою', () => {
    expect(backupFileName(new Date(2026, 9, 7))).toBe(`${appName} — копія 2026-10-07.json.gz`)
  })

  it('розпакований файл (JSON без gzip) теж відновлюється', async () => {
    await fillDevice()
    const plain = new Blob([(await backupLines()).join('\n')])
    expect((await readBackup(plain)).books).toBe(1)
  })

  it('демо-книжка не з\'являється знову після відновлення копії без позначки', async () => {
    await fillDevice()
    const lines = (await backupLines()).filter((l) => !l.includes('demoSeeded'))
    const end = JSON.parse(lines.pop()!)
    lines.push(JSON.stringify({ end: { ...end.end, records: end.end.records - 1 } }))
    await resetAll()
    await restoreBackup(await readBackup(await fileOf(lines)))
    expect(await getValue('meta', 'demoSeeded.v1')).toBe(true)
  })
})

describe('перевірка копії: своя помилка, база без змін', () => {
  async function expectRejected(file: Blob, message: string, limit?: number) {
    const before = await snapshot()
    await expect(readBackup(file, limit)).rejects.toThrow(message)
    expect(await snapshot()).toEqual(before)
  }

  const edit = (lines: string[], index: number, change: (item: Record<string, unknown>) => unknown) =>
    lines.map((line, i) => (i === index ? JSON.stringify(change(JSON.parse(line))) : line))

  it('копія іншого застосунку', async () => {
    await fillDevice()
    const lines = edit(await backupLines(), 0, (h) => ({ ...h, app: 'other-reader' }))
    await expectRejected(await fileOf(lines), 'Це копія Other Reader. Відновіть її в Other Reader.')
  })

  it('новіша версія', async () => {
    await fillDevice()
    const lines = edit(await backupLines(), 0, (h) => ({ ...h, version: BACKUP_VERSION + 1 }))
    await expectRejected(await fileOf(lines), backupErrors.newerVersion)
  })

  it('немає кінцевого рядка або записів менше, ніж у ньому', async () => {
    await fillDevice()
    const lines = await backupLines()
    await expectRejected(await fileOf(lines.slice(0, -1)), backupErrors.damaged)
    await expectRejected(await fileOf([...lines.slice(0, 2), ...lines.slice(3)]), backupErrors.damaged)
  })

  it('обрізаний gzip', async () => {
    await fillDevice()
    const file = await createBackup()
    await expectRejected(file.slice(0, Math.floor(file.size / 2)), backupErrors.damaged)
  })

  it('непридатний запис або ключ OpenAI у копії', async () => {
    await fillDevice()
    const lines = await backupLines()
    const position = lines.findIndex((l) => l.includes('"store":"positions"'))
    await expectRejected(await fileOf(edit(lines, position, (r) => ({ ...r, value: { chapter: 'x', paragraph: 1 } }))), backupErrors.damaged)
    const withKey = [...lines.slice(0, 1), JSON.stringify({ store: 'meta', key: 'openaiKey', value: 'sk-x' }), ...lines.slice(1)]
    const end = JSON.parse(withKey.pop()!)
    withKey.push(JSON.stringify({ end: { ...end.end, records: end.end.records + 1 } }))
    await expectRejected(await fileOf(withKey), backupErrors.damaged)
  })

  it('книжка з бібліотеки, якої немає в копії', async () => {
    await fillDevice()
    const lines = (await backupLines()).filter((l) => !l.includes('"store":"books"'))
    const end = JSON.parse(lines.pop()!)
    lines.push(JSON.stringify({ end: { books: 0, records: end.end.records - 1 } }))
    await expectRejected(await fileOf(lines), backupErrors.damaged)
  })

  it('не файл копії', async () => {
    await fillDevice()
    await expectRejected(new Blob(['Chapter 1\nIt was a dark night.\n']), backupErrors.notBackup)
    await expectRejected(await gzip('{"hello":1}\n'), backupErrors.notBackup)
  })

  it('завелика копія', async () => {
    await fillDevice()
    await expectRejected(await createBackup(), backupErrors.tooLarge, 100)
  })
})

describe('відновлення', () => {
  it('збій посередині транзакції: у базі те, що було', async () => {
    await fillDevice()
    const file = await createBackup()
    await resetAll()
    const other = await addBook(book('Other'))
    await saveKey('sk-new-device')
    const before = await snapshot()
    const backup = await readBackup(file)

    const put = IDBObjectStore.prototype.put
    vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(function (this: IDBObjectStore, ...args: Parameters<IDBObjectStore['put']>) {
      if (this.name === 'explanations') throw new DOMException('The quota has been exceeded.', 'QuotaExceededError')
      return put.apply(this, args)
    })
    await expect(restoreBackup(backup)).rejects.toThrow('Не вдалося відновити: на пристрої недостатньо місця')
    vi.restoreAllMocks()

    expect(await snapshot()).toEqual(before)
    expect(localStorage.getItem(`${settingsPrefix}fontSize`)).toBeNull()
    await closeDB()
    await initLibrary()
    expect(books.value.map((b) => b.id)).toEqual([other.id])
  })
})
