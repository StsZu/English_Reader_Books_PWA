import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render } from 'preact'
import { act } from 'preact/test-utils'
import { ReaderPanel, type ReaderPanelTab } from '../../src/ui/reader/panel/ReaderPanel.tsx'
import { allDictionaries, dictionaryOrder, defaultEnabledDictionaries, resetAllSettings, settings } from '../../src/core/storage/settings.ts'
import type { Book } from '../../src/core/model/book.ts'

const book: Book = {
  id: 'B1', title: 'Demo', author: '', format: 'md', importedAt: new Date(0).toISOString(),
  chapters: [
    { title: 'A Scandal in Bohemia', paragraphs: [{ kind: 'text', sentences: ['One.'] }] },
    { title: 'The Red-Headed League', paragraphs: [{ kind: 'text', sentences: ['Two.'] }] },
  ],
}

let root: HTMLDivElement

function mount(tab: ReaderPanelTab = 'settings', handlers: Partial<{ onClose: () => void; onSelectChapter: (i: number) => void }> = {}) {
  act(() => {
    render(
      <ReaderPanel open tab={tab} onTab={() => {}} book={book} chapter={0}
        onClose={handlers.onClose ?? (() => {})} onSelectChapter={handlers.onSelectChapter ?? (() => {})} onOpenPlace={() => {}} onShowShortcuts={() => {}} />,
      root,
    )
  })
}

const byID = (id: string) => document.querySelector<HTMLElement>(`[data-testid="${id}"]`)
const click = (id: string, times = 1) => {
  for (let i = 0; i < times; i++) act(() => { byID(id)!.click() })
}

beforeEach(() => {
  resetAllSettings()
  root = document.createElement('div')
  document.body.appendChild(root)
})

afterEach(() => {
  act(() => render(null, root))
  root.remove()
  document.body.innerHTML = ''
})

describe('ReaderPanel', () => {
  it('shows three tabs, theme tiles and four sections; «Текст книги» expanded by default', () => {
    mount()
    expect(byID('panelTabSettings')!.getAttribute('aria-selected')).toBe('true')
    expect(byID('panelTabContents')).toBeTruthy()
    expect(byID('panelTabSaved')).toBeTruthy()
    for (const theme of ['light', 'sepia', 'dark']) expect(byID(`theme-${theme}`)).toBeTruthy()
    expect(byID('panelSection-text')!.getAttribute('aria-expanded')).toBe('true')
    expect(byID('panelSection-parallel')!.getAttribute('aria-expanded')).toBe('false')
    expect(byID('panelSection-dictionary')).toBeTruthy()
    expect(byID('panelSection-pronunciation')).toBeTruthy()
  })

  it('changes the theme and the book text settings within their ranges', () => {
    mount()
    click('theme-light')
    expect(settings.theme.value).toBe('light')
    expect(byID('theme-light')!.getAttribute('aria-pressed')).toBe('true')

    click('panel-font')
    click('font-georgia')
    expect(settings.bookFont.value).toBe('georgia')
    expect(byID('panel-font')!.textContent).toContain('Georgia')

    click('panel-fontSize-minus', 8)
    expect(byID('panel-fontSize-value')!.textContent).toBe('14')
    expect((byID('panel-fontSize-minus') as HTMLButtonElement).disabled).toBe(true)
    click('panel-fontSize-plus', 4)
    expect(settings.fontSize.value).toBe(18)
    click('panel-lineSpacing-plus')
    expect(byID('panel-lineSpacing-value')!.textContent).toBe('0,30')
    click('panel-sideMargin-plus', 2)
    expect(byID('panel-sideMargin-value')!.textContent).toBe('60')
    click('panel-firstLineIndent-plus', 6)
    expect(byID('panel-firstLineIndent-value')!.textContent).toBe('1,50')
    click('panel-paragraphSpacing-minus')
    expect(byID('panel-paragraphSpacing-value')!.textContent).toBe('0,8')
    click('panel-justify')
    expect(settings.justifyText.value).toBe(true)
  })

  it('remembers expanded sections and has no Apple fallback or in-app dictionary toggles (V-01, V-02)', () => {
    mount()
    click('panelSection-parallel')
    click('panelSection-dictionary')
    click('panelSection-pronunciation')
    expect(settings.expandedPanelSections.value).toBe('text,parallel,dictionary,pronunciation')
    click('panelSection-text')
    expect(settings.expandedPanelSections.value).toBe('parallel,dictionary,pronunciation')
    const text = document.body.textContent ?? ''
    expect(text).not.toContain('Офлайн-резерв Apple')
    expect(text).not.toContain('Apple')
    expect(text).not.toContain('Відкривати словники')
    expect(byID('panel-parallelTranslationScale-value')!.textContent).toBe('0,7×')
    expect(byID('panel-parallelTranslationAutoHideLines-value')!.textContent).toBe('1 рядок')
    expect(byID('panel-speechRate-value')!.textContent).toBe('1,00×')
    expect(byID('panel-wordCardScale-value')!.textContent).toBe('1,0×')
  })

  it('disables the auto-hide threshold when auto-hide is off', () => {
    settings.expandedPanelSections.value = 'parallel'
    mount()
    click('parallelTranslationAutoHide')
    expect(settings.parallelTranslationAutoHide.value).toBe(false)
    expect((byID('panel-parallelTranslationAutoHideLines-plus') as HTMLButtonElement).disabled).toBe(true)
  })

  it('resets the explanation template', () => {
    settings.expandedPanelSections.value = 'dictionary'
    settings.explanationTemplate.value = 'Мій шаблон {слово}'
    mount()
    expect((byID('explanationTemplate') as HTMLTextAreaElement).value).toBe('Мій шаблон {слово}')
    click('resetExplanationTemplate')
    expect(settings.explanationTemplate.value).toContain('{контекст}')
    expect((byID('resetExplanationTemplate') as HTMLButtonElement).disabled).toBe(true)
  })

  it('manages dictionaries: enable, disable and reorder', () => {
    settings.expandedPanelSections.value = 'dictionary'
    mount()
    expect(byID('manageDictionaries')!.textContent).toContain(`${defaultEnabledDictionaries.length} з ${allDictionaries.length}`)
    click('manageDictionaries')
    expect(byID('dictionaryManager')).toBeTruthy()
    const [first, second] = allDictionaries
    click(`enableDictionary-${first}`)
    click('enableDictionary-forvo')
    expect(settings.enabledDictionaries.value.split(',')).not.toContain(first)
    expect(settings.enabledDictionaries.value.split(',')).toContain('forvo')
    click(`moveDown-${first}`)
    expect(dictionaryOrder().slice(0, 2)).toEqual([second, first])
    click(`moveUp-${first}`)
    expect(dictionaryOrder()[0]).toBe(first)
    click('dictionariesDone')
    expect(byID('dictionaryManager')).toBeNull()
    expect(byID('manageDictionaries')!.textContent).toContain(`${defaultEnabledDictionaries.length} з ${allDictionaries.length}`)
  })

  it('opens a chapter from the contents tab and closes the panel', () => {
    const onClose = vi.fn()
    const onSelectChapter = vi.fn()
    mount('contents', { onClose, onSelectChapter })
    expect(byID('chapter-0')!.getAttribute('aria-current')).toBe('true')
    click('chapter-1')
    expect(onSelectChapter).toHaveBeenCalledWith(1)
    expect(onClose).toHaveBeenCalled()
  })

  it('closes with the cross', () => {
    const onClose = vi.fn()
    mount('settings', { onClose })
    click('closePanel')
    expect(onClose).toHaveBeenCalled()
  })
})
