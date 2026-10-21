import { describe, expect, it } from 'vitest'
import { allDictionaries, dictionaryOrder, enabledDictionaries, resetAllSettings, setDictionaryEnabled, settings } from '../../src/core/storage/settings.ts'
import { dictionaryInfo, dictionaryURL } from '../../src/ui/word/dictionaries.ts'

describe('external dictionaries (ServiceTests.testExternalDictionaryURLs)', () => {
  it('builds the same URLs as the Swift app', () => {
    expect(dictionaryURL('cambridge', 'Look up')).toBe('https://dictionary.cambridge.org/dictionary/english-ukrainian/look-up')
    expect(dictionaryURL('reverso', 'look up')).toBe('https://context.reverso.net/translation/english-ukrainian/look%20up')
    expect(dictionaryURL('google', 'look up')).toBe('https://translate.google.com/?sl=en&tl=uk&text=look%20up&op=translate')
    expect(dictionaryURL('urban', 'a/b?c')).toBe('https://www.urbandictionary.com/define.php?term=a/b?c')
    expect(dictionaryURL('glosbe', 'a/b')).toBe('https://glosbe.com/en/uk/a%2Fb')
    expect(dictionaryURL('forvo', 'book')).toBe('https://forvo.com/word/book/#en')
    expect(dictionaryURL('deepl', 'book')).toBe('https://www.deepl.com/translator#en/uk/book')
    expect(dictionaryURL('oxford', 'book')).toBe('https://www.oxfordlearnersdictionaries.com/search/english/?q=book')
    for (const id of allDictionaries) {
      const url = new URL(dictionaryURL(id, "don't")!)
      expect(url.protocol, id).toBe('https:')
      expect(url.host, id).not.toBe('')
      expect(dictionaryInfo(id).title).not.toBe('')
    }
    expect(dictionaryURL('oxford', '  ')).toBeNull()
  })

  it('keeps order and enabled set (testDictionaryOrderAndEnabledSetPersist)', () => {
    resetAllSettings()
    expect(enabledDictionaries()).toEqual(['cambridge', 'reverso', 'google', 'deepl', 'glosbe'])
    settings.dictionaryOrder.value = 'forvo,cambridge'
    expect(dictionaryOrder().slice(0, 2)).toEqual(['forvo', 'cambridge'])
    expect(dictionaryOrder()).toHaveLength(allDictionaries.length)
    setDictionaryEnabled('forvo', true)
    setDictionaryEnabled('reverso', false)
    expect(enabledDictionaries()[0]).toBe('forvo')
    expect(enabledDictionaries()).not.toContain('reverso')
    expect(localStorage.getItem('er.enabledDictionaries')).toContain('forvo')
    resetAllSettings()
  })
})
