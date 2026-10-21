// Port of SystemSpeechEngine (AVSpeechSynthesizer) on the Web Speech API. Works offline and without a key.
import { abortError, type SpeechEngine } from '../../contracts.ts'

export const NO_SYSTEM_VOICE = 'Системний голос недоступний у цьому браузері.'

const synth = (): SpeechSynthesis | null => ('speechSynthesis' in globalThis ? globalThis.speechSynthesis : null)

/** Best English voice: higher quality first (Premium, Enhanced, on-device), then en-GB. */
export function bestEnglishVoice(voices: SpeechSynthesisVoice[] = synth()?.getVoices() ?? []): SpeechSynthesisVoice | null {
  const english = voices.filter((v) => v.lang.toLowerCase().replace('_', '-').startsWith('en'))
  const quality = (v: SpeechSynthesisVoice) =>
    (/premium/i.test(v.name) ? 4 : /enhanced|neural|natural/i.test(v.name) ? 2 : 0) + (v.localService ? 1 : 0)
  const british = (v: SpeechSynthesisVoice) => (v.lang.replace('_', '-').toLowerCase() === 'en-gb' ? 0 : 1)
  const ranked = [...english].sort((a, b) => quality(b) - quality(a) || british(a) - british(b))
  return ranked[0] ?? null
}

/** WebKit's pause/resume is unreliable (V-08): if speech does not continue in time, the phrase restarts. */
const RESUME_WATCHDOG_MS = 1000

/** Rough speaking speed at rate 1, used to notice a phrase whose end event never came. */
const CHARS_PER_SECOND = 14

/** Longest a phrase may take before it is treated as stuck: twice the estimate plus 5 s. */
export function phraseLimitMs(text: string, rate: number): number {
  return (text.length / (CHARS_PER_SECOND * Math.max(0.5, rate))) * 2000 + 5000
}

export class SystemSpeechEngine implements SpeechEngine {
  private pending: { resolve: () => void; reject: (e: unknown) => void } | null = null
  private utterance: SpeechSynthesisUtterance | null = null
  private text = ''
  private paused = false
  private watchdog: ReturnType<typeof setTimeout> | null = null
  private endWatchdog: ReturnType<typeof setInterval> | null = null

  constructor(public rate: number) {}

  speak(text: string, onStart: () => void): Promise<void> {
    this.stop()
    const speech = synth()
    if (!speech) return Promise.reject(new Error(NO_SYSTEM_VOICE))
    this.text = text
    return new Promise<void>((resolve, reject) => {
      this.pending = { resolve, reject }
      onStart()
      this.start(speech)
    })
  }

  private start(speech: SpeechSynthesis) {
    const utterance = new SpeechSynthesisUtterance(this.text)
    const voice = bestEnglishVoice()
    if (voice) utterance.voice = voice
    utterance.lang = voice?.lang ?? 'en-GB'
    utterance.rate = Math.min(2, Math.max(0.5, this.rate))
    utterance.onend = () => this.finish(utterance)
    utterance.onerror = (event) => {
      if (utterance !== this.utterance) return
      const pending = this.pending
      this.clear()
      // Cut off by another phrase or by the system, not by stop(): the caller decides what to do next.
      if (event.error === 'interrupted' || event.error === 'canceled') pending?.reject(abortError())
      else pending?.reject(new Error(`${NO_SYSTEM_VOICE} (${event.error})`))
    }
    utterance.onresume = () => this.clearWatchdog()
    utterance.onboundary = () => this.clearWatchdog()
    this.utterance = utterance
    speech.speak(utterance)
    if (this.paused) speech.pause()
    this.watchEnd(speech, utterance)
  }

  /** WebKit sometimes never sends `end`: finish when speech went quiet, fail when it runs far too long. */
  private watchEnd(speech: SpeechSynthesis, utterance: SpeechSynthesisUtterance) {
    this.clearEndWatchdog()
    const limit = phraseLimitMs(this.text, utterance.rate)
    let elapsed = 0
    let quiet = 0
    this.endWatchdog = setInterval(() => {
      if (utterance !== this.utterance || this.paused) return
      elapsed += 1000
      quiet = speech.speaking || speech.pending ? 0 : quiet + 1000
      if (quiet >= 2000) {
        this.finish(utterance)
      } else if (elapsed >= limit) {
        const pending = this.pending
        this.clear()
        speech.cancel()
        pending?.reject(new Error(`${NO_SYSTEM_VOICE} (не відповідає)`))
      }
    }, 1000)
  }

  prefetch() {}

  pause() {
    this.paused = true
    this.clearWatchdog()
    synth()?.pause()
  }

  resume() {
    this.paused = false
    const speech = synth()
    if (!speech || !this.utterance) return
    speech.resume()
    this.clearWatchdog()
    this.watchdog = setTimeout(() => {
      this.watchdog = null
      if (!this.utterance || this.paused) return
      if (speech.paused || !speech.speaking) {
        // Restart the current phrase from its beginning.
        const old = this.utterance
        this.utterance = null
        old.onend = null
        old.onerror = null
        speech.cancel()
        this.start(speech)
      }
    }, RESUME_WATCHDOG_MS)
  }

  stop() {
    const pending = this.pending
    const speech = synth()
    const hadUtterance = this.utterance !== null
    this.clear()
    this.paused = false
    if (speech && hadUtterance && (speech.speaking || speech.pending || speech.paused)) speech.cancel()
    pending?.reject(abortError())
  }

  private finish(utterance: SpeechSynthesisUtterance) {
    if (utterance !== this.utterance) return
    const pending = this.pending
    this.clear()
    pending?.resolve()
  }

  private clear() {
    this.clearWatchdog()
    this.clearEndWatchdog()
    this.pending = null
    this.utterance = null
  }

  private clearEndWatchdog() {
    if (this.endWatchdog) clearInterval(this.endWatchdog)
    this.endWatchdog = null
  }

  private clearWatchdog() {
    if (this.watchdog) clearTimeout(this.watchdog)
    this.watchdog = null
  }
}

/** Voices load asynchronously in Safari; call once at startup so the first phrase uses the best voice. */
export function warmUpVoices() {
  const speech = synth()
  if (!speech) return
  speech.getVoices()
  speech.addEventListener?.('voiceschanged', () => speech.getVoices(), { once: true })
}
