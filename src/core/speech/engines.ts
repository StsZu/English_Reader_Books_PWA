// Engine factory and short pronunciations, as created in ReaderViewModel.swift and ReaderPanel.swift.
import { errorMessage, isAbort, type SpeechEngine, type VoiceEngineKind } from '../../contracts.ts'
import { sampleText } from '../language.ts'
import { testFlags } from '../../app/test-mode.ts'
import { settings } from '../storage/settings.ts'
import { OpenAISpeechEngine } from './openai-speech.ts'
import { SystemSpeechEngine } from './system-speech.ts'

/** Selected engine kind; the test-mode `?voice=` flag wins over the stored setting. */
export function currentVoiceEngine(): VoiceEngineKind {
  return testFlags.voice ?? settings.voiceEngine.value
}

/** Engine for reading the book and sentences aloud, with the current voice, model and rate. */
export function makeEngine(kind: VoiceEngineKind = currentVoiceEngine()): SpeechEngine {
  return kind === 'openAI'
    ? new OpenAISpeechEngine(settings.openAIVoice.value, settings.ttsModel.value, settings.speechRate.value)
    : new SystemSpeechEngine(settings.speechRate.value)
}

export const makeOpenAIEngine = (rate = settings.speechRate.value) =>
  new OpenAISpeechEngine(settings.openAIVoice.value, settings.ttsModel.value, rate)

/** Explanation shown when the AI voice fails and the system voice speaks instead. */
export const fallbackNotice = (error: unknown): string =>
  `ШІ-голос недоступний (${errorMessage(error) || 'помилка'}). Звучить системний голос.`

// Word pronunciation keeps its own slower speakers (rate 0.9 AI, 0.8 system), like the Swift app.
let wordSpeakerAI: OpenAISpeechEngine | null = null
let wordSpeakerSystem: SystemSpeechEngine | null = null

export interface PronounceResult {
  /** Set when the AI voice failed and the system voice was used. */
  fallbackReason?: string
}

/** Pronounces a word or phrase with the selected voice; falls back to the system voice on AI errors. */
export async function pronounceWord(text: string): Promise<PronounceResult> {
  stopPronunciation()
  let fallbackReason: string | undefined
  if (currentVoiceEngine() === 'openAI') {
    wordSpeakerAI ??= new OpenAISpeechEngine(settings.openAIVoice.value, settings.ttsModel.value, 0.9)
    wordSpeakerAI.voice = settings.openAIVoice.value
    wordSpeakerAI.model = settings.ttsModel.value
    try {
      await wordSpeakerAI.speak(text, () => {})
      return {}
    } catch (error) {
      if (isAbort(error)) return {}
      fallbackReason = fallbackNotice(error)
    }
  }
  wordSpeakerSystem ??= new SystemSpeechEngine(0.8)
  try {
    await wordSpeakerSystem.speak(text, () => {})
  } catch {
    // Stopped or no system voice: nothing more to do.
  }
  return { fallbackReason }
}

export function stopPronunciation() {
  wordSpeakerAI?.stop()
  wordSpeakerSystem?.stop()
}

export const SAMPLE_TEXT = sampleText

let sampleEngine: SpeechEngine | null = null

/** «Прослухати зразок»: returns an error message, or null when the sample played or was stopped. */
export async function playSample(): Promise<string | null> {
  sampleEngine?.stop()
  const engine = makeEngine()
  sampleEngine = engine
  try {
    await engine.speak(SAMPLE_TEXT, () => {})
    return null
  } catch (error) {
    return isAbort(error) ? null : errorMessage(error)
  }
}

export function stopSample() {
  sampleEngine?.stop()
  sampleEngine = null
}
