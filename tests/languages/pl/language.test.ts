// Checks of the Polish configuration (src/core/language.ts); the shared tests are the same in English Reader.
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import * as prompts from '../../../src/core/ai/prompts.ts'
import { importBook } from '../../../src/core/import/importer.ts'
import { isChapterHeading } from '../../../src/core/import/text.ts'
import { sentences, words } from '../../../src/core/model/segmenter.ts'
import { bestVoice } from '../../../src/core/speech/system-speech.ts'
import { allDictionaries, defaultExplanationTemplate } from '../../../src/core/storage/settings.ts'
import { dictionaryURL } from '../../../src/ui/word/dictionaries.ts'

describe('Polish Reader: prompts', () => {
  const file = 'build/swift-strings.json'
  const strings = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : null

  // Polish Reader adapts the prompts (specs/002-polish); the JSON contract of every request stays the Swift one.
  it.skipIf(!strings)('prompts keep the Swift JSON contract and are adapted to Polish', () => {
    const keys = (text: string) => [...text.matchAll(/"([a-z_]+)":/g)].map((m) => m[1]).sort()
    expect(keys(prompts.translationSystemPrompt)).toEqual(keys(strings.translationSystemPrompt))
    expect(keys(prompts.wordCardSystemPrompt)).toEqual(keys(strings.wordCardSystemPrompt))
    expect(keys(prompts.explanationSystemPrompt)).toEqual(keys(strings.explanationSystemPrompt))
    for (const text of [prompts.translationSystemPrompt, prompts.wordCardSystemPrompt, prompts.explanationSystemPrompt, prompts.speechInstructions]) {
      expect(text).toContain('Polish')
      expect(text).not.toContain('English')
    }
    expect(prompts.explanationDefaultTemplate).toContain('{слово}')
    expect(prompts.explanationDefaultTemplate).toContain('{контекст}')
    expect(prompts.explanationDefaultTemplate).toContain('польськ')
    expect(defaultExplanationTemplate).toBe(prompts.explanationDefaultTemplate)
  })
})

// Ported from ServiceTests.testExternalDictionaryURLs with the Polish dictionary set (specs/002-polish).
describe('Polish Reader: external dictionaries', () => {
  it('builds Polish dictionary URLs with the same encoding rules', () => {
    expect(dictionaryURL('wikislownik', 'dać spokój')).toBe('https://pl.wiktionary.org/wiki/da%C4%87_spok%C3%B3j')
    expect(dictionaryURL('sjp', 'książka')).toBe('https://sjp.pwn.pl/szukaj/ksi%C4%85%C5%BCka.html')
    expect(dictionaryURL('wiktionary', 'kot')).toBe('https://en.wiktionary.org/wiki/kot#Polish')
    expect(dictionaryURL('glosbe', 'a/b')).toBe('https://glosbe.com/pl/uk/a%2Fb')
    expect(dictionaryURL('google', 'dać spokój')).toBe('https://translate.google.com/?sl=pl&tl=uk&text=da%C4%87%20spok%C3%B3j&op=translate')
    expect(dictionaryURL('deepl', 'kot')).toBe('https://www.deepl.com/translator#pl/uk/kot')
    expect(dictionaryURL('reverso', 'dać spokój')).toBe('https://context.reverso.net/translation/polish-english/da%C4%87%20spok%C3%B3j')
    expect(dictionaryURL('forvo', 'kot')).toBe('https://forvo.com/word/kot/#pl')
    for (const id of allDictionaries) expect(new URL(dictionaryURL(id, 'cześć')!).protocol, id).toBe('https:')
  })
})

describe('Polish Reader: demo book', () => {
  it('«Latarnik»: headings, initials and dialogue', async () => {
    const data = new Uint8Array(readFileSync(resolve(process.cwd(), 'languages/pl/public/demo.md')))
    const book = await importBook(data, 'md', 'demo')
    expect(book.chapters.map((c) => c.title)).toEqual(['Rozdział I', 'Rozdział II'])
    expect(book.chapters[0].paragraphs.slice(0, 2).map((p) => p.kind)).toEqual(['heading', 'heading'])
    const opening = book.chapters[0].paragraphs.filter((p) => p.kind === 'text')
    // The initial «J. Horain» does not end the sentence.
    expect(opening[0].sentences).toHaveLength(1)
    expect(opening[1].sentences[0]).toBe('Pewnego razu zdarzyło się, że latarnik w Aspinwall, niedaleko Panamy, przepadł bez wieści.')
    const dialogue = book.chapters[1].paragraphs.map((p) => p.sentences.join(' '))
    expect(dialogue).toContain('— Skąd jesteście?')
  })
})

describe('Polish Reader: chapter headings in TXT', () => {
  it('rozdział, część, księga, tom, prolog, epilog', () => {
    for (const heading of ['Rozdział I', 'ROZDZIAŁ PIERWSZY', 'Część druga', 'Księga trzecia: Wojna', 'Tom II', 'Prolog', 'Epilog', 'Chapter 3']) {
      expect(isChapterHeading(heading), heading).toBe(true)
    }
    for (const text of ['Rozdziałka była mała.', 'Tomek poszedł do domu.', 'Prologiem tej historii był list.']) {
      expect(isChapterHeading(text), text).toBe(false)
    }
  })
})

// Polish Reader (specs/002-polish): Polish abbreviations, initials and dialogue.
describe('Polish Reader: segmentation', () => {
  it('не розриває після польських скорочень та ініціалів', () => {
    expect(sentences('Mieszkał przy ul. Długiej obok kościoła św. Jana. Potem wyjechał.'))
      .toEqual(['Mieszkał przy ul. Długiej obok kościoła św. Jana.', 'Potem wyjechał.'])
    expect(sentences('Wykład prowadził prof. Nowak, a pisał o tym J. Horain. Było późno.'))
      .toEqual(['Wykład prowadził prof. Nowak, a pisał o tym J. Horain.', 'Było późno.'])
    expect(sentences('Pisał o tym I. Krasicki. Potem wyjechał.')).toEqual(['Pisał o tym I. Krasicki.', 'Potem wyjechał.'])
    expect(sentences('Kupił różne owoce, np. Jabłka i gruszki.')).toEqual(['Kupił różne owoce, np. Jabłka i gruszki.'])
  })

  it('розриває після скорочень, що зазвичай закінчують речення', () => {
    expect(sentences('Zabrał książki, zeszyty itd. Potem wyszedł.')).toEqual(['Zabrał książki, zeszyty itd.', 'Potem wyszedł.'])
    expect(sentences('Stało się to w 1830 r. Polacy walczyli długo.')).toEqual(['Stało się to w 1830 r.', 'Polacy walczyli długo.'])
  })

  it('репліки з тире й «nr» перед числом', () => {
    expect(sentences('— Skąd jesteście? — Jestem Polak.')).toEqual(['— Skąd jesteście?', '— Jestem Polak.'])
    expect(sentences('— Tułałem się — odpowiedział.')).toEqual(['— Tułałem się — odpowiedział.'])
    expect(sentences('Mieszkam w domu nr. 7 przy rynku.')).toEqual(['Mieszkam w domu nr. 7 przy rynku.'])
  })

  it('слова з польськими літерами — цілі', () => {
    expect(words('Zażółć gęślą jaźń, ćma!')).toEqual(['Zażółć', 'gęślą', 'jaźń', 'ćma'])
  })
})

describe('Polish Reader: system voice', () => {
  it('prefers higher-quality Polish voices, then pl-PL', () => {
    const voice = (name: string, lang: string, localService = true) => ({ name, lang, localService }) as SpeechSynthesisVoice
    const voices = [voice('Zosia', 'pl-PL'), voice('Ewa (Enhanced)', 'pl-PL'), voice('Daniel (Enhanced)', 'en-GB')]
    expect(bestVoice(voices)?.name).toBe('Ewa (Enhanced)')
    expect(bestVoice([voice('Daniel', 'en-GB'), voice('Zosia', 'pl_PL')])?.name).toBe('Zosia')
    expect(bestVoice([voice('Daniel', 'en-GB')])).toBeNull()
  })
})
