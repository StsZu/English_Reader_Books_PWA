import type { WordCard } from '../../contracts.ts'
import type { SentenceRef } from '../../core/model/book.ts'

/** Port of ReaderViewModel.WordLookup: state of the open word card. */
export interface WordLookup {
  id: number
  word: string
  sentence: string
  ref: SentenceRef | null
  card: WordCard | null
  error: string | null
  needsSettings: boolean
  explanation: string | null
  explaining: boolean
  explanationError: string | null
  explanationNeedsSettings: boolean
}
