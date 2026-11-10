// Language data of the shared tests: the demo book (languages/<lang>/public/demo.md) and the words the scenarios touch.
// This file and tests/unit/language.test.ts are the only tests that differ from English Reader.
import type { WordCard } from '../../../src/contracts.ts'

export const demoBook = {
  title: 'Latarnik (fragment)',
  author: 'Henryk Sienkiewicz',
  /** The second chapter in «Зміст» and the start of its first text paragraph (data-p="1"). */
  secondChapter: 'Rozdział II',
  secondChapterText: '— Skąd jesteście?',
  /** The first text paragraph of chapter 1 (data-p). */
  paragraph: 3,
  /** A word of each of its sentences 0, 1 and 2. */
  words: ['latarnik', 'burzy', 'Przypuszczenie'] as const,
  /** Long-press drags inside that paragraph: across a sentence boundary and backwards; `count` — selected words. */
  forwardFragment: { from: 'wieści', to: 'stało', count: 3 },
  backwardFragment: { from: 'wśród', to: 'stało', count: 4 },
  /** A paragraph below the first screen of an 834×500 viewport; `nextChapter` — open chapter 2 first. */
  position: { nextChapter: true, paragraph: 10, status: 'Розділ 2 з 2 · абзац 11' },
}

/** A looked-up word for the word-card unit test. */
export const sampleWord = 'kobiety'
export const sampleSentence = 'Nie znał tej kobiety.'
export const sampleCard: WordCard = {
  headword: 'kobiety', lemma: 'kobieta', ipa: 'kɔˈbjɛta', partOfSpeech: 'іменник, жіночий рід', contextTranslation: 'жінки',
  otherTranslations: ['жінка', 'пані'], note: '', level: 'A1', forms: 'kobieta — kobiety — kobiety', irregular: false,
}
