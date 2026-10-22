// Audiobook player of one book: its own <audio> element (separate from sentence speech), tracks in order,
// seeking, speed, the listening place and lock-screen controls.
import { batch, signal } from '@preact/signals'
import { setMediaPlaybackState, setMediaPosition, setMediaSessionHandlers } from '../speech/audio.ts'
import {
  addTracks, deleteAudio, deleteTrackFile, listTracks, loadAudioPosition, saveAudioPosition, setTracks, trackFile,
  type AudioTrack,
} from './store.ts'

export type AudiobookState = 'idle' | 'loading' | 'playing' | 'paused'

/** The part of HTMLAudioElement the player uses; replaced by a fake in unit tests. */
export interface MediaElement {
  src: string
  currentTime: number
  readonly duration: number
  readonly paused: boolean
  playbackRate: number
  defaultPlaybackRate: number
  preservesPitch?: boolean
  preload: string
  play(): Promise<void>
  pause(): void
  removeAttribute(name: string): void
  addEventListener(type: string, listener: () => void): void
  removeEventListener(type: string, listener: () => void): void
}

export const SKIP_SECONDS = 5
export const RATES = [0.75, 0.9, 1, 1.15]
/** «Слухати» after a pause starts a little earlier: the sound cut off at the pause was still on its way to the speaker. */
export const RESUME_REWIND_SECONDS = 1
/** After a long pause (or reopening the book) it goes back further, to pick up the thread. */
export const LONG_PAUSE_MS = 5 * 60_000
export const LONG_PAUSE_REWIND_SECONDS = 3
/** How often the listening place is saved while playing. */
export const SAVE_INTERVAL_MS = 5000

const SILENCE = 'data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAIA+AAACABAAZGF0YQAAAAA='

function createElement(): MediaElement {
  const audio = new Audio()
  audio.preload = 'auto'
  audio.setAttribute('playsinline', '')
  return audio
}

export class AudiobookPlayer {
  readonly tracks = signal<AudioTrack[]>([])
  readonly track = signal(0)
  readonly time = signal(0)
  readonly duration = signal(0)
  readonly state = signal<AudiobookState>('idle')
  readonly rate = signal(1)
  readonly error = signal<string | null>(null)
  /** Called before playback starts, so other sounds of the reader stop. */
  onWillPlay: () => void = () => {}

  private element: MediaElement | null = null
  private objectURL: string | null = null
  /** Track whose file is in the element, and the time to seek to once its metadata is known. */
  private loaded: number | null = null
  private pendingSeek: number | null = null
  private loadToken = 0
  private lastSave = 0
  /** When playback was paused (0: before this session); null after an explicit seek, which starts exactly there. */
  private pausedAt: number | null = null
  private disposed = false

  constructor(
    readonly bookID: string,
    readonly title: string,
    private readonly makeElement: () => MediaElement = createElement,
  ) {}

  get hasAudio(): boolean {
    return this.tracks.value.length > 0
  }

  get isPlaying(): boolean {
    return this.state.value === 'playing' || this.state.value === 'loading'
  }

  /** Reads the tracks and the listening place; puts the current track in the element so a tap can start it at once. */
  async load() {
    const [tracks, position] = await Promise.all([listTracks(this.bookID), loadAudioPosition(this.bookID)])
    if (this.disposed) return
    const track = position ? Math.min(Math.max(0, position.track), Math.max(0, tracks.length - 1)) : 0
    batch(() => {
      this.tracks.value = tracks
      this.track.value = track
      this.time.value = position && position.track === track ? Math.max(0, position.time) : 0
      this.duration.value = tracks[track]?.duration ?? 0
      this.rate.value = position?.rate !== undefined && RATES.includes(position.rate) ? position.rate : 1
    })
    this.pausedAt = position ? 0 : null
    if (tracks.length) await this.prepare(track, this.time.value)
  }

  private get audio(): MediaElement {
    if (!this.element) {
      const element = this.makeElement()
      element.addEventListener('loadedmetadata', this.onMetadata)
      element.addEventListener('timeupdate', this.onTime)
      element.addEventListener('ended', this.onEnded)
      element.addEventListener('playing', this.onPlaying)
      element.addEventListener('pause', this.onPause)
      element.addEventListener('error', this.onError)
      this.element = element
    }
    return this.element
  }

  /** Loads the track file into the element at `time` without playing. */
  private async prepare(index: number, time: number): Promise<boolean> {
    const track = this.tracks.value[index]
    if (!track) return false
    const token = ++this.loadToken
    const blob = await trackFile(track.id)
    if (token !== this.loadToken || this.disposed) return false
    if (!blob) {
      this.error.value = `Файл «${track.name}» не знайдено. Додайте його ще раз.`
      return false
    }
    this.releaseURL()
    const url = URL.createObjectURL(blob)
    this.objectURL = url
    const audio = this.audio
    this.loaded = index
    this.pendingSeek = time
    audio.src = url
    this.applyRate()
    batch(() => {
      this.track.value = index
      this.time.value = time
      this.duration.value = track.duration ?? 0
    })
    return true
  }

  private applyRate() {
    const audio = this.audio
    audio.playbackRate = this.rate.value
    audio.defaultPlaybackRate = this.rate.value
    audio.preservesPitch = true
  }

  /** Must be called from a tap: the first play() of the element has to happen inside the gesture on iOS. */
  play() {
    if (!this.hasAudio) return
    this.onWillPlay()
    this.error.value = null
    const audio = this.audio
    const rewind = this.resumeRewind()
    if (this.loaded === this.track.value) {
      if (rewind > 0) {
        const target = Math.max(0, (this.pendingSeek ?? audio.currentTime) - rewind)
        if (this.pendingSeek !== null) this.pendingSeek = target
        else audio.currentTime = target
        this.time.value = target
      }
      this.state.value = 'loading'
      this.start()
      return
    }
    // The file is not in the element yet: unlock it inside the gesture, then load and play.
    audio.src = SILENCE
    audio.play().catch(() => {})
    this.state.value = 'loading'
    void this.prepare(this.track.value, Math.max(0, this.time.value - rewind)).then((ready) => {
      if (ready) this.start()
      else this.state.value = 'paused'
    })
  }

  private resumeRewind(): number {
    const pausedAt = this.pausedAt
    this.pausedAt = null
    if (pausedAt === null) return 0
    return Date.now() - pausedAt >= LONG_PAUSE_MS ? LONG_PAUSE_REWIND_SECONDS : RESUME_REWIND_SECONDS
  }

  /** The element's own time: `time` is refreshed only a few times a second. */
  private captureTime() {
    if (this.element && this.ownsElement && this.pendingSeek === null) this.time.value = this.element.currentTime
  }

  private start() {
    this.setSession()
    this.audio.play().catch((error: unknown) => {
      if ((error as { name?: string })?.name === 'AbortError') return
      this.state.value = 'paused'
      if ((error as { name?: string })?.name !== 'NotAllowedError') this.error.value = 'Цей файл не відтворюється.'
    })
  }

  pause() {
    if (!this.element || this.state.value === 'idle' || this.state.value === 'paused') return
    this.captureTime()
    this.element.pause()
    this.state.value = 'paused'
    this.pausedAt = Date.now()
    setMediaPlaybackState('paused')
    void this.savePosition()
  }

  toggle() {
    if (this.isPlaying) this.pause()
    else this.play()
  }

  /** Seeks inside the current track. */
  seek(time: number) {
    const duration = this.duration.value || this.element?.duration || 0
    const target = Math.max(0, duration > 0 ? Math.min(time, Math.max(0, duration - 0.25)) : time)
    this.time.value = target
    this.pausedAt = null
    if (this.element && this.loaded === this.track.value && this.pendingSeek === null) this.element.currentTime = target
    else this.pendingSeek = target
    void this.savePosition()
    this.updatePosition()
  }

  skip(seconds: number) {
    this.seek(this.time.value + seconds)
  }

  /** Opens another track at its start (or at `time`); keeps playing if it was playing. */
  async selectTrack(index: number, time = 0) {
    if (index < 0 || index >= this.tracks.value.length) return
    const playing = this.isPlaying
    this.element?.pause()
    this.pausedAt = null
    if (playing) this.state.value = 'loading'
    const ready = await this.prepare(index, time)
    void this.savePosition()
    if (ready && playing) this.start()
    else if (playing) this.state.value = 'paused'
  }

  setRate(rate: number) {
    this.rate.value = rate
    if (this.element) this.applyRate()
    this.updatePosition()
    void this.savePosition()
  }

  // MARK: Editing the track list

  async add(files: File[]): Promise<number> {
    const before = this.tracks.value.length
    const tracks = await addTracks(this.bookID, files, this.tracks.value)
    this.tracks.value = tracks
    if (before === 0 && tracks.length) await this.prepare(0, 0)
    return tracks.length - before
  }

  async move(index: number, to: number) {
    const tracks = [...this.tracks.value]
    if (to < 0 || to >= tracks.length || index === to) return
    const current = tracks[this.track.value]?.id
    const [moved] = tracks.splice(index, 1)
    tracks.splice(to, 0, moved)
    // The list in memory changes first: every later write (e.g. a measured duration) stores the new order.
    batch(() => {
      this.tracks.value = tracks
      this.track.value = Math.max(0, tracks.findIndex((t) => t.id === current))
      this.loaded = this.loaded === null ? null : this.track.value
    })
    await setTracks(this.bookID, tracks)
    void this.savePosition()
  }

  async remove(index: number) {
    const track = this.tracks.value[index]
    if (!track) return
    const current = index === this.track.value
    if (current) this.unload()
    const tracks = this.tracks.value.filter((t) => t.id !== track.id)
    const next = current ? Math.min(index, tracks.length - 1) : this.track.value - (index < this.track.value ? 1 : 0)
    batch(() => {
      this.tracks.value = tracks
      this.track.value = Math.max(0, next)
    })
    await setTracks(this.bookID, tracks)
    await deleteTrackFile(track.id)
    if (current && tracks.length) await this.prepare(this.track.value, 0)
    else if (!current && this.loaded !== null) this.loaded = this.track.value
    if (tracks.length) void this.savePosition()
  }

  async removeAll() {
    this.unload()
    await deleteAudio(this.bookID)
    batch(() => {
      this.tracks.value = []
      this.track.value = 0
      this.time.value = 0
      this.duration.value = 0
    })
  }

  // MARK: Element events

  /** Events of the silent unlock clip or of a file that was already replaced are ignored. */
  private get ownsElement(): boolean {
    return this.loaded !== null && this.objectURL !== null && this.audio.src === this.objectURL
  }

  private readonly onMetadata = () => {
    if (!this.ownsElement) return
    const audio = this.audio
    if (this.pendingSeek !== null) {
      const target = Math.min(this.pendingSeek, Number.isFinite(audio.duration) ? Math.max(0, audio.duration - 0.25) : this.pendingSeek)
      this.pendingSeek = null
      audio.currentTime = target
      this.time.value = target
    }
    const duration = audio.duration
    if (!Number.isFinite(duration) || duration <= 0) return
    this.duration.value = duration
    const index = this.loaded
    const track = index === null ? undefined : this.tracks.value[index]
    if (track && track.duration !== duration) {
      const tracks = this.tracks.value.map((t, i) => (i === index ? { ...t, duration } : t))
      this.tracks.value = tracks
      void setTracks(this.bookID, tracks)
    }
  }

  private readonly onTime = () => {
    if (!this.ownsElement || this.pendingSeek !== null) return
    this.time.value = this.audio.currentTime
    if (Date.now() - this.lastSave >= SAVE_INTERVAL_MS) void this.savePosition()
  }

  private readonly onPlaying = () => {
    if (!this.ownsElement) return
    this.state.value = 'playing'
    setMediaPlaybackState('playing')
    this.updatePosition()
  }

  /** Paused by the system (call, Siri, headphones out) or by the lock screen. */
  private readonly onPause = () => {
    if (this.ownsElement && this.state.value === 'playing') {
      this.captureTime()
      this.state.value = 'paused'
      this.pausedAt = Date.now()
      setMediaPlaybackState('paused')
      void this.savePosition()
    }
  }

  private readonly onEnded = () => {
    if (!this.ownsElement) return
    if (this.track.value + 1 < this.tracks.value.length) {
      void this.selectTrack(this.track.value + 1).then(() => {
        if (this.state.value !== 'playing') this.start()
      })
      return
    }
    // End of the book: stay at the end of the last track.
    this.state.value = 'paused'
    setMediaPlaybackState('paused')
    void this.savePosition()
  }

  private readonly onError = () => {
    if (!this.ownsElement) return
    this.state.value = 'paused'
    this.error.value = `Файл «${this.tracks.value[this.loaded ?? -1]?.name ?? ''}» не відтворюється.`
  }

  // MARK: Session, place, cleanup

  private setSession() {
    setMediaSessionHandlers({
      play: () => this.play(),
      pause: () => this.pause(),
      seekbackward: () => this.skip(-SKIP_SECONDS),
      seekforward: () => this.skip(SKIP_SECONDS),
      seekto: (time) => this.seek(time),
      previoustrack: () => void this.selectTrack(this.track.value - 1),
      nexttrack: () => void this.selectTrack(this.track.value + 1),
    }, this.tracks.value.length > 1 ? `${this.title} · ${this.track.value + 1}/${this.tracks.value.length}` : this.title)
  }

  private updatePosition() {
    setMediaPosition(this.duration.value, this.time.value, this.rate.value)
  }

  async savePosition() {
    if (!this.hasAudio) return
    this.lastSave = Date.now()
    await saveAudioPosition(this.bookID, { track: this.track.value, time: this.time.value, rate: this.rate.value })
  }

  private unload() {
    this.loadToken++
    if (this.element) {
      this.element.pause()
      this.element.removeAttribute('src')
    }
    this.loaded = null
    this.pendingSeek = null
    this.releaseURL()
    if (this.state.value !== 'idle') this.state.value = 'paused'
  }

  private releaseURL() {
    if (this.objectURL) URL.revokeObjectURL(this.objectURL)
    this.objectURL = null
  }

  /** Leaving the reader: saves the place and frees the file. */
  dispose() {
    if (this.hasAudio && this.loaded !== null) void this.savePosition()
    this.disposed = true
    this.unload()
    if (this.element) {
      this.element.removeEventListener('loadedmetadata', this.onMetadata)
      this.element.removeEventListener('timeupdate', this.onTime)
      this.element.removeEventListener('ended', this.onEnded)
      this.element.removeEventListener('playing', this.onPlaying)
      this.element.removeEventListener('pause', this.onPause)
      this.element.removeEventListener('error', this.onError)
    }
    this.state.value = 'idle'
    setMediaPlaybackState('none')
  }
}
