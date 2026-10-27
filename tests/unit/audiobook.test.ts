// Audiobook store and player (specs/002-audio-player, stage A) with a fake <audio> element.
import { File as NodeFile } from 'node:buffer'
import { describe, expect, it, vi } from 'vitest'
import { AudiobookPlayer, LONG_PAUSE_MS, type MediaElement } from '../../src/core/audiobook/player.ts'
import {
  addTracks, closeAudioDB, compareNames, deleteAudio, isAudioFile, listTracks, loadAudioPosition, removeOrphanAudio,
  saveAudioPosition, setTracks, trackFile,
} from '../../src/core/audiobook/store.ts'

// Node's File survives fake-indexeddb's structured clone (happy-dom's does not), like a real Blob in Safari.
const file = (name: string, size = 10, type = 'audio/mpeg') => new NodeFile([new Uint8Array(size)], name, { type }) as unknown as File
const tick = () => new Promise((resolve) => setTimeout(resolve, 0))
const flush = async () => { for (let i = 0; i < 5; i++) await tick() }

class FakeElement implements MediaElement {
  private source = ''
  currentTime = 0
  duration = NaN
  paused = true
  playbackRate = 1
  defaultPlaybackRate = 1
  preservesPitch = false
  preload = ''
  plays = 0
  private listeners = new Map<string, Set<() => void>>()
  constructor(private readonly durationOf: () => number = () => 100) {}
  get src() { return this.source }
  set src(value: string) {
    this.source = value
    this.currentTime = 0
    this.duration = NaN
    this.paused = true
    if (value.startsWith('blob:')) {
      setTimeout(() => {
        if (this.source !== value) return
        this.duration = this.durationOf()
        this.emit('loadedmetadata')
      }, 0)
    }
  }
  async play() {
    this.plays++
    this.paused = false
    setTimeout(() => this.emit('playing'), 0)
  }
  pause() {
    if (this.paused) return
    this.paused = true
    this.emit('pause')
  }
  removeAttribute() { this.source = '' }
  addEventListener(type: string, listener: () => void) {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set())
    this.listeners.get(type)!.add(listener)
  }
  removeEventListener(type: string, listener: () => void) { this.listeners.get(type)?.delete(listener) }
  emit(type: string) { for (const l of this.listeners.get(type) ?? []) l() }
  advance(seconds: number) {
    this.currentTime += seconds
    this.emit('timeupdate')
  }
  end() {
    this.currentTime = this.duration
    this.paused = true
    this.emit('pause')
    this.emit('ended')
  }
}

async function playerWith(names: string[]) {
  const bookID = `book-${crypto.randomUUID()}`
  await addTracks(bookID, names.map((n) => file(n)))
  const element = new FakeElement()
  const player = new AudiobookPlayer(bookID, 'Book', () => element)
  await player.load()
  await flush()
  return { bookID, element, player }
}

describe('audiobook store', () => {
  it('accepts audio files only and orders them by the numbers in their names', async () => {
    expect(isAudioFile(file('a.mp3', 1, ''))).toBe(true)
    expect(isAudioFile(file('a.m4b', 1, ''))).toBe(true)
    expect(isAudioFile(file('notes.txt', 1, 'text/plain'))).toBe(false)
    expect(['10.mp3', '2.mp3', '01.mp3'].sort(compareNames)).toEqual(['01.mp3', '2.mp3', '10.mp3'])
    const bookID = `book-${crypto.randomUUID()}`
    await addTracks(bookID, [file('Chapter 10.mp3'), file('Chapter 2.mp3'), file('cover.jpg', 1, 'image/jpeg')])
    await addTracks(bookID, [file('Chapter 1.mp3')])
    expect((await listTracks(bookID)).map((t) => t.name)).toEqual(['Chapter 2.mp3', 'Chapter 10.mp3', 'Chapter 1.mp3'])
  })

  it('keeps files across relaunches and deletes them with the book audio', async () => {
    const bookID = `book-${crypto.randomUUID()}`
    const [track] = await addTracks(bookID, [file('one.mp3', 64)])
    await closeAudioDB()
    expect((await trackFile(track.id))?.size).toBe(64)
    await deleteAudio(bookID)
    expect(await listTracks(bookID)).toEqual([])
    expect(await trackFile(track.id)).toBeNull()
  })

  it('a failed write leaves no files behind (R6)', async () => {
    const bookID = `book-${crypto.randomUUID()}`
    const put = IDBObjectStore.prototype.put
    let files = 0
    const written: string[] = []
    const spy = vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(function (this: IDBObjectStore, ...args: Parameters<IDBObjectStore['put']>) {
      if (this.name === 'files' && ++files === 2) throw new DOMException('The quota has been exceeded.', 'QuotaExceededError')
      if (this.name === 'files') written.push(String(args[1]))
      return put.apply(this, args)
    })
    try {
      await expect(addTracks(bookID, [file('1.mp3'), file('2.mp3')])).rejects.toThrow('quota')
    } finally {
      spy.mockRestore()
    }
    expect(written).toHaveLength(1)
    expect(await trackFile(written[0])).toBeNull()
    expect(await listTracks(bookID)).toEqual([])
  })

  it('removes the audio of deleted books and files without a track at start (R6)', async () => {
    const kept = `book-${crypto.randomUUID()}`
    const gone = `book-${crypto.randomUUID()}`
    const [keptTrack, orphan] = await addTracks(kept, [file('1.mp3'), file('2.mp3')])
    await setTracks(kept, [keptTrack])
    const [goneTrack] = await addTracks(gone, [file('g.mp3')])
    await saveAudioPosition(gone, { track: 0, time: 5 })
    await removeOrphanAudio([kept])
    expect((await listTracks(kept)).map((t) => t.id)).toEqual([keptTrack.id])
    expect(await trackFile(keptTrack.id)).not.toBeNull()
    expect(await trackFile(orphan.id)).toBeNull()
    expect(await listTracks(gone)).toEqual([])
    expect(await trackFile(goneTrack.id)).toBeNull()
    expect(await loadAudioPosition(gone)).toBeNull()
  })
})

describe('AudiobookPlayer', () => {
  it('plays from a tap, seeks, skips and remembers the place', async () => {
    const { bookID, element, player } = await playerWith(['01.mp3', '02.mp3'])
    expect(player.duration.value).toBe(100)
    player.play()
    await flush()
    expect(player.state.value).toBe('playing')
    element.advance(30)
    expect(player.time.value).toBe(30)
    player.skip(15)
    expect(element.currentTime).toBe(45)
    player.skip(-60)
    expect(element.currentTime).toBe(0)
    player.seek(500)
    expect(element.currentTime).toBeCloseTo(99.75)
    player.seek(42)
    player.pause()
    expect(player.state.value).toBe('paused')
    await flush()
    expect(await loadAudioPosition(bookID)).toEqual({ track: 0, time: 42, rate: 1 })

    const again = new AudiobookPlayer(bookID, 'Book', () => new FakeElement())
    await again.load()
    await flush()
    expect([again.track.value, again.time.value]).toEqual([0, 42])
  })

  it('goes on to the next track at the end and stops at the end of the book', async () => {
    const { element, player } = await playerWith(['01.mp3', '02.mp3'])
    player.play()
    await flush()
    element.end()
    await flush()
    expect(player.track.value).toBe(1)
    expect(player.state.value).toBe('playing')
    element.end()
    await flush()
    expect(player.track.value).toBe(1)
    expect(player.state.value).toBe('paused')
  })

  it('applies the speed with pitch kept and saves the measured duration', async () => {
    const { bookID, element, player } = await playerWith(['01.mp3'])
    player.setRate(1.15)
    expect([element.playbackRate, element.preservesPitch]).toEqual([1.15, true])
    expect((await listTracks(bookID))[0].duration).toBe(100)
  })

  it('a pause from the system is reported and the place saved', async () => {
    const { bookID, element, player } = await playerWith(['01.mp3'])
    player.play()
    await flush()
    element.advance(12)
    element.pause()
    await flush()
    expect(player.state.value).toBe('paused')
    expect(await loadAudioPosition(bookID)).toEqual({ track: 0, time: 12, rate: 1 })
  })

  it('after a pause starts 0.3 s earlier, 3 s after a long pause or reopening; a seek starts exactly there', async () => {
    const { bookID, element, player } = await playerWith(['01.mp3'])
    player.play()
    await flush()
    element.advance(30)
    // The element is ahead of the last timeupdate: the pause keeps the element's own time.
    element.currentTime = 30.4
    player.pause()
    expect(player.time.value).toBe(30.4)
    await flush()
    expect((await loadAudioPosition(bookID))?.time).toBe(30.4)
    player.play()
    expect(element.currentTime).toBeCloseTo(30.1)
    expect(player.time.value).toBeCloseTo(30.1)
    await flush()

    // A second play while playing does not go back again.
    player.play()
    expect(element.currentTime).toBeCloseTo(30.1)

    player.pause()
    const now = Date.now()
    const clock = vi.spyOn(Date, 'now').mockReturnValue(now + LONG_PAUSE_MS)
    player.play()
    clock.mockRestore()
    expect(element.currentTime).toBeCloseTo(27.1)
    await flush()

    player.pause()
    player.seek(50)
    player.play()
    expect(element.currentTime).toBe(50)
    await flush()

    element.pause()
    await flush()
    player.skip(-5)
    player.play()
    expect(element.currentTime).toBe(45)
    player.pause()
    await flush()

    const element2 = new FakeElement()
    const again = new AudiobookPlayer(bookID, 'Book', () => element2)
    await again.load()
    await flush()
    expect(again.time.value).toBe(45)
    again.play()
    expect(element2.currentTime).toBe(42)
  })

  it('a rewind never goes before the start of the track', async () => {
    const { element, player } = await playerWith(['01.mp3'])
    player.play()
    await flush()
    element.advance(0.2)
    player.pause()
    player.play()
    expect(element.currentTime).toBe(0)
  })

  it('remembers the speed of the book', async () => {
    const { bookID, player } = await playerWith(['01.mp3'])
    player.setRate(0.9)
    await flush()
    expect((await loadAudioPosition(bookID))?.rate).toBe(0.9)
    const element = new FakeElement()
    const again = new AudiobookPlayer(bookID, 'Book', () => element)
    await again.load()
    await flush()
    expect(again.rate.value).toBe(0.9)
    expect(element.playbackRate).toBe(0.9)
  })

  it('stops other sounds before playing', async () => {
    const { player } = await playerWith(['01.mp3'])
    let stopped = 0
    player.onWillPlay = () => { stopped++ }
    player.play()
    expect(stopped).toBe(1)
  })

  it('adds, moves and removes tracks while keeping the current one', async () => {
    const { player } = await playerWith(['a.mp3', 'b.mp3', 'c.mp3'])
    await player.selectTrack(1)
    await player.move(1, 0)
    expect(player.tracks.value.map((t) => t.name)).toEqual(['b.mp3', 'a.mp3', 'c.mp3'])
    expect(player.track.value).toBe(0)
    await player.remove(2)
    expect(player.tracks.value.map((t) => t.name)).toEqual(['b.mp3', 'a.mp3'])
    expect(player.track.value).toBe(0)
    expect(await player.add([file('d.mp3'), file('readme.txt', 1, 'text/plain')])).toBe(1)
    await player.removeAll()
    expect(player.hasAudio).toBe(false)
  })
})
