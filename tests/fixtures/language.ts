// Language data of the shared tests: the demo book (public/demo.md) and the words the scenarios touch.
// This file and tests/unit/language.test.ts are the only tests that differ from Polish Reader.
import type { WordCard } from '../../src/contracts.ts'

export const demoBook = {
  title: 'The Adventures of Sherlock Holmes (excerpt)',
  author: 'Arthur Conan Doyle',
  /** The second chapter in «Зміст» and the start of its first text paragraph (data-p="1"). */
  secondChapter: 'The Red-Headed League',
  secondChapterText: 'I had called upon my friend',
  /** The first text paragraph of chapter 1 (data-p). */
  paragraph: 2,
  /** A word of each of its sentences 0, 1 and 2. */
  words: ['woman', 'seldom', 'eclipses'] as const,
  /** Long-press drags inside that paragraph: across a sentence boundary and backwards; `count` — selected words. */
  forwardFragment: { from: 'woman', to: 'seldom', count: 4 },
  backwardFragment: { from: 'heard', to: 'have', count: 3 },
  /** A paragraph below the first screen of an 834×500 viewport; `nextChapter` — open chapter 2 first. */
  position: { nextChapter: false, paragraph: 4, status: 'Розділ 1 з 2 · абзац 5' },
}

/** A looked-up word for the word-card unit test. */
export const sampleWord = 'woman'
export const sampleSentence = 'To Sherlock Holmes she is always the woman.'
export const sampleCard: WordCard = {
  headword: 'woman', lemma: 'woman', ipa: 'ˈwʊmən', partOfSpeech: 'іменник', contextTranslation: 'жінка',
  otherTranslations: ['дружина', 'служниця'], note: '', level: 'A1', forms: 'woman — women', irregular: true,
}
