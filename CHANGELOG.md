# Changelog

## v1.4.2

### Интеграция / Automation

- **[FEAT] Каталог профилей MultiManager через API для миграции stAuto0.**
  Добавлен внутренний endpoint `GET /api/internal/profile-storage`: возвращает фактический каталог профилей `{ "profiles_dir": "<abs>" }`, вычисляемый через `getDataDir()` (`path.join(getDataDir(), 'profiles')`). Учитывает `MULTIMANAGER_DATA_DIR`; не принимает параметры, не изменяет состояние и не обращается к БД; авторизация — через общий Bearer `authMiddleware` (401 при невалидном токене, 500 при некорректном `MULTIMANAGER_DATA_DIR` — без stack trace и без логирования токена).
  - stAuto0: `Core/multimanager.py.get_profile_storage_dir()` (Bearer auth, `ClientTimeout(total=3)`, проверка статуса/JSON/поля/абсолютности пути, без токена в сообщениях) и `scripts/migrate_profile_dirs.py` — каталог назначения запрашивается у MM; fallback и путь `CloakManager/profiles` удалены, при недоступном MM миграция завершается с ошибкой до начала копирования; схема target `<profiles_dir>/<UUID>/BrowserData`, `Default/Extensions` по-прежнему исключается.
  ✅ `src/api/internal.js`, `tests/unit/internal-profiles.test.js`, `docs/API.md`, `docs/API.en.md`, `docs/API.zh.md`; stAuto0: `Core/multimanager.py`, `scripts/migrate_profile_dirs.py`, `tests/test_migration.py`, `docs/scripts.md`

### UI

- **[UX] Уведомление о нерабочем прокси при запуске профиля.** При `Start` с недоступным прокси профиль не запускается, и раньше ошибка `412 PRECONDITION_FAILED` попадала только в DevTools Console. Теперь GUI показывает `message.error` с именем профиля: `Профиль «{имя}» не запущен: прокси недоступен.` (имя берётся из `profilesStore`, fallback — id профиля). Прочие ошибки запуска тоже показываются уведомлением с именем профиля без маскирования исходного текста ошибки. `console.error` и `finally` с обновлением списка профилей сохранены. Работает и для массового запуска (`bulkStart` вызывает `startProfile`).
  ✅ `gui/src/renderer/views/Profiles.vue`

- **[UX] Отображение прокси в формате `host:port` одной строкой.** Ранее `host` и `port` показывались в две строки, а на главной порт вообще пропадал при наличии `location` (`location || port`).
  **Решение:**
  - `gui/src/renderer/views/Profiles.vue` — колонка `proxy`: `host:port` одной строкой (`text-xs font-mono`), локация — второй строкой (`text-xs text-slate-500`) только при наличии; логика `location || port` удалена, порт показывается всегда вместе с host.
  - `gui/src/renderer/views/Proxies.vue` — колонка `connection`: одна строка `host:port`; вторая строка с `port` удалена (Location имеет отдельную колонку).
  - Изменены только шаблоны `.vue`; логика, API, БД и стили Tailwind не затронуты.
  ✅ `gui/src/renderer/views/Profiles.vue`, `gui/src/renderer/views/Proxies.vue`

### Интеграция / Automation

- **[FIX] Первый запуск `init_wallet4browser.py` для мигрированных профилей.** Runtime ID Zerion теперь запрашивается **после** запуска браузера (`POST /api/browser/:id/start`), когда запись о загруженном расширении появляется в `Default/Secure Preferences` по точному пути `MultiManager/extensions`, а не до запуска. Fallback `klghhnkeealcohjjanjjdaeeggmfmlpl` (имя каталога, не runtime ID) удалён: при недоступности ID скрипт завершается с понятной ошибкой и закрывает браузер. Retry: до 5 попыток, интервал 500 мс, общий deadline 3 с, timeout каждой попытки ограничен оставшимся временем. HTTP-сессии `MultiManagerClient` в `BaseBrowser` (`_launch_via_multimanager()`, `close()`, `login_zerion()`) закрываются через `async with` — устранены `Unclosed client session`/`Unclosed connector`.
  ✅ stAuto0: `scripts/init_wallet4browser.py`, `Core/multimanager.py`, `Core/browser.py`, `tests/test_init_wallet4browser.py` (новый), `tests/test_multimanager.py`, `tests/test_browser.py`, `docs/init_browser.md`, `docs/scripts.md`, `docs/browser.md`

- **[FEAT] Динамический runtime ID Zerion для `init_wallet4browser.py`.** Ручной скрипт инициализации кошелька строит URL импорта с актуальным runtime ID расширения Zerion, полученным из MultiManager для конкретного профиля, а не с устаревшей статической константой.
  - `src/api/internal.js` — новый endpoint `GET /api/internal/profiles/:id/zerion-extension`: берёт первое назначенное расширение (`profile.extensions[0]`), вызывает `resolveRuntimeId()` (приоритет `Secure Preferences` по точному пути, затем `manifest.key`) и возвращает `{ id }`; сервер валидирует `^[a-z]{32}$`. Ошибки: 404 (профиль не найден), 400 (невалидный список/нет расширения/не определён runtime ID/неверный формат), 500 (неожиданная fs-ошибка) без стектрейса и секретов.
  - Поведение `POST /api/browser/:id/zerion-login` и executor не изменено — оба продолжают использовать первое назначенное расширение.
  - stAuto0: `Core/multimanager.py.get_zerion_extension_id(profile_id)` (Bearer auth, `ClientTimeout(total=3)`, проверка статуса/JSON/формата) и `scripts/init_wallet4browser.py` строит URL внутри `init_wallet()` с fallback `klghhnkeealcohjjanjjdaeeggmfmlpl` при недоступности MM или невалидном ответе.
  ✅ `src/api/internal.js`, `tests/unit/internal-profiles.test.js`, docs/API*.md; stAuto0: `Core/multimanager.py`, `scripts/init_wallet4browser.py`, `tests/test_multimanager.py`

### Fingerprint / Anti-detect

- **[FIX] Согласование fingerprint с CloakBrowser: Chrome-only UA и документированный `--fingerprint`.**
  Устранён конфликт Firefox/Chromium, который детектировал BrowserScan: генератор мог записать Firefox/Safari UA в профиль, а запуск навязывал сохранённый UA через `--user-agent` поверх движка Chromium 146.
  **Решение:**
  - `src/fingerprint/index.js` — в `UA_TEMPLATES` оставлены только Chrome-шаблоны для `windows`/`macos`/`linux`; Firefox и Safari варианты удалены, генератор больше не может их выбрать.
  - `src/api/browser.js` — флаг `--fingerprint-seed=<uuid>` заменён на документированный CloakBrowser `--fingerprint=<seed>` (master seed для WebGL/GPU/Audio/Canvas/fonts/hardware/screen); ручной `--user-agent=` больше не передаётся в запуск.
  - Без ручных overrides WebGL/GPU/Audio/Canvas/Renderer/Client Hints; профиль, proxy, timezone, extensions, CDP и обработка ошибок запуска сохранены.
  - Тесты: проверки Chrome-only UA и отсутствия Firefox/Safari в `fingerprint.test.js`, `fingerprint-edge.test.js`; наличие `--fingerprint=`, отсутствие `--fingerprint-seed=` и ручного `--user-agent` в `browser-start-await.test.js`.
  ✅ `src/fingerprint/index.js`, `src/api/browser.js`, `tests/unit/fingerprint.test.js`, `tests/unit/fingerprint-edge.test.js`, `tests/unit/browser-start-await.test.js`

- **[EXP] Проверка `--fingerprint-storage-quota` (A/B-эксперимент).** BrowserScan показывал «Скрытый режим: Да, штраф -10%» из-за нормализованного CloakBrowser storage quota. В запуск MM добавлен ровно один аргумент `--fingerprint-storage-quota=10240` (после `--fingerprint-timezone`); `--unlimited-storage` не используется. Seed, proxy, extensions, CDP и остальные параметры запуска не изменены. Гипотеза подтверждена на том же профиле и прокси: штраф «Скрытый режим -10%» исчез. Решение о постоянном применении `10240` — отдельная задача после проверки влияния на остальные сигналы.
  ✅ `src/api/browser.js`, `tests/unit/browser-start-await.test.js`

### Multi-Control

- **[FEAT] Single-source keyboard: native hook — единственный источник клавиатуры.**
  Устранён double dispatch: при вводе в DOM-элементе master page клавиши уходили в slave дважды — через CDP `SYNC_EVENT_SCRIPT` (`keydown`/`keyup`/`charInput`) и через нативный hook `WH_KEYBOARD_LL` → `/api/multi-control/os-keyboard`. Enter дублировался в формах.
  **Решение:**
  - CDP-клавиатура удалена: `SYNC_EVENT_SCRIPT` больше не вешает `keydown`/`keyup` listeners; `charInput`, `browserAction` (closeTab/newTab) и preventDefault для Ctrl+N удалены. `injectFromCdp` не эмитит клавиатурные события (`inputCapture` — только mouse/wheel).
  - Клавиатура идёт только через native hook: `keyDown`/`keyUp` + отдельное событие `charInput` для печатных символов. Клавиша уходит в slave ровно один раз.
  - Текст с учётом раскладки: `hooks.cc` вычисляет `text` через `ToUnicodeEx` (раскладка foreground-окна, Shift, CapsLock, AltGr; композиция dead keys через `s_deadKeyVk`/`s_deadKeyPending`). `charInput` шлётся только для plain text (не командные Ctrl/Meta/Alt без AltGr, не dead keys).
  - Browser-сочетания: Ctrl+T — браузер мастера открывает таб нативно, синхронизация через `discoverActiveTab`; Ctrl+W — закрытие slave-табов через CDP + `unmapTab`; Ctrl+N — блокируется от форвардинга в `onKeyDown`. Ctrl+1..9 и прочие сочетания форвардятся через `dispatchKeyEvent`.
  - Lifecycle: `wireInputToController`/`unwireInputFromController` сохраняют ссылки на handlers и снимают их через `inputCapture.off()`; `unwire` вызывается в `/stop` и в catch `/start` — повторные start/stop не накапливают обработчики.
  - `await discoverActiveTab()` перед Enter в `/os-keyboard` — Enter уходит в актуальный таб.
  ✅ `src/multi-control/cdp-manager.js`, `src/api/multi-control.js`, `src/multi-control/index.js`, `src/os-input/native-hooks/hooks.cc`, `src/os-input/native-hooks/index.js`, `src/os-input/input-capture.js`, `gui/src/main/keyboard-hooks.js`, `gui/src/main/keyboard-hooks-payload.js` (новый), `tests/unit/os-input.test.js`, `tests/unit/cdp-manager.test.js`, `tests/unit/multi-control.test.js`, `tests/unit/multi-control-api.test.js`, `tests/unit/keyboard-hooks-payload.test.js` (новый)

### Безопасность

- **[FEAT] Постоянный API-токен автоматизации.** Токен больше не генерируется при каждом запуске: генерируется один раз при первом старте и сохраняется в `system_config.api_token`, переиспользуется при перезапусках. Electron main process не передаёт токен через env — backend резолвит его по приоритету `--api-token=` → `API_TOKEN` → `system_config.api_token` → новая генерация и сообщает main через IPC `process.send({ type: 'api-token' })`. Добавлен `POST /api/settings/api-token/regenerate` (Bearer auth): ротация действует немедленно, обновляет активный auth token, закрывает все активные WebSocket-соединения и инвалидирует старый токен. Renderer переподключает WebSocket по watcher на `appStore.token`; UI-кнопка «Regenerate API Token» в Settings с подтверждением (3 локали). Токен не логируется.
  ✅ `src/index.js`, `src/api/auth.js`, `src/api/settings.js`, `src/core/websocket.js`, `gui/src/main/core-manager.js`, `gui/src/main/index.js`, `gui/src/preload/index.js`, `gui/src/renderer/stores/app.js`, `gui/src/renderer/composables/useWebSocket.js`, `gui/src/renderer/views/Settings.vue`, `gui/src/renderer/i18n/*.json`, `docs/API.md`, `tests/unit/settings-token.test.js` (новый)

- **[SEC] Устранены уязвимости зависимостей backend.** Обновлены `adm-zip` (0.5.18 → 0.6.0), `ip-address` (10.2.0 → 10.4.0), `body-parser` (1.20.5 → 1.20.6), `brace-expansion` (1.1.15 → 1.1.18), `esbuild` (0.27.7 → 0.28.1). Генерирован чистый lock-файл. ✅ `package.json`, `package-lock.json`

- **[SEC] Устранены уязвимости зависимостей GUI/Electron.** Обновлены `electron` (34.5.8 → 43.3.0), `electron-builder` (25.1.8 → 26.15.3), `better-sqlite3` (11.7.0 → 13.0.3), `cloakbrowser` (0.5.3 → 0.5.4), `postcss` (8.5.15 → 8.5.25), `js-yaml` (4.2.0 → 4.3.1), `concurrently` (9.2.3 → 9.2.4). `tar` форсирован до 7.5.22 через overrides. ✅ `gui/package.json`, `gui/package-lock.json`

- **[SEC] Защита обработки ZIP/CRX расширений.** Введены лимиты на размер архива (10 MB), количество файлов (500), размер одного файла (50 MB), суммарный uncompressed size (100 MB). Добавлена проверка path traversal (`../`, абсолютные пути, drive-relative, NUL-байты, symlink/hardlink). Распаковка во временный каталог с атомарным перемещением. Валидация `name`/`targetName` от path separators и `..`. CRX: проверка границ header до `subarray`. `downloadWithRedirects`: только HTTPS, проверка redirect destinations, лимит размера ответа (20 MB). Безопасные HTTP 500 — без stack traces. ✅ `src/api/extensions.js`, `tests/unit/extensions.test.js`

- **[SEC] Защита proxy от SSRF и отключённой TLS-проверки.** Добавлена `isPrivateAddress()` — проверяет localhost, loopback, RFC1918, link-local, CGNAT, multicast, unspecified, IPv4-mapped IPv6, NAT64, leading-zero формы. `rotateProxy`: валидация адреса на каждом redirect, лимит размера ответа, лимит редиректов. `checkSocks5Proxy`/`checkHttpProxy`: `rejectUnauthorized: true` вместо `false`. Ошибки не раскрывают credentials. ✅ `src/proxy/index.js`, `tests/unit/proxy.test.js`

- **[SEC] Усиление Electron boundary.** Убран универсальный `invoke(channel, ...args)` из preload — только перечисленные IPC channels (13 каналов). Валидация аргументов `pty:start`. Навигационные ограничения: `setWindowOpenHandler` запрещает внешние окна, `will-navigate`/`will-redirect` разрешает только dev URL или открывает во внешнем браузере. Updater: проверка `version` в update events, `allowDowngrade: false`. ✅ `gui/src/preload/index.js`, `gui/src/main/index.js`, `gui/src/main/updater.js`

- **[SEC] Audit-скрипты.** Добавлены `security:audit` в оба `package.json` — `npm audit --audit-level=high`. ✅ `package.json`, `gui/package.json`

- **[CHORE] ESLint flat config.** Создан `eslint.config.mjs` для ESLint 9. Исправлены все 14 ошибок линтера: `no-empty` catch blocks, `no-control-regex`, `no-dupe-keys`. ✅ `eslint.config.mjs`, `src/api/browser.js`, `src/api/extensions.js`, `src/db/queries.js`, `src/logger/index.js`, `src/os-input/hook-worker.js`, `src/proxy/index.js`

### Исправления

- **[FIX] Жизненный цикл Electron: single instance, активация окна и tray.**
  Повторный запуск приложения больше не создаёт второй Electron-процесс и второй backend: `app.requestSingleInstanceLock()` в main process останавливает второй экземпляр до старта, а событие `second-instance` показывает, восстанавливает (если окно минимизировано) и фокусирует существующее окно. Обычный клик по tray-иконке теперь восстанавливает окно так же, как «Открыть панель» и двойной клик, через единый `activateMainWindow` без повторного запуска backend. Путь к tray-иконке исправлен: ресурсы резолвятся относительно `__dirname` внутри `app.asar` (совпадает с `build.files: resources/**/*`) и в dev, и в packaged-режиме; выбор ICO для Windows / PNG для остальных платформ и fallback сохранены, а отсутствие файла или пустой `nativeImage` логируются с указанием пути, формата и причины.
  ✅ `gui/src/main/index.js`, `gui/src/main/tray.js`, `gui/src/main/tray-paths.js` (новый), `gui/src/main/main-window-utils.js` (новый), `tests/unit/electron-lifecycle-tray.test.js` (новый)

- **[FIX] Runtime ID расширения Zerion — имя каталога ≠ chrome-extension:// ID.**
  Имя каталога расширения (`klghhnkeealcohjjanjjdaeeggmfmlpl`) не совпадает с runtime ID Chromium (`lfoeajgcchlidpicbabpmckkejpckcfb`). Использование имени каталога как `chrome-extension://` ID приводило к `ERR_BLOCKED_BY_CLIENT`. Добавлены `computeRuntimeId(manifestKey)` — SHA-256 от DER-encoded `manifest.key`, первые 16 байт → 32 символа `a`–`p` — и `resolveRuntimeId(extPath, profilePath)` — приоритет `Secure Preferences` по точному совпадению пути, затем `manifest.key`. Zerion login и `ZERION_ID` в executor теперь получают настоящий runtime ID. Улучшена диагностика CDP load: вместо `unknown` выводится `exceptionDetails.text`.
  ✅ `src/api/extensions.js`, `src/api/browser.js`, `src/executor/index.js`, `tests/unit/extensions.test.js`, `tests/unit/browser-start-await.test.js`, `tests/unit/executor.test.js`

- **[FIX] Save в настройках больше не пересинхронизирует проекты.**
  `PUT /api/settings/automation` автоматически синхронизировал проекты из ФС после каждого сохранения, что приводило к восстановлению удалённых проектов с отмеченными чекбоксами. Save теперь только сохраняет пути, синхронизация — только через кнопку Sync Projects.
  ✅ `src/api/settings.js`, `docs/API.md`

- **[FIX] FOREIGN KEY constraint failed при удалении профилей, участвовавших в авто-ране.**
  В `run_tasks.profile_id` отсутствовал `ON DELETE CASCADE`. При DELETE профиля, имеющего строки в `run_tasks`, SQLite блокировал операцию. Добавлена миграция с recreate таблицы в транзакции.
  ✅ `src/db/schema.js`, `src/api/profiles.js`, GUI store/view

- **[FIX] GUI: кнопка запуска automation run только для `pending`.**
  Убрана поддержка `partial` — backend не поддерживает перезапуск частично-завершённых ранов. Кнопка «Start» показывается только для статуса `pending`.
  ✅ `gui/src/renderer/views/AutomationRuns.vue`

- **[FIX] executor: исправлен диапазон `--range` в stAuto0.**
  Диапазон строился из `profile.number` (DB-порядок), что приводило к несовпадению: профиль `auto_002` → `--range=001-001`. Исправлено на парсинг числового суффикса из `profile.name` (`auto_002` → `002-002`).
  ✅ `src/executor/index.js`

- **[FIX] executor: токен передаётся явным CLI-аргументом.**
  Добавлен `--token=${apiToken}` в аргументы Python-процесса (ранее только через `MM_TOKEN` в env). Поддержка `MM_TOKEN` сохранена для обратной совместимости.
  ✅ `src/executor/index.js`

- **[FIX] API: ужесточена валидация `profile_path`.**
  `profileUpdateSchema` (был `z.any()`) и `profileBatchSchema` (не проверял абсолютность) приведены к единому стандарту: nullable-строка с проверкой `path.isAbsolute()`. Относительные пути отклоняются на уровне API.
  ✅ `src/api/validate.js`

- **[FIX] browser: pre-flight проверка внешнего профиля.**
  При `profile_path != null` перед spawn браузера проверяется `fs.existsSync(userDataDir)`. При отсутствии каталога возвращается 400 `PROFILE_DIR_NOT_FOUND` вместо создания подменного стандартного профиля.
  ✅ `src/api/browser.js`

- **[FIX] Zerion extension ID исправлен.**
  ID был захардкожен неправильно (`klghhnkeealcohjjanjjdaeeggmfmlpl`). Теперь читается из `profile.extensions` — правильный ID `kdlpoccbjdfjbmpiengmbhjdbkfkkkoj`. ✅ `src/api/browser.js`

- **[FIX] Error message в run tasks.**
  Добавлена колонка `error_message` в таблицу `run_tasks` (миграция). Python передаёт текст ошибки при `report_task_status()`. В интерфейсе отображается тултипом на красных ячейках. ✅ `src/db/schema.js`, `src/db/queries.js`, `src/api/internal-runs.js`

- **[FIX] Executor close-handler не перезаписывает success.**
  Перед пометкой задач как `failed` executor перечитывает статус из БД — если Python уже отчитался (`success`), задача не помечается как `failed`. ✅ `src/executor/index.js`

- **[FIX] Retry-логика при запуске браузера.**
  При ошибке `ERR_ADDRESS_IN_USE` автоматически повторяет запуск до 3 раз с задержкой 2 секунды. ✅ `src/api/browser.js:356-388`

- **[FIX] User-Agent обновлён с Chrome 131 на Chrome 146.**
  BrowserScan детектировал несоответствие: UA говорил Chrome 131, а реальный браузер CloakBrowser — Chrome 146. Это была мгновенная детекция. ✅ `src/fingerprint/index.js`

### Новые возможности

- **[FEAT] Внешние пути к профилям браузера (`profile_path`).**
  Добавлено поле `profile_path` в профили — абсолютный путь к user-data-dir внешнего браузерного профиля. Позволяет использовать профили из внешних проектов (например, stAuto0) без копирования файлов. MM запускает браузер с внешним `user-data-dir`, расширения подгружаются из профиля (как в stAuto0 standalone). Гибридный режим: если `profile_path` не задан — используется стандартный путь MM.
  ✅ `src/db/schema.js`, `src/core/profile-path.js`, `src/api/browser.js`, `src/api/validate.js`, `src/api/profiles.js`, `src/db/queries.js`, `gui/src/renderer/views/ProfileModal.vue`, `docs/API.md`, `docs/DATABASE.md`

### Улучшения

- **[SEC] Динамический User-Agent по версии CloakBrowser.**
  UA теперь генерируется на основе реальной версии CloakBrowser (Авто-определение из `~/.cloakbrowser/` → ручная настройка в Settings → дефолт). При обновлении CloakBrowser UA автоматически обновляется. ✅ `src/core/cloakbrowser-version.js`, `src/fingerprint/index.js`

- **[SEC] GeoIP timezone при запуске браузера.**
  Timezone теперь определяется автоматически по IP прокси через `ip-api.com`, а не берётся из профиля. Это guaranteет что timezone соответствует геолокации прокси. ✅ `src/api/browser.js`

- **[API] Настройка версии CloakBrowser.**
  Новые эндпоинты `GET/PUT /api/settings/cloakbrowser-version` для ручного задания версии. ✅ `src/api/settings.js`

- **[SEC] Антидетект: timezone через `--fingerprint-timezone`.**
  Timezone теперь передаётся на уровне движка CloakBrowser через бинарный флаг `--fingerprint-timezone`, а НЕ через обнаруживаемую CDP-эмуляцию `Emulation.setTimezoneOverride`. Это исключает детектирование мультиаккаунтинга по timezone. ✅ `src/api/browser.js:301-313`

- **[SEC] Антидетект: дополнительные флаги.**
  Добавлены `--lang=en-US`, `--no-first-run`, `--no-default-browser-check` — отключают первичные диалоги и стандартные проверки браузера. ✅ `src/api/browser.js:309-311`

### Тесты

- Добавлен `tests/unit/profile-path.test.js` (21 тест): helper путей, валидация, сканирование расширений внешнего профиля.
- Добавлен `tests/unit/browser-start-await.test.js` (8 новых тестов): проверка `--fingerprint-timezone`, `--lang`, `--no-first-run`, `--no-default-browser-check`, `SPAWN_RETRIES`, `SPAWN_RETRY_DELAY_MS`, `ERR_ADDRESS_IN_USE`
- `tests/unit/runs-api.test.js` — новый тест: `'rejects starting without Authorization header'` (401 без токена).
- `tests/unit/executor.test.js` — обновлён: проверка `--token=tok_xxx` вместо `not.toContain('--token=')`.
- Удалена ссылка на несуществующий `tests/unit/inject.test.js` из CHANGELOG.
- Добавлен `tests/unit/keyboard-hooks-payload.test.js` (11 тестов): vkToKey/vkToCode/buildKeyEvent/shouldSendCharInput (Ctrl/Meta/AltGr/dead keys/пустой text).
- Обновлены: `tests/unit/os-input.test.js` (native hook: text/altGr/dead key; negative: CDP keyDown/charInput), `tests/unit/cdp-manager.test.js` (SYNC_EVENT_SCRIPT не перехватывает клавиатуру), `tests/unit/multi-control.test.js` (Ctrl+W/T/N не форвардятся, Ctrl+1 форвардится), `tests/unit/multi-control-api.test.js` (lifecycle wire/unwire, POST /os-keyboard маршрутизация).
- Всего: **915 тестов** (53 файла), все проходят ✅

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
