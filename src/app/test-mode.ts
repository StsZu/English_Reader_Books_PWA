// Test fixtures (FR-33): analogues of the native -uiTest* launch arguments.
// Only parsed when __TEST_MODE__ is true (dev and `--mode test` builds); production builds drop this code.

export interface TestFlags {
  reset: boolean
  translation: boolean
  speech: boolean
  wordCard: boolean
  savedWords: boolean
  recording: boolean
  voice: 'openAI' | 'system' | null
  importPath: string | null
  /** OpenAI key injected only for live tests. */
  key: string | null
  installHint: boolean
}

const none: TestFlags = {
  reset: false, translation: false, speech: false, wordCard: false, savedWords: false, recording: false,
  voice: null, importPath: null, key: null, installHint: false,
}

function parse(): TestFlags {
  if (!__TEST_MODE__) return none
  const params = new URLSearchParams(location.search)
  const voice = params.get('voice')
  return {
    reset: params.has('reset'),
    translation: params.has('testTranslation'),
    speech: params.has('testSpeech'),
    wordCard: params.has('testWordCard'),
    savedWords: params.has('testSavedWords'),
    recording: params.has('testRecording'),
    voice: voice === 'openAI' || voice === 'system' ? voice : null,
    importPath: params.get('import'),
    key: params.get('key'),
    installHint: params.has('installHint'),
  }
}

export const testFlags: TestFlags = parse()
