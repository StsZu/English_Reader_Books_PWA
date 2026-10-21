// Port of EnglishReader/Views/SavedView.swift (stage 2.3, Z3, Z5): a tab of the reading panel and a screen of the library.
import type { ComponentChildren } from 'preact'
import { useRef, useState } from 'preact/hooks'
import {
  filterQuotes, filterWords, quotes as savedQuotes, removeQuote, removeWord, words as savedWords,
  type SavedPlace, type SavedQuote, type SavedWord,
} from '../../core/saved/saved.ts'
import { formatDayMonth } from '../../core/util/format.ts'
import { openTraining } from '../../app/router.ts'
import { Button, List, SearchField, Section, Segmented, Toggle, cx } from '../components/index.ts'
import { Icon } from '../icons.tsx'
import { quotesFile, shareFile, wordsFile } from './export.ts'
import './saved.css'

export interface SavedListProps {
  /** The open book; null in the library, where all books are listed. */
  currentBookID: string | null
  /** Books that still exist; places of deleted books are marked and cannot be opened. */
  existingBooks: Set<string>
  /** Whether a place can be opened from here (in the reader only the open book). */
  canOpen: (place: SavedPlace) => boolean
  onOpen: (place: SavedPlace) => void
}

type Kind = 'words' | 'quotes'

export function trainingStatus(word: SavedWord): string {
  if (word.trainingLevel >= 5) return 'вивчено'
  const date = word.nextReview ? formatDayMonth(new Date(word.nextReview)) : ''
  return `рівень ${word.trainingLevel}` + (date ? ` · повторити ${date}` : '')
}

export function SavedList({ currentBookID, existingBooks, canOpen, onOpen }: SavedListProps) {
  const [kind, setKind] = useState<Kind>('words')
  const [query, setQuery] = useState('')
  const [allBooks, setAllBooks] = useState(false)
  const [expanded, setExpanded] = useState<string | null>(null)

  const scope = allBooks ? null : currentBookID
  const words = filterWords(scope, query, savedWords.value)
  const quotes = filterQuotes(scope, query, savedQuotes.value)
  const canShare = kind === 'words' ? words.length > 0 : quotes.length > 0

  const place = (p: SavedPlace, testID: string, label: ComponentChildren) => {
    if (!existingBooks.has(p.bookID)) {
      return (
        <div class="saved-place">
          {label}
          <span class="saved-note is-deleted">книжку видалено</span>
        </div>
      )
    }
    if (canOpen(p)) {
      return (
        <button type="button" class="saved-place is-button" onClick={() => onOpen(p)} data-testid={testID}>
          <span class="saved-place-label">{label}</span>
          <span class="saved-go"><Icon name="arrow.right.circle" size={22} /></span>
        </button>
      )
    }
    return (
      <div class="saved-place">
        {label}
        <span class="saved-note">відкривається з бібліотеки</span>
      </div>
    )
  }

  return (
    <List class="saved-list" testID="savedList">
      <Section>
        <div class="saved-controls">
          <Segmented<Kind>
            ariaLabel="Вид"
            testID="savedKind"
            value={kind}
            onChange={setKind}
            items={[
              { value: 'words', label: `Слова (${words.length})`, testID: 'savedKindWords' },
              { value: 'quotes', label: `Цитати (${quotes.length})`, testID: 'savedKindQuotes' },
            ]}
          />
        </div>
        {currentBookID !== null && (
          <div class="saved-controls">
            <Toggle label="Усі книжки" checked={allBooks} onChange={setAllBooks} testID="savedAllBooks" />
          </div>
        )}
        <div class="saved-controls">
          <SearchField value={query} onInput={setQuery} placeholder="Пошук англійською або українською" testID="savedSearch" />
        </div>
        {canShare && (
          <div class="saved-controls">
            <Button
              icon="square.and.arrow.up"
              testID="savedShare"
              onClick={() => void shareFile(kind === 'words' ? wordsFile(words) : quotesFile(quotes))}
            >
              Поділитися
            </Button>
          </div>
        )}
        <div class="saved-controls">
          <Button icon="graduationcap" testID="startTraining" onClick={openTraining}>Тренування</Button>
        </div>
      </Section>

      <Section>
        {kind === 'words' && words.length === 0 && (
          <Empty title="Збережених слів немає" hint="Збережіть слово кнопкою «Зберегти» в його картці." />
        )}
        {kind === 'quotes' && quotes.length === 0 && (
          <Empty title="Збережених цитат немає" hint="Виділіть фрагмент і натисніть «Зберегти» у верхній панелі." />
        )}
        {kind === 'words' && words.map((word) => (
          <SwipeRow key={word.id} onDelete={() => { void removeWord(word.id) }}>
            <WordRow
              word={word}
              expanded={expanded === word.id}
              onToggle={() => setExpanded(expanded === word.id ? null : word.id)}
              place={place}
              onDelete={() => { void removeWord(word.id) }}
            />
          </SwipeRow>
        ))}
        {kind === 'quotes' && quotes.map((quote) => (
          <SwipeRow key={quote.id} onDelete={() => { void removeQuote(quote.id) }}>
            <QuoteRow quote={quote} place={place} />
          </SwipeRow>
        ))}
      </Section>
    </List>
  )
}

function Empty({ title, hint }: { title: string; hint: string }) {
  return (
    <div class="saved-empty" data-testid="savedEmpty">
      <span class="saved-empty-title">{title}</span>
      <span class="saved-empty-hint">{hint}</span>
    </div>
  )
}

type PlaceRenderer = (p: SavedPlace, testID: string, label: ComponentChildren) => ComponentChildren

function WordRow({ word, expanded, onToggle, place, onDelete }: {
  word: SavedWord
  expanded: boolean
  onToggle: () => void
  place: PlaceRenderer
  onDelete: () => void
}) {
  const details = [word.ipa ? `/${word.ipa}/` : '', word.partOfSpeech].filter(Boolean).join(' · ')
  return (
    <div class={cx('saved-word', expanded && 'is-expanded')}>
      <button type="button" class="saved-word-head" onClick={onToggle} aria-expanded={expanded} data-testid={`savedWord-${word.lemma}`}>
        <span class="saved-lemma">{word.lemma}</span>
        {word.level && <span class="saved-level">{word.level}</span>}
        <span class="saved-translation">{word.contextTranslation}</span>
        {word.trainingLevel > 0 && (
          <span class={cx('saved-training', word.lastResultUnknown && 'is-unknown')} data-testid={`trainingStatus-${word.lemma}`}>
            {trainingStatus(word)}
          </span>
        )}
        <span class="saved-chevron"><Icon name={expanded ? 'chevron.up' : 'chevron.down'} size={14} strokeWidth={2.6} /></span>
      </button>
      {expanded && (
        <div class="saved-word-body">
          {details && <span class="saved-details">{details}</span>}
          {word.forms && <span class="saved-forms">{word.forms}</span>}
          {word.otherTranslations.length > 0 && (
            <span class="saved-other">{'Інші значення: ' + word.otherTranslations.join(', ')}</span>
          )}
          {word.contexts.map((context, index) => (
            <div key={index} class="saved-context">
              {place(context.place, `savedContext-${word.lemma}`, (
                <span class="saved-context-text">
                  <span class="saved-sentence">{context.sentence}</span>
                  <span class="saved-meta">{`«${context.translation}» · ${context.place.bookTitle}`}</span>
                </span>
              ))}
            </div>
          ))}
          <div class="saved-word-actions">
            <Button icon="trash" variant="destructive" size="small" onClick={onDelete} testID={`savedWordDelete-${word.lemma}`}>
              Видалити
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}

function QuoteRow({ quote, place }: { quote: SavedQuote; place: PlaceRenderer }) {
  return (
    <div class="saved-quote">
      {place(quote.place, 'savedQuote', (
        <span class="saved-quote-text">
          <span class="saved-quote-en">{quote.text}</span>
          <span class="saved-quote-uk">{quote.translation}</span>
          <span class="saved-meta">{quote.place.bookTitle}</span>
        </span>
      ))}
    </div>
  )
}

const ACTION_WIDTH = 88

/** List row with iOS swipe-to-delete: drag left reveals «Видалити»; a long swipe deletes at once. */
function SwipeRow({ children, onDelete }: { children: ComponentChildren; onDelete: () => void }) {
  const [offset, setOffset] = useState(0)
  const [dragging, setDragging] = useState(false)
  const drag = useRef<{ x: number; y: number; base: number; horizontal: boolean | null; id: number } | null>(null)
  const width = useRef(0)
  /** The click that ends a horizontal drag must not open or expand the row. */
  const suppressClick = useRef(false)

  const onPointerDown = (event: PointerEvent) => {
    if (event.pointerType === 'mouse' && event.button !== 0) return
    width.current = (event.currentTarget as HTMLElement).offsetWidth
    drag.current = { x: event.clientX, y: event.clientY, base: offset, horizontal: null, id: event.pointerId }
  }
  const onPointerMove = (event: PointerEvent) => {
    const state = drag.current
    if (!state || state.id !== event.pointerId) return
    const dx = event.clientX - state.x
    const dy = event.clientY - state.y
    if (state.horizontal === null) {
      if (Math.abs(dx) < 8 && Math.abs(dy) < 8) return
      state.horizontal = Math.abs(dx) > Math.abs(dy)
      if (state.horizontal) {
        setDragging(true)
        ;(event.currentTarget as HTMLElement).setPointerCapture(event.pointerId)
      }
    }
    if (!state.horizontal) return
    event.preventDefault()
    setOffset(Math.min(0, Math.max(-width.current, state.base + dx)))
  }
  const onPointerUp = (event: PointerEvent) => {
    const state = drag.current
    drag.current = null
    if (!state || !state.horizontal) return
    suppressClick.current = true
    setTimeout(() => { suppressClick.current = false }, 350)
    setDragging(false)
    const current = Math.min(0, state.base + (event.clientX - state.x))
    if (width.current > 0 && -current > width.current * 0.6) {
      setOffset(0)
      onDelete()
    } else {
      setOffset(-current > ACTION_WIDTH / 2 ? -ACTION_WIDTH : 0)
    }
  }
  const onClickCapture = (event: MouseEvent) => {
    if (suppressClick.current) {
      suppressClick.current = false
      event.stopPropagation()
      event.preventDefault()
      return
    }
    // A tap on an open row closes it instead of activating its content.
    if (offset !== 0) {
      event.stopPropagation()
      event.preventDefault()
      setOffset(0)
    }
  }

  return (
    <div class="swipe-row" data-testid="savedRow">
      <button
        type="button"
        class="swipe-delete"
        aria-label="Видалити"
        tabIndex={offset === 0 ? -1 : 0}
        onClick={() => { setOffset(0); onDelete() }}
        data-testid="savedDelete"
      >
        Видалити
      </button>
      <div
        class={cx('swipe-content', dragging && 'is-dragging')}
        style={{ transform: `translateX(${offset}px)` }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onClickCapture={onClickCapture}
      >
        {children}
      </div>
    </div>
  )
}
