import { describe, expect, it } from 'vitest'
import { makeBook, normalizeWhitespace, sentences, words } from '../../src/core/model/segmenter.ts'

describe('TextSegmenter', () => {
  // ImportTests.testSentenceSegmentation
  it('розбиває на речення й склеює репліки з малої літери', () => {
    expect(sentences('Mr. Holmes sat down. "Is it you?" he asked!  Yes —   it was.'))
      .toEqual(['Mr. Holmes sat down.', '"Is it you?" he asked!', 'Yes — it was.'])
  })

  it('не розриває речення після скорочень та ініціалів', () => {
    expect(sentences('I met Mr. Sherlock Holmes and Dr. Watson. It was late.'))
      .toEqual(['I met Mr. Sherlock Holmes and Dr. Watson.', 'It was late.'])
    expect(sentences('A. Writer wrote it, e.g. a lot. Then he left.'))
      .toEqual(['A. Writer wrote it, e.g. a lot.', 'Then he left.'])
    expect(sentences('He lived at No. 7 Baker Street. "No." She left.'))
      .toEqual(['He lived at No. 7 Baker Street.', '"No."', 'She left.'])
  })

  it('приклеює фрагменти без літер до попереднього речення', () => {
    expect(sentences('He stopped. — . Then went on.')).toEqual(['He stopped. — .', 'Then went on.'])
  })

  // ImportTests.testWordRangesSkipPunctuation
  it('слова без розділових знаків, апостроф усередині слова', () => {
    const list = words("Don't stop, Watson.")
    expect(list).toContain('Watson')
    expect(list).toContain("Don't")
    expect(list).not.toContain(',')
    expect(list).not.toContain('.')
    expect(words("the men's motives")).toEqual(['the', "men's", 'motives'])
  })

  it('нормалізує пробіли, NBSP і мʼякі переноси', () => {
    expect(normalizeWhitespace('  a b­c \n\t d ')).toBe('a bc d')
  })

  it('makeBook: заголовок — одне речення, порожні розділи пропускаються', () => {
    const book = makeBook({
      title: 'T', author: 'A', chapters: [
        { title: 'Empty', blocks: [{ kind: 'text', text: '   ' }] },
        { title: 'One', blocks: [{ kind: 'heading', text: 'One. Two.' }, { kind: 'text', text: 'First. Second.' }] },
      ],
    }, 'md', 'ID')
    expect(book.chapters).toHaveLength(1)
    expect(book.chapters[0].paragraphs[0]).toEqual({ kind: 'heading', sentences: ['One. Two.'] })
    expect(book.chapters[0].paragraphs[1].sentences).toEqual(['First.', 'Second.'])
  })
})
