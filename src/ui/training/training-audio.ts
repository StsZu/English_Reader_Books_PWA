// Port of TrainingAudio (TrainingView.swift): word audio for training with the chosen voice,
// prepared in advance, and the system voice as fallback (T3).
import { signal } from '@preact/signals'
import { isAbort } from '../../contracts.ts'
import { testFlags } from '../../app/test-mode.ts'
import { settings } from '../../core/storage/settings.ts'
import { currentVoiceEngine, fallbackNotice } from '../../core/speech/engines.ts'
import { OpenAISpeechEngine } from '../../core/speech/openai-speech.ts'
import { SystemSpeechEngine } from '../../core/speech/system-speech.ts'

/** Headless test browsers have no system voices: in test mode the system voice "speaks" for a short time. */
const fakeSystemVoice = () => __TEST_MODE__ && (testFlags.recording || testFlags.speech)

export class TrainingAudio {
  readonly notice = signal<string | null>(null)
  private useAI = true
  private readonly ai = new OpenAISpeechEngine('coral', 'gpt-4o-mini-tts', 1)
  private readonly system = new SystemSpeechEngine(0.8)
  private generation = 0
  private cancelFake: (() => void) | null = null

  configure() {
    this.useAI = currentVoiceEngine() === 'openAI'
    this.ai.voice = settings.openAIVoice.value
    this.ai.model = settings.ttsModel.value
    this.ai.rate = settings.speechRate.value
    this.system.rate = Math.min(1, settings.speechRate.value) * 0.8
  }

  prefetch(words: string[]) {
    if (!this.useAI) return
    for (const word of words) this.ai.prefetch(word)
  }

  speak(text: string) {
    this.stop()
    void this.say(text)
  }

  /** Speaks and resolves when the word has been heard; false when speech was stopped before the end. */
  async say(text: string): Promise<boolean> {
    const generation = this.generation
    if (this.useAI) {
      try {
        await this.ai.speak(text, () => {})
        return generation === this.generation
      } catch (error) {
        if (isAbort(error) || generation !== this.generation) return false
        this.notice.value = fallbackNotice(error)
      }
    }
    if (fakeSystemVoice()) {
      this.cancelFake?.()
      return new Promise<boolean>((resolve) => {
        const timer = setTimeout(() => { this.cancelFake = null; resolve(generation === this.generation) }, 300)
        this.cancelFake = () => { clearTimeout(timer); this.cancelFake = null; resolve(false) }
      })
    }
    try {
      await this.system.speak(text, () => {})
      return generation === this.generation
    } catch {
      return false
    }
  }

  stop() {
    this.generation++
    this.cancelFake?.()
    this.ai.stop()
    this.system.stop()
  }
}
