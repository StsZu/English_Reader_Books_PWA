// Case- and diacritic-insensitive matching for search: saved items (FR-27), the library and the book text (specs/010-library).

/** Letters that NFD keeps whole, with their Latin base for search. */
const baseLetters: Record<string, string> = { ł: 'l', đ: 'd', ø: 'o', ß: 'ss', æ: 'ae', œ: 'oe' }

/** Case- and diacritic-insensitive form for search («lodz» finds «Łódź»). */
export function fold(text: string): string {
  return text.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/[łđøßæœ]/gu, (letter) => baseLetters[letter])
}

/** The first match of the query in the text as [start, end) offsets of the original text; null without a match. */
export function foldedRange(text: string, query: string): [number, number] | null {
  const needle = fold(query)
  if (!needle) return null
  let folded = ''
  const origin: number[] = []
  let offset = 0
  for (const char of text) {
    const part = fold(char)
    for (let i = 0; i < part.length; i++) origin.push(offset)
    folded += part
    offset += char.length
  }
  const start = folded.indexOf(needle)
  if (start < 0) return null
  const end = start + needle.length
  return [origin[start], end < origin.length ? origin[end] : text.length]
}
