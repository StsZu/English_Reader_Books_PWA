// Matching the words of a book with the words heard by Whisper (specs/013-prepared-book): used by
// scripts/make-reader-book.ts to give each sentence its time. Any language: letters and digits of all scripts
// count (Polish ą, ę, ł, ó, ś, ź, ż, ć, ń stay in the word), case and punctuation do not.

/** Words of a text for matching: lower case, NFC, letters and digits of any script; hyphens split, apostrophes stay inside. */
export function normalizeWords(text: string): string[] {
  return text.normalize('NFC').toLocaleLowerCase().replace(/[’‘]/g, "'").replace(/[^\p{L}\p{M}\p{N}'\s-]/gu, ' ')
    .replace(/-/g, ' ').split(/\s+/).map((w) => w.replace(/^'+|'+$/g, '')).filter(Boolean)
}

/**
 * Longest common subsequence of the two word lists: pairs [book word, heard word]. Time and memory grow with
 * the product of the lengths, so it is meant for a chapter, not a whole book at once.
 */
export function alignWords(a: readonly string[], b: readonly string[]): Array<[number, number]> {
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
