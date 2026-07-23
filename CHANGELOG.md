# Changelog

## v1.4.2

### Улучшения

- **[SEC] Динамический User-Agent по версии CloakBrowser.**
  UA теперь генерируется на основе реальной версии CloakBrowser (Авто-определение из `~/.cloakbrowser/` → ручная настройка в Settings → дефолт). При обновлении CloakBrowser UA автоматически обновляется. ✅ `src/core/cloakbrowser-version.js`, `src/fingerprint/index.js`

- **[SEC] GeoIP timezone при запуске браузера.**
  Timezone теперь определяется автоматически по IP прокси через `ip-api.com`, а не берётся из профиля. Это guaranteет что timezone соответствует геолокации прокси. ✅ `src/api/browser.js`

- **[API] Настройка версии CloakBrowser.**
  Новые эндпоинты `GET/PUT /api/settings/cloakbrowser-version` для ручного задания версии. ✅ `src/api/settings.js`

### Исправления

- **[SEC] User-Agent обновлён с Chrome 131 на Chrome 146.**
  BrowserScan детектировал несоответствие: UA говорил Chrome 131, а реальный браузер CloakBrowser — Chrome 146. Это была мгновенная детекция. ✅ `src/fingerprint/index.js`

- **[SEC] Антидетект: timezone через `--fingerprint-timezone`.**
  Timezone теперь передаётся на уровне движка CloakBrowser через бинарный флаг `--fingerprint-timezone`, а НЕ через обнаруживаемую CDP-эмуляцию `Emulation.setTimezoneOverride`. Это исключает детектирование мультиаккаунтинга по timezone. ✅ `src/api/browser.js:301-313`

- **[SEC] Антидетект: дополнительные флаги.**
  Добавлены `--lang=en-US`, `--no-first-run`, `--no-default-browser-check` — отключают первичные диалоги и стандартные проверки браузера. ✅ `src/api/browser.js:309-311`

- **[FIX] Retry-логика при запуске браузера.**
  При ошибке `ERR_ADDRESS_IN_USE` автоматически повторяет запуск до 3 раз с задержкой 2 секунды. ✅ `src/api/browser.js:356-388`

### Тесты

- Добавлен `tests/unit/browser-start-await.test.js` (8 новых тестов): проверка `--fingerprint-timezone`, `--lang`, `--no-first-run`, `--no-default-browser-check`, `SPAWN_RETRIES`, `SPAWN_RETRY_DELAY_MS`, `ERR_ADDRESS_IN_USE`
- Всего: **771 тестов** (49 файлов), все проходят

## v1.4.1

### Улучшения

- **[UX] Чекбоксы на странице прокси.**
  Добавлен множественный выбор прокси через чекбоксы в каждой строке + чекбокс "выбрать все" в шапке таблицы. При выделении появляется панель bulk-действий с кнопкой "Check Selected" и счётчиком выбранных.

- **[UX] Кнопка "Check Selected" на странице прокси.**
  Массовая проверка выделенных прокси — последовательный вызов check для каждого выбранного прокси с отображением результата. Выделение сбрасывается после завершения.

- **[UX] Кнопка "Delete Selected" на странице прокси.**
  Массовое удаление выделенных прокси — последовательный вызов remove для каждого выбранного прокси. Выделение сбрасывается после завершения.

- **[UX] Пагинация с выбором размера страницы на странице прокси.**
  Добавлен dropdown для выбора количества записей на странице (10/20/50/100), аналогично странице профилей.

- **[FIX] proxies store: fetchAll обрабатывает ошибку.**
  Добавлен catch-блок в `fetchAll()` — при ошибке сети данные очищаются (аналогично automation store).

### Тесты

- Добавлен `tests/unit/gui-proxies-store.test.js` (10 тестов): fetchAll (успех/ошибка/loading), create, importBulk, update, remove, check
- Всего: **763 тестов** (49 файлов), все проходят

### Исправления

- **[BUG] Ctrl+W не закрывал таб в slave при multi-control синхронизации.**
  Причины: (1) нативный addon `hooks.node` (WH_KEYBOARD_LL) не собирался и отсутствовал в packaged app — OS keyboard hooks не стартовали; (2) путь к addon в packaged режиме содержал лишний `src` сегмент; (3) SYNC_EVENT_SCRIPT не блокировал Ctrl+W и не отправлял `browserAction` event.
  **Фикс:** (1) добавлен `build:native` скрипт в package.json; (2) исправлен путь в `keyboard-hooks.js` (`resources/backend/os-input/...` вместо `resources/backend/src/os-input/...`); (3) SYNC_EVENT_SCRIPT блокирует Ctrl+W через `e.preventDefault()` и отправляет `browserAction: closeTab` через CDP binding; (4) добавлен negation в `.gitignore` для `src/os-input/native-hooks/build/`. ✅ `src/multi-control/cdp-manager.js`, `src/api/multi-control.js`, `gui/src/main/keyboard-hooks.js`, `.gitignore`, `package.json`

- **[CHORE] SYNC_EVENT_SCRIPT теперь включает modifier keys в emitted events.**
  `ctrlKey`, `shiftKey`, `altKey`, `metaKey` теперь передаются в keyDown/keyUp событиях через SYNC_EVENT_SCRIPT. Ранее `ctrlKey` отсутствовал, что ломало фильтр в `controller.onKeyDown()`. ✅ `src/multi-control/cdp-manager.js`

### Улучшения

- **[UX] Кнопка Stop Sync теперь останавливает синхронизацию напрямую.**
  Ранее при нажатии на кнопку Stop Sync открывалось выпадающее меню с опцией "Остановить синхронизацию". Теперь кнопка останавливает синхронизацию одним кликом без промежуточного меню. Кнопка Sync (выбор Master) по-прежнему работает через dropdown.

- **[UX] Столбец Proxy на главной странице отображает host и port.**
  Ранее столбец Proxy показывал только `Proxy #id`. Теперь отображается `host` (первая строка) и `port` (вторая строка) — аналогично стилю столбца Fingerprint. Клик по колонке Proxy открывает диалог редактирования прокси.

- **[UX] Столбец Connection на странице прокси разбит на две строки.**
  Ранее `host:port` отображалось в одну строку. Теперь `host` (первая строка) и `port` (вторая строка, `text-slate-500`).

- **[UX] Новый столбец Accounts на странице прокси.**
  Показывает имена профилей, использующих данный прокси. Имена кликабельны — открывается диалог редактирования профиля.

- **[UX] Единый диалог редактирования прокси (ProxyModal).**
  Вынесен в переиспользуемый компонент `ProxyModal.vue`. Теперь одинаковый диалог работает на главной странице, странице прокси и в модальном окне. Включает badge статуса (Active/Inactive) и кнопку Check.

- **[UX] Кнопка Check прокси доступна в 3 местах.**
  Главная страница (столбец Proxy Status), страница прокси (столбец Actions), модал редактирования прокси.

- **[FIX] Валидация proxy_rotation_url.**
  Пустая строка `""` теперь корректно обрабатывается (принимается как `null`). URL валидируется только при непустом значении.

- **[FEATURE] Поле Location для прокси (формат `DE(Germany)`).**
  Добавлено поле `location` в таблицу `proxies`. Локация определяется автоматически при проверке прокси (check) через ip-api.com. Отображается: главная страница (столбец Proxy вместо порта), страница прокси (новый столбец Location), модал редактирования прокси (рядом с Host), dropdown прокси в редактировании аккаунта (`protocol://IP - Location(count)`).

### Тесты

- Добавлен `tests/unit/hooks-node-path.test.js` (9 тестов): проверка наличия hooks.node, корректности путей в keyboard-hooks.js, negation в .gitignore, build:native скрипта
- Всего: **747 тестов** (48 файлов), все проходят

---

## v1.4.0 (Security Hardening)

### Безопасность

- **[SEC] WebSocket `/ws` требует аутентификации.**
  Любой localhost-процесс мог подключиться к WebSocket и получать логи/статусы профилей без токена.
  **Фикс:** при подключении проверяется `?token=` query parameter. Без валидного токена — `ws.close(4401)`. Фронтенд передаёт токен в WS URL. ✅ `src/core/websocket.js`, `gui/src/renderer/composables/useWebSocket.js`

- **[SEC] Recovery key показывается один раз и удаляется из БД.**
  `/api/settings/recovery-key` возвращал base64-encoded master key, который оставался в `system_config` навсегда. Любой authenticated клиент мог расшифровать все секреты.
  **Фикс:** `POST /recovery-key` удаляет строку после показа (POST вместо GET из-за side-effect). `POST /set-master-password` и `POST /change-master-password` возвращают recovery key в ответе, не храня в БД. `clearRecoveryKey()` теперь делает `DELETE` вместо пустой строки. ✅ `src/api/settings.js`, `src/crypto/index.js`

- **[SEC] Убран plaintext fallback master key.**
  Если `keytar` недоступен, ключ хранился как hex в `system_config` SQLite — любой процесс с доступом к файлу БД мог прочитать ключ.
  **Фикс:** `initMasterKey()` не генерирует и не хранит ключ открытым текстом. Если keytar недоступен и пароль не установлен — возвращает `null`, система работает в режиме ожидания пароля. ✅ `src/crypto/index.js`

- **[SEC] Блокировка записи секретов до инициализации master key.**
  Сервер стартовал до завершения `initMasterKey()`. Ранние запросы на создание профилей/прокси могли сохранять секреты без шифрования.
  **Фикс:** добавлен `requireMasterKey` middleware — блокирует POST/PUT/DELETE к `/api/profiles`, `/api/proxies`, `/api/cookies` пока ключ не готов (503). GET-запросы работают. ✅ `src/core/app.js`

- **[SEC] Секреты удалены из Internal API.**
  `/api/internal/profiles` возвращал расшифрованные пароли, auth-токены и proxy credentials (username/password/connection_string) любому authenticated клиенту.
  **Фикс:** секретные поля (`email_password`, `twitter_password`, `twitter_auth_token`, `discord_password`, `discord_token`, `wallet_password`) удалены из ответа. Proxy credentials заменены на `has_auth` (boolean). Удалена функция `buildProxyString`. ✅ `src/api/internal.js`

- **[SEC] Proxy credentials теперь шифруются в SQLite.**
  `proxies.username` и `proxies.password` хранились открытым текстом. Любой процесс с доступом к БД мог прочитать прокси-авторизацию.
  **Фикс:** добавлены `encryptProxyFields()` / `decryptProxyRow()` — шифрование при записи, расшифровка при чтении. Паттерн аналогиченSECRET_FIELDS для профилей. ✅ `src/db/queries.js`, `src/api/proxies.js`

- **[SEC] CDP password injection исправлен.**
  Wallet password вставлялся в JavaScript через string interpolation (`password.replace(...)`). Пароль с `'` или `\n` мог выполнить произвольный JS.
  **Фикс:** `Runtime.callFunctionOn` с isolated function и arguments array вместо string interpolation. ✅ `src/api/browser.js`

- **[SEC] CDP selectors injection исправлен.**
  `waitForSelector` / `waitForSelectorHidden` конкатенировали CSS-селектор в `document.querySelector('${selector}')`.
  **Фикс:** `Runtime.callFunctionOn` с selector как аргументом функции. ✅ `src/api/browser.js`

- **[SEC] Extension installation теперь валидирует manifest.**
  Расширения устанавливались без проверки `manifest.json`. Автоматически создавался `.enabled` файл.
  **Фикс:** добавлена `validateExtensionDir()` — проверяет наличие `manifest.json` с полями `name`, `version`, `manifest_version` (2 или 3). `.enabled` больше не создаётся автоматически — включать через toggle. ✅ `src/api/extensions.js`

- **[SEC] CRX парсер отвергает неизвестные версии.**
  `extractZipFromCrx` возвращал исходный буфер для не-CRX файлов и неизвестных версий, что позволяло обработать произвольный файл как zip.
  **Фикс:** reject для невалидных magic bytes и неизвестных CRX-версий. ✅ `src/api/extensions.js`

- **[SEC] Cookie temp-файл всегда удаляется.**
  Cookie content записывался в `/tmp/cookies_<timestamp>.txt` и удалялся только при успехе. При ошибке парсинга файл оставался с сырыми куки.
  **Фикс:** `try/finally` block — unlink выполняется всегда. ✅ `src/api/cookies.js`

- **[SEC] Proxy rotation SSRF защищён.**
  `rotateProxy()`.fetchал любой URL без валидации. Возможен SSRF на localhost/приватные сети.
  **Фикс:** валидация scheme (http/https) и блокировка private/local адресов. ✅ `src/proxy/index.js`

- **[SEC] pty log tail валидирует пути.**
  Renderer мог запросить tail произвольного файла.
  **Фикс:** `isAllowedLogPath()` проверяет что путь в allowed directories. ✅ `gui/src/main/pty.js`

- **[SEC] Core token ротируется при каждом старте.**
  `coreToken` генерировался один раз при загрузке модуля и не менялся.
  **Фикс:** ротация при каждом `startCore()`. ✅ `gui/src/main/core-manager.js`

- **[SEC] Browser manager ищет бинарник по платформе.**
  `getCloakBrowserBinary()` искал только `chrome.exe`. На Linux/macOS не находил браузер.
  **Фикс:** platform-appropriate binary name. ✅ `gui/src/main/browser-manager.js`

### Исправления

- **[BUG] `listExtensions()` вызывалась без await в sync route.**
  `router.get('/')` вызывал async `listExtensions()` без await — возвращал Promise вместо массива.
  **Фикс:** route handler сделан async + await. ✅ `src/api/extensions.js`

- **[BUG] Matrix JSON.parse без try/catch.**
  `JSON.parse(proj.default_config || '{}')` мог упасть при битом конфиге и крашнуть route.
  **Фикс:** обёрнуто в try/catch с fallback на `{}`. ✅ `src/api/matrix.js`

- **[BUG] Native addon загружался без platform check.**
  `.node` addon загружался на всех платформах — на Linux/macOS падал.
  **Фикс:** `process.platform === 'win32'` guard с graceful degradation. ✅ `src/os-input/native-hooks/index.js`

- **[BUG] Missing `badRequest` import в browser.js.**
  `badRequest` использовалась в `zerion-login` но не импортировалась из `errors`.
  **Фикс:** добавлен импорт. ✅ `src/api/browser.js`

- **[CHORE] Extension assign-all обёрнут в транзакцию.**
  Итерация по профилям с UPDATE без транзакции — частичная ошибка оставляла inconsistent state.
  **Фикс:** `db.transaction()`. ✅ `src/api/extensions.js`

### Тесты

- Обновлены тесты: `extensions.test.js` (CRX reject), `pty.test.js` (electron mock), `websocket.test.js` (token auth), `api-real.test.js` (master key setup)
- Всего: **737 тестов** (47 файлов), все проходят

---

## v1.3.2

### Исправления

**Multi-Control**

- **[BUG] Курсор в slave рассинхронизировался после прокрутки колесом — клики уходили мимо цели.**
  До скролла синхронизация работала, после — курсор «уплывал». Три причины:
  1. `masterScroll` не вычитался в `_toSlaveCoords` — координаты считались как `pageX_master - slaveScroll`, что верно только при одинаковой прокрутке master и slave.
  2. `slaveScroll` опережал реальный `window.scrollY` страницы (гонка): в `_runScrollSequence` scroll наращивался в момент отправки wheel, а браузер докручивался асинхронно.
  3. Накопление дельт вместо реального значения — сумма `deltaY` не равна реальному смещению контента (инерция, плавный скролл, трекпад).
  **Фикс:** перешли на РЕАЛЬНЫЙ `window.scrollX/scrollY`. `SYNC_EVENT_SCRIPT` передаёт scroll мастера в событиях мыши/скролла; `_toSlaveCoords` конвертирует `page → viewport мастера → viewport slave`; после серии wheel `_syncSlaveScroll` читает реальный scroll slave через `getPageScroll`; `scrollTo` пишет реальный scroll вместо накопления дельт. `MouseSmoother` не тронут.

- **[BUG] Синхронизация ломалась при открытии нового таба.**
  `setActiveMasterTab` вызывался только для `mouseDown` (исключения: `mouseMove`, `scroll`, `keyUp`, `charInput`). При переключении на новый таб `activeMasterTab` не обновлялся → `_getSlaveSession` искал slave-сессию по устаревшему табу → события шли не в тот slave.
  **Фикс:** убран фильтр исключений — `setActiveMasterTab` вызывается для ВСЕХ событий от master.

- **[CHORE] Унифицирован формат `masterScroll`.**
  В конструкторе был `{x, y}`, в `stop()` — `{scrollX, scrollY}`. Приведено к единому `{scrollX, scrollY}` везде (конструктор, `stop`, `scrollTo`).

**Browser / GUI / Build**

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

- Регрессионный блок в `tests/unit/multi-control.test.js` — «рассинхрон курсора после wheel-скролла»: вычитание masterScroll, проброс scroll в onMouseMoved/click, реальный scroll в `scrollTo`, `_syncSlaveScroll`, формат masterScroll.
- Блок в `tests/unit/cdp-manager.test.js` — «SYNC_EVENT_SCRIPT передаёт реальный scroll мастера»: проверка `window.scrollX/scrollY` в обработчиках mousemove/wheel/mousedown/mouseup/click.
- `tests/unit/browser-get-path.test.js` — тесты для `getBrowserPath` (USERPROFILE-приоритет, null-guard, fallback logic).
- `tests/unit/copy-backend.test.js` — регрессионные тесты для `copy-backend.js` (источник `src/`, `statSync` вместо `isDirectory`).
- Всего 719 тестов, все проходят.

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
