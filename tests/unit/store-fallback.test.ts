// The fallback of storing a track as bytes (specs/015-reader-book-container, R022, FR-05): bounded, same stored form.
import { describe, expect, it, vi } from 'vitest'
import { AudioStoreError, MAX_FALLBACK_BYTES, putFile } from '../../src/core/audiobook/store.ts'

function database(blobFails: { name: string } | null) {
  const stored = new Map<string, unknown>()
  return {
    stored,
    put: vi.fn(async (_store: string, value: unknown, id: string) => {
      const isBytes = typeof value === 'object' && value !== null && 'audioBytes' in value
      if (!isBytes && blobFails) throw Object.assign(new Error('cannot store a Blob'), blobFails)
      stored.set(id, value)
      return id
    }),
  }
}

const track = (size: number) => ({ name: 'a.mp3', type: 'audio/mpeg', size, arrayBuffer: vi.fn(async () => new ArrayBuffer(8)) })

describe('storing a track when the browser cannot store a Blob', () => {
  it('a Blob is stored as it is when it can be', async () => {
    const db = database(null)
    const file = new File([new Uint8Array([1, 2, 3])], 'a.mp3', { type: 'audio/mpeg' })
    await putFile(db as never, 't1', file)
    expect(db.stored.get('t1')).toBe(file)
  })

  it('a small track falls back to bytes in the form older versions read', async () => {
    const db = database({ name: 'DataCloneError' })
    const file = new File([new Uint8Array([1, 2, 3])], 'a.mp3', { type: 'audio/mpeg' })
    await putFile(db as never, 't1', file)
    const value = db.stored.get('t1') as { audioBytes: ArrayBuffer; type: string }
    expect(new Uint8Array(value.audioBytes)).toEqual(new Uint8Array([1, 2, 3]))
    expect(value.type).toBe('audio/mpeg')
  })

  it('a track over the limit is refused without reading it whole into memory', async () => {
    const db = database({ name: 'DataCloneError' })
    const big = track(MAX_FALLBACK_BYTES + 1)
    await expect(putFile(db as never, 't1', big as never)).rejects.toThrow(AudioStoreError)
    expect(big.arrayBuffer).not.toHaveBeenCalled()
    expect(db.stored.size).toBe(0)
  })

  it('a full storage is reported as it is, not hidden by the fallback', async () => {
    const db = database({ name: 'QuotaExceededError' })
    const small = track(10)
    await expect(putFile(db as never, 't1', small as never)).rejects.toMatchObject({ name: 'QuotaExceededError' })
    expect(small.arrayBuffer).not.toHaveBeenCalled()
  })
})
