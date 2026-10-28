// Port of ReaderPanel.swift: reading settings, contents and saved items, sliding in from the right (D1–D7);
// search in the book above the contents (specs/010-library, F4).
import { useEffect, useMemo, useRef, useState } from 'preact/hooks'
import type { Book, ContentsEntry, ParagraphRef, SentenceRef } from '../../../core/model/book.ts'
import { MIN_QUERY_LENGTH, searchBook, SEARCH_LIMIT, type SearchHit } from '../../../core/model/search.ts'
import { fold } from '../../../core/util/fold.ts'
import { sourceLanguage } from '../../../core/language.ts'
import type { SavedPlace } from '../../../core/saved/saved.ts'
import { stopSample } from '../../../core/speech/engines.ts'
import { books } from '../../../core/storage/library.ts'
import { SearchField, SidePanel, Tabs } from '../../components/index.ts'
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
  /** The paragraph at the top of the screen: the current entry of the book's own contents. */
  paragraph: number
  onSelectChapter: (index: number) => void
  /** An entry of the book's own contents (specs/011-epub-formatting, E1). */
  onSelectParagraph: (ref: ParagraphRef) => void
  onOpenPlace: (place: SavedPlace) => void
  onShowShortcuts: () => void
  /** A search result chosen in «Зміст». */
  onFound: (ref: SentenceRef) => void
  /** Bumped by ⌘F: the search field of «Зміст» takes the focus. */
  searchFocus: number
}

const tabs: { value: ReaderPanelTab; label: string; testID: string }[] = [
  { value: 'settings', label: 'Налаштування', testID: 'panelTabSettings' },
  { value: 'contents', label: 'Зміст', testID: 'panelTabContents' },
  { value: 'saved', label: 'Збережене', testID: 'panelTabSaved' },
]

/** Typing settles for this long before the book is searched. */
const SEARCH_DELAY = 200

/** At most this many characters of a long sentence around the match. */
const SNIPPET = 160

function snippet(hit: SearchHit) {
  const [start, end] = hit.match
  let from = 0
  let to = hit.text.length
  if (to > SNIPPET) {
    from = Math.max(0, Math.min(start - 40, to - SNIPPET))
    to = Math.min(to, from + SNIPPET)
  }
  return (
    <>
      {from > 0 && '…'}
      {hit.text.slice(from, start)}
      <mark>{hit.text.slice(start, end)}</mark>
      {hit.text.slice(end, to)}
      {to < hit.text.length && '…'}
    </>
  )
}

/** The last entry at or before the place, i.e. the part of the book being read. */
export function currentEntry(entries: ContentsEntry[], place: ParagraphRef): number {
  let current = -1
  entries.forEach((entry, index) => {
    if (entry.chapter < place.chapter || (entry.chapter === place.chapter && entry.paragraph <= place.paragraph)) current = index
  })
  return current
}

function BookContents({ entries, place, onSelect }: { entries: ContentsEntry[]; place: ParagraphRef; onSelect: (ref: ParagraphRef) => void }) {
  const current = currentEntry(entries, place)
  return (
    <div class="rp-contents" role="list">
      {entries.map((entry, index) => (
        <button
          key={index}
          type="button"
          role="listitem"
          class="rp-chapter rp-entry"
          style={{ '--level': entry.level }}
          aria-current={index === current ? 'true' : undefined}
          aria-label={entry.title}
          onClick={() => onSelect({ chapter: entry.chapter, paragraph: entry.paragraph })}
          data-testid={`contents-${index}`}
        >
          <span class="rp-chapter-title">{entry.title}</span>
          {index === current && <Icon name="bookmark" filled size={18} class="rp-chapter-mark" />}
        </button>
      ))}
    </div>
  )
}

interface ContentsProps {
  book: Book
  chapter: number
  paragraph: number
  onSelect: (index: number) => void
  onSelectParagraph: (ref: ParagraphRef) => void
  query: string
  onQuery: (query: string) => void
  onFound: (ref: SentenceRef) => void
  searchFocus: number
}

function Contents({ book, chapter, paragraph, onSelect, onSelectParagraph, query, onQuery, onFound, searchFocus }: ContentsProps) {
  const box = useRef<HTMLDivElement>(null)
  const [searched, setSearched] = useState(query)
  useEffect(() => {
    const timer = setTimeout(() => setSearched(query), SEARCH_DELAY)
    return () => clearTimeout(timer)
  }, [query])
  useEffect(() => {
    if (searchFocus) box.current?.querySelector<HTMLInputElement>('.rp-search input')?.focus()
  }, [searchFocus])
  const result = useMemo(() => searchBook(book, searched), [book, searched])
  // Until the query is long enough the contents stay in place.
  const searching = fold(searched.trim()).length >= MIN_QUERY_LENGTH

  return (
    <div class="rp-scroll" ref={box}>
      <div class="rp-search">
        <SearchField value={query} onInput={onQuery} placeholder="Пошук у книжці" testID="bookSearch" />
      </div>
      {searching ? (
        <div class="rp-results" data-testid="searchResults">
          {result.hits.length === 0 && <p class="rp-results-empty" data-testid="searchNoResults">Нічого не знайдено</p>}
          {result.hits.length > 0 && (
            <div class="rp-contents" role="list">
              {result.hits.map((hit, index) => (
                <button key={index} type="button" role="listitem" class="rp-hit" onClick={() => onFound(hit.ref)}
                  data-testid={`searchResult-${index}`}>
                  <span class="rp-hit-chapter">{hit.chapterTitle}</span>
                  <span class="rp-hit-text" lang={sourceLanguage}>{snippet(hit)}</span>
                </button>
              ))}
            </div>
          )}
          {result.total > result.hits.length && (
            <p class="rp-footnote rp-results-more" data-testid="searchMore">Показано {SEARCH_LIMIT} з {result.total}</p>
          )}
        </div>
      ) : book.contents ? (
        <BookContents entries={book.contents} place={{ chapter, paragraph }} onSelect={onSelectParagraph} />
      ) : (
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
      )}
    </div>
  )
}

export function ReaderPanel({
  open, onClose, tab, onTab, book, chapter, paragraph, onSelectChapter, onSelectParagraph, onOpenPlace, onShowShortcuts, onFound,
  searchFocus,
}: ReaderPanelProps) {
  const [dictionaries, setDictionaries] = useState(false)
  /** Kept while the panel is closed: the next result is one tap away. */
  const [query, setQuery] = useState('')
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
            <Contents book={book} chapter={chapter} paragraph={paragraph} onSelect={(index) => { onSelectChapter(index); onClose() }}
              onSelectParagraph={(ref) => { onSelectParagraph(ref); onClose() }}
              query={query} onQuery={setQuery} onFound={(ref) => { onFound(ref); onClose() }} searchFocus={searchFocus} />
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
