// Port of ExternalDictionary (EnglishReader/Services/AppSettings.swift): web dictionaries opened from the word card (DT2).
// The dictionaries of the book language are in src/core/language.ts; the encoding rules are the Swift ones.
import { dictionaryPages, type DictionaryTerm } from '../../core/language.ts'
import type { ExternalDictionaryID } from '../../core/storage/settings.ts'

export const dictionaryInfo = (id: ExternalDictionaryID): { title: string; subtitle: string } => {
  const { title, subtitle } = dictionaryPages[id]
  return { title, subtitle }
}

/** Percent-encoding with an allowed set like Foundation's CharacterSet-based encoding. */
function encode(text: string, keep: string): string {
  return encodeURIComponent(text).replace(/%(2[1-9A-F]|3[A-F]|40|5B|5D)/gi, (match) => {
    const char = decodeURIComponent(match)
    return keep.includes(char) ? char : match
  })
}

// .urlPathAllowed: alphanumerics and -._~!$&'()*+,;=:@/
const PATH_ALLOWED = "!$&'()*+,;=:@/"
// .urlPathAllowed minus "/?#" (word path component)
const SEGMENT_ALLOWED = "!$&'()*+,;=:@"
// URLComponents.queryItems keeps .urlQueryAllowed except & = (and leaves + as is)
const QUERY_ALLOWED = "!$'()*+,;:@/?"

function query(base: string, items: [string, string][]): string {
  return base + '?' + items.map(([name, value]) => `${encode(name, QUERY_ALLOWED)}=${encode(value, QUERY_ALLOWED)}`).join('&')
}

/** The dictionary's page for a word or phrase; null for an empty term. */
export function dictionaryURL(id: ExternalDictionaryID, term: string): string | null {
  const trimmed = term.trim()
  if (!trimmed) return null
  const encoders: DictionaryTerm = {
    text: trimmed,
    segment: (text) => encode(text, SEGMENT_ALLOWED),
    path: (text) => encode(text, PATH_ALLOWED),
    query,
  }
  return dictionaryPages[id].url(encoders)
}

/** Opens the page in a new window; an installed PWA shows it in the system Safari view (V-02). */
export function openDictionary(id: ExternalDictionaryID, term: string): void {
  const url = dictionaryURL(id, term)
  if (url) window.open(url, '_blank', 'noopener,noreferrer')
}
