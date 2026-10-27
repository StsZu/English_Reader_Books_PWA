// Port of EnglishReader/Views/LibraryView.swift: «Мої книжки», import, delete, saved list.
import { useEffect, useRef, useState } from 'preact/hooks'
import { aiServicesOpen, openBook } from '../../app/router.ts'
import { pendingUpdate } from '../../app/update.ts'
import { addBook, books, deleteBook, lastError } from '../../core/storage/library.ts'
import { loadPosition, savePosition } from '../../core/storage/positions.ts'
import { importFile } from '../../core/import/importer.ts'
import { placeParagraph, placeSentence, setPendingSentence, type SavedPlace } from '../../core/saved/saved.ts'
import { formatLabel, type BookSummary } from '../../core/model/book.ts'
import { errorMessage } from '../../contracts.ts'
import {
  ConfirmDialog, ContentUnavailable, ContextMenu, FormSheet, IconButton, NavBar, NoticeBar, ProgressSpinner,
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
  const [partial, setPartial] = useState<{ id: string; chapters: number; unreadable: string[] } | null>(null)
  const input = useRef<HTMLInputElement>(null)
  const list = books.value

  async function onFile(event: Event) {
    const target = event.currentTarget as HTMLInputElement
    const file = target.files?.[0]
    target.value = ''
    if (!file) return
    setImporting(true)
    try {
      const unreadable: string[] = []
      const summary = await addBook(await importFile(file, unreadable))
      if (unreadable.length > 0) setPartial({ id: summary.id, chapters: summary.chapterCount, unreadable })
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
        <div class="library-grid" data-testid="libraryGrid">
          {list.map((book) => (
            <ContextMenu key={book.id} actions={[{ label: 'Видалити', icon: 'trash', destructive: true, testID: 'deleteBook', onSelect: () => setBookToDelete(book) }]}>
              <button type="button" class="book-button" data-testid={`book-${book.title}`} aria-label={book.title} onClick={() => openBook(book.id)}>
                <BookCard book={book} />
              </button>
            </ContextMenu>
          ))}
        </div>
      </main>

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
        message={partial && `Розділів: ${partial.chapters}. Не вдалося прочитати файлів: ${partial.unreadable.length} (${partial.unreadable.join(', ')}). Можливо, EPUB пошкоджений.`}
        actions={[{ label: 'Відкрити', role: 'cancel', testID: 'partialImportOpen' }]}
        onClose={() => {
          if (partial) openBook(partial.id)
          setPartial(null)
        }}
        testID="partialImport"
      />
      <FormSheet open={showSaved} onClose={() => setShowSaved(false)} title="Збережене" ariaLabel="Збережене"
        doneTestID="savedDone" testID="savedSheet" width={700} height={820}>
        <SavedList currentBookID={null} existingBooks={new Set(list.map((b) => b.id))} canOpen={() => true} onOpen={(place) => void open(place)} />
      </FormSheet>
    </div>
  )
}

const palette = ['#5856D6', '#30B0C7', '#A2845E', '#AF52DE', '#007AFF', '#FF9500', '#34C759']

/** Same colour choice as BookCard.color: sum of the title's code points modulo the palette. */
export function coverColor(title: string): string {
  let sum = 0
  for (const ch of title) sum = (sum + ch.codePointAt(0)!) | 0
  return palette[Math.abs(sum) % palette.length]
}

function BookCard({ book }: { book: BookSummary }) {
  const [chapter, setChapter] = useState<number | null>(null)
  useEffect(() => {
    let alive = true
    void loadPosition(book.id).then((position) => { if (alive) setChapter(position ? position.chapter : null) })
    return () => { alive = false }
  }, [book.id])
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
        <span class="book-progress">
          {chapter !== null && book.chapterCount > 0
            ? `Розділ ${chapter + 1} з ${book.chapterCount}`
            : `Розділів: ${book.chapterCount}`}
        </span>
      </div>
    </div>
  )
}
