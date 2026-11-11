// Matching the words of a book with the words heard by Whisper (specs/013-prepared-book): used by
// scripts/make-reader-book.ts to give each sentence its time. Any language: letters and digits of all scripts
// count (Polish ą, ę, ł, ó, ś, ź, ż, ć, ń stay in the word), case and punctuation do not.

/** Words of a text for matching: lower case, NFC, letters and digits of any script; hyphens split, apostrophes stay inside. */
export function normalizeWords(text: string): string[] {
  return text.normalize('NFC').toLocaleLowerCase().replace(/[’‘]/g, "'").replace(/[^\p{L}\p{M}\p{N}'\s-]/gu, ' ')
    .replace(/-/g, ' ').split(/\s+/).map((w) => w.replace(/^'+|'+$/g, '')).filter(Boolean)
}

/**
 * Largest table `alignWords` builds: 4 bytes a cell, about 160 MB. A chapter of half an hour (about 4 500 words
 * read and heard) needs about 20 million cells; a track of two hours does not fit and has to be split.
 */
export const MAX_ALIGN_CELLS = 40_000_000

/** Cells of the table for matching `bookWords` with `heardWords`. */
export function alignmentCells(bookWords: number, heardWords: number): number {
  return (bookWords + 1) * (heardWords + 1)
}

export class AlignmentTooLarge extends Error {
  readonly cells: number
  readonly limit: number
  constructor(cells: number, limit: number) {
    super(`Зіставлення потребує ${cells} клітинок таблиці, більше за межу ${limit}.`)
    this.cells = cells
    this.limit = limit
  }
}

/**
 * Longest common subsequence of the two word lists: pairs [book word, heard word]. Time and memory grow with
 * the product of the lengths, so it is meant for a chapter, not a whole book at once: above `limit` cells
 * it throws `AlignmentTooLarge` before taking the memory.
 */
export function alignWords(a: readonly string[], b: readonly string[], limit = MAX_ALIGN_CELLS): Array<[number, number]> {
  const cells = alignmentCells(a.length, b.length)
  if (cells > limit) throw new AlignmentTooLarge(cells, limit)
  const width = b.length + 1
  const table = new Uint32Array((a.length + 1) * width)
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      table[i * width + j] = a[i] === b[j]
        ? table[(i + 1) * width + j + 1] + 1
        : Math.max(table[(i + 1) * width + j], table[i * width + j + 1])
    }
  }
  const pairs: Array<[number, number]> = []
  let i = 0
  let j = 0
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) pairs.push([i++, j++])
    else if (table[(i + 1) * width + j] >= table[i * width + j + 1]) i++
    else j++
  }
  return pairs
}
