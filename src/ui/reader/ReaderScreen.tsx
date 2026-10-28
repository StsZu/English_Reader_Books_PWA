// Port of EnglishReader/Views/ReaderView.swift: layout, scrolling, position, auto-hide and reading-aloud follow.
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'preact/hooks'
import { effect } from '@preact/signals'
import { IconButton, NavBar, NoticeBar, ProgressSpinner } from '../components/index.ts'
import { loadBook, markOpened } from '../../core/storage/library.ts'
import { settings } from '../../core/storage/settings.ts'
import { highlightForms, words as savedWords } from '../../core/saved/saved.ts'
import { sameParagraph, type Book } from '../../core/model/book.ts'
import { unlockAudio } from '../../core/speech/audio.ts'
import { aiServicesOpen, openLibrary } from '../../app/router.ts'
import { sourceLanguage } from '../../core/language.ts'
import { fontInfo, lineHeight } from '../theme/fonts.ts'
import { ReaderPanel } from './panel/ReaderPanel.tsx'
import { WordCard } from '../word/WordCard.tsx'
import { ReaderModel } from './model.ts'
import { Paragraph } from './Paragraph.tsx'
import { ParallelPane } from './ParallelPane.tsx'
import { ChapterNav, PlaybackBar } from './PlaybackBar.tsx'
import { AudioSheet } from './AudioSheet.tsx'
import { ShortcutsSheet } from './ShortcutsSheet.tsx'
import { useReaderShortcuts } from './shortcuts.ts'
import { attachGestures } from './gestures.ts'
import './reader.css'

const VERTICAL_PADDING = 28
const EMPTY: readonly number[] = []
const NO_FORMS: ReadonlySet<string> = new Set()

export function ReaderScreen({ bookID }: { bookID: string }) {
  const [model, setModel] = useState<ReaderModel | null>(null)
  useEffect(() => {
    let created: ReaderModel | null = null
    let cancelled = false
    void loadBook(bookID).then(async (book: Book | null) => {
      if (!book || cancelled) {
        if (!book) openLibrary()
        return
      }
      void markOpened(book.id)
      created = new ReaderModel(book)
      await created.load()
      if (!cancelled) setModel(created)
    })
    return () => {
      cancelled = true
      created?.dispose()
    }
  }, [bookID])
  if (!model) return <div class="reader-loading"><ProgressSpinner /></div>
  return <Reader model={model} />
}

type PanelTab = 'settings' | 'contents' | 'saved'

function Reader({ model }: { model: ReaderModel }) {
  const scroller = useRef<HTMLDivElement>(null)
  const [panelOpen, setPanelOpen] = useState(false)
  const [panelTab, setPanelTab] = useState<PanelTab>('settings')
  const [shortcutsOpen, setShortcutsOpen] = useState(false)
  const [searchFocus, setSearchFocus] = useState(0)
  useReaderShortcuts(model, () => setShortcutsOpen(true), () => {
    openPanel('contents')
    setSearchFocus((n) => n + 1)
  })
  const scroll = useRef({ last: 0, anchor: null as number | null, touching: false, user: false, programmatic: false, idle: 0, save: 0 })

  const chapterIndex = model.chapter.value
  const chapter = model.currentChapter
  const fontName = settings.bookFont.value
  const fontSize = settings.fontSize.value
  const spacing = fontSize * settings.lineSpacingFactor.value
  const bookLineHeight = lineHeight(fontName, fontSize) + spacing
  const active = model.activeSentence.value
  const wordCursor = model.wordCursor.value
  const current = model.reading.current.value
  const selection = model.selection.value
  const showTranslation = settings.showTranslation.value
  const savedList = savedWords.value
  const highlightSaved = settings.highlightSavedWords.value
  const savedForms = useMemo(() => (highlightSaved ? highlightForms() : NO_FORMS), [highlightSaved, savedList])

  const openPanel = (tab: PanelTab) => {
    setPanelTab(tab)
    setPanelOpen(true)
  }

  // MARK: Scrolling helpers

  const paragraphElement = (index: number) => scroller.current?.querySelector<HTMLElement>(`[data-p="${index}"]`) ?? null

  const settleLater = () => {
    const s = scroll.current
    clearTimeout(s.idle)
    s.idle = window.setTimeout(() => {
      if (!s.touching) s.user = false
      s.programmatic = false
    }, 160)
  }

  const scrollToParagraph = (index: number, smooth = false) => {
    const el = scroller.current
    const target = paragraphElement(index)
    if (!el) return
    const top = index <= 0 || !target ? 0 : target.offsetTop - VERTICAL_PADDING
    const s = scroll.current
    s.programmatic = true
    s.user = false
    el.scrollTo({ top, behavior: smooth ? 'smooth' : 'instant' as ScrollBehavior })
    settleLater()
  }

  const updateTopParagraph = () => {
    const el = scroller.current
    if (!el) return
    const top = el.scrollTop + VERTICAL_PADDING / 2
    const paragraphs = el.querySelectorAll<HTMLElement>('[data-p]')
    let found = 0
    for (const p of paragraphs) {
      if (p.offsetTop + p.offsetHeight > top) {
        found = Number(p.dataset.p)
        break
      }
    }
    if (found !== model.topParagraph.value) {
      model.topParagraph.value = found
      const s = scroll.current
      clearTimeout(s.save)
      s.save = window.setTimeout(() => model.savePosition(), 250)
    }
  }

  // Scroll listener: top paragraph and auto-hide by lines (A2–A6).
  useEffect(() => {
    const el = scroller.current
    if (!el) return
    const s = scroll.current
    s.last = el.scrollTop
    const onScroll = () => {
      const now = el.scrollTop
      const delta = now - s.last
      s.last = now
      if (s.anchor !== null) {
        if (!s.user || s.programmatic) {
          s.anchor += delta
        } else if (settings.parallelTranslationAutoHide.value
          && Math.abs(now - s.anchor) >= settings.parallelTranslationAutoHideLines.value * bookLineHeightRef.current) {
          model.hideParallelTranslation()
        }
      }
      settleLater()
      updateTopParagraph()
    }
    const onTouchStart = () => { s.touching = true; s.user = true; s.programmatic = false }
    const onTouchEnd = () => { s.touching = false; settleLater() }
    const onWheel = () => { s.user = true; s.programmatic = false; settleLater() }
    el.addEventListener('scroll', onScroll, { passive: true })
    el.addEventListener('touchstart', onTouchStart, { passive: true })
    el.addEventListener('touchend', onTouchEnd, { passive: true })
    el.addEventListener('touchcancel', onTouchEnd, { passive: true })
    el.addEventListener('pointerdown', onTouchStart, { passive: true })
    el.addEventListener('pointerup', onTouchEnd, { passive: true })
    el.addEventListener('wheel', onWheel, { passive: true })
    return () => {
      el.removeEventListener('scroll', onScroll)
      el.removeEventListener('touchstart', onTouchStart)
      el.removeEventListener('touchend', onTouchEnd)
      el.removeEventListener('touchcancel', onTouchEnd)
      el.removeEventListener('pointerdown', onTouchStart)
      el.removeEventListener('pointerup', onTouchEnd)
      el.removeEventListener('wheel', onWheel)
    }
  }, [])

  const bookLineHeightRef = useRef(bookLineHeight)
  bookLineHeightRef.current = bookLineHeight

  // Counting starts again whenever a sentence translation or a fragment appears in the top panel.
  const hasSelection = selection !== null
  useEffect(() => {
    scroll.current.anchor = active || hasSelection ? scroller.current?.scrollTop ?? 0 : null
  }, [active, hasSelection])

  // Restore the position when a chapter opens, and on explicit requests (saved places).
  const scrollRequest = model.scrollRequest.value
  useLayoutEffect(() => {
    scrollToParagraph(model.topParagraph.value)
  }, [chapterIndex, scrollRequest])

  // A sentence chosen from the keyboard scrolls into view without counting as the reader's own scroll (A3).
  const revealRequest = model.revealRequest.value
  useLayoutEffect(() => {
    const ref = model.activeSentence.peek()
    if (!revealRequest || !ref) return
    const target = paragraphElement(ref.paragraph.paragraph)?.querySelector<HTMLElement>(`[data-s="${ref.sentence}"]`)
    if (!target) return
    const s = scroll.current
    s.programmatic = true
    s.user = false
    target.scrollIntoView({ block: 'nearest' })
    settleLater()
  }, [revealRequest])

  // After layout changes keep the reader on the same paragraph.
  const typography = `${fontName}|${fontSize}|${settings.lineSpacingFactor.value}|${settings.sideMargin.value}|${settings.firstLineIndent.value}|${settings.paragraphSpacingFactor.value}|${settings.justifyText.value}|${showTranslation}|${settings.parallelTranslationMultiline.value}|${settings.parallelTranslationScale.value}`
  const firstLayout = useRef(true)
  useLayoutEffect(() => {
    if (firstLayout.current) {
      firstLayout.current = false
      return
    }
    scrollToParagraph(model.topParagraph.value)
  }, [typography])

  // Follow reading aloud.
  const currentParagraph = current?.paragraph
  useEffect(() => {
    if (!currentParagraph) return
    if (currentParagraph.chapter !== model.chapter.value) {
      model.goToChapter(currentParagraph.chapter, currentParagraph.paragraph)
    } else if (currentParagraph.paragraph !== model.topParagraph.value) {
      scrollToParagraph(currentParagraph.paragraph, true)
    }
  }, [currentParagraph?.chapter, currentParagraph?.paragraph])

  // Gestures on the text (G1–G7, X1).
  useEffect(() => {
    const el = scroller.current
    if (!el) return
    return attachGestures(el, {
      touched: () => unlockAudio(),
      tap: (hit) => model.handleWordTap(hit.text, {
        paragraph: { chapter: model.chapter.value, paragraph: hit.paragraph }, sentence: hit.position.sentence,
      }),
      longPressBegan: () => model.longPressBegan(),
      longPressMoved: (anchor, focus) => model.updateSelection(
        { chapter: model.chapter.value, paragraph: anchor.paragraph }, anchor.position, focus),
      longPressEnded: (hit, sentence, moved) => model.longPressEnded(
        hit && sentence !== null ? { paragraph: { chapter: model.chapter.value, paragraph: hit.paragraph }, sentence } : null,
        hit?.position ?? null, moved),
    })
  }, [])

  // Turning the translation off hides it; closing «ШІ-сервіси» retries failed requests.
  useEffect(() => {
    let wasOpen = aiServicesOpen.peek()
    let wasShown = settings.showTranslation.peek()
    return effect(() => {
      const open = aiServicesOpen.value
      if (wasOpen && !open) model.retryFailed()
      wasOpen = open
      const shown = settings.showTranslation.value
      if (wasShown && !shown) model.hideParallelTranslation()
      wasShown = shown
    })
  }, [])

  useEffect(() => {
    const onHide = () => { if (document.visibilityState !== 'visible') model.savePosition() }
    document.addEventListener('visibilitychange', onHide)
    window.addEventListener('pagehide', onHide)
    return () => {
      document.removeEventListener('visibilitychange', onHide)
      window.removeEventListener('pagehide', onHide)
    }
  }, [])

  const leave = () => {
    model.dispose()
    openLibrary()
  }

  const columnStyle = {
    '--book-font': fontInfo(fontName).cssFamily,
    '--book-size': `${fontSize}px`,
    '--book-line': `${bookLineHeight}px`,
    '--heading-size': `${fontSize * 1.35}px`,
    '--heading-line': `${lineHeight(fontName, fontSize * 1.35) + fontSize * 1.35 * settings.lineSpacingFactor.value}px`,
    '--indent': `${settings.firstLineIndent.value}em`,
    '--para-gap': `${fontSize * settings.paragraphSpacingFactor.value}px`,
    // The margin from settings is an upper bound: a narrow window keeps at least 14 font sizes of text per line (specs/008, A2).
    '--side': `min(${settings.sideMargin.value}px, max(0px, (100% - ${fontSize * 14}px) / 2))`,
    '--align': settings.justifyText.value ? 'justify' : 'left',
  } as Record<string, string>

  const readingError = model.reading.errorMessage.value
  const lookup = model.wordLookup.value
  return (
    <div class="reader" data-testid="reader">
      <NavBar tone="reader" onBack={leave} backLabel="Мої книжки" title={<span lang={sourceLanguage}>{chapter.title}</span>}
        trailing={
          <>
            <IconButton icon="list.bullet" label="Зміст" onClick={() => openPanel('contents')} testID="contentsButton" />
            <IconButton icon="character.bubble" label="Паралельний переклад" selected={showTranslation}
              onClick={() => { settings.showTranslation.value = !settings.showTranslation.value }} testID="translationToggle" />
            <IconButton icon="textformat" label="Вигляд" onClick={() => openPanel('settings')} testID="appearanceButton" />
            <IconButton icon="gearshape" label="ШІ-сервіси" onClick={() => { aiServicesOpen.value = true }} testID="readerSettingsButton" />
          </>
        } />
      {showTranslation && <ParallelPane model={model} openSettings={() => { aiServicesOpen.value = true }} />}
      {model.searchReturn.value && (
        <NoticeBar text="Перейшли до знайденого." actionTitle="Повернутися" onAction={() => model.returnFromSearch()} testID="searchReturnBar" />
      )}
      {readingError && (
        <NoticeBar text={`Озвучення зупинено: ${readingError}`} actionTitle="Закрити"
          onAction={() => { model.reading.errorMessage.value = null }} />
      )}
      <div class="reader-scroll" ref={scroller} data-testid="readerScroll">
        <div class="reader-column" style={columnStyle}>
          {chapter.paragraphs.map((paragraph, index) => {
            const ref = { chapter: chapterIndex, paragraph: index }
            const highlighted: number[] = []
            if (active && sameParagraph(active.paragraph, ref)) highlighted.push(active.sentence)
            if (current && sameParagraph(current.paragraph, ref) && !highlighted.includes(current.sentence)) highlighted.push(current.sentence)
            const cursorWord = active && wordCursor !== null && sameParagraph(active.paragraph, ref) ? { sentence: active.sentence, word: wordCursor } : null
            const sel = selection && sameParagraph(selection.paragraph, ref)
              ? { lower: [selection.lower.sentence, selection.lower.word] as [number, number], upper: [selection.upper.sentence, selection.upper.word] as [number, number] }
              : null
            return (
              <Paragraph key={`${chapterIndex}-${index}`} index={index} paragraph={paragraph}
                wordRanges={(s) => model.wordRanges(s)}
                highlighted={highlighted.length ? highlighted : EMPTY} selection={sel} wordCursor={cursorWord} savedForms={savedForms} />
            )
          })}
          <ChapterNav model={model} />
        </div>
      </div>
      <PlaybackBar model={model} />
      <AudioSheet model={model} />
      <ShortcutsSheet open={shortcutsOpen} onClose={() => setShortcutsOpen(false)} />
      <ReaderPanel open={panelOpen} onClose={() => setPanelOpen(false)} tab={panelTab} onTab={setPanelTab}
        book={model.book} chapter={chapterIndex}
        onSelectChapter={(index) => {
          model.searchReturn.value = null
          model.goToChapter(index)
        }}
        onFound={(ref) => model.showFound(ref)} searchFocus={searchFocus}
        onShowShortcuts={() => {
          setPanelOpen(false)
          setShortcutsOpen(true)
        }}
        onOpenPlace={(place) => {
          setPanelOpen(false)
          model.show(place)
        }} />
      <WordCard lookup={lookup} notice={model.pronunciationNotice.value} saved={model.isLookupSaved}
        onToggleSave={() => model.toggleSaveWord()}
        onPronounce={(text) => model.pronounce(text)}
        onExplain={(regenerate) => model.explainWord(regenerate)}
        onOpenSettings={() => {
          model.closeWordCard()
          aiServicesOpen.value = true
        }}
        onClose={() => model.closeWordCard()} />
    </div>
  )
}
