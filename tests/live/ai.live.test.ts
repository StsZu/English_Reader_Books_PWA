// Real (paid) OpenAI calls, ported from LiveOpenAITests in ServiceTests.swift.
// Run only with permission: LIVE=1 OPENAI_API_KEY=... npm run test:live
import { beforeAll, describe, expect, it } from 'vitest'
import { setKeyProvider } from '../../src/core/ai/openai.ts'
import { explanationDefaultTemplate } from '../../src/core/ai/prompts.ts'
import { OpenAITranslationProvider } from '../../src/core/ai/translation.ts'
import { ExplanationService, WordLookupService } from '../../src/core/ai/word.ts'

const key = process.env.OPENAI_API_KEY
const enabled = !!process.env.LIVE && !!key
const model = 'gpt-5.4-mini'
const cyrillic = /[Ѐ-ӿ]/

describe.skipIf(!enabled)('live OpenAI', () => {
  beforeAll(() => setKeyProvider(async () => key ?? null))

  it('translates a paragraph sentence by sentence', async () => {
    const sentences = ['To Sherlock Holmes she is always the woman.', 'I have seldom heard him mention her under any other name.']
    const result = await new OpenAITranslationProvider(model).translate(sentences)
    expect(result).toHaveLength(2)
    for (const line of result) expect(line).toMatch(cyrillic)
  }, 90_000)

  it('translates a fragment with context', async () => {
    const result = await new OpenAITranslationProvider(model).translate(['woman. I have seldom'],
      'To Sherlock Holmes she is always the woman. I have seldom heard him mention her under any other name.')
    expect(result).toHaveLength(1)
    expect(result[0]).toMatch(cyrillic)
  }, 90_000)

  it('word card uses the sentence context', async () => {
    const card = await WordLookupService.lookup('woman', `To Sherlock Holmes she is always the woman. ${Date.now()}`, model)
    expect(card.contextTranslation.toLowerCase()).toContain('жінк')
    expect(card.ipa).not.toBe('')
  }, 90_000)

  it('word card has level and irregular forms', async () => {
    const card = await WordLookupService.lookup('went', `She went home early. ${Date.now()}`, model)
    expect(card.level).toBe('A1')
    expect(card.forms.toLowerCase()).toContain('go — went — gone')
    expect(card.irregular).toBe(true)
  }, 90_000)

  it('explanation is Ukrainian', async () => {
    const text = await ExplanationService.explain('eclipses', 'In his eyes she eclipses and predominates the whole of her sex.',
      explanationDefaultTemplate, model, true)
    expect(text).toMatch(cyrillic)
  }, 90_000)
})
