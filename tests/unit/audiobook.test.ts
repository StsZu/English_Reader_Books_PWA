// Audiobook store and player (specs/002-audio-player, stage A) with a fake <audio> element.
import { File as NodeFile } from 'node:buffer'
import { describe, expect, it } from 'vitest'
import { AudiobookPlayer, type MediaElement } from '../../src/core/audiobook/player.ts'
import {
  addTracks, closeAudioDB, compareNames, deleteAudio, isAudioFile, listTracks, loadAudioPosition, trackFile,
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
    expect(await loadAudioPosition(bookID)).toEqual({ track: 0, time: 42 })

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
    player.setRate(1.5)
    expect([element.playbackRate, element.preservesPitch]).toEqual([1.5, true])
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
    expect(await loadAudioPosition(bookID)).toEqual({ track: 0, time: 12 })
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
