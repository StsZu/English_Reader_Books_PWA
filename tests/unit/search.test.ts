// Search in the book text and the folding it shares with the saved list and the library (specs/010-library, F4).
import { describe, expect, it } from 'vitest'
import type { Book } from '../../src/core/model/book.ts'
import { searchBook } from '../../src/core/model/search.ts'
import { foldedRange } from '../../src/core/util/fold.ts'

const book: Book = {
  id: 'B', title: 'T', author: '', format: 'md', importedAt: new Date(0).toISOString(),
  chapters: [
    { title: 'One', paragraphs: [{ kind: 'heading', sentences: ['The Café'] }, { kind: 'text', sentences: ['Tea at the café.', 'Nothing here.'] }] },
    { title: 'Two', paragraphs: [{ kind: 'text', sentences: ['Back in Łódź, the CAFE was shut.'] }] },
  ],
}

describe('пошук у книжці', () => {
  it('знаходить речення без регістру й діакритики, у заголовках теж, з місцем збігу', () => {
    const result = searchBook(book, ' cafe ')
    expect(result.total).toBe(3)
    expect(result.hits.map((h) => [h.ref.paragraph.chapter, h.ref.paragraph.paragraph, h.ref.sentence, h.chapterTitle])).toEqual([
      [0, 0, 0, 'One'], [0, 1, 0, 'One'], [1, 0, 0, 'Two'],
    ])
    expect(result.hits.map((h) => h.text.slice(...h.match))).toEqual(['Café', 'café', 'CAFE'])
    expect(searchBook(book, 'lodz').hits[0].match).toEqual([8, 12])
  })

  it('від двох символів; понад межу — лише лічильник', () => {
    expect(searchBook(book, 't')).toEqual({ hits: [], total: 0 })
    const limited = searchBook(book, 'the', 1)
    expect(limited.hits.length).toBe(1)
    expect(limited.total).toBe(3)
  })

  it('місце збігу в оригінальному тексті, коли згортання змінює довжину', () => {
    expect(foldedRange('Die Straße ist lang', 'strasse')).toEqual([4, 10])
    expect(foldedRange('café au lait', 'au')).toEqual([6, 8])
    expect(foldedRange('abc', 'x')).toBeNull()
    expect(foldedRange('abc', '')).toBeNull()
  })
})
