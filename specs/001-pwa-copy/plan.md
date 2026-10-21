# 6. План реалізації

Джерела: `spec.md` (FR/SC, V-01…V-08, C1–C8), `.specify/memory/constitution.md`, еталон `/Users/szubar/Projects/ACTIVE/English_Reader_Books` (лише читання).

## Підхід

Порт «модуль у модуль»: кожен Swift-файл еталона має відповідний TypeScript-модуль з тими самими правилами, текстами й константами. Логіка (`src/core`) не залежить від інтерфейсу й перевіряється перенесеними модульними тестами; інтерфейс (`src/ui`) відтворює екрани SwiftUI вебкомпонентами.

```
Файл (input type=file) ─> core/import ─> core/model/segmenter ─> Book JSON ─> IndexedDB
                                                                     │
Дотик/утримання ─> ui/reader/gestures ─> ReaderViewModel ──┬─> core/ai (OpenAI JSON) ─> кеші IndexedDB
                                                           ├─> core/speech (OpenAI TTS mp3 | speechSynthesis) ─> Cache Storage
                                                           └─> core/saved ─> core/training
Service worker: оболонка застосунку офлайн; мережа лише self + api.openai.com
```

## Технології

| Шар | Вибір | Чому |
|---|---|---|
| Збірка | Vite 6, TypeScript 5 `strict` | Швидка збірка, статичний `dist/` для будь-якого HTTPS-хостингу |
| UI | Preact 10 + `@preact/signals` | ~5 КБ, компонентна модель, близька до SwiftUI `@Published`/`@State`; вміщається в бюджет 250 КБ |
| Сховище | IndexedDB через `idb` (~1 КБ); Cache Storage для MP3; `localStorage` — лише налаштування (аналог `@AppStorage`) | Вбудовано в Safari; `navigator.storage.persist()` |
| ZIP | Порт `ZipArchive.swift` + `DecompressionStream('deflate-raw')` | Без залежності, та сама логіка центрального каталогу |
| XML (container, OPF) | `DOMParser` (`application/xml`) | Вбудовано |
| XHTML → блоки | Порт толерантного сканера `HTMLTextExtractor.swift` (не DOMParser) | Той самий результат на некоректному XHTML |
| Речення/слова | `Intl.Segmenter('en', {granularity})` + список скорочень + правила склеювання з `TextSegmenter.swift` | Найближче до `NLTokenizer`; звіряється SC-03 |
| Хеш | `crypto.subtle.digest('SHA-256')` | Ті самі ключі кешів |
| Мовлення | `HTMLAudioElement` (один на застосунок) + Media Session; `speechSynthesis` | Аналоги `AVAudioPlayer` / `AVSpeechSynthesizer` |
| Запис | `getUserMedia` + `MediaRecorder` (`audio/mp4`) | Аналог `AVAudioRecorder` |
| Іконки | `lucide-preact` (ISC), tree-shaking | Заміна SF Symbols (V-06) |
| PWA | `vite-plugin-pwa` у режимі `injectManifest` (dev-залежність) | Прекеш оболонки, власний SW |
| Тести | Vitest + `fake-indexeddb` + `happy-dom`; Playwright `webkit`, пристрій «iPad Pro 11» | Аналоги XCTest / XCUITest |
| Якість | ESLint + `typescript-eslint` | Стандарти конституції |

Дозволені runtime-залежності: `preact`, `@preact/signals`, `idb`, `lucide-preact`. Будь-яка інша — запис обґрунтування тут перед додаванням.

Мінімальна платформа: Safari / iPadOS 17.0+ (Intl.Segmenter, DecompressionStream, MediaRecorder `audio/mp4`, `storage.persist`, Web Share з файлами).

## Структура файлів

Відповідник у еталоні — шлях від `EnglishReader/`. Власник — завдання з `tasks.md`; один файл — одне завдання-власник; інші завдання змінюють файл лише через оркестратора.

| Шлях | Роль | Еталон | Власник |
|---|---|---|---|
| `package.json`, `vite.config.ts`, `tsconfig.json`, `eslint.config.js`, `playwright.config.ts`, `vitest.config.ts` | Каркас, скрипти `dev/build/test/test:e2e/test:live/lint/check` | `project.pbxproj` | T01 |
| `index.html`, `public/manifest.webmanifest`, `public/icons/*`, `public/demo.md` | Оболонка, CSP, піктограми 180/192/512/maskable, демо | `Assets.xcassets`, `Resources/demo.md` | T01 |
| `src/contracts.ts` | Спільні типи та інтерфейси (розділ «Спільні контракти») | — | T02 |
| `src/core/model/book.ts` | `Book`, `Chapter`, `Paragraph`, `BookSummary`, `ParagraphRef`, `SentenceRef`, `RawBook` | `Model/Book.swift` | T02 |
| `src/core/model/segmenter.ts` | Речення, слова, нормалізація, `makeBook` | `Model/TextSegmenter.swift` | T10 |
| `src/core/util/hash.ts`, `src/core/util/format.ts` | SHA-256 hex; числа `uk-UA`, `linesLabel`, дати `дд.мм` | `AppSettings.linesLabel`, різне | T10 |
| `src/core/import/zip.ts` | Читач ZIP | `Import/ZipArchive.swift` | T11 |
| `src/core/import/epub.ts` | container, OPF, spine, DRM, назви розділів | `Import/EPUBImporter.swift` | T11 |
| `src/core/import/html.ts` | XHTML → блоки, сутності | `Import/HTMLTextExtractor.swift` | T11 |
| `src/core/import/text.ts` | Декодування, TXT, MD | `Import/TextImporter.swift` | T11 |
| `src/core/import/importer.ts` | Формат за розширенням, 50 МБ, `ImportError` | `Import/BookImporter.swift` | T11 |
| `src/core/storage/db.ts` | Схема IndexedDB (сховища з таблиці «Схема даних» spec.md), `persist()` | — | T12 |
| `src/core/storage/library.ts` | Бібліотека, книжки, демо, видалення, тестове скидання | `Services/LibraryStore.swift` | T12 |
| `src/core/storage/positions.ts` | Позиції читання | `ReadingPositionStore` | T12 |
| `src/core/storage/settings.ts` | Усі ключі `AppSettings` з типовими значеннями й межами, сигнали | `Services/AppSettings.swift` | T12 |
| `src/core/storage/key.ts` | Ключ OpenAI (+ змінна для живих тестів) | `Services/APIKeyStore.swift` | T12 |
| `src/core/ai/openai.ts` | `chatJSON`, `speech`, `post`, `mapError`, `AIServiceError` | `Services/OpenAIClient.swift` | T13 |
| `src/core/ai/translation.ts` | Провайдер перекладу, `TranslationStore`, переклад фрагмента | `Services/TranslationService.swift`, частина `ReaderViewModel.swift` | T13 |
| `src/core/ai/word.ts` | `WordCard`, `WordLookupService`, `ExplanationService` | `Services/WordLookupService.swift` | T13 |
| `src/core/speech/openai-speech.ts` | ШІ-голос, кеш MP3, `replay`, лічильник синтезу | `Services/SpeechEngines.swift` (OpenAI) | T14 |
| `src/core/speech/system-speech.ts` | Системний голос | `Services/SpeechEngines.swift` (System) | T14 |
| `src/core/speech/audio.ts` | Єдиний аудіоелемент, розблокування дотиком, Media Session, Wake Lock | `AudioSessionConfigurator` | T14 |
| `src/core/speech/reading.ts` | Черга читання вголос | `Services/ReadingController.swift` | T14 |
| `src/core/saved/saved.ts` | Слова, цитати, пошук, форми, CSV, текст цитат | `Services/SavedStore.swift` | T15 |
| `src/core/training/training.ts` | Набори, обманки, токени, рівні | `Services/Training.swift` (`Training`) | T15 |
| `src/core/training/session.ts` | Сесія вправ | `Services/Training.swift` (`TrainingSession`) | T15 |
| `src/core/training/recorder.ts` | Мікрофон, запис, відтворення, очищення | `Services/PronunciationRecorder.swift` | T15 |
| `src/ui/theme/tokens.css`, `src/ui/theme/themes.ts`, `src/ui/theme/fonts.ts`, `src/ui/icons.ts` | Теми (RGB з `ReaderTheme`), шрифти `BookFont`, відповідність іконок | `AppSettings.swift` (`ReaderTheme`, `BookFont`) | T16 |
| `src/ui/components/*` | `NavBar`, `Sheet` (половина/повна), `SidePanel`, `Stepper` («− значення +»), `Toggle`, `Segmented`, `Dialog`, `Menu`, `ContentUnavailable`, `NoticeBar` | системні елементи SwiftUI | T16 |
| `src/app/main.tsx`, `src/app/router.ts`, `src/app/test-mode.ts` | Запуск, навігація бібліотека ↔ читалка ↔ тренування, тестові фікстури (FR-33) | `App/EnglishReaderApp.swift` | T03 |
| `src/ui/library/*` | Бібліотека, картка книжки, імпорт, видалення | `Views/LibraryView.swift` | T20 |
| `src/ui/settings/AIServices.tsx` | «ШІ-сервіси» | `Views/SettingsView.swift` | T21 |
| `src/ui/reader/ReaderScreen.tsx` | Розкладка читалки, прокручування, позиція, слідування за читанням | `Views/ReaderView.swift` (`ReaderView`) | T22 |
| `src/ui/reader/Paragraph.tsx` | Абзац: речення/слова як `<span data-s data-w>`, підсвічування, підкреслення збережених | `ReaderView.swift` (`ParagraphView`) | T22 |
| `src/ui/reader/PlaybackBar.tsx`, `ChapterNav.tsx` | Нижня панель, навігація розділів | `ReaderView.swift` | T23 |
| `src/ui/reader/model.ts` | Стан читалки: активне речення, запити, вимова речення, фрагмент, картка, перехід до місця | `Views/ReaderViewModel.swift` | T30 → T31 → T32 → T33 (послідовно) |
| `src/ui/reader/ParallelPane.tsx` | Верхня панель перекладу/фрагмента, «Стоп»/«Ще раз», «Копіювати», «Зберегти» | `ReaderView.swift` (`ParallelTranslationPane`, `SentenceSpeechControls`, `FragmentControls`) | T30 |
| `src/ui/reader/gestures.ts` | Короткий дотик, утримання 0,5 с, допуск 10 px, рух для виділення | `ReaderView.swift` (жести) | T31 |
| `src/ui/reader/autohide.ts` | Поріг у рядках, ручне vs програмне прокручування | `ReaderView.swift` (`onScrollGeometryChange`) | T32 |
| `src/ui/reader/panel/*` | Бічна панель, вкладки, теми, чотири розділи, «Зміст», «Керування словниками» | `Views/ReaderPanel.swift` | T34 |
| `src/ui/word/WordCard.tsx` | Картка слова, пояснення, словники | `Views/WordCardView.swift` | T35 |
| `src/ui/saved/*` | Список збереженого, експорт | `Views/SavedView.swift` | T40 |
| `src/ui/training/*` | Налаштування, ознайомлення, вправи 1–4, підсумок | `Views/TrainingView.swift` | T41 |
| `src/ui/training/Pronunciation.tsx` | Вправа 5 | `TrainingView.swift` (`PronunciationExercise`) | T42 |
| `src/sw.ts` | Service worker | — | T50 |
| `tests/unit/**` | Перенесені модульні тести | `EnglishReaderTests/*` | власник модуля |
| `tests/e2e/**` | Перенесені UI-сценарії | `EnglishReaderUITests/MainScenarioUITests.swift` | T52 (каркас — T03) |
| `tests/fixtures/**` | Синтетичні EPUB/TXT/MD, еталонні `book.json` | `ImportTests.swift` | T11, T51 |
| `scripts/golden-compare.ts` | Порівняння розбиття з еталоном (SC-03) | — | T51 |
| `scripts/check-secrets.sh`, `scripts/check-network.ts` | SC-12 | — | T54 |
| `build/` | Докази перевірок: звіти, знімки, журнали | — | оркестратор |

## Спільні контракти

Фіксуються в `src/contracts.ts` (T02) до старту хвилі 1. Імена — як у Swift.

```ts
// Помилки ШІ — тексти дослівно з OpenAIClient.swift
type AIServiceError =
  | { kind: 'missingKey' } | { kind: 'unauthorized' } | { kind: 'rateLimited' } | { kind: 'quotaExceeded' }
  | { kind: 'server'; status: number } | { kind: 'http'; status: number; message: string }
  | { kind: 'offline' } | { kind: 'timeout' } | { kind: 'badResponse'; detail: string };
declare function errorText(e: AIServiceError): string;     // український текст
declare function needsSettings(e: AIServiceError): boolean; // missingKey | unauthorized

interface TranslationProvider { translate(sentences: string[], context?: string): Promise<string[]>; }

interface SpeechEngine {                       // аналог протоколу SpeechEngine
  speak(text: string, onStart: () => void, signal: AbortSignal): Promise<void>; // AbortError після stop()
  prefetch(text: string): void;
  pause(): void; resume(): void; stop(): void;
}
interface ReplayableSpeech extends SpeechEngine {
  hasAudio(text: string): Promise<boolean>;
  replay(text: string, onStart: () => void, signal: AbortSignal): Promise<void>; // ніколи не синтезує
  readonly synthesisCount: number;
}

interface KeyValueCache<T> { get(key: string): Promise<T | undefined>; set(key: string, value: T): Promise<void>; }

type ImportError =
  | { kind: 'unsupportedFormat'; ext: string } | { kind: 'tooLarge' } | { kind: 'unreadable' }
  | { kind: 'emptyText' } | { kind: 'drmProtected' } | { kind: 'invalidEPUB'; detail: string };
```

- **Налаштування.** `settings.ts` експортує сигнал на кожен ключ `AppSettings` з тим самим ім'ям (`fontSize`, `lineSpacingFactor`, `parallelTranslationAutoHideLines`, `explanationTemplate`, …), типовими значеннями та діапазонами (`fontSizeRange` тощо). `bookLineHeight` = виміряна висота рядка шрифту книжки (`canvas.measureText` / прихований елемент) + `fontSize × lineSpacingFactor`.
- **Ключі кешів.** Абзац — `${chapter}-${paragraph}`; картка — `${word.toLowerCase()}|${sentence}`; пояснення — `sha256(`${word.toLowerCase()}|${sentence}|${template}|${model}`)`; аудіо — `sha256(`${ns ? ns + '|' : ''}${model}|${voice}|${instructions}|${text}`)` + `.mp3`; фрагмент — як у `ReaderViewModel.swift`.
- **Промпти й тексти.** Системні промпти, інструкція озвучення, типовий шаблон пояснення, тексти помилок — константи, скопійовані дослівно; модульний тест порівнює їх із рядками, витягнутими зі Swift-файлів еталона (`scripts/extract-swift-strings.ts`, T02).
- **DOM-розмітка тексту.** `<p data-p="{index}" class="para heading|text">` → `<span class="s" data-s="{i}">` → `<span class="w" data-w="{j}">`; пробіли між словами — текстові вузли. На цих атрибутах працюють жести (T31), автоприховування (T32), виділення (T33), підсвічування (T22, T40) і e2e-селектори.
- **Тестовий режим.** Параметри адреси в dev/test-збірці: `?reset`, `?testTranslation`, `?testSpeech`, `?testWordCard`, `?testSavedWords`, `?testRecording`, `?voice=system|openAI`, `?import=/fixtures/x.epub`. Ідентифікатори для e2e — `data-testid` з тими самими іменами, що `accessibilityIdentifier` еталона (`importButton`, `translationToggle`, `playButton`, `panelBackdrop`, `readerScroll`, …).
- **Дизайн-токени.** CSS-змінні `--bg`, `--text`, `--translation`, `--highlight`, `--selection` на `[data-theme=light|sepia|dark]` з RGB з `ReaderTheme`; системні кольори інтерфейсу (`accent`, `secondary`, `bar`) — значення iPadOS для світлої/темної схеми; шрифт інтерфейсу `-apple-system, system-ui`.
- **Іконки (V-06).**

| SF Symbol | Lucide |
|---|---|
| `books.vertical` | `library` |
| `plus` / `minus` | `plus` / `minus` |
| `gearshape` | `settings` |
| `bookmark` / `bookmark.fill` | `bookmark` / `bookmark` (заливка) |
| `list.bullet` | `list` |
| `character.bubble` | `languages` |
| `textformat` | `type` |
| `xmark` | `x` |
| `play.fill` / `pause.fill` / `stop.fill` | `play` / `pause` / `square` |
| `chevron.left` / `chevron.right` | `chevron-left` / `chevron-right` |
| `exclamationmark.triangle.fill` | `triangle-alert` |
| `speaker.wave.2` / `speaker.wave.3.fill` | `volume-2` / `volume-2` |
| `checkmark` | `check` |
| `trash` | `trash-2` |
| `square.and.arrow.up` | `share` |
| `arrow.right.circle` | `circle-arrow-right` |
| `mic` | `mic` |

## Послідовність і залежності

```
Хвиля 0  T01 ─ T02 ─ T03
Хвиля 1  T10 [P] ┬ T11 [P] ┬ T12 [P] ┬ T13 [P] ┬ T14 [P] ┬ T15 [P] ┬ T16 [P]
                  (T11 використовує T10; починає з контрактів T02 і інтегрується після T10)
Хвиля 2  T20 [P] ┬ T21 [P] ┬ T22 ── T23
Хвиля 3  T30 ─ T31 ─ T32 ─ T33   (спільний model.ts)      T34 [P]   T35 [P]
Хвиля 4  T40 [P] ┬ T41 ── T42
Хвиля 5  T50 [P] ┬ T51 [P] ┬ T52 ┬ T53 ┬ T54 [P] ┬ T55 (дозвіл, платно)
Хвиля 6  T60 (дозвіл) ─ T61 (користувач на iPad) ─ T62 alignment.md
```

C1–C8 погоджено 2026-10-21 (`spec.md` → «5. Уточнення»); хвилі виконуються підряд.

## Ризики

| Ризик | Пом'якшення |
|---|---|
| Межі речень `Intl.Segmenter` ≠ `NLTokenizer` | Список скорочень (Mr, Mrs, Ms, Dr, St, Jr, Sr, Prof, Rev, Gen, Col, Capt, Lt, No, vs, etc., e.g., i.e., ініціали `A.`) + ті самі правила склеювання; еталонне порівняння SC-03 і розбір розбіжностей у `build/golden/report.md`; ≤ 3 ітерації, далі відхилення. |
| Еталонні `book.json` потребують нативного застосунку | Узяти з контейнера даних тестового симулятора `English Reader Translation Check` (`xcrun simctl get_app_container … data`) лише читанням файлів; імпорт #1661 і `demo.md` виконати наявною збіркою з `UITEST_IMPORT_PATH`. Вихідний проєкт не змінюється. |
| Довге натискання конфліктує з виділенням, лупою й меню Safari | CSS `user-select:none; -webkit-user-select:none; -webkit-touch-callout:none` на тексті книжки; `contextmenu` → `preventDefault`; `touch-action: pan-y`; ручна перевірка на iPad у T61. |
| Пауза між реченнями при ШІ-озвученні | `prefetch` наступних 2 речень у Blob URL, один `<audio>`, перемикання `src` в обробнику `ended`; вимір проміжку в e2e (≤ 150 мс з тестовим аудіо). |
| Фонове читання (V-04) | Media Session метадані й дії, Wake Lock під час «Слухати»; перевірка T61; результат — у `alignment.md`. |
| Автовідтворення iOS | Розблокування аудіоелемента та `speechSynthesis` у першому обробнику дотику (кнопки «Слухати», «Почати», «Вимова»). |
| `speechSynthesis.pause()` ненадійна в WebKit | Детект: якщо після `resume()` немає подій 1 с — повторити речення з початку (V-08). |
| Маршрутизація звуку після мікрофона | Зупиняти всі треки `MediaStream` одразу після запису; перевірка на iPad. |
| Квота й видалення сховища | `persist()`, показ стану в «ШІ-сервісах», підказка встановлення (FR-32). |
| Обсяг DOM довгих розділів | `content-visibility: auto` + `contain-intrinsic-size` для абзаців; бюджет SC-06; за потреби — віртуалізація абзаців лише поза екраном. |

## Відповідальні

Оркестратор (головна сесія) — контракти, інтеграція файлів спільного володіння, запуск перевірок, ведення стану в `tasks.md`, рішення в межах конституції. Субагенти — завдання з позначкою `[P]` у хвилях 1, 2, 4, 5; кожному в промпт: завдання, витяг конституції (розділи IV–V), контракти з цього файла, відповідні Swift-файли еталона й тести, умова Done. Паралельні субагенти не пишуть у спільні файли; зміни поза своїми файлами — частинами в `build/parts/` для інтеграції оркестратором.

## Спосіб перевірки результату

| Що | Як | Критерій |
|---|---|---|
| Трасування вимог | Таблиця FR → тест / пункт чек-листа в `alignment.md` | SC-01 |
| Логіка | `npm test` (Vitest), перелік перенесених тестів `tests/PORTED.md` | SC-02 |
| Розбиття | `npm run golden` → `build/golden/report.md` | SC-03 |
| Імпорт і помилки | e2e `import.spec.ts`; вимір часу на iPad (T61) | SC-04 |
| Розкладка | e2e `parallel-pane.spec.ts` — `boundingBox()` першого абзацу до/після | SC-05 |
| Швидкодія й розмір | `performance.now()` у тестовому режимі на iPad; `npm run size` | SC-06 |
| Аудіо | Vitest `openai-speech.test.ts` + e2e `long-press.spec.ts` з `?testSpeech` | SC-07 |
| Позиція | e2e `position.spec.ts` (`page.reload()`), T61 | SC-08 |
| Офлайн | e2e з `context.setOffline(true)` після першого завантаження; T61 в авіарежимі | SC-09 |
| Живі запити | `OPENAI_API_KEY=… npm run test:live` (лише з дозволом) | SC-10 |
| iPad | Чек-лист у `alignment.md`, відповіді користувача | SC-11 |
| Безпека | `npm run check` (секрети, CSP, мережевий журнал e2e) | SC-12 |
| Вигляд | `build/visual/*.png` поруч зі знімками симулятора `xcrun simctl io … screenshot` | SC-13 |
