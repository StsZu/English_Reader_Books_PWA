// Port of EnglishReader/Views/LibraryView.swift: «Мої книжки», import, delete, saved list;
// «Продовжити», search and order of the books (specs/010-library, F2–F3).
import { useEffect, useRef, useState } from 'preact/hooks'
import { aiServicesOpen, openBook } from '../../app/router.ts'
import { pendingUpdate } from '../../app/update.ts'
import {
  addBook, books, deleteBook, filterBooks, lastError, lastOpened, librarySorts, sortBooks,
} from '../../core/storage/library.ts'
import { loadPosition, savePosition } from '../../core/storage/positions.ts'
import { settings } from '../../core/storage/settings.ts'
import { importFile } from '../../core/import/importer.ts'
import type { SkippedContent } from '../../core/import/epub.ts'
import { placeParagraph, placeSentence, setPendingSentence, type SavedPlace } from '../../core/saved/saved.ts'
import { formatLabel, type BookSummary } from '../../core/model/book.ts'
import { errorMessage } from '../../contracts.ts'
import {
  ConfirmDialog, ContentUnavailable, ContextMenu, FormSheet, IconButton, MenuPopover, NavBar, NoticeBar, ProgressSpinner,
  SearchField,
} from '../components/index.ts'
import { SavedList } from '../saved/SavedList.tsx'
import './library.css'

const ACCEPT = '.epub,.txt,.text,.md,.markdown,application/epub+zip,text/plain,text/markdown'

export function LibraryScreen() {
  const [importing, setImporting] = useState(false)
  const [showSaved, setShowSaved] = useState(false)
  const [bookToDelete, setBookToDelete] = useState<BookSummary | null>(null)
  const [deleteError, setDeleteError] = useState<string | null>(null)
  /** A book imported without some EPUB files (R2): opened after the reader has seen the warning. */
  const [partial, setPartial] = useState<{ id: string; chapters: number; unreadable: string[]; skipped: string } | null>(null)
  /** An EPUB whose illustrations, notes or extra pages were left out (specs/011-epub-formatting, E3). */
  const [textOnly, setTextOnly] = useState<{ id: string; skipped: string } | null>(null)
  const [query, setQuery] = useState('')
  const [sortMenu, setSortMenu] = useState<{ x: number; y: number } | null>(null)
  const input = useRef<HTMLInputElement>(null)
  const list = books.value
  const sort = settings.librarySort.value
  const shown = filterBooks(sortBooks(list, sort), query)
  // With one book there is nothing to find, order or continue.
  const many = list.length >= 2
  const resume = many && !query.trim() ? lastOpened(list) : null

  async function onFile(event: Event) {
    const target = event.currentTarget as HTMLInputElement
    const file = target.files?.[0]
    target.value = ''
    if (!file) return
    setImporting(true)
    try {
      const unreadable: string[] = []
      const left: SkippedContent = { images: 0, notes: 0, pages: 0 }
      const summary = await addBook(await importFile(file, unreadable, left))
      const skipped = skippedSummary(left)
      if (unreadable.length > 0) setPartial({ id: summary.id, chapters: summary.chapterCount, unreadable, skipped })
      else if (skipped) setTextOnly({ id: summary.id, skipped })
      else openBook(summary.id)
    } catch (error) {
      lastError.value = errorMessage(error)
    } finally {
      setImporting(false)
    }
  }

  /** Opens the book of a saved word or quote on its paragraph and selects the sentence. */
  async function open(place: SavedPlace) {
    if (!list.some((b) => b.id === place.bookID)) return
    await savePosition(place.bookID, placeParagraph(place))
    setPendingSentence({ bookID: place.bookID, ref: placeSentence(place) })
    setShowSaved(false)
    openBook(place.bookID)
  }

  return (
    <div class="library-screen">
      <NavBar
        largeTitle="Мої книжки"
        leading={<IconButton icon="gearshape" label="Налаштування" testID="settingsButton" onClick={() => { aiServicesOpen.value = true }} />}
        trailing={
          <>
            <IconButton icon="bookmark" label="Збережене" testID="savedButton" onClick={() => setShowSaved(true)} />
            {importing
              ? <span class="library-importing" data-testid="importButton" aria-label="Імпорт" aria-busy="true"><ProgressSpinner size="small" label="Імпорт" /></span>
              : <IconButton icon="plus" label="Імпорт" testID="importButton" onClick={() => input.current?.click()} />}
          </>
        }
      />
      {pendingUpdate.value && (
        <NoticeBar text="Доступна нова версія." actionTitle="Оновити" onAction={pendingUpdate.value} testID="updateBar" />
      )}
      <input ref={input} type="file" accept={ACCEPT} class="library-input" data-testid="importInput" onChange={onFile} />
      <main class="library-scroll">
        {list.length === 0 && (
          <div class="library-empty">
            <ContentUnavailable icon="books.vertical" title="Бібліотека порожня"
              description="Натисніть «Імпорт», щоб додати книжку EPUB, TXT або MD." testID="libraryEmpty" />
          </div>
        )}
        {many && (
          <div class="library-tools">
            <SearchField value={query} onInput={setQuery} placeholder="Назва або автор" testID="librarySearch" />
            <IconButton icon="arrow.up.arrow.down" label="Сортування" testID="librarySortButton"
              onClick={(event) => {
                const box = (event.currentTarget as HTMLElement).getBoundingClientRect()
                setSortMenu({ x: box.left + box.width / 2, y: box.bottom })
              }} />
          </div>
        )}
        {resume && <ContinueRow book={resume} />}
        {many && shown.length === 0 && (
          <div class="library-no-results">
            <ContentUnavailable icon="magnifyingglass" title="Нічого не знайдено" testID="libraryNoResults" />
          </div>
        )}
        <div class="library-grid" data-testid="libraryGrid">
          {shown.map((book) => (
            <ContextMenu key={book.id} actions={[{ label: 'Видалити', icon: 'trash', destructive: true, testID: 'deleteBook', onSelect: () => setBookToDelete(book) }]}>
              <button type="button" class="book-button" data-testid={`book-${book.title}`} aria-label={book.title} onClick={() => openBook(book.id)}>
                <BookCard book={book} />
              </button>
            </ContextMenu>
          ))}
        </div>
      </main>

      {sortMenu && (
        <MenuPopover x={sortMenu.x} y={sortMenu.y} onClose={() => setSortMenu(null)}
          actions={librarySorts.map((item) => ({
            label: item.label,
            icon: item.value === sort ? 'checkmark' : undefined,
            testID: `librarySort-${item.value}`,
            onSelect: () => { settings.librarySort.value = item.value },
          }))} />
      )}
      <ConfirmDialog
        open={lastError.value !== null}
        title="Не вдалося імпортувати"
        message={lastError.value ?? ''}
        actions={[{ label: 'Гаразд', role: 'cancel', testID: 'importErrorOK' }]}
        onClose={() => { lastError.value = null }}
        testID="importError"
      />
      <ConfirmDialog
        open={bookToDelete !== null}
        style="actionSheet"
        title={`Видалити книжку «${bookToDelete?.title ?? ''}»?`}
        actions={[
          {
            label: 'Видалити', role: 'destructive', testID: 'confirmDelete',
            onSelect: () => { if (bookToDelete) deleteBook(bookToDelete.id).catch((error) => setDeleteError(errorMessage(error))) },
          },
          { label: 'Скасувати', role: 'cancel' },
        ]}
        onClose={() => setBookToDelete(null)}
        testID="deleteDialog"
      />
      <ConfirmDialog
        open={deleteError !== null}
        title="Не вдалося видалити"
        message={deleteError ?? ''}
        actions={[{ label: 'Гаразд', role: 'cancel' }]}
        onClose={() => setDeleteError(null)}
        testID="deleteError"
      />
      <ConfirmDialog
        open={partial !== null}
        title="Книжку імпортовано не повністю"
        message={partial && `Розділів: ${partial.chapters}. Не вдалося прочитати файлів: ${partial.unreadable.length} (${partial.unreadable.join(', ')}). Можливо, EPUB пошкоджений.`
          + (partial.skipped ? ` Також не перенесено: ${partial.skipped}.` : '')}
        actions={[{ label: 'Відкрити', role: 'cancel', testID: 'partialImportOpen' }]}
        onClose={() => {
          if (partial) openBook(partial.id)
          setPartial(null)
        }}
        testID="partialImport"
      />
      <ConfirmDialog
        open={textOnly !== null}
        title="Книжку імпортовано як текст"
        message={textOnly && `Застосунок переносить лише текст книжки. Не перенесено: ${textOnly.skipped}.`}
        actions={[{ label: 'Відкрити', role: 'cancel', testID: 'textImportOpen' }]}
        onClose={() => {
          if (textOnly) openBook(textOnly.id)
          setTextOnly(null)
        }}
        testID="textImport"
      />
      <FormSheet open={showSaved} onClose={() => setShowSaved(false)} title="Збережене" ariaLabel="Збережене"
        doneTestID="savedDone" testID="savedSheet" width={700} height={820}>
        <SavedList currentBookID={null} existingBooks={new Set(list.map((b) => b.id))} canOpen={() => true} onOpen={(place) => void open(place)} />
      </FormSheet>
    </div>
  )
}

/** «ілюстрацій: 12, приміток: 30, додаткових сторінок: 2»; empty when nothing was left out. */
export function skippedSummary(left: SkippedContent): string {
  const parts: [number, string][] = [[left.images, 'ілюстрацій'], [left.notes, 'приміток'], [left.pages, 'додаткових сторінок']]
  return parts.filter(([count]) => count > 0).map(([count, label]) => `${label}: ${count}`).join(', ')
}

const palette = ['#5856D6', '#30B0C7', '#A2845E', '#AF52DE', '#007AFF', '#FF9500', '#34C759']

/** Same colour choice as BookCard.color: sum of the title's code points modulo the palette. */
export function coverColor(title: string): string {
  let sum = 0
  for (const ch of title) sum = (sum + ch.codePointAt(0)!) | 0
  return palette[Math.abs(sum) % palette.length]
}

/** The chapter of the saved reading place; null before the book was read. */
function useSavedChapter(bookID: string): number | null {
  const [chapter, setChapter] = useState<number | null>(null)
  useEffect(() => {
    let alive = true
    void loadPosition(bookID).then((position) => { if (alive) setChapter(position ? position.chapter : null) })
    return () => { alive = false }
  }, [bookID])
  return chapter
}

const progressText = (book: BookSummary, chapter: number | null): string =>
  chapter !== null && book.chapterCount > 0 ? `Розділ ${chapter + 1} з ${book.chapterCount}` : `Розділів: ${book.chapterCount}`

/** The last opened book above the grid (specs/010-library, F2). */
function ContinueRow({ book }: { book: BookSummary }) {
  const chapter = useSavedChapter(book.id)
  return (
    <button type="button" class="library-continue" data-testid="continueReading" aria-label={`Продовжити: ${book.title}`}
      onClick={() => openBook(book.id)}>
      <span class="library-continue-cover" style={{ '--cover': coverColor(book.title) }} />
      <span class="library-continue-text">
        <span class="library-continue-label">Продовжити</span>
        <span class="library-continue-title">{book.title}</span>
        {book.author && <span class="library-continue-author">{book.author}</span>}
        <span class="library-continue-place" data-testid="continuePlace">{progressText(book, chapter)}</span>
      </span>
    </button>
  )
}

function BookCard({ book }: { book: BookSummary }) {
  const chapter = useSavedChapter(book.id)
  const color = coverColor(book.title)
  return (
    <div class="book-card">
      <div class="book-cover" style={{ '--cover': color }}>
        <div class="book-cover-text">
          <div class="book-title">{book.title}</div>
          {book.author && <div class="book-author">{book.author}</div>}
        </div>
      </div>
      <div class="book-meta">
        <span class="book-format">{formatLabel(book.format)}</span>
        <span class="book-progress">{progressText(book, chapter)}</span>
      </div>
    </div>
  )
}
