// Language configuration of English Reader: everything that differs from Polish Reader lives here
// (specs/005-reliability/idea.md → «Етап 0»). The rest of the app is language-neutral.

export const appName = 'English Reader'

/** BCP 47 code of the book language (segmentation, system voice). */
export const sourceLanguage = 'en'
/** Preferred system voice locale. */
export const preferredVoiceLocale = 'en-gb'
/** Language of a system utterance when no voice of the book language is installed. */
export const fallbackVoiceLanguage = 'en-GB'

/** Ukrainian names of the book language in UI texts. */
export const sourceLanguageName = {
  /** «англійською» */
  instrumental: 'англійською',
  /** «англійське слово» */
  adjectiveNeuter: 'англійське',
  /** «англійського тексту» */
  adjectiveGenitive: 'англійського',
}

// MARK: - Segmentation

/** Abbreviations after which ICU breaks a sentence that NLTokenizer keeps whole ("Mr. Holmes"). */
export const abbreviations = [
  'mr', 'mrs', 'ms', 'dr', 'st', 'jr', 'sr', 'prof', 'rev', 'gen', 'col', 'capt', 'lt', 'vs', 'etc',
  'e.g', 'i.e', 'mt', 'messrs', 'mme', 'mlle', 'sgt', 'cpl', 'gov', 'hon', 'esq',
]

/** Abbreviations glued only before a number ("No. 7"), since "No." is also a whole reply. */
export const numberAbbreviations = ['no', 'nos', 'vol', 'p', 'pp', 'ch', 'fig']

/** Capital letters that are a word before a full stop, not an initial ("It was I. Nobody else."). */
export const capitalLetterWords = ['I']

/** Whether a dialogue dash after the end of a sentence starts a new one («…? — Jestem Polak.»). */
export const dialogueDashStartsSentence = false

/** Chapter headings in plain-text books. */
export const chapterHeading = /^(chapter|part|book|prologue|epilogue)\b.{0,60}$/i

// MARK: - AI prompts (verbatim from the Swift reference app, checked against build/swift-strings.json in tests)

/** TranslationService.swift → OpenAITranslationProvider.systemPrompt. Also used for fragments (with surrounding sentences as context). */
export const translationSystemPrompt = "You translate English books into Ukrainian for a reader who is learning English.\nTranslate each input sentence into natural, literary Ukrainian, faithful to the meaning and tone.\nKeep proper names (transliterate them the usual Ukrainian way), keep numbers. Never merge or split sentences.\nThe optional \"context\" is the previous paragraph; use it only to resolve pronouns and terms — do not translate it.\nReturn JSON: {\"translations\": [string]} with exactly one item per sentence in \"sentences\", in the same order."

/** WordLookupService.swift → WordLookupService.systemPrompt. */
export const wordCardSystemPrompt = "You are an English–Ukrainian learner's dictionary. Given an English word and the sentence it appears in,\nreturn ONLY a JSON object:\n{\"headword\": string (the word as given), \"lemma\": string (dictionary form),\n \"ipa\": string (British IPA of the lemma, without slashes),\n \"part_of_speech\": string (in Ukrainian, e.g. \"дієслово\"),\n \"context_translation\": string (Ukrainian translation of the word as used in this sentence; if it is part of\n   a phrasal verb or idiom in the sentence, translate that phrase and mention it),\n \"other_translations\": [string] (up to 5 other common Ukrainian meanings),\n \"note\": string (one short Ukrainian usage note, or empty),\n \"level\": string (CEFR level of the lemma in this meaning: \"A1\", \"A2\", \"B1\", \"B2\", \"C1\" or \"C2\"),\n \"forms\": string (main English forms joined with \" — \": verbs \"base — past — past participle\",\n   nouns \"singular — plural\", adjectives/adverbs \"positive — comparative — superlative\" if they compare;\n   empty string for other parts of speech),\n \"irregular\": boolean (true for irregular verbs or irregular noun plurals)}"

/** WordLookupService.swift → ExplanationService.systemPrompt. */
export const explanationSystemPrompt = "You are a helpful English teacher for a Ukrainian reader. Answer in Ukrainian, concisely, as plain text without Markdown.\nReturn ONLY a JSON object: {\"explanation\": string}."

/** WordLookupService.swift → ExplanationService.defaultTemplate. */
export const explanationDefaultTemplate = "Поясни українською значення слова «{слово}» у реченні: «{контекст}». Опиши відтінки значення й типові словосполучення та дай 2–3 короткі приклади вживання англійською з перекладом."

/** SpeechEngines.swift → OpenAISpeechEngine.instructions. */
export const speechInstructions = "Read this sentence from a book aloud in clear, natural English with a neutral British accent, at a calm pace suitable for a language learner."

/** «Прослухати зразок» in the voice settings. */
export const sampleText = 'Reading aloud helps you hear the rhythm of English.'

/** «Перевірити переклад» in «ШІ-сервіси». */
export const translationCheckSentence = 'The book is on the table.'

// MARK: - External dictionaries (DT2, ExternalDictionary in AppSettings.swift)

export type ExternalDictionaryID =
  | 'cambridge' | 'reverso' | 'google' | 'deepl' | 'glosbe' | 'oxford' | 'merriamWebster' | 'urban' | 'forvo'

export const allDictionaries: ExternalDictionaryID[] =
  ['cambridge', 'reverso', 'google', 'deepl', 'glosbe', 'oxford', 'merriamWebster', 'urban', 'forvo']
export const defaultEnabledDictionaries: ExternalDictionaryID[] = ['cambridge', 'reverso', 'google', 'deepl', 'glosbe']

/** Word used by «Перевірити» in «Керування словниками». */
export const dictionaryTestWord = 'book'

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
  cambridge: {
    title: 'Cambridge', subtitle: 'англо-український словник',
    url: (t) => 'https://dictionary.cambridge.org/dictionary/english-ukrainian/' + t.path(t.text.toLowerCase().replaceAll(' ', '-')),
  },
  reverso: {
    title: 'Reverso Context', subtitle: 'приклади в контексті, англійська → українська',
    url: (t) => 'https://context.reverso.net/translation/english-ukrainian/' + t.segment(t.text),
  },
  google: {
    title: 'Google Перекладач', subtitle: 'машинний переклад, англійська → українська',
    url: (t) => t.query('https://translate.google.com/', [['sl', 'en'], ['tl', 'uk'], ['text', t.text], ['op', 'translate']]),
  },
  deepl: {
    title: 'DeepL', subtitle: 'машинний переклад, англійська → українська',
    url: (t) => 'https://www.deepl.com/translator#en/uk/' + t.segment(t.text),
  },
  glosbe: {
    title: 'Glosbe', subtitle: 'словник і приклади, англійська → українська',
    url: (t) => 'https://glosbe.com/en/uk/' + t.segment(t.text),
  },
  oxford: {
    title: "Oxford Learner's", subtitle: 'тлумачний словник для тих, хто вивчає англійську',
    url: (t) => t.query('https://www.oxfordlearnersdictionaries.com/search/english/', [['q', t.text]]),
  },
  merriamWebster: {
    title: 'Merriam-Webster', subtitle: 'тлумачний словник',
    url: (t) => 'https://www.merriam-webster.com/dictionary/' + t.segment(t.text),
  },
  urban: {
    title: 'Urban Dictionary', subtitle: 'сленг',
    url: (t) => t.query('https://www.urbandictionary.com/define.php', [['term', t.text]]),
  },
  forvo: {
    title: 'Forvo', subtitle: 'вимова носіями мови',
    url: (t) => 'https://forvo.com/word/' + t.segment(t.text) + '/#en',
  },
}

// MARK: - Test fixtures (test mode only)

export const fixtureTranslation =
  'Для Шерлока Голмса вона завжди залишалася тією жінкою. Цей довгий український переклад використовується лише для перевірки перенесення рядків, прокручування панелі та незмінного розташування англійського тексту під час вибору речення.'

export const fixtureCard = {
  ipa: 'ˈwʊmən', partOfSpeech: 'іменник', contextTranslation: 'жінка',
  otherTranslations: ['дружина', 'служниця'], level: 'A1', forms: 'woman — women', irregular: true,
}

/** Saved words seeded by `?testSavedWords` (word, translation, part of speech); the last one is a phrase. */
export const fixtureSavedWords: [string, string, string][] = [
  ['woman', 'жінка', 'іменник'],
  ['river', 'річка', 'іменник'],
  ['bright', 'яскравий', 'прикметник'],
  ['look up', 'шукати', 'дієслово'],
]

/** Context sentence of a seeded saved word. */
export const fixtureSentence = (word: string): string => `A ${word} here.`

// MARK: - Storage namespace (both apps can run side by side on one device and on localhost)

export const databaseName = 'english-reader'
export const settingsPrefix = 'er.'
