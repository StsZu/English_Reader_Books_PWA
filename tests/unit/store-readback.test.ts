// Stored tracks read back before a prepared book appears (specs/015-reader-book-container, R033): size first, then
// SHA-256 in pieces; a mismatch refuses, and every file written for the import — also the one that failed — is removed.
import { createHash } from 'node:crypto'
import { File as NodeFile } from 'node:buffer'
import { beforeEach, describe, expect, it } from 'vitest'
import { openDB } from 'idb'
import { AudioStoreError, canStoreBlobs, closeAudioDB, listTracks, MAX_FALLBACK_BYTES, ownCopy, putTracksInOrder, trackFile } from '../../src/core/audiobook/store.ts'
import { DB_NAME } from '../../src/core/storage/db.ts'

const file = (name: string, bytes: Uint8Array) => new NodeFile([bytes], name, { type: 'audio/mpeg' }) as unknown as File
const sha = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex')
const bytes = (n: number, fill: number) => new Uint8Array(n).fill(fill)

async function storedFiles(): Promise<string[]> {
  await closeAudioDB()
  const db = await openDB(`${DB_NAME}-audio`)
  const keys = (await db.getAllKeys('files')).map(String)
  db.close()
  return keys
}

describe('read-back check of stored tracks (R033)', () => {
  beforeEach(async () => {
    await closeAudioDB()
    indexedDB.deleteDatabase(`${DB_NAME}-audio`)
  })

  // The own copy (`copy: true`) is a File of the environment, which fake-indexeddb cannot clone in happy-dom: its bytes
  // are checked below and its storage in the browser test tests/e2e/prepared-persistent.spec.ts.
  it('stores, reads back and accepts tracks whose size and SHA-256 match', async () => {
    const a = bytes(10_000, 1)
    const b = bytes(7_000, 2)
    const tracks = await putTracksInOrder('book', [file('a.mp3', a), file('b.mp3', b)],
      { expected: [{ size: a.length, sha256: sha(a) }, { size: b.length, sha256: sha(b) }] })
    expect(tracks.map((t) => t.name)).toEqual(['a.mp3', 'b.mp3'])
    for (const [i, t] of tracks.entries()) {
      const stored = new Uint8Array(await (await trackFile(t.id))!.arrayBuffer())
      expect(sha(stored)).toBe(sha([a, b][i]))
    }
  })

  it('read back: the right file and the right expectation, but other bytes of the same size in storage → refused, removed', async () => {
    const a = bytes(4_096, 1)
    const b = bytes(3_000, 2)
    let replaced = 0
    await expect(putTracksInOrder('book', [file('a.mp3', a), file('b.mp3', b)], {
      expected: [{ size: a.length, sha256: sha(a) }, { size: b.length, sha256: sha(b) }],
      // Between the write and the read back, the second stored value gets other bytes of the same size.
      afterWrite: async (id) => {
        if (++replaced !== 2) return
        const db = await openDB(`${DB_NAME}-audio`)              // a second connection; the store's own stays open
        await db.put('files', { audioBytes: bytes(3_000, 9).buffer, type: 'audio/mpeg' }, id)
        db.close()
      },
    })).rejects.toThrow('збережене аудіо «b.mp3» не збігається')
    expect(await storedFiles()).toEqual([])
    expect(await listTracks('book')).toEqual([])
  })

  it('a package that expects other bytes of the same size than the file → refused, removed', async () => {
    const a = bytes(4_096, 1)
    await expect(putTracksInOrder('book', [file('a.mp3', a)], { expected: [{ size: a.length, sha256: sha(bytes(4_096, 9)) }] }))
      .rejects.toThrow('збережене аудіо «a.mp3» не збігається')
    expect(await storedFiles()).toEqual([])
    expect(await listTracks('book')).toEqual([])
  })

  it('a package that expects another size → refused before hashing, removed', async () => {
    const a = bytes(4_096, 1)
    await expect(putTracksInOrder('book', [file('a.mp3', a)], { expected: [{ size: a.length + 1, sha256: sha(a) }] }))
      .rejects.toThrow('не збігається')
    expect(await storedFiles()).toEqual([])
  })

  it('a failure at the second track removes the first and the second file and stores no track list', async () => {
    const a = bytes(3_000, 1)
    const b = bytes(3_000, 2)
    await expect(putTracksInOrder('book', [file('a.mp3', a), file('b.mp3', b)],
      { expected: [{ size: a.length, sha256: sha(a) }, { size: b.length, sha256: sha(a) }] })).rejects.toThrow('«b.mp3»')
    expect(await storedFiles()).toEqual([])
    expect(await listTracks('book')).toEqual([])
    await expect(putTracksInOrder('book', [file('a.mp3', a), file('b.mp3', b)],
      { afterTrack: async (i) => { if (i === 1) throw new Error('stop after the second') } })).rejects.toThrow('stop after the second')
    expect(await storedFiles()).toEqual([])
  })

  it('an own copy has the same bytes, made of pieces, for sizes around the piece size', async () => {
    for (const n of [0, 1, 4095, 4096, 4097, 3 * 4096 + 5]) {
      const data = Uint8Array.from({ length: n }, (_, i) => i % 251)
      const copy = await ownCopy(file('x.mp3', data), 4096)
      expect(copy.size).toBe(n)
      expect(copy.type).toBe('audio/mpeg')
      expect(sha(new Uint8Array(await copy.arrayBuffer()))).toBe(sha(data))
    }
  })

  it('copies of a container: where no Blob is kept, a track over the fallback limit is refused before it is read or copied', async () => {
    let read = 0
    const big = {
      name: 'big.mp3', type: 'audio/mpeg', size: MAX_FALLBACK_BYTES + 1,
      slice() { read++; throw new Error('read') }, arrayBuffer() { read++; throw new Error('read') },
    } as unknown as File
    // In this environment (happy-dom + fake-indexeddb) a Blob does not come back as a Blob: the fallback form is used.
    await expect(putTracksInOrder('book', [file('small.mp3', bytes(10, 1)), big], { copy: true }))
      .rejects.toBeInstanceOf(AudioStoreError)
    expect(read).toBe(0)
    expect(await storedFiles()).toEqual([])                     // no orphan, no probe left
  })

  it('copies of a container in the fallback form are read back right', async () => {
    const a = bytes(5_000, 3)
    const [t] = await putTracksInOrder('book', [file('a.mp3', a)], { copy: true, expected: [{ size: a.length, sha256: sha(a) }] })
    expect(sha(new Uint8Array(await (await trackFile(t.id))!.arrayBuffer()))).toBe(sha(a))
    expect(await storedFiles()).toEqual([t.id])
  })

  it('the Blob probe: a full storage is thrown, not taken for "no Blob"; a value that does not come back as a Blob is "no"', async () => {
    const quota = Object.assign(new Error('full'), { name: 'QuotaExceededError' })
    const deleted: string[] = []
    const base = { delete: async (_s: string, k: string) => { deleted.push(k) } }
    await expect(canStoreBlobs({ ...base, put: async () => { throw quota }, get: async () => undefined } as never)).rejects.toBe(quota)
    expect(await canStoreBlobs({ ...base, put: async () => { throw new Error('DataCloneError') }, get: async () => undefined } as never)).toBe(false)
    expect(await canStoreBlobs({ ...base, put: async () => 'k', get: async () => ({ size: 1 }) } as never)).toBe(false)
    expect(await canStoreBlobs({ ...base, put: async () => 'k', get: async () => new Blob([new Uint8Array([7])]) } as never)).toBe(true)
    expect(deleted.length).toBe(4)                              // the probe is removed every time
  })
})
