// Checks of the English configuration (src/core/language.ts); the shared tests are the same in Polish Reader.
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import * as prompts from '../../src/core/ai/prompts.ts'
import { importBook } from '../../src/core/import/importer.ts'
import { sentences } from '../../src/core/model/segmenter.ts'
import { bestVoice } from '../../src/core/speech/system-speech.ts'
import { defaultExplanationTemplate } from '../../src/core/storage/settings.ts'
import { dictionaryURL } from '../../src/ui/word/dictionaries.ts'

describe('English Reader: verbatim Swift strings', () => {
  const file = 'build/swift-strings.json'
  const strings = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : null

  it.skipIf(!strings)('prompts match the Swift sources (run scripts/extract-swift-strings.ts first)', () => {
    expect(prompts.translationSystemPrompt).toBe(strings.translationSystemPrompt)
    expect(prompts.wordCardSystemPrompt).toBe(strings.wordCardSystemPrompt)
    expect(prompts.explanationSystemPrompt).toBe(strings.explanationSystemPrompt)
    expect(prompts.speechInstructions).toBe(strings.speechInstructions)
    expect(prompts.explanationDefaultTemplate).toBe(strings.explanationDefaultTemplate)
    expect(defaultExplanationTemplate).toBe(strings.explanationDefaultTemplate)
  })
})

describe('English Reader: external dictionaries (ServiceTests.testExternalDictionaryURLs)', () => {
  it('builds the same URLs as the Swift app', () => {
    expect(dictionaryURL('cambridge', 'Look up')).toBe('https://dictionary.cambridge.org/dictionary/english-ukrainian/look-up')
    expect(dictionaryURL('reverso', 'look up')).toBe('https://context.reverso.net/translation/english-ukrainian/look%20up')
    expect(dictionaryURL('google', 'look up')).toBe('https://translate.google.com/?sl=en&tl=uk&text=look%20up&op=translate')
    expect(dictionaryURL('urban', 'a/b?c')).toBe('https://www.urbandictionary.com/define.php?term=a/b?c')
    expect(dictionaryURL('glosbe', 'a/b')).toBe('https://glosbe.com/en/uk/a%2Fb')
    expect(dictionaryURL('forvo', 'book')).toBe('https://forvo.com/word/book/#en')
    expect(dictionaryURL('deepl', 'book')).toBe('https://www.deepl.com/translator#en/uk/book')
    expect(dictionaryURL('oxford', 'book')).toBe('https://www.oxfordlearnersdictionaries.com/search/english/?q=book')
    expect(dictionaryURL('merriamWebster', "don't")).toBe("https://www.merriam-webster.com/dictionary/don't")
  })
})

describe('English Reader: demo book (ImportTests.testBundledDemoBookImports)', () => {
  it('keeps the chapters and sentences of the native import', async () => {
    const data = new Uint8Array(readFileSync(resolve(process.cwd(), 'public/demo.md')))
    const book = await importBook(data, 'md', 'demo')
    expect(book.chapters.map((c) => c.title)).toEqual(['A Scandal in Bohemia', 'The Red-Headed League'])
    const opening = book.chapters[0].paragraphs.find((p) => p.kind === 'text')!
    expect(opening.sentences[0]).toBe('To Sherlock Holmes she is always the woman.')
    const allSentences = book.chapters.flatMap((c) => c.paragraphs.flatMap((p) => p.sentences))
    expect(allSentences.some((s) => s.startsWith('I had called upon my friend, Mr. Sherlock Holmes,'))).toBe(true)
  })
})

describe('English Reader: segmentation', () => {
  it('a dialogue dash does not start a new sentence', () => {
    expect(sentences('"Is it you?" — he asked.')).toEqual(['"Is it you?" — he asked.'])
    expect(sentences('Who? — Holmes.')).toEqual(['Who? — Holmes.'])
  })
})

describe('English Reader: system voice', () => {
  it('prefers higher-quality voices, then British English', () => {
    const voice = (name: string, lang: string, localService = true) => ({ name, lang, localService }) as SpeechSynthesisVoice
    const voices = [voice('Daniel', 'en-GB'), voice('Samantha (Enhanced)', 'en-US'), voice('Thomas', 'fr-FR')]
    expect(bestVoice(voices)?.name).toBe('Samantha (Enhanced)')
    expect(bestVoice([voice('Alex', 'en-US'), voice('Daniel', 'en-GB')])?.name).toBe('Daniel')
  })
})
