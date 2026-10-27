// Prompts of the AI requests, from the language configuration (src/core/language.ts): English Reader keeps
// the Swift prompts verbatim, Polish Reader adapts them to Polish → Ukrainian (specs/002-polish/idea.md).
export {
  translationSystemPrompt, wordCardSystemPrompt, explanationSystemPrompt, explanationDefaultTemplate, speechInstructions,
} from '../language.ts'
