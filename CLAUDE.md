# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

# English Reader PWA

PWA-копія iPad-застосунку `/Users/szubar/Projects/ACTIVE/English_Reader_Books` (SwiftUI, стан після етапу 2.5).

## Документи (читати на початку кожної сесії)

1. `specs/001-pwa-copy/idea.md` — ідея, оцінювання, оцінка відмінностей від нативної версії.
2. `.specify/memory/constitution.md` — правила, стандарти, Non-negotiables.
3. `specs/001-pwa-copy/spec.md` — FR/SC, схема даних, свідомі відхилення V-01…V-08, уточнення C1–C8.
4. `specs/001-pwa-copy/plan.md` — технології, файли й власники, контракти, хвилі.
5. `specs/001-pwa-copy/tasks.md` — завдання й поточний стан; продовжувати з першого невиконаного.

Нові функції після хвиль 0–6 — окремі `specs/00N-*/idea.md` (002 аудіокнига, 003 відступ після паузи й клавіші, 004 YouTube — відхилено) і `specs/backlog.md`.

## Правила

- Еталон поведінки — Swift-код і `task_01.md` вихідного проєкту. Вихідний проєкт і `English_Reader_2026` — лише читання: не змінювати файли, налаштування, git-стан.
- C1–C8 погоджено 2026-10-21. Головне для користувача: дизайн не гірший за нативний і застосунок повністю виконує функцію.
- Репозиторій буде публічним (C8): скриншоти `reference/` вихідного проєкту й сторонні книжки не копіювати й не комітити.
- Ключ OpenAI — лише в застосунку або в змінній середовища процесу для живих тестів; ніколи в коді, комітах, журналах.
- Платні живі тести, розгортання, push, створення репозиторію на GitHub — лише з окремим дозволом.
- Після кожного завдання оновлювати його стан і результат перевірки в `tasks.md`.
- Нова вимога або зміна поведінки щодо еталона — спершу запис у `spec.md` (або `idea.md` функції), потім код.
- Тексти інтерфейсу — дослівно зі Swift-коду або записане відхилення; промпти й тексти помилок звіряються з еталоном (`scripts/extract-swift-strings.ts`).
- Спільний код із `../Polish_Reader_Books_PWA` (мовна частина там — `src/core/language.ts`). Специфікації 002/003 і `backlog.md` стосуються обох застосунків; Polish Reader змінювати лише за окремим запитом.
- Спілкування українською, стисло, без емодзі.

## Команди

- `npm run dev` — розробка (тестовий режим увімкнено: `?reset`, `?testTranslation`, `?testSpeech`, `?testWordCard`, `?testSavedWords`, `?testRecording`, `?voice=system|openAI`, `?import=<шлях>`, `?gallery`).
- `npm test` — модульні тести (без мережі); `npm run test:e2e` — WebKit iPad + офлайн у Chromium; `npm run golden` — розбиття проти нативного імпортера; `npm run check` — production-збірка, секрети, CSP, розмір.
- `npm run lint`, `npm run typecheck`, `npm run size` — окремі перевірки зі складу стандартів конституції.
- Один модульний тест: `npx vitest run tests/unit/segmenter.test.ts -t "<частина назви>"`.
- Один e2e: `npx playwright test tests/e2e/reader.spec.ts --project=webkit-ipad -g "<частина назви>"`; офлайн — `--project=chromium-offline`.
- `npm run test:live` — платні живі тести OpenAI, лише з дозволом і ключем у змінній середовища.

Особливості тестів:
- e2e збирає `vite build --mode test` у `dist-test/` і піднімає preview на порту 4174; локально вже запущений сервер на 4174 використовується повторно — після змін коду його треба зупинити, інакше тести йдуть по старій збірці.
- `tests/setup.ts` кидає помилку на будь-який запит до `api.openai.com` (якщо не `LIVE=1`); `fake-indexeddb` і `happy-dom` — середовище модульних тестів.
- `npm run golden` потребує `build/golden/*.swift.json` і `tests/fixtures/external/pg1661.epub` (не в git); без них випадки пропускаються, звіт — `build/golden/report.md`.
- Тестові книжки e2e генеруються в пам'яті (`tests/fixtures/e2e/books.ts`, `tests/fixtures/zip-writer.ts`); EPUB у git не додавати (`check-secrets.sh` це перевіряє).
- Відповідність тестів еталона — `tests/PORTED.md`; e2e-селектори — `data-testid` з іменами `accessibilityIdentifier` еталона.

## Архітектура

Порт «модуль у модуль»: кожен Swift-файл еталона має TS-відповідник з тими самими правилами й константами (таблиця «Структура файлів» у `plan.md`). Preact 10 + `@preact/signals`, без власного сервера: статичний хостинг і прямі виклики `https://api.openai.com/v1/`. Runtime-залежності лише `preact`, `@preact/signals`, `idb`, `lucide-preact`; нова — спершу обґрунтування в `plan.md`.

- `src/contracts.ts` — спільні типи й тексти помилок (`AIServiceError`, `ImportError`, `SpeechEngine`, `ReplayableSpeech`, `WordCard`); імена як у Swift.
- `src/core/**` — логіка без UI: `import` (власний ZIP + `DecompressionStream`, толерантний сканер XHTML, не DOMParser) → `model/segmenter` (`Intl.Segmenter` + правила склеювання скорочень) → `Book` JSON; `storage` (IndexedDB `english-reader`, сховища в `db.ts`; налаштування — сигнали в `settings.ts`); `ai` (переклад, картка слова, пояснення, кеші за ключами з `plan.md`); `speech` (один `<audio>` на застосунок, кеш MP3 у Cache Storage, «Ще раз» ніколи не синтезує — G6); `saved`, `training`; `audiobook` (власні MP3/M4A книжки в окремій базі `english-reader-audio`, схема `db.ts` не змінюється).
- `src/ui/reader/model.ts` — стан читалки (аналог `ReaderViewModel.swift`): активне речення, запити перекладу, фрагмент, картка, озвучення, режим панелі «Голос» ↔ «Аудіокнига». Кнопки й клавіші (`shortcuts.ts`) викликають ті самі дії моделі.
- DOM тексту: `<p data-p>` → `<span class="s" data-s>` → `<span class="w" data-w>`; на цих атрибутах працюють жести (`gestures.ts`), підсвічування, виділення й e2e.
- `src/app/router.ts` — навігація сигналами (бібліотека ↔ читалка, тренування й «ШІ-сервіси» поверх), без URL-маршрутизації.
- Тестовий режим: `__TEST_MODE__` (true у dev і `--mode test`, false у production) + `src/app/test-mode.ts`. Заглушки підключаються в самих модулях (`translation.ts`, `word.ts`, `openai-speech.ts`, `recorder.ts`, `engines.ts`, `key.ts`) під умовою `__TEST_MODE__ && testFlags.*`, щоб production-збірка їх відкидала; `check-secrets.sh` шукає їх у `dist/`.
- Service worker: власний плагін у `vite.config.ts` підставляє список файлів і версію в `src/sw-template.js` → `sw.js` (не `vite-plugin-pwa` і не `src/sw.ts`, як у `plan.md`). Новий файл у `public/`, потрібний офлайн, додати до `precache` там само.
- CSP задано двічі: `index.html` (meta) і `public/_headers` (Cloudflare); змінювати обидва.

## Стан (2026-10-27)

Хвилі 0–5 виконано (`specs/001-pwa-copy/tasks.md`), проміжне узгодження — `specs/001-pwa-copy/alignment.md`. Після них додано аудіокнигу (002) і клавіші (003). Розгорнуто: https://english-reader-books-pwa.sts-zubar.workers.dev/ (Cloudflare, збірка з `main` репозиторію https://github.com/StsZu/English_Reader_Books_PWA). Відкрито: T53 (візуальне порівняння), T61 (ручна перевірка на iPad за чек-листом, виконує користувач), T62 (`alignment.md`).
