// Extracts prompts and user-facing error texts from the Swift reference app (read-only)
// into build/swift-strings.json, so tests can prove the PWA uses them verbatim.
// Run: node --experimental-strip-types scripts/extract-swift-strings.ts
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const root = process.env.SWIFT_SOURCE ?? '/Users/szubar/Projects/ACTIVE/English_Reader_Books/EnglishReader'
const read = (path: string) => readFileSync(join(root, path), 'utf8')

/** Swift multi-line literal: strip the closing delimiter's indentation; no trailing newline. */
function multiline(source: string, name: string): string {
  const pattern = new RegExp(`${name}\\s*=\\s*"""\\n([\\s\\S]*?)\\n([ \\t]*)"""`)
  const match = source.match(pattern)
  if (!match) throw new Error(`multi-line string ${name} not found`)
  const indent = match[2]
  return match[1].split('\n').map((line) => (line.startsWith(indent) ? line.slice(indent.length) : line.trimStart())).join('\n')
}

/** Single-line literal assigned to a name. */
function single(source: string, name: string): string {
  const match = source.match(new RegExp(`${name}\\s*=\\s*"((?:[^"\\\\]|\\\\.)*)"`))
  if (!match) throw new Error(`string ${name} not found`)
  return match[1].replace(/\\"/g, '"').replace(/\\\\/g, '\\')
}

/** `case .x: return "..."` texts inside an errorDescription switch, keyed by case name. */
function errorTexts(source: string, enumName: string): Record<string, string> {
  const start = source.indexOf(`enum ${enumName}`)
  if (start < 0) throw new Error(`enum ${enumName} not found`)
  const body = source.slice(start, source.indexOf('\n}\n', start))
  const result: Record<string, string> = {}
  const re = /case \.(\w+)(?:\([^)]*\))?:\s*(?:\n\s*)?return "((?:[^"\\]|\\.)*)"/g
  for (const m of body.matchAll(re)) result[m[1]] = m[2].replace(/\\"/g, '"')
  return result
}

const translation = read('Services/TranslationService.swift')
const word = read('Services/WordLookupService.swift')
const speech = read('Services/SpeechEngines.swift')
const client = read('Services/OpenAIClient.swift')
const importer = read('Import/BookImporter.swift')

const strings = {
  translationSystemPrompt: multiline(translation, 'static let systemPrompt'),
  wordCardSystemPrompt: multiline(word.slice(0, word.indexOf('actor ExplanationService')), 'static let systemPrompt'),
  explanationSystemPrompt: multiline(word.slice(word.indexOf('actor ExplanationService')), 'static let systemPrompt'),
  explanationDefaultTemplate: single(word, 'static let defaultTemplate'),
  speechInstructions: single(speech, 'static let instructions'),
  aiServiceErrors: errorTexts(client, 'AIServiceError'),
  importErrors: errorTexts(importer, 'ImportError'),
}

mkdirSync('build', { recursive: true })
writeFileSync('build/swift-strings.json', JSON.stringify(strings, null, 2) + '\n')
console.log(`build/swift-strings.json: ${Object.keys(strings.aiServiceErrors).length} AI errors, ${Object.keys(strings.importErrors).length} import errors`)
