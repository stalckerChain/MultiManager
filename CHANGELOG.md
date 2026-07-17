# Changelog

## v1.3.4 (Multi-Control Real-Scroll Sync)

### Исправления

- **[BUG] Multi-Control: курсор в slave рассинхронизировался после прокрутки колесом — клики уходили мимо цели.**
  До скролла синхронизация работала, после — курсор «уплывал». Три причины:
  1. `masterScroll` не вычитался в `_toSlaveCoords` — координаты считались как `pageX_master - slaveScroll`, что верно только при одинаковой прокрутке master и slave.
  2. `slaveScroll` опережал реальный `window.scrollY` страницы (гонка): в `_runScrollSequence` scroll наращивался в момент отправки wheel, а браузер докручивался асинхронно.
  3. Накопление дельт вместо реального значения — сумма `deltaY` не равна реальному смещению контента (инерция, плавный скролл, трекпад).
  **Фикс:** перешли на РЕАЛЬНЫЙ `window.scrollX/scrollY`. `SYNC_EVENT_SCRIPT` передаёт scroll мастера в событиях мыши/скролла; `_toSlaveCoords` конвертирует `page → viewport мастера → viewport slave`; после серии wheel `_syncSlaveScroll` читает реальный scroll slave через `getPageScroll`; `scrollTo` пишет реальный scroll вместо накопления дельт. `MouseSmoother` не тронут.

- **[CHORE] Multi-Control: унифицирован формат `masterScroll`.**
  В конструкторе был `{x, y}`, в `stop()` — `{scrollX, scrollY}`. Приведено к единому `{scrollX, scrollY}` везде (конструктор, `stop`, `scrollTo`).

### Тесты

- Добавлен регрессионный блок в `tests/unit/multi-control.test.js` — «рассинхрон курсора после wheel-скролла»: вычитание masterScroll, проброс scroll в onMouseMoved/click, реальный scroll в `scrollTo`, `_syncSlaveScroll`, формат masterScroll.
- Добавлен блок в `tests/unit/cdp-manager.test.js` — «SYNC_EVENT_SCRIPT передаёт реальный scroll мастера»: проверка `window.scrollX/scrollY` в обработчиках mousemove/wheel/mousedown/mouseup/click.
- Всего 716 тестов, все проходят.

---

## v1.3.3 (Multi-Control Coordinate Fix)

### Исправления

- **[BUG] Multi-Control: координаты кликов и hover не синхронизировались после прокрутки страницы.**
  \_toSlaveCoords\ конвертировала page-координаты в viewport неверно: \pageX - masterScrollX + slaveScrollX + offsetX\ давала \clientX + slaveScrollX + offsetX\ вместо \clientX + offsetX\. Клик по dropdown после прокрутки попадал мимо целевого элемента.
  **Фикс:** формула изменена на \pageX - slaveScrollX + offsetX\ — правильная конвертация page→viewport.

- **[BUG] Multi-Control: \masterScroll\ не обновлялся при прокрутке — координаты дрейфовали.**
  \masterScroll\ был статическим снапшотом при инициализации. После прокрутки master-страницы формула конвертации координат становилась всё менее точной.
  **Фикс:** \masterScroll\ теперь обновляется накоплением дельт в \scrollTo\.

- **[BUG] Multi-Control: синхронизация ломалась при открытии нового таба.**
  \setActiveMasterTab\ вызывался только для \mouseDown\ (исключения: \mouseMove\, \scroll\, \keyUp\, \charInput\). При переключении на новый таб \ctiveMasterTab\ не обновлялся → \_getSlaveSession\ искал slave-сессию по устаревшему табу → события шли не в тот slave.
  **Фикс:** убран фильтр исключений — \setActiveMasterTab\ вызывается для ВСЕХ событий от master.

### Тесты

- Обновлён тест \учитывает scroll slave при пересчёте координат\ — теперь проверяет slave scroll вместо master scroll.
- Всего 707 тестов, все проходят.

---

## v1.3.2

### Исправления

- **[BUG] Browser Start: `getBrowserPath()` не находила браузер в Electron fork — "CloakBrowser не установлен".**
  При запуске core-движка из GUI через `child_process.fork` переменная `HOME` может быть не задана на Windows, а `USERPROFILE` всегда доступна. Старый порядок `HOME || USERPROFILE` не работал в fork-окружении Electron. Дополнительно: `fs.existsSync(null)` выбрасывал `TypeError` если `getBrowserPath()` возвращал `null`.
  **Фикс:** изменён порядок на `USERPROFILE || HOME`, добавлена null-проверка `!browserPath || !fs.existsSync(browserPath)`, добавлен импорт `logger` в `browser.js`.

- **[BUG] copy-backend копировал устаревший код из `gui/backend/` вместо `src/`.**
  `gui/backend/` была обычной директорией-копией (не symlink), поэтому `copy-backend.js` копировала устаревшие файлы при сборке. Обновления в `src/api/browser.js` не попадали в release.
  **Фикс:** `copy-backend.js` теперь копирует из `path.join(__dirname, '..', '..', 'src')` вместо `gui/backend`. Добавлена `fs.statSync()` вместо `entry.isDirectory()` для корректного обхода симлинков на Windows.

- **[BUG] Proxy не отображаются в ProfileModal при редактировании.**
  `ProfileModal.vue` не загружал список прокси при открытии модального окна. Если пользователь не посещал страницу прокси, выпадающий список был пуст.
  **Фикс:** добавлен `proxiesStore.fetchAll()` при открытии модального окна.

- **[BUG] Start/Stop без обработки ошибок — статус зависал в `starting`.**
  Если API возвращал ошибку, `profilesStore.fetchAll()` не вызывался и статус профиля оставался `starting` навсегда.
  **Фикс:** добавлен `try/catch/finally` в `startProfile`/`stopProfile` в `Profiles.vue`.

### Тесты

- Добавлены `tests/unit/browser-get-path.test.js` — source-level и функциональные тесты для `getBrowserPath` (USERPROFILE优先, null-guard, fallback logic).
- Добавлены `tests/unit/copy-backend.test.js` — регрессионные тесты для `copy-backend.js` (источник `src/`, `statSync` вместо `isDirectory`).
- Всего 707 тестов, все проходят.

---

## v1.3.0

### Исправления

- **[BUG] Automation Matrix: кнопка "Create Run" неактивна при отметке чекбоксов в первых столбцах.**
  `selectedCount` был `ref(0)` + `watch({ deep: true })` — Vue 3 не отслеживала добавление новых свойств в `ref({})`.
  **Фикс:** замена на `computed` — ленивое отслеживание зависимостей работает корректно для любых изменений.
  Добавлены 3 регрессионных теста, гарантирующих корректный подсчёт для каждого столбца независимо.

- **[BUG] Automation Matrix: кнопка "Create Run" неактивна для проектов без привязки к аккаунтам.**
  `allowed_profile_ids` возвращался как `[]` (пустой массив). В JS `[]` truthy, поэтому `|| fallback` не срабатывал — `allowedIds` оставался `[]` и проверка `includes()` всегда возвращала false.
  **Фикс:** замена `proj?.allowed_profile_ids || fallback` на `proj?.allowed_profile_ids?.length ? ... : fallback` в `selectedCount` и `getEnabledEntries`.

- **[BUG] Automation Matrix: снятие галочки не отключало ячейку в БД.**
  `getEnabledEntries()` отправляла только включённые записи (`is_enabled: 1`). Отключённые ячейки не отправлялись на сервер и оставались `is_enabled: 1` в БД.
  **Фикс:** `getEnabledEntries()` теперь отправляет все записи (включая `is_enabled: 0`).

- **[BUG] Executor: необработанная ошибка спавна Python молча убивала процесс.**
  Отсутствовал `child.on('error')` обработчик. Если Python не найден (ENOENT), необработанное событие crash-ило Node.js процесс.
  **Фикс:** добавлен `child.on('error')` с логированием и пометкой задач как `failed`.

- **[BUG] Executor: `incrementRun` передавался но нигде не вызывался.**
  Счётчики `completed_tasks`/`success_tasks`/`failed_tasks` обновлялись только через HTTP-колбэк Python-скрипта — если скрипт падал до колбэка, счётчики оставались 0.
  **Фикс:** добавлен `.catch()` на `executor.start()` с финализацией статуса и пометкой задач.

- **[BUG] Bilid: бэкенд не попадал в packaged app из-за .gitignore.**
  `gui/backend/` был в `.gitignore` → electron-builder исключал его из asar и extraResources → `core-manager.js` не мог найти `index.js` → бэкенд не стартовал → фронт не коннектился к беку.
  **Фикс:** добавлен хук `afterPack` (`scripts/copy-backend.js`) для копирования бэкенда в `resources/backend/`. Исправлен путь в `core-manager.js`.

- **[BUG] Runs: нет автообновления статуса выполнения.**
  Страница Runs не обновляла прогресс без ручного рефреша.
  **Фикс:** добавлен polling каждые 3 сек пока есть running-раны.

---

## Тесты

- Всего: **691 тест** (44 файла)
- Обновлены регрессионные тесты в `gui-matrix-selection.test.js`:
  - Пустой `allowed_profile_ids: []` не блокирует подсчёт (3 новых теста)
  - `undefined allowed_profile_ids` не блокирует подсчёт
  - Пустой `allowed_profile_ids: []` не блокирует серверные ячейки
  - `getEnabledEntries` создаёт entries для всех профилей когда `allowed_profile_ids` пуст
  - Согласованность `selectedCount` и `getEnabledEntries`
