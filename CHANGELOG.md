# Changelog

## Unreleased — Retry / Duplicate + Matrix Shift-Selection

- **[Feature] Shift-выделение диапазона в Automation → Matrix** — `gui/src/renderer/views/AutomationMatrix.vue`: `lastSelectedKey`, `handleCellClick($event, record.id, column.projectName)` на обёртке `<span>` вместо `@change` на `a-checkbox`, копирование состояния anchor на прямоугольный диапазон (`filteredProfiles` × активные проекты) с фильтрацией `allowed_profile_ids`, валидация anchor по текущему отображению/поиску, клики по недоступным ячейкам игнорируются. `tests/unit/gui-matrix-selection.test.js` (+12: границы, обратное направление, `allowed_profile_ids`, Shift без anchor, невалидный anchor после фильтрации, массовое выключение копированием). API/БД/версия не менялись.
  ✅ `gui/src/renderer/views/AutomationMatrix.vue`, `tests/unit/gui-matrix-selection.test.js`, `TASK.md`

- **[Feature] Retry и дублирование runs** — `POST /api/runs/:id/retry` (копирует задачи `status != 'success'`) и `POST /api/runs/:id/duplicate` (копирует все) создают новый `pending` run c `pending` задачами, без `exit_code`/`log_file_path`/`attempts`/`error_message`/`started_at`/`completed_at`. Форма предзаполняется `Run YYYY-MM-DD HH:mm` и `parallel_limit=1` (пустое имя → авто), создание атомарно; пустой набор → `400`, нет исходного → `404`; снимок задач по `project_name`/`profile_id`. GUI `AutomationRuns.vue` — две кнопки на карточке (`@click.stop`, любой статус), единый modal `retry`/`duplicate`, `stores/automation.js` `retryRun`/`duplicateRun`, i18n `automation.retry|duplicate|retryTitle|duplicateTitle|retrySuccess|duplicateSuccess|retryEmpty` (ru/en/zh), доки `docs/API*.md`. Версия не менялась.
  ✅ `src/db/queries.js` (`createWithTasks`, `getRetryPairs`/`getAllPairs`), `src/api/runs.js`, `gui/src/renderer/stores/automation.js`, `gui/src/renderer/views/AutomationRuns.vue`, `gui/src/renderer/i18n/*.json`, `docs/API.md`, `docs/API.en.md`, `docs/API.zh.md`, `README.md`, `TS.md`

## v1.5.1

### Синхронизатор / Zerion Popup

- **[FIX] Надёжная синхронизация popup Zerion в Multi-Control — устранено появление обычных вкладок вместо нативных popup-окон при задержке открытия popup в slave.**
  Сохранена синхронизация мыши и поведение для обычных `http(s)` вкладок, включая `_blank` и `window.open`. Новые native target антидетекта не всегда приходят через CDP WS, поэтому master обнаруживается через HTTP `/json` polling 300мс, после чего `syncNewMasterTab()` ищет target в каждом slave. Старая `_findNativeSlaveTab()` делала 2 попытки 150мс и брала любую немапленную page-вкладку → поздний popup приводил к `Target.createTarget` и вкладке `chrome-extension://...` вместо popup, плюс `onNewTab`/`onTabAttached` по `tabIndex` давал неверный mapping.
  - `src/api/multi-control.js`: локальные helper `getChromeExtensionInfo` (парсинг `chrome-extension://` → `extId`+`pathname`, query/hash игнорируются), `getZerionRuntimeIdForProfile` (из `profile.extensions[0]` через `resolveRuntimeId(extPath, profileDir)` с `getBrowserDataDir` конкретного профиля, проверка `^[a-z]{32}$`, ошибки профиля/JSON/`resolveRuntimeId` — не классифицировать как popup, лог без секретов, кэш `runtimeIdCache` 5с), `classifyMasterUrl` (по runtime ID master: `zerion-popup` / `unknown-extension` / `http`, недостижимый код `chrome-extension://` удалён); `_findNativeSlaveTab(slaveId, expectedUrl)` — Zerion-пopup polling 2–3с шаг 200мс (`POPUP_INITIAL_WAIT_MS` 2500 / `POPUP_POLL_INTERVAL_MS` 200) через `getHttpTabs`, исключает `tabMapping` для slave, принимает только `page` с совпадающим Zerion ID конкретного slave и `pathname` master-popup (случайная `http(s)` не принимается), обычные `http(s)` — 2×150мс; `syncNewMasterTab` — трёхветочная классификация (подтверждённый Zerion-popup — `Promise.all` ожидание native без `createTab` + `attach`/`mapTab` + фокус, нераспознанный `chrome-extension://` — warning без `createTab`, `http(s)` — `createTab`→`attach`→`map`), параллельное ожидание slave, долгое ожидание не блокирует `discoverActiveTab`/`/os-keyboard` Enter (Zerion `sync` fire-and-forget, reconciliation без ожидания из Enter-пути); reconciliation через `pendingPopupReconciliations` (masterTargetId+pathname+slaveId+slaveRuntimeId, `expiresAt` initial+5500мс для 5+с задержек под нагрузкой, проверка на `discoverActiveTab` 300мс), `attach` + in-place remap `tabMapping.get(masterTargetId).set(slaveId, newTargetId)` без `unmapTab`+`mapTab` (сохраняет `tabIndex` при единственном slave), cleanup закрывает только явно ошибочный fallback (`createdPopupFallbackTargets` — остаётся пустой пока fallback запрещён, defensive — или URL-совпадение ID+pathname) через `closeTarget`, идемпотентно, очистка в `/stop` и `/slave/remove` вместе с `pendingSync`/`attachedMasterTabs` + `runtimeIdCache.clear()`, `onNewTab`/`onTabAttached` для slave не маппят `chrome-extension://` по `tabIndex`, `tabIndex` для обычных табов сохранён, `isChromeExtension` исключён из index-based mapping (gaps не исправляются).
  - `src/multi-control/cdp-manager.js` не менялся — `getHttpTabs`/`attachToExistingTarget`/`closeTarget` уже достаточны.
  - `tests/unit/multi-control-api.test.js` (+14 тестов + 1 full-chain `/os-keyboard`): delayed popup >300мс без `createTab`, Enter <1с в т.ч. `/os-keyboard`, случайная `http` не принимается за popup, timeout без вкладки, нераспознанный `chrome-extension://` после ошибки `resolveRuntimeId` без `createTab`, обычный `_blank` с `createTab`, reconciliation после 5+с, late popup заменяет ошибочный fallback с `closeTarget`, повторная обработка без дубликата/закрытия, wrong ID/pathname не мапится, in-place remap сохраняет `tabIndex`, parallel wait, pending cleanup при корректном mapping.
  - `docs/MULTI-CONTROL.md` — раздел Zerion popup `v0.19.0` (распознавание, `_findNativeSlaveTab`, `syncNewMasterTab`, reconciliation, `onNewTab`/`onTabAttached`).
  - API-контракт, схема БД, зависимости и версия не менялись; `src/multi-control/cdp-manager.js` не менялся.
  ✅ `src/api/multi-control.js`, `tests/unit/multi-control-api.test.js`, `docs/MULTI-CONTROL.md`, `README.md`, `TS.md`, `TASK.md`

### Синхронизатор / Клавиатура

- **[FIX] Дублирование printable-ввода и ошибочная рассылка ввода из slave + «квадратики» от Backspace.**
  При вводе печатного символа в master символ дублировался в slave (`Input.dispatchKeyEvent` из `keyDown` + `Input.insertText` из `charInput`); ввод из slave-окна рассылался всем slave; Backspace/Tab/Enter/Delete вставляли в input slave управляющие символы (`\b`, `\t`, `\r`, `\x7f` из `ToUnicodeEx`) вместо стирания/перевода строки.
  - `src/os-input/native-hooks/hooks.cc`: в `KeyEvent` добавлен `sourcePid` — PID foreground-окна; в `KeyboardProc` PID/thread-id получаются один раз на каждое событие (включая `keyUp`) и записываются в `sourcePid`; `ComputeTextForKey` принимает уже вычисленный thread-id (раскладка из foreground-окна, без повторных вызовов `GetForegroundWindow`/`GetWindowThreadProcessId`).
  - `src/os-input/native-hooks/index.js`: `sourcePid` в `keyDown`/`keyUp` eventData и в `charInput { text, sourcePid }`; `_isPlainText` отсекает управляющие символы C0/DEL (`code < 0x20 || code === 0x7f`).
  - `gui/src/main/keyboard-hooks-payload.js`: `buildKeyEvent` включает `text` и `sourcePid`; `shouldSendCharInput`/`hasControlChars` — управляющие символы текстом не считаются (`\b`, `\t`, `\r`, `\x7f` для Backspace/Tab/Enter/Delete).
  - `gui/src/main/keyboard-hooks.js`: `charInput` отправляется с `sourcePid`, без дублирования запросов и без логирования текста.
  - `src/api/multi-control.js`: ленивый кэш `masterKeyboardPidCache`/`getMasterKeyboardPid()` (инвалидация по `stop`/смене `masterId`); строгая фильтрация `/os-keyboard` — события с PID, отличным от PID master (`pq.getById(masterId)?.pid`), возвращают `{ ok: true, skipped: 'source-not-master' }` и не вызывают controller (фильтр стоит до обработки Ctrl+T/W и Enter).
  - `src/multi-control/index.js`: `_isPrintableText` (непустой text, не управляющий символ, без Ctrl/Meta/обычного Alt; AltGr остаётся текстовым) — printable `keyDown` не dispatch-ится, символ идёт единственным каналом `charInput → Input.insertText`; управляющие клавиши (Backspace/Delete/Tab/Enter/стрелки/Ctrl+...) форвардятся через `Input.dispatchKeyEvent` с очищенным `text: ''` (CDP не вставит управляющий символ); `keyUp` форвардится как раньше.
  - Тесты: `tests/unit/os-input.test.js` (sourcePid, charInput `{text, sourcePid}`, Backspace не эмитит charInput), `tests/unit/keyboard-hooks-payload.test.js` (payload `text`/`sourcePid`, `shouldSendCharInput`/`hasControlChars`), `tests/unit/multi-control.test.js` (printable/Shift/AltGr → один `insertText`; Ctrl+1/Meta/обычный Alt/Enter/стрелки → dispatch; Backspace/Tab/Enter с управляющим text → dispatch с `text: ''`), `tests/unit/multi-control-api.test.js` (маршрутизация master PID, игнор slave/без PID/неизвестного PID, отсутствующий PID master).
  - API-контракт, схема БД, зависимости и версия не менялись; клавиши и текст не логируются.
  ✅ `src/os-input/native-hooks/hooks.cc`, `src/os-input/native-hooks/index.js`, `gui/src/main/keyboard-hooks-payload.js`, `gui/src/main/keyboard-hooks.js`, `src/api/multi-control.js`, `src/multi-control/index.js`, `tests/unit/os-input.test.js`, `tests/unit/keyboard-hooks-payload.test.js`, `tests/unit/multi-control.test.js`, `tests/unit/multi-control-api.test.js`, `docs/MULTI-CONTROL.md`, `README.md`, `TS.md`, `TASK.md`

### Синхронизатор / Multi-Control

- **[FEAT] Снижение задержки курсора в MultiController + authoritative document scroll.**
  Устранена задержка движения курсора на slave-профилях (2–4 с на 5 профилях при i7-8265U / 20 GB) и рассинхрон координат после прокрутки.
  - `src/multi-control/index.js`: throttling входящих `mousemove` (16 мс, `latest-event-wins`, pending хранит минимум `{x, y, scrollX, scrollY}`; общий для controller, не на slave; `removeSlave` не чистит общий pending при других slave; полная очистка только при stop/без slave; клики/клавиатура/scroll не троттлятся). Адаптивные параметры MouseSmoother по числу slave (1–2: `stepInterval=8/maxPoints=60`, 3–4: `12/40`, 5+: `16/30`, `moveSpeed=5` стабилен). Пропуск устаревших точек без пересчёта траектории. Исправлена `_toSlaveCoords`: `slaveX = pageX - slaveScroll.scrollX`, `slaveY = pageY - slaveScroll.scrollY` (без `masterScroll`, двойное вычитание устранено). `scrollTo` берёт абсолютное состояние мастера из события; per-slave `generation`/`pending` (коалесцирование); `_applyDocumentScroll` через `cdp.scrollToSession`; `_syncSlaveScroll` перечитывает фактический scroll slave; при неуспешном применении `scrollSyncDiscarded += 1`, состояние slave не подменяется.
  - `src/multi-control/cdp-manager.js`: `SYNC_EVENT_SCRIPT` — `wheel` эмитит только `type: 'wheel'` (диагностика: обработчик выполняется до browser default action), authoritative `scroll` из `window.addEventListener('scroll', …)` с абсолютными `window.scrollX/scrollY` и коалесцированием; `Runtime.enable` для ВСЕХ сессий (захват `executionContextId` из `Runtime.executionContextCreated`); `_callFunctionOnSession` — единственный путь `Runtime.callFunctionOn` (sessionId + числовые аргументы + `executionContextId`), fallback `Runtime.evaluate`/objectId удалён; `scrollToSession`/`getPageScrollForSession`.
  - `src/os-input/input-capture.js`: `case 'wheel'` — no-op (не превращает wheel в authoritative scroll, не запускает runner); `case 'scroll'` — passthrough `scrollX/scrollY`.
  - Тесты: `tests/unit/multi-control.test.js` (throttling latest-event-wins, адаптивные параметры, пропуск stale точек, регрессии порядка событий scroll), `tests/unit/mouse-smoothing.test.js` (устаревшие точки), `tests/unit/cdp-manager.test.js` (wheel→'wheel', window-scroll→'scroll', scroll-коалесцирование, `scrollToSession` без context → `{applied:false}` без `Runtime.evaluate`, `_callFunctionOnSession` только callFunctionOn, `Runtime.enable` на attach), `tests/unit/multi-control-api.test.js` (wheel без scroll → `scrollTo` не вызывается; scroll после wheel — один вызов), `tests/unit/os-input.test.js` (wheel не эмитит 'scroll').
  - Spike-проверка `ghost-cursor@1.4.2` (в требовании TASK): уменьшение `moveSpeed` увеличивает число исходных точек и суммарную длительность траектории — `moveSpeed` как адаптивный ограничитель не используется.
  - API-контракт, схема БД, зависимости и версия не менялись.
  ✅ `src/multi-control/index.js`, `src/multi-control/cdp-manager.js`, `src/os-input/input-capture.js`, `tests/unit/multi-control.test.js`, `tests/unit/mouse-smoothing.test.js`, `tests/unit/cdp-manager.test.js`, `tests/unit/multi-control-api.test.js`, `tests/unit/os-input.test.js`, `docs/MULTI-CONTROL.md`, `docs/API.md`, `docs/API.en.md`, `docs/API.zh.md`, `README.md`, `TASK.md`

### Синхронизатор / Окна

- **[FEAT] Отображение имени профиля в `Window Preview` и `Detected Windows`.**
  Вместо системного заголовка окна Chromium (`Untitled - Chromium`) теперь показывается имя профиля из MultiManager.
  - `src/api/window-arranger.js`: `buildProfileNameByPid(runningProfiles)` строит lookup `PID -> name` по запущенным профилям (`profiles.name`, при пустом имени — `profiles.id`); фильтрация running-профилей выполняется один раз в `getRunningWindows`, в lookup передаётся уже отфильтрованный список (двойной фильтр устранён).
  - `parseWindowLine(parts, profileNameByPid)` для окна возвращает `{ id, windowTitle, name, x, y, width, height }`: `id` — HWND (не изменён, используется `Focus`/`Grid`/`Cascade`), `windowTitle` — исходный Win32-заголовок, `name` — имя профиля по PID окна из PowerShell-скрипта, при отсутствии сопоставления — `windowTitle`. Поля `pid`, `profileId` и `profileName` в ответ не добавляются. JSDoc фиксирует предусловие `parts.length >= 7`.
  - Linux/macOS поведение не изменено (fallback системного имени); PowerShell-скрипт и фильтры crash/restore и минимального размера сохранены.
  - `WindowArranger.vue` не изменялся: preview и таблица уже отображают `win.name`.
  - Тесты: `tests/unit/window-arranger.test.js` (+10 тестов: lookup по running-профилям и fallback имени на id, преобразование строки PowerShell с сохранением HWND/координат/размеров, `name`/`windowTitle` при совпадении и отсутствии PID, отсутствие `pid`/`profileId`/`profileName`, JSDoc-предусловие `parts.length >= 7`, source-code инварианты: lookup по `running`, HWND в Grid/Cascade/Focus, сохранение фильтров).
  ✅ `src/api/window-arranger.js`, `tests/unit/window-arranger.test.js`, `docs/API.md`, `docs/API.en.md`, `docs/API.zh.md`, `TASK.md`

### Браузер / Информационная вкладка

- **[FEAT] Информационная вкладка профиля при запуске.**
  При старте профиля (`POST /api/browser/:id/start`) в конце запуска открывается вкладка с локальной HTML-страницей `http://127.0.0.1:<MultiManager-port>/profile-info/<profileId>`, заголовок которой равен имени аккаунта. Если после стартовых операций (автологин/нормализация вкладок) осталась пустая вкладка `about:blank` — страница открывается в ней (`Target.attachToTarget` + `Page.navigate`, без создания лишней вкладки); если пустой вкладки нет (например, automation/MM-запуск) — создаётся новый target (`Target.createTarget`).
  - `src/api/profile-info.js` (новый): публичный loopback-endpoint `GET /profile-info/:profileId` (подключён до `authMiddleware`, без авторизации и rate limiter), возвращает HTML только из безопасной проекции: `name` (в `<title>` и `<h1>`), `email`, `wallet_evm_address`, `wallet_sol_address`, `twitter_username` как X username, `discord_username`, IP и локация прокси (`last_ip`, `location`); отсутствующие значения — единый placeholder «Не указано»; неизвестный `profileId` — 404; HTML escaping всех пользовательских значений.
  - `src/core/app.js`: подключение `/profile-info` до `authMiddleware`.
  - `src/api/browser.js`: открытие вкладки в самом конце старта — после `loadExtensionsViaCDP` и `runManualAutologin`, непосредственно перед `res.json`; если в браузере есть пустая `about:blank`-вкладка, страница открывается в ней (`Target.getTargets` → `Target.attachToTarget` + `Page.navigate`), иначе создаётся новый target (`Target.createTarget`); порт — из `req.socket.localPort` start-запроса (без передачи через `spawnBrowserWithCdp` и без хардкода 3000); явная проверка `cdpPort`; сбой CDP не ломает успешный запуск (warning); безопасный лог только `profileId` + категория (`CDP`), URL и `err.message` не логируются.
  - `src/cdp/profile-tabs.js`: `resetToSingleBlankTab` после закрытия вкладок дожидается их фактического удаления (`waitUntilSinglePageTarget`, опрос `Target.getTargets` до таймаута), т.к. `Target.closeTarget` подтверждает только приём команды, а уничтожение таргета асинхронно. Это устраняет гонку с `openProfileInfoTab`: без ожидания могла быть навигирована ещё «живая» старая `about:blank`, которая затем закрывалась, и итоговая страница оставалась пустой (проявлялось на кошельк-профилях с автологином Zerion).
  - Секреты (`email_password`, `wallet_password`, `twitter_password`, `twitter_auth_token`, `twitter_email`, `discord_password`, `discord_token`, `discord_email`, proxy credentials, fingerprint seed) отсутствуют в HTML/JSON и логах.
  - Тесты: `tests/unit/profile-info.test.js` (новый, 11 тестов: 200/404, отсутствие секретов, escaping, корректный `<title>`), `tests/unit/browser-profile-info-tab.test.js` (новый, 19 тестов: `Target.createTarget` и навигация существующей `about:blank`-вкладки через `Page.navigate` для ручного и automation/MM запуска, `req.socket.localPort`, безопасные логи, отсутствие хардкода 3000); `tests/unit/profile-tabs.test.js` (+3 теста: ожидание асинхронного уничтожения вкладок и ошибка по таймауту); opt-in интеграционный тест в `tests/integration/profile-launch.test.js` (реальный CloakBrowser, пропускается в обычном `npm test`).
  ✅ `src/api/profile-info.js` (новый), `src/core/app.js`, `src/api/browser.js`, `src/cdp/profile-tabs.js`, `tests/unit/profile-info.test.js` (новый), `tests/unit/browser-profile-info-tab.test.js` (новый), `tests/unit/profile-tabs.test.js`, `tests/integration/profile-launch.test.js`, `docs/API.md`, `docs/API.en.md`, `docs/API.zh.md`, `TS.md`, `README.md`

### Интеграция / Automation shutdown

- **[FEAT] Корректное завершение браузера в MM-automation.**
  Гарантировано, что браузер, запущенный через MultiManager для automation из `stAuto0`, корректно завершается во всех сценариях: штатное завершение проекта, ошибка проекта/другого участка выполнения, `KeyboardInterrupt`/остановка CLI, отмена automation-run, недоступность/ошибка MM API. Штатный shutdown использует существующую последовательность `POST /api/browser/:id/stop` → `Browser.close` через CDP → ожидание exit → graceful fallback → force fallback только при необходимости.
  - stAuto0 `main.py`: введён `mm_mode_active` (фактически определённый MM-режим) и `run_main()`. В MM-режиме верхнеуровневые обработчики (`KeyboardInterrupt`, `SystemExit`, общее исключение) **не** вызывают глобальный `kill_chrome_processes()` (`taskkill /F /IM chrome.exe|node.exe`), который мог завершить сам MultiManager; legacy-режим сохраняет прежний аварийный cleanup. Основной flow `main()` обёрнут в `try/finally` — HTTP-сессия `mm_client` (`__aexit__`) закрывается и при исключении до штатного закрытия.
  - stAuto0 `Core/browser.py`: `BaseBrowser.close()` в MM-режиме идемпотентен (флаг `_closed` ставится на входе, повторный вызов из `finally`/аварийного пути не вызывает `stop_browser()` повторно); порядок — сначала `stop_browser(profile_id)` (через MultiManager lifecycle), затем остановка Playwright CDP-сессии; при ошибке/таймауте MM API Playwright-сессия всё равно закрывается и не создаётся неконтролируемый orphan Chromium; `_kill_chrome_for_profile()` в MM-режиме не используется.
  - `src/api/browser.js`: остановка профиля вынесена в `stopProfile(profileId)` (та же последовательность graceful shutdown, что и `POST /:id/stop`); используется и REST-эндпоинтом, и отменой run. Публичный API-контракт endpoint-ов не изменён.
  - `src/executor/index.js`: `RunExecutor.cancel()` сначала инициирует остановку браузеров профилей с уже запущенными Python-процессами через MM lifecycle (`stopProfile`), затем принудительно завершает child и очищает `this.processes`. `child.kill()` на Windows может завершить Python без выполнения `finally`, поэтому остановка браузера инициируется до убийства child. Повторная остановка одного профиля (одновременный cancel и штатный `close()`) не создаёт второй shutdown-flow — защита `stoppingProfiles`. Статусы run/task и API-ответ `POST /api/runs/:id/cancel` сохранены.
  - `src/api/runs.js`: в опции executor'а передан callback `stopProfile`.
  - Тесты: `tests/unit/executor.test.js` (+5 тестов cancel: stopProfile для каждого профиля, kill после инициирования остановки, очистка `processes`, статус `cancelled`, переживание ошибки stopProfile), `tests/unit/browser-cleanup.test.js` (обновлён на `stopProfile`); stAuto0 `tests/test_browser.py` (+5: идемпотентность, `_pw.stop()` при ошибке stop_browser, отсутствие глобального cleanup), `tests/test_main.py` (+17: `run_main` MM/legacy/undefined, закрытие `mm_client` при успехе/исключении).
  - API-контракты, схема БД, зависимости и версия не менялись; secrets не логируются.
  ✅ `src/api/browser.js`, `src/api/runs.js`, `src/executor/index.js`, `tests/unit/executor.test.js`, `tests/unit/browser-cleanup.test.js`, `docs/API.md`, `docs/API.en.md`, `docs/API.zh.md`, `TS.md`, `README.md`; stAuto0 `main.py`, `Core/browser.py`, `tests/test_browser.py`, `tests/test_main.py`, `docs/README.md`, `docs/browser.md`

### GUI / Профили

- **[FEAT] Сохранение сгенерированного fingerprint при редактировании профиля.**
  После нажатия `Generate Fingerprint` новый полный fingerprint остаётся в форме и сохраняется в БД по кнопке `OK`, без повторной генерации на backend.
  - `ProfileModal.vue`: в `form` добавлены `fingerprint_seed`, `hardware_cores`, `hardware_memory`, `fingerprint_platform`; загружаются при открытии профиля и сбрасываются при создании. `generateFingerprint()` заполняет все поля из ответа `POST /api/fingerprint/generate`. `handleOk()` передаёт fingerprint-поля в событии `save`; без нажатия `Generate` они исключаются из payload. При смене `form.platform` флаг `fingerprintGenerated` сбрасывается, поэтому профиль сохраняется с автогенерацией backend, а не с ошибочным набором.
  - `src/api/validate.js`: `profileUpdateSchema` расширен полями `fingerprint_seed` (UUID), `user_agent`, `screen_resolution` (формат `WxH`), `hardware_cores`/`hardware_memory` (int, разумные границы), `fingerprint_platform` (enum). `superRefine` отклоняет частичный fingerprint-набор (400).
  - `src/api/profiles.js` (`PUT /:id`): переданный полный набор сохраняется одним UPDATE без генерации второго seed; `fingerprint_platform` сверяется с эффективной платформой (400 при несовпадении). Набор не передан + платформа изменена → прежняя автогенерация; платформа не изменена → старые fingerprint-значения сохраняются.
  - `src/db/queries.js`: `hardware_cores`/`hardware_memory`/`user_agent`/`screen_resolution`/`fingerprint_seed` передаются по проверке `!== undefined ? value : null` — явные нулевые hardware-значения не теряются через `|| null`.
  - Тесты: `tests/unit/profiles-fingerprint-update.test.js` (новый, 9 тестов), `tests/integration/api-real.test.js` (+6 тестов профиля fingerprint-persistence). Схема БД и `--fingerprint=<seed>` в запуске не изменялись.
  ✅ `gui/src/renderer/views/ProfileModal.vue`, `src/api/validate.js`, `src/api/profiles.js`, `src/db/queries.js`, `tests/unit/profiles-fingerprint-update.test.js` (новый), `tests/integration/api-real.test.js`, `docs/API.md`, `docs/API.en.md`, `docs/API.zh.md`, `README.md`

- **[FEAT] Порядок столбцов таблицы профилей.** Столбец `Action` перемещён в массиве `columns` сразу после `Name`: итоговый порядок `#`, `Name`, `Action`, `Proxy`, `Proxy Status`, `Fingerprint`, `Status`. Ключ `actions` и `fixed: 'right'` сохранены — шаблон ячейки и обработчики не изменены, API и схема БД не затронуты.
  ✅ `gui/src/renderer/views/Profiles.vue`

### Браузер / Запуск

- **[FEAT] Отключение уведомления `Restore pages?`.** В общий массив стартовых аргументов профиля добавлен штатный Chromium-флаг `--disable-session-crashed-bubble`. Флаг применяется ко всем профилям независимо от proxy, расширений и `run_id`. Существующие `--no-first-run` и `--no-default-browser-check` сохранены без изменений. Профильные данные, session- и crash-файлы не удаляются.
  ✅ `src/api/browser.js`, `tests/unit/browser-start-await.test.js`, `tests/integration/profile-launch.test.js`, `docs/API.md`, `docs/API.en.md`, `docs/API.zh.md`

### Браузер / Shutdown

- **[FEAT] Graceful shutdown Chromium через CDP `Browser.close`.**
  Первым действием остановки браузера (`POST /api/browser/:id/stop`, `POST /api/browser/shutdown`) теперь отправляется CDP `Browser.close` на browser-level WebSocket, чтобы Chromium сам корректно закрыл вкладки и сбросил persistent storage (включая WAL-журналы SQLite `Cookies`, Local Storage).
  - CDP-порт берётся из `cdpPorts` до любых cleanup-операций; обработчик `exit` регистрируется до shutdown-команд; WebSocket закрывается в `finally` при успехе, ошибке и таймауте. `Browser.close` выполняется через существующий `cdpClient` без `Target.attachToTarget` и без `sessionId`, ответ не обязателен (Chromium может закрыть WebSocket сразу после команды).
  - Отдельные таймауты фаз: CDP close — 2 сек, ожидание завершения процесса после CDP — 8 сек, signal fallback — 5 сек. Ошибка, отсутствие CDP-порта или уже завершившийся процесс не завешивают shutdown и приводят к быстрому fallback.
  - При таймауте — graceful-сигнал: Unix `SIGTERM` (tree-kill), Windows `taskkill /PID <pid> /T` без `/F` (безопасный `spawn` с числовым PID, не shell-конкатенация; Windows-реализация `tree-kill` всегда добавляет `/F` и не используется). Если процесс не завершился — force kill: Unix `SIGKILL`, Windows `taskkill /PID <pid> /T /F`.
  - На Windows после `taskkill` без `/F` всегда выдерживается фиксированное ожидание 2.5 сек (Chromium может игнорировать WM_CLOSE), затем выполняется force kill; полный signal timeout не ждётся.
  - Ожидаемые сообщения закрытого WebSocket (`WebSocket was closed`, `Connection closed`) после принятия `Browser.close` не логируются как warning; настоящая ошибка подключения/отправки CDP логируется и не блокирует fallback.
  - Повторный stop/shutdown для одного профиля блокируется через `Map` `stoppingProfiles` (по аналогии с `runningProfiles`).
  - API-контракт endpoint-ов, схема БД, зависимости и версия проекта не менялись; secrets не логируются.
  ✅ `src/api/browser.js`, `tests/unit/browser-shutdown.test.js`, `docs/API.md`, `docs/API.en.md`, `docs/API.zh.md`, `TS.md`

### Прокси / Распределение

- **[FEAT] Нормализация и дедупликация прокси при создании/импорте/обновлении.**
  `host` нормализуется перед сравнением и записью: начальные/конечные пробелы удаляются (`trim`), значение приводится к нижнему регистру (`toLowerCase`); в БД сохраняется нормализованный `host`. Дубликат определяется по нормализованной паре `host:port`; `type`, `username`, `password` и `proxy_rotation_url` не входят в ключ дубликата.
  - `POST /api/proxies` сохраняет только нормализованный host и отклоняет дубль (HTTP 409 «Прокси с таким host:port уже существует»).
  - `POST /api/proxies/import` применяет ту же нормализацию к каждому прокси и последовательно отбрасывает дубликаты после каждой вставки, включая повторяющиеся строки внутри одного входного списка (локальный `Set` не используется).
  - `PUT /api/proxies/:id` перед `update` проверяет конфликт по нормализованной паре (поля, фактически переданные в запросе; отсутствующие берутся из текущей записи). При совпадении с другой записью возвращается 409 и запись не изменяется; обновление записи на её собственный нормализованный `host:port` допустимо.
  - `findByHostPort` использует `LOWER(TRIM(host)) = ? AND port = ?`, поэтому находит и старые ненормализованные записи без миграции данных. Уникальность остаётся прикладной проверкой: индекс `idx_proxies_host_port` — обычный индекс поиска.
  ✅ `src/proxy/index.js`, `src/api/proxies.js`, `src/db/queries.js`, `tests/unit/proxy-normalization.test.js` (новый, 12 тестов), `tests/integration/database.test.js`, `tests/integration/api-real.test.js`, `docs/API.md`, `docs/API.en.md`, `docs/API.zh.md`, `docs/DATABASE.md`, `docs/DATABASE.en.md`, `docs/DATABASE.zh.md`, `TS.md`

- **[FEAT] Распределение прокси по аккаунтам.**
  На вкладке «Прокси» добавлены две операции: **«Распределить используемые прокси»** (источник — уникальные `proxy_id` профилей) и **«Распределить все прокси»** (источник — все записи `proxies`). Двухфазный поток: `POST /api/proxies/distribute/preview` последовательно проверяет кандидатов существующей логикой `checkProxy`/`rotateProxy` (rotation → ожидание 3 c → check), обновляет технические поля (`is_active`, `last_ip`, location) и не меняет назначения; GUI показывает подтверждающее окно на базе `ConfirmDeleteModal.vue` с количеством проверенных/рабочих/нерабочих прокси и числом целевых аккаунтов (checkbox и блокировка OK сохранены). После подтверждения `POST /api/proxies/distribute` назначает случайные рабочие прокси всем профилям (включая аккаунты без прокси и `running`) в стабильном порядке `profiles.number`, одной SQLite-транзакцией; внутри цикла прокси не повторяются, после исчерпания список рабочих прокси восстанавливается. При пустом рабочем наборе текущие назначения сохраняются (массовое обнуление `proxy_id` не выполняется). Финальная фаза повторно валидирует `working_proxy_ids` относительно допустимого источника режима и атомарно отказывается от записи при несоответствии. Ошибка отдельного прокси не прерывает batch. Credentials прокси не возвращаются и не логируются.
  - В `POST /api/proxies/:id/check` разделена обработка ошибок: сбой ротации → 502 «Ошибка ротации», прочая ошибка проверки → 502 «Ошибка проверки прокси»; handler обёрнут в `asyncHandler` (ранее async-исключение не доходило до error-middleware).
  - Новые i18n-ключи (ru/en/zh) для кнопок, popup, счётчиков, сообщений об успехе и ошибках.
  ✅ `src/api/proxies.js`, `src/api/validate.js`, `src/db/queries.js`, `gui/src/renderer/stores/proxies.js`, `gui/src/renderer/views/Proxies.vue`, `gui/src/renderer/components/ConfirmDeleteModal.vue`, `gui/src/renderer/i18n/*.json`, `tests/unit/proxy-distribution.test.js` (новый, 21 тест), `tests/unit/gui-proxies-store.test.js` (+5 тестов), `docs/API.md`, `docs/API.en.md`, `docs/API.zh.md`, `TS.md`

### Синхронизатор / Tabs

- **[FEAT] Вкладка `Window Arranger` переименована в «Синхронизатор».**
  Навигационное имя и заголовок вкладки заменены через i18n (en/ru/zh); маршрут `/arranger` сохранён; в меню вкладка идёт сразу после «Профили». Управление Sync (кнопка Sync с выбором Master, Stop Sync, тэг Master, счётчик запущенных профилей) перенесено из `Profiles.vue` в `WindowArranger.vue` и размещено в верхнем ряду слева от кнопок расположения окон. Из `Profiles.vue` удалены Sync-кнопки, Sync-меню и связанные импорты/обработчики.
  ✅ `gui/src/renderer/views/WindowArranger.vue`, `gui/src/renderer/views/Profiles.vue`, `gui/src/renderer/components/Layout.vue`, `gui/src/renderer/i18n/*.json`

- **[FEAT] Массовые операции с вкладками всех запущенных профилей.**
  Добавлены `POST /api/window-arranger/close-all-tabs` и `POST /api/window-arranger/open-links` (JSON `{ links: string[] }`). Операции выполняются только для running-профилей через существующие profile queries. Новый общий CDP-слой `src/cdp/profile-tabs.js` использует низкоуровневый `cdp/client` (`call`, `connect`, `discoverWsUrl`) и порт из `getCdpPort(profileId)`; WebSocket краткоживущей сессии закрывается в `finally`, сессии не пересекаются с `browserConnections` CdpManager. Ограниченный параллелизм (`mapLimit`, 4 одновременных сессии) — операция для 100+ профилей не создаёт взрыв CDP-соединений.
  - `close-all-tabs`: для каждого профиля фиксируется исходный набор page targets, создаётся новая вкладка `about:blank`, затем закрываются только исходные targets (созданная вкладка никогда не закрывается). Возвращаются фактические результаты по каждому профилю и target.
  - `open-links`: `links` проверяется как массив строк; пустые строки отбрасываются с сохранением порядка; для каждой непустой ссылки и каждого running-профиля создаётся отдельная вкладка; ошибка отдельной ссылки/профиля не прерывает обработку остальных.
  - URL и ссылки не логируются и не попадают в сообщения об ошибках; URL передаётся только параметром `Target.createTarget`.
  ✅ `src/cdp/profile-tabs.js` (новый), `src/api/window-arranger.js`, `tests/unit/window-arranger.test.js`, `docs/API.md`, `docs/API.en.md`, `docs/API.zh.md`

### Браузер / Автологин

- **[FEAT] Автологин кошелька при ручном запуске профиля.**
  При `POST /api/browser/:id/start` **без `run_id`** (ручной запуск с главной страницы) после запуска браузера и загрузки расширений выполняется preflight по wallet-полям:
  - Автологин разрешён только при одновременно непустых `wallet_evm_address` и `wallet_password`. При отсутствии любого из полей вызывается нормализация вкладок и preflight завершается без `zerionLogin`.
  - При наличии обоих полей перед логином вызывается `resetToSingleBlankTab` (убираются стартовые и служебные вкладки), затем выполняется существующая Zerion-логика; после попытки логина в `finally` вкладки снова нормализуются к одной `about:blank`.
  - Ошибка автологина не останавливает браузер: она записывается в профильный лог без пароля, EVM-адреса и URL; вкладки нормализуются, запуск возвращает согласованное успешное состояние.
  - Automation-запросы с `run_id` (например, от `stAuto0`) новый ручной автологин не получают — повторного входа нет.
  - Новая операция `resetToSingleBlankTab(profileId)` в `src/cdp/profile-tabs.js`: внутри одного `withProfileSession` создаёт `about:blank`, закрывает остальные page-targets, не трогает `devtools://`; корректна при отсутствии старых вкладок и при частичной ошибке закрытия; WebSocket закрывается в `finally`; URL не логируются.
  - В `zerionLogin` убраны полные URL из логов (`loginUrl`/`wsUrl`); логируется только `hasPassword`.
  - Тестовые швы (`setProfileTabsForTesting`, `setCdpClientForTesting`, `setExtensionsApiForTesting`, `setCdpPortProviderForTesting`) восстанавливают оригиналы при передаче `null`; устранено дублирование импортов `extensions` (единый `extensionsApi`).
  ✅ `src/api/browser.js`, `src/cdp/profile-tabs.js`, `tests/unit/browser-autologin.test.js` (новый, 18 тестов), `tests/unit/profile-tabs.test.js` (новый, 11 тестов), `tests/integration/profile-launch.test.js` (+opt-in тест с реальным CloakBrowser), `docs/API.md`, `docs/API.en.md`, `docs/API.zh.md`, `TS.md`, `README.md`

## v1.5.0

### Security / Storage

- **[SEC] Удалено шифрование секретов (master key / master password / keytar).**
  Секретные поля профилей (`email_password`, `twitter_password`, `twitter_auth_token`, `discord_password`, `discord_token`, `wallet_password`) и прокси (`username`, `password`) теперь хранятся и читаются как обычные `TEXT`-значения (plaintext) без runtime master key. Удалены: модуль `src/crypto/`, инициализация master key при старте (`initMasterKey`), runtime-gate `requireMasterKey` для mutating-запросов, crypto-эндпоинты (`/api/settings/crypto-status`, `set-master-password`, `change-master-password`, `recovery-key`), раздел «Безопасность» в Settings GUI и связанные i18n-ключи, зависимость `keytar` из `package.json`/lock-файлов. Перезапуск или переустановка приложения больше не блокируют редактирование профилей и прокси. Значения, ранее сохранённые в формате `aes-256-gcm:...`, автоматически не мигрируются и не преобразуются — их восстановление выполняется отдельным внешним скриптом. Легаси-default `asdfj*KK` для `wallet_password` удалён: незаполненное значение хранится как пустое/`NULL`. Версия приложения — **1.5.0**.
  ✅ `src/crypto/index.js` (удалён), `src/index.js`, `src/core/app.js`, `src/api/settings.js`, `src/api/browser.js`, `src/db/queries.js`, `package.json`, `package-lock.json`, `gui/src/renderer/views/Settings.vue`, `gui/src/renderer/i18n/*.json`, `tests/unit/crypto.test.js` (удалён), `tests/unit/keytar-service.test.js` (удалён), `tests/integration/api-real.test.js`, `tests/unit/settings-token.test.js`, `docs/API.md`, `docs/API.en.md`, `docs/API.zh.md`, `docs/DATABASE.md`, `docs/DATABASE.en.md`, `docs/DATABASE.zh.md`, `docs/DEPLOY.md`, `docs/AGENTS_COMMON.md`, `TS.md`, `TS_INTEGRATION.md`, `README.md`, `README.en.md`, `README.zh.md`

## v1.4.2

### Интеграция / Automation

- **[FEAT] Каталог профилей MultiManager через API для миграции stAuto0.**
  Добавлен внутренний endpoint `GET /api/internal/profile-storage`: возвращает фактический каталог профилей `{ "profiles_dir": "<abs>" }`, вычисляемый через `getDataDir()` (`path.join(getDataDir(), 'profiles')`). Учитывает `MULTIMANAGER_DATA_DIR`; не принимает параметры, не изменяет состояние и не обращается к БД; авторизация — через общий Bearer `authMiddleware` (401 при невалидном токене, 500 при некорректном `MULTIMANAGER_DATA_DIR` — без stack trace и без логирования токена).
  - stAuto0: `Core/multimanager.py.get_profile_storage_dir()` (Bearer auth, `ClientTimeout(total=3)`, проверка статуса/JSON/поля/абсолютности пути, без токена в сообщениях) и `scripts/migrate_profile_dirs.py` — каталог назначения запрашивается у MM; fallback и путь `CloakManager/profiles` удалены, при недоступном MM миграция завершается с ошибкой до начала копирования; схема target `<profiles_dir>/<UUID>/BrowserData`, `Default/Extensions` по-прежнему исключается.
  ✅ `src/api/internal.js`, `tests/unit/internal-profiles.test.js`, `docs/API.md`, `docs/API.en.md`, `docs/API.zh.md`; stAuto0: `Core/multimanager.py`, `scripts/migrate_profile_dirs.py`, `tests/test_migration.py`, `docs/scripts.md`

### UI

- **[UX] Обязательное подтверждение удаления сущностей.** Перед удалением профиля, прокси, расширения или проекта открывается модальное окно с предупреждением и чекбоксом «Я понимаю, что удаление необратимо»: без установленного чекбокса кнопка `OK` недоступна, а DELETE-запрос не отправляется. Единый переиспользуемый компонент `ConfirmDeleteModal.vue` — компактная ширина ~420px, вертикальное расположение предупреждения и чекбокса, стандартный нижний footer, прокрутка длинного списка внутри окна, адаптивность на узких экранах; состояние чекбокса сбрасывается при каждом открытии; родитель передаёт состояние загрузки; компонент не выполняет API-вызовы самостоятельно.
  - Одиночное удаление профиля/прокси/расширения/проекта: DELETE выполняется только из обработчика подтверждения, при отмене ожидающая операция очищается и запрос не отправляется; существующие сообщения об успехе и ошибках сохранены.
  - Массовое удаление профилей: запущенные профили (`status !== 'stopped'`) исключаются заранее, перечисляются в окне с причиной «остановите перед удалением» и не получают DELETE; остановленные удаляются одним окном; при всех запущенных DELETE не выполняется; после операции показывается результат «Удалено/пропущено» и очищается выбор.
  - Массовое удаление прокси: одно окно подтверждения для всего набора `selectedRowKeys` с количеством, после `OK` выбор очищается.
  - `a-popconfirm` для удаления расширения заменён модальным окном; массовое удаление расширений не добавлялось.
  - Удаление проекта сохраняет обработку ошибки конфликта `409` (проект связан с задачами).
  - Новые строки локализованы (en/ru/zh).
  ✅ `gui/src/renderer/components/ConfirmDeleteModal.vue` (новый), `gui/src/renderer/views/Profiles.vue`, `gui/src/renderer/views/Proxies.vue`, `gui/src/renderer/views/Extensions.vue`, `gui/src/renderer/views/Settings.vue`, `gui/src/renderer/i18n/*.json`, `tests/unit/gui-confirm-delete.test.js` (новый)

- **[UX] Нумерация строк на странице прокси.** Добавлена первая колонка `#` с последовательной нумерацией записей в порядке их отображения, аналогично странице профилей. Номер — чисто UI-индекс, вычисляемый по формуле `(current - 1) * pageSize + index + 1` из слотового индекса строки и текущих `current`/`pageSize`: продолжается между страницами, пересчитывается при смене размера страницы и после добавления/импорта/удаления прокси. Значение не сохраняется в БД и не передаётся в API; `row-key`, выбор строк, `Check`/`Edit`/`Delete`, данные и порядок загрузки не затронуты.
  ✅ `gui/src/renderer/views/Proxies.vue`

- **[UX] Сохранение выбранного размера страницы в таблицах профилей и прокси.**
  Выбор количества записей на странице (10/20/50/100) больше не сбрасывается на фиксированные 20 при обновлении таблицы: пагинация переведена на реактивное состояние компонента (`current`, `pageSize`, `showSizeChanger`, `pageSizeOptions`), обработчик `@change` обновляет состояние и при смене размера всегда сбрасывает `current` на 1. Выбранный размер сохраняется в `localStorage` отдельными ключами `multimanager.profiles.pageSize` / `multimanager.proxies.pageSize` и восстанавливается при перезапуске; настройки профилей и прокси независимы. Новая utility `createPageSizeStore()` (`gui/src/renderer/utils/page-size.js`) принимает ключ, допустимые значения и fallback, валидирует значение только против 10/20/50/100, оборачивает каждый вызов `localStorage.getItem`/`setItem` в `try/catch` и использует fallback 50 при отсутствии, повреждении, неподдерживаемом значении или исключении чтения.
  ✅ `gui/src/renderer/views/Profiles.vue`, `gui/src/renderer/views/Proxies.vue`, `gui/src/renderer/utils/page-size.js` (новый)

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
- Добавлен `tests/unit/gui-page-size.test.js` (8 тестов): fallback 50 при отсутствии значения, сохранение/восстановление размера, поддержка 10/20/50/100, повреждённые и неподдерживаемые значения → 50, независимые ключи профилей и прокси, исключения `localStorage` при чтении/записи.
- Добавлен `tests/unit/keyboard-hooks-payload.test.js` (11 тестов): vkToKey/vkToCode/buildKeyEvent/shouldSendCharInput (Ctrl/Meta/AltGr/dead keys/пустой text).
- Обновлены: `tests/unit/os-input.test.js` (native hook: text/altGr/dead key; negative: CDP keyDown/charInput), `tests/unit/cdp-manager.test.js` (SYNC_EVENT_SCRIPT не перехватывает клавиатуру), `tests/unit/multi-control.test.js` (Ctrl+W/T/N не форвардятся, Ctrl+1 форвардится), `tests/unit/multi-control-api.test.js` (lifecycle wire/unwire, POST /os-keyboard маршрутизация).
- Всего: **1074 тестов** (66 файлов), все проходят ✅

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
