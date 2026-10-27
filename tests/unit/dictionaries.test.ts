import { describe, expect, it } from 'vitest'
import { defaultEnabledDictionaries, settingsPrefix } from '../../src/core/language.ts'
import { allDictionaries, dictionaryOrder, enabledDictionaries, resetAllSettings, setDictionaryEnabled, settings } from '../../src/core/storage/settings.ts'
import { dictionaryInfo, dictionaryURL } from '../../src/ui/word/dictionaries.ts'

// The URLs of each dictionary (ServiceTests.testExternalDictionaryURLs) are checked in language.test.ts.
describe('external dictionaries', () => {
  it('every dictionary has a title and an https page; an empty term has none', () => {
    for (const id of allDictionaries) {
      const url = new URL(dictionaryURL(id, "don't")!)
      expect(url.protocol, id).toBe('https:')
      expect(url.host, id).not.toBe('')
      expect(dictionaryInfo(id).title).not.toBe('')
    }
    for (const id of allDictionaries) expect(dictionaryURL(id, '  '), id).toBeNull()
  })

  it('keeps order and enabled set (testDictionaryOrderAndEnabledSetPersist)', () => {
    resetAllSettings()
    const [first, second] = defaultEnabledDictionaries
    expect(enabledDictionaries()).toEqual(defaultEnabledDictionaries)
    settings.dictionaryOrder.value = `forvo,${first}`
    expect(dictionaryOrder().slice(0, 2)).toEqual(['forvo', first])
    expect(dictionaryOrder()).toHaveLength(allDictionaries.length)
    setDictionaryEnabled('forvo', true)
    setDictionaryEnabled(second, false)
    expect(enabledDictionaries()[0]).toBe('forvo')
    expect(enabledDictionaries()).not.toContain(second)
    expect(localStorage.getItem(`${settingsPrefix}enabledDictionaries`)).toContain('forvo')
    resetAllSettings()
  })
})
