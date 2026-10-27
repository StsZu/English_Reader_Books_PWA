// Port of ReaderView.swift → ParagraphView. Each sentence and word is its own element, so taps,
// long presses and selection resolve against what is drawn — including justified lines.
import { memo } from 'preact/compat'
import type { Paragraph as ParagraphData } from '../../core/model/book.ts'
import type { WordRange } from '../../core/model/segmenter.ts'
import { sourceLanguage } from '../../core/language.ts'

export interface ParagraphProps {
  index: number
  paragraph: ParagraphData
  wordRanges: (sentence: string) => WordRange[]
  /** Sentences highlighted as active or being read aloud. */
  highlighted: readonly number[]
  /** Selected fragment inside this paragraph as [sentence, word] bounds. */
  selection: { lower: [number, number]; upper: [number, number] } | null
  /** Word chosen from the keyboard (specs/008, A3). */
  wordCursor: { sentence: number; word: number } | null
  savedForms: ReadonlySet<string>
}

const inRange = (s: number, w: number, sel: ParagraphProps['selection']) =>
  !!sel && (s > sel.lower[0] || (s === sel.lower[0] && w >= sel.lower[1]))
    && (s < sel.upper[0] || (s === sel.upper[0] && w <= sel.upper[1]))

function ParagraphView({ index, paragraph, wordRanges, highlighted, selection, wordCursor, savedForms }: ParagraphProps) {
  const heading = paragraph.kind === 'heading'
  return (
    <p class={heading ? 'para heading' : 'para text'} data-p={index} data-testid={`paragraph-${index}`} lang={sourceLanguage}
      role={heading ? 'heading' : undefined} aria-level={heading ? 2 : undefined}>
      {paragraph.sentences.map((sentence, s) => {
        const ranges = wordRanges(sentence)
        const pieces = []
        let cursor = 0
        ranges.forEach((range, w) => {
          if (range.start > cursor) {
            const gapSelected = w > 0 && inRange(s, w - 1, selection) && inRange(s, w, selection)
            pieces.push(<span class={gapSelected ? 'g sel' : 'g'}>{sentence.slice(cursor, range.start)}</span>)
          }
          const word = sentence.slice(range.start, range.end)
          let cls = 'w'
          if (inRange(s, w, selection)) cls += ' sel'
          if (savedForms.size > 0 && savedForms.has(word.toLowerCase())) cls += ' saved'
          if (wordCursor && wordCursor.sentence === s && wordCursor.word === w) cls += ' cursor'
          pieces.push(<span class={cls} data-w={w}>{word}</span>)
          cursor = range.end
        })
        if (cursor < sentence.length) {
          // Trailing punctuation belongs to the band when the selection continues past this sentence.
          const tailSelected = ranges.length > 0 && inRange(s, ranges.length - 1, selection) && inRange(s + 1, 0, selection)
          pieces.push(<span class={tailSelected ? 'g sel' : 'g'}>{sentence.slice(cursor)}</span>)
        }
        const between = s > 0
          ? <span class={inRange(s - 1, Number.MAX_SAFE_INTEGER, selection) && inRange(s, 0, selection) ? 'g sel' : 'g'}> </span>
          : null
        return (
          <>
            {between}
            <span class={highlighted.includes(s) ? 's active' : 's'} data-s={s}>{pieces}</span>
          </>
        )
      })}
    </p>
  )
}

export const Paragraph = memo(ParagraphView, (a, b) =>
  a.paragraph === b.paragraph && a.index === b.index && a.savedForms === b.savedForms
  && a.highlighted.join() === b.highlighted.join()
  && JSON.stringify(a.selection) === JSON.stringify(b.selection)
  && a.wordCursor?.sentence === b.wordCursor?.sentence && a.wordCursor?.word === b.wordCursor?.word)
