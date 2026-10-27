// One audio element for the whole app (analogue of the shared AVAudioSession): iOS allows sound
// only after a user gesture, and reusing the element unlocked by that gesture keeps later playback allowed.
import { abortError } from '../../contracts.ts'
import { appName } from '../language.ts'

/** Playback backend; replaced in unit tests, where happy-dom cannot decode audio. */
export interface AudioBackend {
  /** Plays the URL; resolves on end, rejects with AbortError on stop, with another error when it cannot play. */
  play(url: string, rate: number, onStart: () => void): Promise<void>
  pause(): void
  resume(): void
  stop(): void
}

/** Playback that has not moved for this long while it should be playing is reported as stuck. */
export const STALL_TIMEOUT_MS = 15_000

const SILENCE = 'data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAIA+AAACABAAZGF0YQAAAAA='

class ElementBackend implements AudioBackend {
  private element: HTMLAudioElement | null = null
  private pending: { resolve: () => void; reject: (e: unknown) => void; cleanup: () => void } | null = null
  private paused = false

  get audio(): HTMLAudioElement {
    if (!this.element) {
      this.element = new Audio()
      this.element.preload = 'auto'
      this.element.setAttribute('playsinline', '')
    }
    return this.element
  }

  play(url: string, rate: number, onStart: () => void): Promise<void> {
    this.stop()
    const audio = this.audio
    return new Promise<void>((resolve, reject) => {
      const onEnded = () => finish(() => resolve())
      const onError = () => finish(() => reject(new Error('аудіо не відтворюється')))
      // Paused by the system (call, Siri, headphones out) rather than by us: the caller resumes later.
      const onPause = () => {
        if (!this.paused && !audio.ended) finish(() => reject(abortError()))
      }
      let lastTime = -1
      let lastMove = Date.now()
      const watchdog = setInterval(() => {
        if (this.paused || audio.ended) {
          lastMove = Date.now()
          return
        }
        if (audio.currentTime !== lastTime) {
          lastTime = audio.currentTime
          lastMove = Date.now()
        } else if (Date.now() - lastMove >= STALL_TIMEOUT_MS) {
          finish(() => reject(new Error('аудіо зависло')))
        }
      }, 1000)
      const cleanup = () => {
        clearInterval(watchdog)
        audio.removeEventListener('ended', onEnded)
        audio.removeEventListener('error', onError)
        audio.removeEventListener('pause', onPause)
      }
      const finish = (action: () => void) => {
        if (this.pending?.cleanup !== cleanup) return
        this.pending = null
        cleanup()
        action()
      }
      this.pending = { resolve, reject, cleanup }
      audio.addEventListener('ended', onEnded)
      audio.addEventListener('error', onError)
      audio.addEventListener('pause', onPause)
      audio.src = url
      audio.playbackRate = rate
      audio.defaultPlaybackRate = rate
      if (this.paused) {
        onStart()
        return
      }
      audio.play().then(onStart, (error: unknown) => {
        const name = (error as { name?: string })?.name
        // AbortError: our own pause() before playback began — resume() starts it again.
        if (name === 'AbortError' && this.paused) return
        // Interrupted, or iOS refused to start without a tap: the caller resumes on the next tap.
        if (name === 'AbortError' || name === 'NotAllowedError') finish(() => reject(abortError()))
        else finish(() => reject(error instanceof Error ? error : new Error('аудіо не відтворюється')))
      })
    })
  }

  pause() {
    this.paused = true
    this.element?.pause()
  }

  resume() {
    this.paused = false
    const pending = this.pending
    if (!pending) return
    this.element?.play().catch(() => {
      // Could not continue (no tap, interrupted): give the audio back so the caller can restart.
      if (this.paused || this.pending !== pending) return
      this.pending = null
      pending.cleanup()
      pending.reject(abortError())
    })
  }

  stop() {
    this.paused = false
    const pending = this.pending
    this.pending = null
    if (this.element) {
      this.element.pause()
      this.element.removeAttribute('src')
    }
    if (pending) {
      pending.cleanup()
      pending.reject(abortError())
    }
  }

  unlock() {
    const audio = this.audio
    if (this.pending) return
    audio.src = SILENCE
    audio.play().catch(() => {})
  }
}

const elementBackend = new ElementBackend()
let backend: AudioBackend = elementBackend

export function setAudioBackend(next: AudioBackend | null) {
  backend = next ?? elementBackend
}

/** Call from a tap handler before the first sound so iOS allows later playback. */
export function unlockAudio() {
  if (backend === elementBackend) elementBackend.unlock()
  try {
    if ('speechSynthesis' in globalThis && !speechSynthesis.speaking) {
      const utterance = new SpeechSynthesisUtterance('')
      utterance.volume = 0
      speechSynthesis.speak(utterance)
    }
  } catch {
    // Speech synthesis is optional.
  }
}

/** Plays the URL with the shared element; resolves on end, AbortError on stop or signal abort. */
export function playURL(url: string, rate: number, onStart: () => void, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) return Promise.reject(abortError())
  const active = backend
  const onAbort = () => active.stop()
  signal?.addEventListener('abort', onAbort, { once: true })
  return active.play(url, rate, onStart).finally(() => signal?.removeEventListener('abort', onAbort))
}

export const pauseAudio = () => backend.pause()
export const resumeAudio = () => backend.resume()
export const stopAudio = () => backend.stop()

// MARK: - Media Session

export interface MediaSessionHandlers {
  play?: () => void
  pause?: () => void
  stop?: () => void
  /** Audiobook controls on the lock screen. */
  seekbackward?: () => void
  seekforward?: () => void
  seekto?: (time: number) => void
  previoustrack?: () => void
  nexttrack?: () => void
}

export function setMediaSessionHandlers(handlers: MediaSessionHandlers | null, title = appName) {
  const session = (navigator as Navigator & { mediaSession?: MediaSession }).mediaSession
  if (!session) return
  try {
    if (handlers) {
      session.metadata = typeof MediaMetadata !== 'undefined' ? new MediaMetadata({ title, artist: appName }) : null
    }
    const seekto = handlers?.seekto
    const actions: [MediaSessionAction, MediaSessionActionHandler | undefined][] = [
      ['play', handlers?.play], ['pause', handlers?.pause], ['stop', handlers?.stop],
      ['seekbackward', handlers?.seekbackward], ['seekforward', handlers?.seekforward],
      ['seekto', seekto ? (details) => { if (details.seekTime !== undefined) seekto(details.seekTime) } : undefined],
      ['previoustrack', handlers?.previoustrack], ['nexttrack', handlers?.nexttrack],
    ]
    for (const [action, handler] of actions) {
      try {
        session.setActionHandler(action, handler ?? null)
      } catch {
        // Not every action is supported everywhere.
      }
    }
  } catch {
    // Media Session is optional.
  }
}

/** Lock-screen progress of the audiobook. */
export function setMediaPosition(duration: number, position: number, playbackRate: number) {
  const session = (navigator as Navigator & { mediaSession?: MediaSession }).mediaSession
  try {
    if (session?.setPositionState && Number.isFinite(duration) && duration > 0) {
      session.setPositionState({ duration, position: Math.min(Math.max(0, position), duration), playbackRate })
    }
  } catch {
    // Not supported.
  }
}

export function setMediaPlaybackState(state: 'none' | 'paused' | 'playing') {
  const session = (navigator as Navigator & { mediaSession?: MediaSession }).mediaSession
  if (session) session.playbackState = state
}

// MARK: - Wake Lock (keeps the screen on while reading aloud, V-04)

let wakeLock: { release(): Promise<void> } | null = null

export async function acquireWakeLock() {
  try {
    const nav = navigator as Navigator & { wakeLock?: { request(type: 'screen'): Promise<{ release(): Promise<void> }> } }
    if (!wakeLock && nav.wakeLock) wakeLock = await nav.wakeLock.request('screen')
  } catch {
    wakeLock = null
  }
}

export async function releaseWakeLock() {
  const lock = wakeLock
  wakeLock = null
  try {
    await lock?.release()
  } catch {
    // Already released by the system.
  }
}
