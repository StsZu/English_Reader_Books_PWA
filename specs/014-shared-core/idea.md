# Спільне ядро English і Polish Reader

**Стан:** погоджено 2026-11-10 («ok 014 S0»): S0–S9; питання 2 і 3 — за рекомендаціями, питання 4 — відкрито. S0–S4, S6, S7 виконано в гілці `014-shared-core` (див. «Стан виконання»); S5, S8, S9 — відкрито. Стосується обох застосунків: English Reader (цей репозиторій) і Polish Reader (`/Users/szubar/Projects/ACTIVE/Polish_Reader_Books_PWA`). Джерела: аудит `READER_PWA_COMPARATIVE_AUDIT_2026-10-27.md` (розділ «Спільне ядро», етап 4), `specs/005-reliability/idea.md` (R0.3, `sibling-diff`), `specs/006-backup/idea.md` (копія як точка відкату), `specs/013-prepared-book/idea.md` (D4), рецензія `TASK/2026-11-10_audit_review_and_answers.md` (розділ 2.3).

## Формулювання

| | |
|---|---|
| **Проблема** | Два репозиторії з однаковим кодом. Кожну зміну роблять двічі: копіюють файли, двічі запускають тести, двічі комітять і пушать, а `npm run sibling-diff` стежить, щоб копії не розійшлися (P22–P26 у Polish Reader — саме такі перенесення). Велика функція (підготовлена книжка, 013) удвічі дорожча. |
| **Для кого** | Розробка обох застосунків; користувач отримує виправлення в обох одночасно. |
| **Бажана зміна** | Один репозиторій, один код, дві збірки (`en`, `pl`) і два сайти, як зараз. Для користувача нічого не змінюється: ті самі адреси, встановлені PWA, бібліотеки, слова й налаштування. |
| **Користь** | Кожна зміна робиться й перевіряється один раз; гілка 013 зливається одразу для обох мов. |

## Що є зараз

- Мовне зосереджено в одному файлі `src/core/language.ts`: назва (`appName`), мова й голос, правила сегментації, промпти, словники, тестові дані, **`databaseName`** (`english-reader` / `polish-reader`) і **`settingsPrefix`** (`er.` / `pr.`). Аудіобаза — `<databaseName>-audio`.
- Решта відмінностей (`scripts/sibling-diff.mjs`, `ALLOWED`): `tests/fixtures/language.ts`, `tests/unit/language.test.ts`, `tests/live/ai.live.test.ts`, `tests/golden/` (лише English), `public/demo.md`, `public/manifest.webmanifest` (назва й опис), `public/apple-touch-icon.png`, `public/icons/`, `index.html` (заголовок), `package.json` (назва; `golden`, у гілці 013 — `prepared-book`), порти в `vite.config.ts` і `playwright.config.ts` (e2e: 4174 / 4176), `vitest.config.ts` (golden).
- Розгортання: два воркери Cloudflare (`english-reader-books-pwa`, `polish-reader-books-pwa` на `sts-zubar.workers.dev`), кожен збирає `main` свого репозиторію GitHub. У English Reader (гілка 013) є `wrangler.jsonc` з `previews`; у `main` і в Polish Reader файлу налаштувань немає.
- Документи: English — `specs/001`–`014`, `backlog.md`; Polish — `specs/001-pwa-copy` (копія), `specs/002-polish` (ідеї й журнал перенесень P1–P26), свої `CLAUDE.md`, `AUDIT.md`, `specs/000-order`.
- Історія: English `main` — 29 комітів, Polish — 21.

## Що не повинно змінитися (інваріанти)

| Що | Чому |
|---|---|
| Адреси сайтів (origin) | IndexedDB, Cache Storage, `localStorage` і встановлена PWA прив'язані до origin; нова адреса = порожній застосунок |
| `databaseName`, `<databaseName>-audio`, `settingsPrefix` | Інакше бібліотека, слова, переклади, аудіо й налаштування «зникнуть» |
| Ключі кешів (перекладів, карток, TTS `tts`, `shell-<версія>`) | Інакше кеш стане недосяжним або платні відповіді OpenAI підуть повторно |
| `manifest.webmanifest`: назва, `start_url`, `scope`, піктограми | Встановлена PWA має лишитися тією самою |
| Мовні правила сегментації | Інакше вже імпортовані книжки розійдуться з перекладами й місцями читання |
| Поведінка й тексти UI | Об'єднання — лише перебудова коду |

Ці значення перевіряються тестом для кожної мови (S6): тест порівнює їх з поточними значеннями, записаними як константи.

## Що робимо

| № | Що |
|---|---|
| S0 | Передумови: обидва `main` зелені, `sibling-diff` — OK; резервні копії (006) на iPad — за рішенням користувача не робляться. Гілка 013 поки не зливається. |
| S1 | Мовні модулі: `src/languages/en.ts` (нинішній `src/core/language.ts` English) і `src/languages/pl.ts` (Polish). Обидва відповідають одному типу `Language` (`satisfies`), тож `tsc` перевіряє обидва. `src/core/language.ts` лишається точкою імпорту для решти коду; конкретний модуль підставляє псевдонім Vite/Vitest за змінною `APP_LANG` (`en` / `pl`). Решта коду не змінюється. |
| S2 | Мовні файли сайту: `languages/<мова>/public/` (`demo.md`, `manifest.webmanifest`, `apple-touch-icon.png`, `icons/`) накладаються на спільний `public/` під час збірки й у `sw.js` (список `precache`). Заголовок `index.html` береться з `appName`. |
| S3 | Тести: мовні фікстури й `language.test.ts` — у `tests/languages/<мова>/`; `npm test` і `npm run test:e2e` проганяють обидві мови (`APP_LANG=en`, `APP_LANG=pl`), e2e — на своїх портах (4174 / 4176). `golden` — лише `en`. |
| S4 | Скрипти: `dev:en`, `dev:pl`, `build:en`, `build:pl`, `check` (обидві збірки); `sibling-diff` і його правило в конституції прибираються. |
| S5 | Розгортання: `wrangler.en.jsonc` і `wrangler.pl.jsonc` (ім'я воркера, `assets: dist`, `previews`). Воркер `polish-reader-books-pwa` у Cloudflare підключається до цього репозиторію з командою збірки `npm run build:pl` і розгортанням `npx wrangler deploy --config wrangler.pl.jsonc`; для English — те саме з `en`. Спершу — адреса попереднього перегляду гілки для обох мов; старе підключення Polish не вимикається, доки перегляд не перевірено. Налаштування в панелі Cloudflare робить користувач (або з окремого дозволу). |
| S6 | Перевірка інваріантів: тест для кожної мови (`databaseName`, `settingsPrefix`, `appName`, `sourceLanguage`, маніфест); у збірці `pl` немає `english-reader`, у збірці `en` немає `polish-reader`; повні тести обох мов. |
| S7 | Документи: один `CLAUDE.md`, одна конституція; `Polish_Reader_Books_PWA/specs/002-polish/` → `specs/pl-002-polish/` (журнал P1–P26 — як історія); `AUDIT.md` і `specs/000-order/` обох — за рішенням власника. |
| S8 | Перемикання: після перевірки перегляду Polish-воркер розгортається з `main` цього репозиторію; на iPad перевіряється, що обидві встановлені PWA відкривають ту саму бібліотеку й слова. Репозиторій Polish Reader — лише читання (README з посиланням); архівування на GitHub — окремим рішенням. |
| S9 | Гілка `013-d0-prototype` перебазовується на новий `main`, відхилення записуються в `spec.md` (V-нн: кнопка «Книжка з перекладом і аудіо»), злиття — для обох мов. |

Поза цим документом: перейменування репозиторію або сайтів, спільна бібліотека двох мов в одному застосунку, нові функції.

## Ризики

| Ризик | Захист |
|---|---|
| Помилка в налаштуваннях Cloudflare — сайт Polish недоступний | Спершу адреса перегляду; старе підключення живе до перевірки; відкат — повернути підключення до старого репозиторію |
| Випадкова зміна `databaseName` / `settingsPrefix` / origin — дані «зникли» | Інваріанти в тестах (S6); перевірка на адресі перегляду (S5) перед перемиканням (S8); резервних копій немає (рішення користувача) |
| Збірка однієї мови бере файли іншої (демо, маніфест, піктограми) | Перевірка `dist` кожної мови в `check` (S6) |
| Історія комітів Polish Reader не переходить | Старий репозиторій лишається (лише читання); журнал P1–P26 переноситься в `specs/pl-002-polish/` |
| Подвійні e2e подовжують перевірку (≈ 2 × 2,6 хв) | Прийнятно; за потреби — паралельні проєкти Playwright |

## Обсяг

S1–S7 — 1–2 дні (оцінка); S5 і S8 залежать від налаштування Cloudflare користувачем; S9 — пів дня після S8.

## Відкриті питання

1. ~~Погодити S0–S9.~~ Погоджено 2026-11-10.
2. ~~Назва репозиторію.~~ Лишається `English_Reader_Books_PWA` (2026-11-10).
3. ~~Репозиторій Polish Reader після S8.~~ Лише читання з README; архівування на GitHub — окремим рішенням (2026-11-10).
4. `AUDIT.md`, `specs/000-order/`, незакомічені `CLAUDE.md` обох репозиторіїв і порівняльний аудит: закомітити до S1, перенести чи лишити поза git.

## Стан виконання

### S0 (2026-11-10)

- English `main` `60c8027`: `npm run typecheck`, `npm run lint`, `npm test` (206), `npm run test:e2e` (61), `npm run check` зелені; `npm run sibling-diff` — OK.
- Polish `main` `cd13372`: `npm run typecheck`, `npm run lint`, `npm test` (209), `npm run test:e2e` (61), `npm run check` зелені.
- Резервні копії (006) на iPad: за рішенням користувача 2026-11-10 не робляться («Копії не потрібні»). Захист даних під час об'єднання — лише незмінні ідентифікатори й тести інваріантів (S6) та перевірка на адресі перегляду перед перемиканням (S5, S8).
- S0 виконано.

### S1–S4, S6, S7 (2026-11-10) — гілка `014-shared-core`, не злито

**Як влаштовано**

- `languages/app-language.ts`: `APP_LANG` (`en` типово, `pl`), порти кожної мови (dev 5173 / 5174, preview 4173 / 4177, e2e 4174 / 4176 — як до об'єднання), назва застосунку з маніфесту мови.
- S1: `src/languages/en.ts` (колишній `src/core/language.ts` English) і `src/languages/pl.ts` (з Polish Reader, без змін). `src/core/language.ts` — `export * from '#language'`; псевдонім задають `tsconfig.json` (en), `tsconfig.pl.json` (pl), `vite.config.ts`, `vitest.config.ts`. `npm run typecheck` перевіряє код з обома мовами. Решта коду не змінювалася.
- S2: `languages/<мова>/public/` (`demo.md`, `manifest.webmanifest`, `apple-touch-icon.png`, `icons/`) + спільний `public/` (`_headers`) → `build/public-<мова>/` як `publicDir`. `index.html`: `%APP_NAME%`.
- S3: `tests/languages/<мова>/` (`fixtures.ts` через `#test-language`, `language.test.ts`, `ai.live.test.ts`); `tests/unit/import.test.ts` бере демо мови збірки; `golden` — лише `en`. Playwright бере `tsconfig.pl.json` для `pl`; e2e збирає в `dist-test/<мова>/`.
- S4: `dev:pl`, `build:pl`, `preview:pl`; `npm test`, `npm run test:e2e`, `npm run check` — обидві мови; `scripts/sibling-diff.mjs` і скрипт `sibling-diff` прибрано.
- S5 (файли): `wrangler.en.jsonc`, `wrangler.pl.jsonc` (воркер, `assets: ./dist`, `previews`). Налаштування Cloudflare ще не змінювалися.
- S6: `tests/unit/app-identity.test.ts` (назва, `databaseName`, `settingsPrefix`, маніфест — як до об'єднання, для кожної мови); `scripts/check-language.mjs` у `check` (заголовок, маніфест і база своєї мови; жодного `English Reader` / `english-reader` у збірці `pl` і навпаки).
- S7: конституція (принцип 6), `CLAUDE.md`; `specs/pl-002-polish/` — копія `Polish_Reader_Books_PWA/specs/002-polish/` (ідеї й журнал P1–P26). Polish-копія `specs/001-pwa-copy` відрізнялася лише шляхами `English_Reader_Books_PWA/…` і T55 (живі тести Polish не запускалися), тому не переносилась. `AUDIT.md`, `specs/000-order/`, `CLAUDE.md` Polish Reader — питання 4, відкрито.

**Перевірки (2026-11-10)**

- `npm run typecheck` (en і pl), `npm run lint`, `npm test` (en 209, pl 212 — по 3 нових тести ідентичності поверх 206 / 209 до об'єднання), `npm run test:e2e` (en 61, pl 61), `npm run check` (обидві збірки) — зелені.
- Збірки збігаються зі збірками до об'єднання: JS English — з `main` `60c8027`, JS Polish — з `Polish_Reader_Books_PWA` `cd13372`, за винятком рядка версії (і хешу імені файла, що з нього випливає); `index.html`, `manifest.webmanifest` і набір файлів — однакові.
- Нестабільність: під час перших прогонів e2e двічі (з 14 запусків) впав English «аудіокнига: додати файли, повзунок, ±5 с…» на перевірці тексту часу; потім 6 з 6 зелені на гілці й 6 з 6 на `main`. Причину не встановлено; ймовірно, навантаження машини.

**Що далі**

- S5, адреси перегляду (2026-11-11): створено з CLI без зміни робочих сайтів і підключень репозиторіїв — `npm run build` → `npx wrangler preview --config wrangler.en.jsonc`, потім `npm run build:pl` → `npx wrangler preview --config wrangler.pl.jsonc` (wrangler 4.160.0, вхід OAuth; `preview` — відкрита бета). Гілку не запушено.
  - English: https://014-shared-core-english-reader-books-pwa.sts-zubar.workers.dev (розгортання https://d922279d-english-reader-books-pwa.sts-zubar.workers.dev).
  - Polish: https://014-shared-core-polish-reader-books-pwa.sts-zubar.workers.dev (розгортання https://1f2da271-polish-reader-books-pwa.sts-zubar.workers.dev).
  - Перевірено curl: `index.html`, маніфест, JS, `demo.md`, `sw.js` — 200; заголовок і маніфест своєї мови; у JS лише своя база й назва (`english-reader` / `polish-reader`); демо — Sherlock Holmes / «Latarnik»; версія `63fc522`; CSP є. Робочі сайти не змінилися (`45d36de`, `cd13372`).
  - Ручна перевірка обох адрес — 2026-11-11, користувач: «перевірив, все працює». S5 (адреси перегляду) виконано.
- S5, налаштування Cloudflare (робить користувач): воркер English — команда збірки `npm run build`, розгортання `npx wrangler deploy --config wrangler.en.jsonc`, гілки — `npx wrangler preview --config wrangler.en.jsonc`; воркер Polish — підключити цей репозиторій, збірка `npm run build:pl`, розгортання `npx wrangler deploy --config wrangler.pl.jsonc`, гілки — `npx wrangler preview --config wrangler.pl.jsonc`. Спершу перевірити адреси гілки `014-shared-core` для обох воркерів.
- S8: план нижче («S8: послідовність злиття й перемикання»).
- S9: гілка 013.

### S8: послідовність злиття й перемикання (уточнено 2026-11-11, не виконано)

**8.1. Поточні налаштування Workers Builds** (прочитано користувачем у Cloudflare Dashboard 2026-11-11, без змін)

| | English-воркер | Polish-воркер |
|---|---|---|
| Репозиторій | `StsZu/English_Reader_Books_PWA` | `StsZu/Polish_Reader_Books_PWA` |
| Production branch | `main` | `main` |
| Build command | `npm run build` | `npm run build` |
| Deploy command | `npx wrangler deploy` | `npx wrangler deploy` |
| Root directory | `/` | `/` |
| Previews Base: builds for preview branches | увімкнено; `npm run build`; `npx wrangler preview`; `/` | так само |
| Disable builds / Build cache / змінні й секрети | вимкнено / увімкнено / немає | так само |

Поточні версії для відкату (`wrangler deployments status`): English `fbebfc4a-3662-4b99-a90d-efd386021cb5` (збірка `45d36de`), Polish `a3104dec-fd92-4150-b3f6-4d7cd0411352` (збірка `cd13372`).

**Що робить голий `npx wrangler deploy` (перевірено 2026-11-11, wrangler 4.160.0, локально, без завантаження)**

- Файла `wrangler.json(c)/toml` немає ні в `main`, ні в `014-shared-core`; `wrangler.en.jsonc` і `wrangler.pl.jsonc` Wrangler сам не шукає. Без файла `deploy` працює лише через autoconfig (`--autoconfig`, увімкнено типово): розпізнає Vite, ставить `wrangler` і `@cloudflare/vite-plugin`, додає `cloudflare()` у `vite.config.ts`, створює `wrangler.jsonc` (`assets.not_found_handling: "single-page-application"`, `observability.enabled`), **запускає `npm run build`** і розгортає `dist/`. Так зараз розгортаються обидва робочі сайти (дата сумісності версії English — 2026-11-09, тобто autoconfig під час збірки).
- `wrangler setup --yes --build` (те саме autoconfig без розгортання) у робочих копіях `main` і `014-shared-core`: ті самі зміни, збірка English в обох; JS однаковий з точністю до рядка версії, `manifest.webmanifest`, `demo.md`, `_headers`, `.assetsignore` — однакові, згенерований `dist/wrangler.json` відрізняється лише шляхами. Отже, **English-воркер з чинними командами після злиття розгорне те саме, що зараз**.
- **Polish-воркер з голим `deploy` після підключення цього репозиторію розгорнув би English**: autoconfig сам запускає `npm run build` (English) і перезаписує `dist/` після `npm run build:pl`. Тому для Polish — лише `--config wrangler.pl.jsonc` (з файлом налаштувань autoconfig не запускається).
- Робочі сайти віддають `index.html` (200) на неіснуючий шлях, а адреси перегляду з явними `wrangler.*.jsonc` без `not_found_handling` — 404. У `wrangler.en.jsonc` і `wrangler.pl.jsonc` додано `"not_found_handling": "single-page-application"` і `observability`, як у autoconfig; `--dry-run` обох — без помилок. Перевірити на Cloudflare — новим переглядом (8.2).
- Перегляди гілок (`npx wrangler preview` без `--config`) після злиття, як і зараз, падатимуть (немає `previews` у конфігурації autoconfig), доки команду не змінено; на робочі сайти це не впливає.

**Порядок**

| Крок | Хто | Що | Перевірка | Відкат |
|---|---|---|---|---|
| 8.2 | Claude, з дозволу | Закомітити зміни конфігурацій у `014-shared-core`; оновити перегляди обох мов (`npm run build` → `npx wrangler preview --config wrangler.en.jsonc`; `npm run build:pl` → `npx wrangler preview --config wrangler.pl.jsonc`) | неіснуючий шлях — 200, мова, CSP, версія | перегляд не впливає на робочі сайти |
| 8.3 | Claude, з дозволу | Злиття `014-shared-core` у `main` локально (fast-forward від `60c8027`), повні перевірки обох мов | `typecheck`, `lint`, `test`, `test:e2e`, `check` | локальний `git reset` |
| 8.4 | Claude, з дозволу | Push `main` → English-воркер з **чинними** командами (autoconfig, перевірено вище); Polish-воркер не реагує | `sw.js` English — новий коміт; заголовок, маніфест, `english-reader`, неіснуючий шлях — 200; iPad: бібліотека на місці | `npx wrangler rollback fbebfc4a-3662-4b99-a90d-efd386021cb5 --name english-reader-books-pwa` |
| 8.5 | користувач | Polish-воркер одним збереженням: репозиторій `StsZu/English_Reader_Books_PWA`, гілка `main`, Build `npm run build:pl`, Deploy `npx wrangler deploy --config wrangler.pl.jsonc`; Previews Base: Build `npm run build:pl`, Preview `npx wrangler preview --config wrangler.pl.jsonc`; запустити збірку `main` | журнал: `APP_LANG=pl vite build`, розгортання з `wrangler.pl.jsonc`, без autoconfig | повернути підключення й команди; `npx wrangler rollback a3104dec-fd92-4150-b3f6-4d7cd0411352 --name polish-reader-books-pwa` |
| 8.6 | Claude | Перевірка Polish після 8.5 | `sw.js` — коміт з `main` цього репозиторію; «Polish Reader», `polish-reader`, «Latarnik», неіснуючий шлях — 200; iPad: бібліотека на місці | як у 8.5 |
| 8.7 | користувач, потім Claude | English-воркер: Deploy `npx wrangler deploy --config wrangler.en.jsonc`, Preview `npx wrangler preview --config wrangler.en.jsonc`; повторити збірку `main` | розгортання з `wrangler.en.jsonc`, без autoconfig; як у 8.4 | повернути `npx wrangler deploy`; rollback на версію з 8.4 |
| 8.8 | Claude, з дозволу | README у `Polish_Reader_Books_PWA` («перенесено, лише читання»), коміт і push туди | README на GitHub | revert |

**8.2 — виконано 2026-11-11.** Коміт `3291676` у `014-shared-core` (не запушено). Перегляди оновлено з CLI по черзі (`npm run build` → `npx wrangler preview --config wrangler.en.jsonc`; `npm run build:pl` → `npx wrangler preview --config wrangler.pl.jsonc`):

- English: https://014-shared-core-english-reader-books-pwa.sts-zubar.workers.dev (розгортання https://0f3607f4-english-reader-books-pwa.sts-zubar.workers.dev).
- Polish: https://014-shared-core-polish-reader-books-pwa.sts-zubar.workers.dev (розгортання https://00f01573-polish-reader-books-pwa.sts-zubar.workers.dev).
- Обидва: `/` — 200, свій заголовок, у JS лише своя база, `sw.js` — `3291676`, CSP є. Робочі сайти не змінилися (`45d36de`, `cd13372`).
- Неіснуючий шлях: запит браузера (навігація, `Sec-Fetch-Mode: navigate`, `Accept: text/html`) — **200** (`index.html`), як на робочих сайтах. Простий запит без цих заголовків (curl) — **404**, а на робочих сайтах — 200. Дата сумісності не причина: перегляд English з `2026-11-09` (як у робочої версії) дав те саме; конфігурацію повернуто до закоміченої й перегляд English опубліковано ще раз. Причину не встановлено (можливо, особливість переглядів або конфігурації `@cloudflare/vite-plugin`). Для браузера й PWA поведінка однакова; остаточно — перевірити на робочому сайті Polish у 8.6 і English у 8.7 (перше розгортання з явною конфігурацією).

Після 8.8 — S9 (гілка 013 містить `wrangler.jsonc` — під час перебазування його прибрати, інакше голий `deploy` English почне брати його замість autoconfig) і питання 4.
