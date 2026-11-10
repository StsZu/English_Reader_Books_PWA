// Language configuration of Polish Reader: everything that differs from English Reader lives here
// (specs/002-polish/idea.md → «Що змінюється»). The rest of the app is language-neutral.

export const appName = 'Polish Reader'

/** BCP 47 code of the book language (segmentation, system voice). */
export const sourceLanguage = 'pl'
/** Preferred system voice locale. */
export const preferredVoiceLocale = 'pl-pl'
/** Language of a system utterance when no voice of the book language is installed. */
export const fallbackVoiceLanguage = 'pl-PL'

/** Ukrainian names of the book language in UI texts. */
export const sourceLanguageName = {
  /** «польською» */
  instrumental: 'польською',
  /** «польське слово» */
  adjectiveNeuter: 'польське',
  /** «польського тексту» */
  adjectiveGenitive: 'польського',
}

// MARK: - Segmentation

/**
 * Abbreviations after which ICU breaks a sentence although it continues («św. Jana», «prof. Nowak»).
 * Abbreviations that usually end a sentence (itd., itp., r., w.) are left out on purpose.
 */
export const abbreviations = [
  'św', 'ul', 'al', 'pl', 'dr', 'prof', 'mgr', 'inż', 'ks', 'gen', 'płk', 'kpt', 'por', 'hr', 'im', 'tzw',
  'np', 'm.in', 'tj', 'tzn', 'ok', 'wg', 'zob', 'mr', 'mrs', 'st',
]

/** Abbreviations glued only before a number («nr 7», «s. 12»). */
export const numberAbbreviations = ['nr', 's', 'str', 'poz', 'rozdz', 't', 'vol', 'no', 'p']

/** Capital letters that are a word before a full stop, not an initial: none, «I.» is an initial («I. Krasicki»). */
export const capitalLetterWords: string[] = []

/** Whether a dialogue dash after the end of a sentence starts a new one («…? — Jestem Polak.»). */
export const dialogueDashStartsSentence = true

/** Chapter headings in plain-text books. */
export const chapterHeading = /^(chapter|part|book|prologue|epilogue|rozdział|część|księga|tom|prolog|epilog)(?=$|[\s.:,—–-]).{0,60}$/iu

// MARK: - AI prompts (English Reader prompts adapted to Polish → Ukrainian)

export const translationSystemPrompt = `You translate Polish books into Ukrainian for a reader who is learning Polish.
Translate each input sentence into natural, literary Ukrainian, faithful to the meaning and tone.
Polish and Ukrainian are close languages: translate by meaning, never by similar-looking words, and watch for false friends (uroda — краса, dywan — килим, zapomnieć — забути, sklep — магазин).
Keep proper names (transliterate them the usual Ukrainian way), keep numbers. Never merge or split sentences.
The optional "context" is the previous paragraph; use it only to resolve pronouns and terms — do not translate it.
Return JSON: {"translations": [string]} with exactly one item per sentence in "sentences", in the same order.`

export const wordCardSystemPrompt = `You are a Polish–Ukrainian learner's dictionary. Given a Polish word and the sentence it appears in,
return ONLY a JSON object:
{"headword": string (the word as given), "lemma": string (dictionary form: infinitive for verbs, nominative singular for nouns, masculine nominative singular for adjectives),
 "ipa": string (IPA of the lemma in standard Polish pronunciation, with the stress mark, without slashes),
 "part_of_speech": string (in Ukrainian; for nouns add the gender, e.g. "іменник, жіночий рід"; for verbs add the aspect, e.g. "дієслово, недоконаний вид"),
 "context_translation": string (Ukrainian translation of the word as used in this sentence; if it is part of
   an idiom or a fixed phrase in the sentence, translate that phrase and mention it),
 "other_translations": [string] (up to 5 other common Ukrainian meanings),
 "note": string (one short Ukrainian usage note, or empty; if the word is a false friend for a Ukrainian speaker, say so first),
 "level": string (CEFR level of the lemma in this meaning: "A1", "A2", "B1", "B2", "C1" or "C2"),
 "forms": string (main Polish forms joined with " — ": verbs "infinitive — aspect pair — 1st person singular — 3rd person plural" of the present (imperfective) or simple future (perfective),
   nouns "nominative singular — genitive singular — nominative plural", adjectives "masculine — feminine — neuter";
   empty string for other parts of speech),
 "irregular": boolean (true for irregular verbs, suppletive aspect pairs or irregular noun declension)}`

export const explanationSystemPrompt = `You are a helpful Polish teacher for a Ukrainian reader. Answer in Ukrainian, concisely, as plain text without Markdown.
Return ONLY a JSON object: {"explanation": string}.`

export const explanationDefaultTemplate =
  'Поясни українською значення польського слова «{слово}» у реченні: «{контекст}». Опиши відтінки значення й типові словосполучення, попередь, якщо це хибний друг перекладача, та дай 2–3 короткі приклади вживання польською з перекладом.'

export const speechInstructions =
  'Read this sentence from a book aloud in clear, natural Polish with standard pronunciation, at a calm pace suitable for a language learner.'

/** «Прослухати зразок» in the voice settings. */
export const sampleText = 'Czytanie na głos pomaga usłyszeć melodię języka polskiego.'

/** «Перевірити переклад» in «ШІ-сервіси». */
export const translationCheckSentence = 'Pewnego razu zdarzyło się, że latarnik w Aspinwall przepadł bez wieści.'

// MARK: - External dictionaries (DT2)

export type ExternalDictionaryID =
  | 'wikislownik' | 'sjp' | 'wiktionary' | 'glosbe' | 'google' | 'deepl' | 'reverso' | 'forvo'

export const allDictionaries: ExternalDictionaryID[] =
  ['wikislownik', 'sjp', 'wiktionary', 'glosbe', 'google', 'deepl', 'reverso', 'forvo']
export const defaultEnabledDictionaries: ExternalDictionaryID[] =
  ['wikislownik', 'sjp', 'wiktionary', 'glosbe', 'google', 'deepl']

/** Word used by «Перевірити» in «Керування словниками». */
export const dictionaryTestWord = 'książka'

/** A trimmed word or phrase with the Swift-compatible encoders of src/ui/word/dictionaries.ts. */
export interface DictionaryTerm {
  text: string
  /** .urlPathAllowed minus "/?#" (one path component). */
  segment(text: string): string
  /** .urlPathAllowed. */
  path(text: string): string
  query(base: string, items: [string, string][]): string
}

export const dictionaryPages: Record<ExternalDictionaryID, { title: string; subtitle: string; url: (term: DictionaryTerm) => string }> = {
  wikislownik: {
    title: 'Wikisłownik', subtitle: 'польський словник з відмінюванням і прикладами',
    url: (t) => 'https://pl.wiktionary.org/wiki/' + t.segment(t.text.replaceAll(' ', '_')),
  },
  sjp: {
    title: 'SJP PWN', subtitle: 'тлумачний словник польської мови',
    url: (t) => 'https://sjp.pwn.pl/szukaj/' + t.segment(t.text) + '.html',
  },
  wiktionary: {
    title: 'Wiktionary', subtitle: 'таблиці відмінювання й дієвідмінювання (англійською)',
    url: (t) => 'https://en.wiktionary.org/wiki/' + t.segment(t.text.replaceAll(' ', '_')) + '#Polish',
  },
  glosbe: {
    title: 'Glosbe', subtitle: 'словник і приклади, польська → українська',
    url: (t) => 'https://glosbe.com/pl/uk/' + t.segment(t.text),
  },
  google: {
    title: 'Google Перекладач', subtitle: 'машинний переклад, польська → українська',
    url: (t) => t.query('https://translate.google.com/', [['sl', 'pl'], ['tl', 'uk'], ['text', t.text], ['op', 'translate']]),
  },
  deepl: {
    title: 'DeepL', subtitle: 'машинний переклад, польська → українська',
    url: (t) => 'https://www.deepl.com/translator#pl/uk/' + t.segment(t.text),
  },
  reverso: {
    title: 'Reverso Context', subtitle: 'приклади в контексті, польська → англійська',
    url: (t) => 'https://context.reverso.net/translation/polish-english/' + t.segment(t.text),
  },
  forvo: {
    title: 'Forvo', subtitle: 'вимова носіями мови',
    url: (t) => 'https://forvo.com/word/' + t.segment(t.text) + '/#pl',
  },
}

// MARK: - Test fixtures (test mode only)

export const fixtureTranslation =
  'Одного разу сталося так, що доглядач маяка в Аспінволлі, неподалік Панами, зник безвісти. Цей довгий український переклад використовується лише для перевірки перенесення рядків, прокручування панелі та незмінного розташування польського тексту під час вибору речення.'

export const fixtureCard = {
  ipa: 'laˈtarɲik', partOfSpeech: 'іменник, чоловічий рід', contextTranslation: 'доглядач маяка',
  otherTranslations: ['маячник', 'ліхтарник'], level: 'B2', forms: 'latarnik — latarnika — latarnicy', irregular: true,
}

/** Saved words seeded by `?testSavedWords` (word, translation, part of speech); the last one is a phrase. */
export const fixtureSavedWords: [string, string, string][] = [
  ['kobieta', 'жінка', 'іменник, жіночий рід'],
  ['rzeka', 'річка', 'іменник, жіночий рід'],
  ['jasny', 'яскравий', 'прикметник'],
  ['dać spokój', 'дати спокій', 'дієслово, доконаний вид'],
]

/** Context sentence of a seeded saved word. */
export const fixtureSentence = (word: string): string => `To jest ${word}.`

// MARK: - Storage namespace (both apps can run side by side on one device and on localhost)

export const databaseName = 'polish-reader'
export const settingsPrefix = 'pr.'
