// Real (paid) OpenAI calls for Polish → Ukrainian, adapted from LiveOpenAITests in ServiceTests.swift.
// Run only with permission: LIVE=1 OPENAI_API_KEY=... npm run test:live
import { beforeAll, describe, expect, it } from 'vitest'
import { setKeyProvider } from '../../../src/core/ai/openai.ts'
import { explanationDefaultTemplate } from '../../../src/core/ai/prompts.ts'
import { OpenAITranslationProvider } from '../../../src/core/ai/translation.ts'
import { ExplanationService, WordLookupService } from '../../../src/core/ai/word.ts'

const key = process.env.OPENAI_API_KEY
const enabled = !!process.env.LIVE && !!key
const model = 'gpt-5.4-mini'
const cyrillic = /[Ѐ-ӿ]/

const opening = [
  'Pewnego razu zdarzyło się, że latarnik w Aspinwall, niedaleko Panamy, przepadł bez wieści.',
  'Ponieważ stało się to wśród burzy, przypuszczano, że nieszczęśliwy musiał podejść nad sam brzeg skalistej wysepki.',
]

describe.skipIf(!enabled)('live OpenAI (Polish)', () => {
  beforeAll(() => setKeyProvider(async () => key ?? null))

  it('translates a paragraph sentence by sentence', async () => {
    const result = await new OpenAITranslationProvider(model).translate(opening)
    expect(result).toHaveLength(2)
    for (const line of result) expect(line).toMatch(cyrillic)
    expect(result[0].toLowerCase()).toMatch(/маяк/)
  }, 90_000)

  it('translates a fragment with context', async () => {
    const result = await new OpenAITranslationProvider(model).translate(['przepadł bez wieści'], opening.join(' '))
    expect(result).toHaveLength(1)
    expect(result[0].toLowerCase()).toContain('безвісти')
  }, 90_000)

  it('word card uses the sentence context, gender and Polish IPA', async () => {
    const card = await WordLookupService.lookup('latarnik', `${opening[0]} ${Date.now()}`, model)
    expect(card.contextTranslation.toLowerCase()).toMatch(/маяк/)
    expect(card.partOfSpeech.toLowerCase()).toContain('чоловічий')
    expect(card.ipa).toMatch(/[ɲɕʑʂʐ]|ˈ/)
  }, 90_000)

  it('verb card has the lemma, aspect and forms', async () => {
    const card = await WordLookupService.lookup('przepadł', `${opening[0]} ${Date.now()}`, model)
    expect(card.lemma).toBe('przepaść')
    expect(card.partOfSpeech.toLowerCase()).toMatch(/доконаний/)
    expect(card.forms).toContain('—')
    expect(card.level).toMatch(/^[ABC][12]$/)
  }, 90_000)

  it('false friend is translated by meaning', async () => {
    const card = await WordLookupService.lookup('uroda', `Jej uroda zachwyciła wszystkich. ${Date.now()}`, model)
    expect(card.contextTranslation.toLowerCase()).toMatch(/врод|крас/)
  }, 90_000)

  it('explanation is Ukrainian', async () => {
    const text = await ExplanationService.explain('przepadł', opening[0], explanationDefaultTemplate, model, true)
    expect(text).toMatch(cyrillic)
  }, 90_000)
})
