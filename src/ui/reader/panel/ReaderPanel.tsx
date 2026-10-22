// Port of ReaderPanel.swift: reading settings, contents and saved items, sliding in from the right (D1–D7).
import { useEffect, useState } from 'preact/hooks'
import type { Book } from '../../../core/model/book.ts'
import type { SavedPlace } from '../../../core/saved/saved.ts'
import { stopSample } from '../../../core/speech/engines.ts'
import { books } from '../../../core/storage/library.ts'
import { SidePanel, Tabs } from '../../components/index.ts'
import { Icon } from '../../icons.tsx'
import { SavedList } from '../../saved/SavedList.tsx'
import { DictionaryManager } from './DictionaryManager.tsx'
import { SettingsTab } from './sections.tsx'
import './panel.css'

export type ReaderPanelTab = 'settings' | 'contents' | 'saved'

export interface ReaderPanelProps {
  open: boolean
  onClose: () => void
  tab: ReaderPanelTab
  onTab: (tab: ReaderPanelTab) => void
  book: Book
  chapter: number
  onSelectChapter: (index: number) => void
  onOpenPlace: (place: SavedPlace) => void
  onShowShortcuts: () => void
}

const tabs: { value: ReaderPanelTab; label: string; testID: string }[] = [
  { value: 'settings', label: 'Налаштування', testID: 'panelTabSettings' },
  { value: 'contents', label: 'Зміст', testID: 'panelTabContents' },
  { value: 'saved', label: 'Збережене', testID: 'panelTabSaved' },
]

function Contents({ book, chapter, onSelect }: { book: Book; chapter: number; onSelect: (index: number) => void }) {
  return (
    <div class="rp-scroll">
      <div class="rp-contents" role="list">
        {book.chapters.map((item, index) => (
          <button
            key={index}
            type="button"
            role="listitem"
            class="rp-chapter"
            aria-current={index === chapter ? 'true' : undefined}
            aria-label={item.title}
            onClick={() => onSelect(index)}
            data-testid={`chapter-${index}`}
          >
            <span class="rp-chapter-title">{item.title}</span>
            {index === chapter && <Icon name="bookmark" filled size={18} class="rp-chapter-mark" />}
          </button>
        ))}
      </div>
    </div>
  )
}

export function ReaderPanel({ open, onClose, tab, onTab, book, chapter, onSelectChapter, onOpenPlace, onShowShortcuts }: ReaderPanelProps) {
  const [dictionaries, setDictionaries] = useState(false)
  useEffect(() => {
    if (!open) {
      stopSample()
      setDictionaries(false)
    }
  }, [open])
  useEffect(() => () => stopSample(), [])

  return (
    <SidePanel open={open} onClose={onClose} ariaLabel="Налаштування читання" testID="readerPanel">
      {dictionaries ? (
        <DictionaryManager onDone={() => setDictionaries(false)} />
      ) : (
        <>
          <div class="rp-header">
            <Tabs items={tabs} value={tab} onChange={onTab} ariaLabel="Вкладки панелі" />
            <button type="button" class="rp-close" onClick={onClose} aria-label="Закрити" data-testid="closePanel">
              <Icon name="xmark" size={22} strokeWidth={2.2} />
            </button>
          </div>
          <div class="rp-divider rp-header-divider" />
          {tab === 'settings' && <SettingsTab onManageDictionaries={() => setDictionaries(true)} onShowShortcuts={onShowShortcuts} />}
          {tab === 'contents' && (
            <Contents book={book} chapter={chapter} onSelect={(index) => { onSelectChapter(index); onClose() }} />
          )}
          {tab === 'saved' && (
            <div class="rp-scroll rp-saved">
              <SavedList
                currentBookID={book.id}
                existingBooks={new Set([...books.value.map((b) => b.id), book.id])}
                canOpen={(place) => place.bookID === book.id}
                onOpen={onOpenPlace}
              />
            </div>
          )}
        </>
      )}
    </SidePanel>
  )
}
