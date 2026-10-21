// Port of ExternalDictionary (EnglishReader/Services/AppSettings.swift): web dictionaries opened from the word card (DT2).
import type { ExternalDictionaryID } from '../../core/storage/settings.ts'

const info: Record<ExternalDictionaryID, { title: string; subtitle: string }> = {
  cambridge: { title: 'Cambridge', subtitle: 'англо-український словник' },
  reverso: { title: 'Reverso Context', subtitle: 'приклади в контексті, англійська → українська' },
  google: { title: 'Google Перекладач', subtitle: 'машинний переклад, англійська → українська' },
  deepl: { title: 'DeepL', subtitle: 'машинний переклад, англійська → українська' },
  glosbe: { title: 'Glosbe', subtitle: 'словник і приклади, англійська → українська' },
  oxford: { title: "Oxford Learner's", subtitle: 'тлумачний словник для тих, хто вивчає англійську' },
  merriamWebster: { title: 'Merriam-Webster', subtitle: 'тлумачний словник' },
  urban: { title: 'Urban Dictionary', subtitle: 'сленг' },
  forvo: { title: 'Forvo', subtitle: 'вимова носіями мови' },
}

export const dictionaryInfo = (id: ExternalDictionaryID): { title: string; subtitle: string } => info[id]

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
  const path = encode(trimmed, SEGMENT_ALLOWED)
  switch (id) {
    case 'cambridge': {
      const slug = trimmed.toLowerCase().replaceAll(' ', '-')
      return 'https://dictionary.cambridge.org/dictionary/english-ukrainian/' + encode(slug, PATH_ALLOWED)
    }
    case 'reverso': return 'https://context.reverso.net/translation/english-ukrainian/' + path
    case 'google': return query('https://translate.google.com/', [['sl', 'en'], ['tl', 'uk'], ['text', trimmed], ['op', 'translate']])
    case 'deepl': return 'https://www.deepl.com/translator#en/uk/' + path
    case 'glosbe': return 'https://glosbe.com/en/uk/' + path
    case 'oxford': return query('https://www.oxfordlearnersdictionaries.com/search/english/', [['q', trimmed]])
    case 'merriamWebster': return 'https://www.merriam-webster.com/dictionary/' + path
    case 'urban': return query('https://www.urbandictionary.com/define.php', [['term', trimmed]])
    case 'forvo': return 'https://forvo.com/word/' + path + '/#en'
  }
}

/** Opens the page in a new window; an installed PWA shows it in the system Safari view (V-02). */
export function openDictionary(id: ExternalDictionaryID, term: string): void {
  const url = dictionaryURL(id, term)
  if (url) window.open(url, '_blank', 'noopener,noreferrer')
}
