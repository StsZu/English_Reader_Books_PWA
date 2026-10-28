// Ported from EnglishReaderTests/ServiceTests.swift: the ReaderViewModel tests (parallel translation,
// saved words and quotes in the reader, fragment selection, sentence speech G4–G8).
// The Apple fallback tests are not ported: the PWA has no on-device translation (V-01).
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { AIError, abortError, type TranslationProvider } from '../../src/contracts.ts'
import type { Book, ParagraphRef, SentenceRef } from '../../src/core/model/book.ts'
import { setAudioBackend, type AudioBackend } from '../../src/core/speech/audio.ts'
import { OpenAISpeechEngine, silentWAV } from '../../src/core/speech/openai-speech.ts'
import { WordLookupService } from '../../src/core/ai/word.ts'
import { quotes, removeAllForTests, words } from '../../src/core/saved/saved.ts'
import { resetAllSettings, settings } from '../../src/core/storage/settings.ts'
import { FRAGMENT_LIMIT, ReaderModel, speechKeyID } from '../../src/ui/reader/model.ts'

// MARK: - Fakes

class MemoryCache {
  entries = new Map<string, ArrayBuffer>()
  async match(key: string) {
    const body = this.entries.get(key)
    return body ? new Response(body.slice(0)) : undefined
  }
  async put(key: string, response: Response) {
    this.entries.set(key, await response.arrayBuffer())
  }
  async delete(key: string) {
    return this.entries.delete(key)
  }
}
const memoryCaches = new Map<string, MemoryCache>()
Object.defineProperty(globalThis, 'caches', {
  configurable: true,
  value: {
    open: async (name: string) => {
      if (!memoryCaches.has(name)) memoryCaches.set(name, new MemoryCache())
      return memoryCaches.get(name)!
    },
  },
})

class FakeBackend implements AudioBackend {
  private pending: { resolve: () => void; reject: (e: unknown) => void } | null = null
  async play(_url: string, _rate: number, onStart: () => void) {
    this.stop()
    onStart()
    await new Promise<void>((resolve, reject) => {
      this.pending = { resolve, reject }
      setTimeout(() => {
        if (this.pending?.resolve === resolve) {
          this.pending = null
          resolve()
        }
      }, 20)
    })
  }
  pause() {}
  resume() {}
  stop() {
    const pending = this.pending
    this.pending = null
    pending?.reject(abortError())
  }
}

class RecordingProvider implements TranslationProvider {
  calls = 0
  constructor(private readonly delayFirst = false) {}
  async translate(sentences: string[]) {
    this.calls++
    if (this.delayFirst && sentences[0] === 'First sentence.') await sleep(100)
    return sentences.map((s) => `Переклад: ${s}`)
  }
}

class ScriptedProvider implements TranslationProvider {
  calls = 0
  constructor(private readonly failure: AIError | null, private readonly prefix: string, private readonly delay = 0) {}
  async translate(sentences: string[]) {
    this.calls++
    if (this.delay) await sleep(this.delay)
    if (this.failure) throw this.failure
    return sentences.map((s) => `${this.prefix}: ${s}`)
  }
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

async function waitUntil(condition: () => boolean, label = 'condition') {
  for (let i = 0; i < 300; i++) {
    if (condition()) return
    await sleep(10)
  }
  throw new Error(`${label} did not happen`)
}

function translationTestBook(): Book {
  return {
    id: crypto.randomUUID().toUpperCase(), title: 'Translation interaction', author: '', format: 'txt',
    importedAt: new Date().toISOString(),
    chapters: [{
      title: 'Chapter',
      paragraphs: [
        { kind: 'text', sentences: ['First sentence.', 'Another sentence.'] },
        { kind: 'text', sentences: ['Second paragraph.'] },
      ],
    }],
  }
}

const p0: ParagraphRef = { chapter: 0, paragraph: 0 }
const p1: ParagraphRef = { chapter: 0, paragraph: 1 }
const ref = (paragraph: ParagraphRef, sentence: number): SentenceRef => ({ paragraph, sentence })

async function waitForTranslation(model: ReaderModel, at: ParagraphRef) {
  await waitUntil(() => model.translationState(at)?.kind === 'done', 'translation')
}

function speechModel() {
  const counter = { calls: 0 }
  const engine = new OpenAISpeechEngine('coral', 'gpt-4o-mini-tts', 1)
  engine.cacheNamespace = `unit-${crypto.randomUUID()}`
  engine.synthesize = async () => {
    counter.calls++
    await sleep(100)
    return silentWAV(0.2)
  }
  const book = translationTestBook()
  const model = new ReaderModel(book, { provider: () => new RecordingProvider(), sentenceSpeaker: engine })
  return { model, counter, book }
}

async function waitForSpeechEnd(model: ReaderModel) {
  await waitUntil(() => model.sentenceSpeech.value === null, 'speech end')
}

beforeEach(() => {
  resetAllSettings()
  settings.showTranslation.value = true
  settings.voiceEngine.value = 'openAI'
  setAudioBackend(new FakeBackend())
  removeAllForTests()
})

afterEach(() => {
  setAudioBackend(null)
  WordLookupService.fixture = null
})

// MARK: - Parallel translation (stage 1.5)

describe('паралельний переклад', () => {
  it('testParallelTranslationStartsOnTapAndReusesParagraphCache', async () => {
    const provider = new RecordingProvider()
    const model = new ReaderModel(translationTestBook(), { provider: () => provider })
    expect(provider.calls).toBe(0)
    expect(model.activeSentence.value).toBeNull()
    const first = ref(p0, 0)
    model.handleWordTap('First', first)
    expect(model.activeSentence.value).toEqual(first)
    expect(model.wordLookup.value).toBeNull()
    await waitForTranslation(model, p0)
    const second = ref(p0, 1)
    model.handleWordTap('Another', second)
    expect(model.activeSentence.value).toEqual(second)
    expect(model.wordLookup.value).toBeNull()
    expect(provider.calls).toBe(1)
  })

  it('testLateTranslationKeepsNewSentenceActive', async () => {
    const model = new ReaderModel(translationTestBook(), { provider: () => new RecordingProvider(true) })
    model.handleWordTap('First', ref(p0, 0))
    model.handleWordTap('Second', ref(p1, 0))
    await waitForTranslation(model, p1)
    await sleep(150)
    expect(model.activeSentence.value).toEqual(ref(p1, 0))
  })

  it('testHidingTranslationDoesNotReopenAfterResponse', async () => {
    const provider = new RecordingProvider(true)
    const model = new ReaderModel(translationTestBook(), { provider: () => provider })
    model.handleWordTap('First', ref(p0, 0))
    model.hideParallelTranslation()
    await sleep(150)
    expect(model.activeSentence.value).toBeNull()
    model.handleWordTap('First', ref(p0, 0))
    expect(model.activeSentence.value).toEqual(ref(p0, 0))
    await waitForTranslation(model, p0)
    expect(provider.calls).toBeLessThanOrEqual(2)
  })

  it('немає ключа — одне повідомлення замість помилки на абзаці', async () => {
    const model = new ReaderModel(translationTestBook(), {
      provider: () => new ScriptedProvider(new AIError({ kind: 'missingKey' }), 'ШІ'),
    })
    model.handleWordTap('First', ref(p0, 0))
    await waitUntil(() => model.translationNotice.value !== null, 'notice')
    expect(model.translationNotice.value).toContain('Не вказано ключ OpenAI')
    expect(model.translationState(p0)).toBeUndefined()
  })

  it('інші помилки дають «Повторити» в абзаці', async () => {
    const model = new ReaderModel(translationTestBook(), {
      provider: () => new ScriptedProvider(new AIError({ kind: 'rateLimited' }), 'ШІ'),
    })
    model.handleWordTap('First', ref(p0, 0))
    await waitUntil(() => model.translationState(p0)?.kind === 'failed', 'failure')
    expect(model.translationNotice.value).toBeNull()
  })
})

// MARK: - Saved in the reader (stage 2.3)

describe('збережене в читалці', () => {
  it('testReaderSavesWordAndFragmentAndShowsPlace', async () => {
    WordLookupService.fixture = (word: string) => ({
      headword: word, lemma: word.toLowerCase(), ipa: '', partOfSpeech: '', contextTranslation: 'т',
      otherTranslations: [], note: '', level: '', forms: '', irregular: false,
    })
    const book = translationTestBook()
    const model = new ReaderModel(book, { provider: () => new ScriptedProvider(null, 'ШІ') })
    const at = ref(p0, 1)
    model.handleWordTap('Another', at)
    model.handleWordTap(`Another${crypto.randomUUID().slice(0, 4)}`, at)
    await waitUntil(() => model.wordLookup.value?.card != null, 'card')
    expect(model.isLookupSaved).toBe(false)
    model.toggleSaveWord()
    await waitUntil(() => model.isLookupSaved, 'saved')
    expect(words.value[0].contexts[0].place).toMatchObject({ chapter: 0, paragraph: 0, sentence: 1 })
    expect(words.value[0].contexts[0].sentence).toBe('Another sentence.')
    model.toggleSaveWord()
    await waitUntil(() => !model.isLookupSaved, 'removed')
    model.closeWordCard()

    await sleep(600)
    model.updateSelection(p0, { sentence: 0, word: 0 }, { sentence: 0, word: 1 })
    model.longPressEnded(null, null, true)
    await waitUntil(() => model.fragmentTranslation.value?.kind === 'done', 'fragment')
    model.saveFragment()
    await waitUntil(() => model.isFragmentSaved, 'quote saved')
    model.saveFragment()
    await waitUntil(() => !model.isFragmentSaved, 'quote removed')
    model.saveFragment()
    await waitUntil(() => model.isFragmentSaved, 'quote saved again')
    expect(quotes.value[0].translation).toBe('ШІ: First sentence')

    model.show({ bookID: book.id, bookTitle: book.title, chapter: 0, paragraph: 1, sentence: 0 })
    expect(model.topParagraph.value).toBe(1)
    expect(model.activeSentence.value).toEqual(ref(p1, 0))
    expect(model.selection.value).toBeNull()
  })
})

describe('вибір із клавіатури (specs/008, A3)', () => {
  it('↑ / ↓ ідуть реченнями розділу через межі абзаців і зупиняються на краях', async () => {
    const model = new ReaderModel(translationTestBook(), { provider: () => new RecordingProvider() })
    model.moveSentence(1)
    expect(model.activeSentence.value).toEqual(ref(p0, 0))
    await waitForTranslation(model, p0)
    const reveals = model.revealRequest.value
    model.moveSentence(1)
    model.moveSentence(1)
    expect(model.activeSentence.value).toEqual(ref(p1, 0))
    expect(model.revealRequest.value).toBe(reveals + 2)
    model.moveSentence(1)
    expect(model.activeSentence.value).toEqual(ref(p1, 0))
    model.moveSentence(-1)
    expect(model.activeSentence.value).toEqual(ref(p0, 1))
    model.moveSentence(-1)
    model.moveSentence(-1)
    expect(model.activeSentence.value).toEqual(ref(p0, 0))
  })

  it('курсор слова в межах речення, Enter — картка цього слова, нове речення прибирає курсор', async () => {
    WordLookupService.fixture = (word: string) => ({
      headword: word, lemma: word.toLowerCase(), ipa: '', partOfSpeech: '', contextTranslation: 'т',
      otherTranslations: [], note: '', level: '', forms: '', irregular: false,
    })
    const model = new ReaderModel(translationTestBook(), { provider: () => new RecordingProvider() })
    model.moveWord(1)
    expect(model.wordCursor.value).toBeNull()
    model.moveSentence(1)
    model.moveWord(-1)
    expect(model.wordCursor.value).toBe(1)
    model.moveWord(1)
    expect(model.wordCursor.value).toBe(1)
    model.moveWord(-1)
    model.moveWord(-1)
    expect(model.wordCursor.value).toBe(0)
    model.lookUpCursorWord()
    expect(model.wordLookup.value).toMatchObject({ word: 'First', sentence: 'First sentence.', ref: ref(p0, 0) })
    model.closeWordCard()
    model.moveSentence(1)
    expect(model.wordCursor.value).toBeNull()
  })
})

// MARK: - Fragment selection (stage 2.1)

describe('виділення фрагмента', () => {
  it('testFragmentTextFollowsWordBoundariesAcrossSentences', () => {
    const model = new ReaderModel(translationTestBook(), { provider: () => new RecordingProvider() })
    const one = model.fragmentText(p0, { sentence: 0, word: 0 }, { sentence: 0, word: 1 })
    expect(one).toEqual({ text: 'First sentence', context: 'First sentence.' })
    const two = model.fragmentText(p0, { sentence: 0, word: 1 }, { sentence: 1, word: 0 })
    expect(two).toEqual({ text: 'sentence. Another', context: 'First sentence. Another sentence.' })
  })

  it('testSelectionReplacesSentenceTranslatesOnceAndCaches', async () => {
    const ai = new ScriptedProvider(null, 'ШІ')
    const model = new ReaderModel(translationTestBook(), { provider: () => ai })
    model.handleWordTap('First', ref(p0, 0))
    expect(model.activeSentence.value).not.toBeNull()

    // Backward drag: the anchor is after the focus.
    model.longPressBegan()
    model.updateSelection(p0, { sentence: 1, word: 0 }, { sentence: 0, word: 1 })
    expect(model.activeSentence.value).toBeNull()
    expect(model.selection.value?.text).toBe('sentence. Another')
    expect(model.fragmentTranslation.value).toBeNull()
    model.longPressEnded(null, { sentence: 1, word: 0 }, true)
    await waitUntil(() => model.fragmentTranslation.value?.kind === 'done', 'fragment')
    expect(model.fragmentTranslation.value).toEqual({ kind: 'done', line: 'ШІ: sentence. Another' })
    const callsAfterFirst = ai.calls

    // The same fragment again comes from the cache.
    await sleep(600)
    model.longPressBegan()
    model.updateSelection(p0, { sentence: 0, word: 1 }, { sentence: 1, word: 0 })
    model.longPressEnded(null, { sentence: 0, word: 1 }, true)
    await waitUntil(() => model.fragmentTranslation.value?.kind === 'done', 'cached fragment')
    expect(ai.calls).toBe(callsAfterFirst)

    // A tap clears the fragment and selects the sentence (G1).
    await sleep(600)
    model.handleWordTap('Second', ref(p1, 0))
    expect(model.selection.value).toBeNull()
    expect(model.fragmentTranslation.value).toBeNull()
    expect(model.activeSentence.value).toEqual(ref(p1, 0))
  })

  it('testFragmentStopsGrowingAtLimit', () => {
    const list = Array.from({ length: 200 }, (_, i) => `word${i}`)
    const book: Book = {
      id: crypto.randomUUID(), title: 'Long', author: '', format: 'txt', importedAt: new Date().toISOString(),
      chapters: [{ title: 'C', paragraphs: [{ kind: 'text', sentences: [`${list.join(' ')}.`] }] }],
    }
    const model = new ReaderModel(book, { provider: () => new RecordingProvider() })
    model.updateSelection(p0, { sentence: 0, word: 0 }, { sentence: 0, word: 50 })
    const fitting = model.selection.value
    expect(fitting).not.toBeNull()
    model.updateSelection(p0, { sentence: 0, word: 0 }, { sentence: 0, word: 199 })
    expect(model.selection.value).toEqual(fitting)
    expect(model.selection.value!.text.length).toBeLessThanOrEqual(FRAGMENT_LIMIT)
  })

  it('testFragmentUsesAppleFallbackAndReportsKeyErrors (без Apple: недійсний ключ → «Налаштування», мережа → «Повторити»)', async () => {
    for (const [failure, expected] of [
      [new AIError({ kind: 'unauthorized' }), 'needsSettings'],
      [new AIError({ kind: 'offline' }), 'failed'],
    ] as const) {
      const model = new ReaderModel(translationTestBook(), { provider: () => new ScriptedProvider(failure, 'ШІ') })
      model.updateSelection(p0, { sentence: 0, word: 0 }, { sentence: 0, word: 1 })
      model.longPressEnded(null, null, true)
      await waitUntil(() => !!model.fragmentTranslation.value && model.fragmentTranslation.value.kind !== 'loading', 'result')
      expect(model.fragmentTranslation.value?.kind).toBe(expected)
    }
  })

  it('testClearedFragmentIgnoresLateTranslation', async () => {
    const model = new ReaderModel(translationTestBook(), { provider: () => new ScriptedProvider(null, 'ШІ', 200) })
    model.updateSelection(p0, { sentence: 0, word: 0 }, { sentence: 0, word: 1 })
    model.longPressEnded(null, null, true)
    expect(model.fragmentTranslation.value).toEqual({ kind: 'loading' })
    model.hideParallelTranslation()
    await sleep(400)
    expect(model.selection.value).toBeNull()
    expect(model.fragmentTranslation.value).toBeNull()
  })

  it('testFragmentSpeechUsesSavedAudio', async () => {
    const { model, counter } = speechModel()
    model.updateSelection(p0, { sentence: 0, word: 0 }, { sentence: 1, word: 0 })
    model.longPressEnded(null, null, true)
    const key = { kind: 'fragment', text: 'First sentence. Another' } as const
    await sleep(20)
    expect(model.canReplay(key)).toBe(false)
    model.speakFragment(false)
    expect(speechKeyID(model.sentenceSpeech.value!.key)).toBe(speechKeyID(key))
    await waitForSpeechEnd(model)
    expect(model.canReplay(key)).toBe(true)
    model.speakFragment(true)
    await waitForSpeechEnd(model)
    // A still long press on a selected word speaks the fragment too.
    await sleep(600)
    model.longPressBegan()
    model.longPressEnded(ref(p0, 0), { sentence: 0, word: 1 }, false)
    expect(speechKeyID(model.sentenceSpeech.value!.key)).toBe(speechKeyID(key))
    await waitForSpeechEnd(model)
    expect(counter.calls).toBe(1)
    expect(model.selection.value).not.toBeNull()
  })
})

// MARK: - Sentence speech (G4–G8)

describe('вимова речення', () => {
  it('testLongPressSpeaksOnlyTranslatedActiveSentenceAndReplaysCache', async () => {
    const { model, counter } = speechModel()
    const first = ref(p0, 0)
    const other = ref(p0, 1)
    const firstKey = { kind: 'sentence', ref: first } as const

    // G4 before selection: a long press only selects, without sound.
    model.longPressBegan()
    model.longPressEnded(first, null, false)
    expect(model.activeSentence.value).toEqual(first)
    expect(model.sentenceSpeech.value).toBeNull()
    await waitForTranslation(model, p0)
    expect(model.canReplay(firstKey)).toBe(false)

    // G4: long press on the translated sentence speaks it once.
    model.longPressBegan()
    model.longPressEnded(first, null, false)
    expect(model.sentenceSpeech.value?.key).toEqual(firstKey)
    // G7: the tap that ends the long press is ignored.
    model.handleWordTap('First', first)
    expect(model.wordLookup.value).toBeNull()
    // A second press while preparing does not create a second request.
    model.longPressBegan()
    model.longPressEnded(first, null, false)
    await waitForSpeechEnd(model)
    expect(counter.calls).toBe(1)
    expect(model.canReplay(firstKey)).toBe(true)

    // G5/G6: repeats use the saved file.
    await sleep(600)
    model.longPressBegan()
    model.longPressEnded(first, null, false)
    await waitForSpeechEnd(model)
    for (let i = 0; i < 2; i++) {
      model.speakSentence(first, true)
      expect(model.sentenceSpeech.value?.key).toEqual(firstKey)
      await waitForSpeechEnd(model)
    }
    expect(counter.calls).toBe(1)
    expect(model.sentenceSpeechNotice.value).toBeNull()

    // A press that moved without a selection does nothing.
    await sleep(600)
    model.longPressBegan()
    model.longPressEnded(other, null, true)
    expect(model.activeSentence.value).toEqual(first)
    expect(model.sentenceSpeech.value).toBeNull()

    // G3: another sentence becomes active; a long press there does not speak yet.
    model.longPressBegan()
    model.longPressEnded(other, null, false)
    expect(model.activeSentence.value).toEqual(other)
    expect(model.sentenceSpeech.value).toBeNull()
    expect(counter.calls).toBe(1)
  })

  it('testChangingSentenceStopsPendingSpeech', async () => {
    const { model, counter } = speechModel()
    const first = ref(p0, 0)
    const second = ref(p1, 0)
    model.handleWordTap('First', first)
    await waitForTranslation(model, p0)
    model.speakSentence(first, false)
    expect(model.sentenceSpeech.value?.phase).toBe('preparing')
    model.handleWordTap('Second', second)
    expect(model.sentenceSpeech.value).toBeNull()
    await sleep(500)
    expect(model.sentenceSpeech.value).toBeNull()
    expect(counter.calls).toBe(1)

    // Hiding the panel also stops speech.
    await waitForTranslation(model, p1)
    model.speakSentence(second, false)
    model.hideParallelTranslation()
    expect(model.sentenceSpeech.value).toBeNull()
  })

  it('testReplayWithoutSavedAudioDoesNotSynthesize', async () => {
    const { model, counter } = speechModel()
    const first = ref(p0, 0)
    model.handleWordTap('First', first)
    await waitForTranslation(model, p0)
    model.speakSentence(first, true)
    await waitForSpeechEnd(model)
    expect(counter.calls).toBe(0)
    expect(model.sentenceSpeechNotice.value).not.toBeNull()
  })
})

// MARK: - Settings defaults (testBookFontsAreInstalledAndSettingsHaveCurrentDefaults, settings part)

describe('пошук у книжці (specs/010-library, F4–F5)', () => {
  it('перехід до знайденого вибирає речення; «Повернутися» — до місця перед першим переходом', async () => {
    const book = translationTestBook()
    book.chapters.push({ title: 'Two', paragraphs: [{ kind: 'text', sentences: ['Far away.'] }, { kind: 'text', sentences: ['Further.'] }] })
    const model = new ReaderModel(book, { provider: () => new RecordingProvider() })
    model.topParagraph.value = 1
    model.showFound(ref({ chapter: 1, paragraph: 1 }, 0))
    expect(model.chapter.value).toBe(1)
    expect(model.topParagraph.value).toBe(1)
    expect(model.activeSentence.value).toEqual(ref({ chapter: 1, paragraph: 1 }, 0))
    expect(model.searchReturn.value).toEqual(p1)
    model.showFound(ref({ chapter: 1, paragraph: 0 }, 0))
    expect(model.searchReturn.value).toEqual(p1)
    model.returnFromSearch()
    expect(model.searchReturn.value).toBeNull()
    expect(model.chapter.value).toBe(0)
    expect(model.topParagraph.value).toBe(1)
    expect(model.activeSentence.value).toBeNull()
    model.showFound(ref({ chapter: 5, paragraph: 0 }, 0))
    expect(model.searchReturn.value).toBeNull()
  })
})

describe('типові налаштування', () => {
  it('testBookFontsAreInstalledAndSettingsHaveCurrentDefaults', async () => {
    const { isExpanded, toggleSection } = await import('../../src/core/storage/settings.ts')
    resetAllSettings()
    expect(settings.bookFont.value).toBe('system')
    expect(settings.fontSize.value).toBe(22)
    expect(settings.lineSpacingFactor.value).toBe(0.25)
    expect(settings.sideMargin.value).toBe(40)
    expect(settings.firstLineIndent.value).toBe(0)
    expect(settings.paragraphSpacingFactor.value).toBe(0.9)
    expect(settings.justifyText.value).toBe(false)
    expect(isExpanded('text')).toBe(true)
    toggleSection('pronunciation')
    toggleSection('text')
    expect(settings.expandedPanelSections.value).toBe('pronunciation')
    resetAllSettings()
  })
})
