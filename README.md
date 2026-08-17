# MultiManager

AI-Driven Web Automation Platform — кроссплатформенный антидетект-браузер с графическим интерфейсом и локальным REST API / WebSocket для автономных ИИ-агентов (аналог AdsPower) на базе C++ ядра CloakBrowser.

> **Полная спецификация:** [TS.md](./TS.md) · [TS_INTEGRATION.md](./TS_INTEGRATION.md) (интеграция stAuto0)
> **Текущая задача и план:** [TASK.md](./TASK.md)

## Что нового

- **[Feature]** Информационная вкладка профиля при запуске. При старте профиля (`POST /api/browser/:id/start`) в браузере создаётся вкладка с локальной HTML-страницей `http://127.0.0.1:<port>/profile-info/<profileId>`, заголовок которой равен имени аккаунта. Публичный loopback-endpoint `GET /profile-info/:profileId` (подключён до `authMiddleware`, без авторизации и rate limiter) возвращает только 8 согласованных полей: имя, email, `wallet_evm_address`, `wallet_sol_address`, X username, Discord username, IP и локацию прокси; отсутствующие значения — placeholder «Не указано», неизвестный профиль — 404. Секреты (пароли, токены, email, proxy credentials, fingerprint seed) не включаются в HTML, JSON и логи; URL вкладки и текст ошибки CDP не логируются. Порт берётся из `req.socket.localPort` start-запроса — работает при нестандартном порте MultiManager; сбой CDP-создания вкладки не переводит запущенный профиль в failed (записывается warning). Режимы ручного и automation/MM запуска (включая legacy-`stAuto0`) не изменены. API-контракт, схема БД, зависимости и версия не менялись. Версия — **1.5.1**.

- **[Feature]** Graceful shutdown Chromium через CDP `Browser.close`. При остановке браузера (`POST /api/browser/:id/stop`, `POST /api/browser/shutdown`) первой выполняется CDP-команда `Browser.close` на browser-level WebSocket (таймаут 2 сек, без `sessionId` и `Target.attachToTarget`), чтобы Chromium сам корректно закрыл вкладки и сбросил persistent storage, включая WAL-журналы SQLite (`Cookies`, Local Storage). После CDP-попытки — ожидание завершения процесса до 8 сек; при таймауте graceful-сигнал (Unix `SIGTERM` / Windows `taskkill /PID <pid> /T` без `/F`), затем force kill (`SIGKILL` / `taskkill /T /F`). На Windows после `taskkill` без `/F` всегда выдерживается фиксированное ожидание 2–3 сек (Chromium может игнорировать WM_CLOSE). Ошибка/отсутствие CDP не блокируют fallback; повторный stop/shutdown для одного профиля игнорируется (`stoppingProfiles`). API-контракт, схема БД, зависимости и версия не менялись. Версия — **1.5.1**.

- **[Feature]** Сохранение браузерных сессий и импорт cookies через CDP. Файловая запись `<user-data-dir>/Default/Cookies` (Netscape-текст в SQLite-базу Chromium) удалена — ручные cookies профиля больше не повреждаются и не заменяются при запуске. Таблица `cookies` теперь является очередью одноразового импорта: после запуска браузера записи применяются через CDP `Network.setCookies` на browser-level WebSocket (без `sessionId`), применение подтверждается через `Network.getAllCookies` по ключу `(domain, path, name)` (без сравнения `value`), и только подтверждённые записи удаляются из очереди по своим DB `id`. При ошибке CDP записи не удаляются и повторяются при следующем запуске. Старт браузера не прерывается ошибкой инъекции; значения cookies не логируются. Экспорт запущенного профиля получает актуальные cookies через CDP `Network.getAllCookies`; экспорт остановленного профиля возвращает только оставшиеся в очереди записи. Схема БД не менялась. Версия — **1.5.1**.

- **[Feature]** Сохранение сгенерированного fingerprint при редактировании профиля. После нажатия `Generate Fingerprint` новый полный fingerprint (seed, User-Agent, разрешение, cores, memory) остаётся в форме и сохраняется в БД по кнопке `OK` одной операцией обновления без повторной генерации; при следующем запуске CloakBrowser получает новый seed через существующий аргумент `--fingerprint=`. Отмена формы не меняет профиль. Смена платформы без `Generate` сохраняет прежнее поведение: backend автоматически генерирует новый fingerprint для новой платформы. Обычное редактирование имени, proxy, тегов и аккаунтов не сбрасывает fingerprint-поля. Схема БД не менялась. Версия — **1.5.1**.

- **[UX]** Столбец `Action` на главной странице профилей перемещён сразу после столбца `Name`: итоговый порядок — `#`, `Name`, `Action`, `Proxy`, `Proxy Status`, `Fingerprint`, `Status`. Поведение кнопок и выпадающего меню не изменено. При запуске профиля CloakBrowser больше не показывает стандартное уведомление `Restore pages?`: в стартовые аргументы добавлен штатный Chromium-флаг `--disable-session-crashed-bubble` (применяется ко всем профилям независимо от proxy, расширений и `run_id`). Профильные данные, session- и crash-файлы не удаляются. Версия — **1.5.1**.

- **[Feature]** Автологин кошелька при ручном запуске профиля. При вызове `POST /api/browser/:id/start` **без `run_id`** (ручной запуск с главной страницы) выполняется preflight: если у профиля заданы непустые `wallet_evm_address` и `wallet_password`, браузер автоматически логинится в Zerion; перед автологином и после него (включая ошибку) все page-вкладки закрываются и остаётся одна чистая вкладка `about:blank`. Если хотя бы одно wallet-поле отсутствует — автологин не выполняется, вкладки всё равно нормализуются. Ошибка автологина не останавливает браузер: пишется в профильный лог без пароля, EVM-адреса и URL. Automation-запуск с `run_id` ручной автологин не вызывает. Операция нормализации вкладок (`resetToSingleBlankTab`) реализована в `src/cdp/profile-tabs.js` в одном CDP-сеансе: `devtools://`-вкладки не закрываются, WebSocket закрывается в `finally`, URL не логируются. Версия — **1.5.1**.

- **[Feature]** Нормализация и дедупликация прокси. `host` нормализуется перед сравнением и записью: удаляются начальные/конечные пробелы (`trim`) и значение приводится к нижнему регистру (`toLowerCase`); в БД сохраняется нормализованный `host`. Дубликат определяется по нормализованной паре `host:port`. `POST /api/proxies` сохраняет только нормализованный host и отклоняет дубль (HTTP 409). `POST /api/proxies/import` применяет ту же нормализацию и дедупликацию, включая повторяющиеся строки внутри одного входного списка. `PUT /api/proxies/:id` теперь проверяет конфликт по нормализованной паре до изменения: при занятом `host:port` возвращается HTTP 409 «Прокси с таким host:port уже существует» и запись не изменяется; обновление записи на её собственный нормализованный `host:port` допустимо. Проверка находит и старые ненормализованные записи (`LOWER(TRIM(host))`) без миграции. Версия — **1.5.1**.

- **[Feature]** На вкладке «Прокси» добавлены массовые операции распределения прокси: **«Распределить используемые прокси»** (уникальные прокси, назначенные аккаунтам) и **«Распределить все прокси»** (все прокси из БД). Операция двухфазная: сначала все кандидаты последовательно проверяются (с ротацией, как в ручной проверке), затем показывается подтверждающее окно со статистикой (проверено/рабочих/нерабочих прокси и число аккаунтов), и только после подтверждения назначения обновляются одной транзакцией. Распределение случайное по циклам: внутри цикла прокси не повторяются, после исчерпания список рабочих прокси восстанавливается. Обрабатываются все аккаунты, включая без прокси и запущенные (перезапуск браузера не выполняется). При отсутствии рабочих прокси назначения сохраняются. Новые API: `POST /api/proxies/distribute/preview`, `POST /api/proxies/distribute`. Credentials прокси не возвращаются. Версия — **1.5.1**.

- **[Feature]** Вкладка `Window Arranger` переименована в **«Синхронизатор»** и перенесена в меню сразу после «Профили». Управление Sync (выбор Master / Stop Sync) перенесено из `Profiles` в синхронизатор и размещено в верхнем ряду рядом с кнопками расположения окон. Добавлены массовые операции с вкладками всех запущенных профилей через общий CDP-слой (`src/cdp/profile-tabs.js`, порт из `getCdpPort`): **«Закрыть все вкладки»** (для каждого профиля создаётся `about:blank`, затем закрываются остальные page-вкладки; созданная вкладка не трогается) и **массовое открытие ссылок** (многострочное поле, по вкладке на каждую непустую ссылку в каждом running-профиле). Ошибка одного профиля/ссылки не останавливает остальные; GUI показывает итоговую сводку. Работает поверх активного Sync без пересечения target/mapping. URL не логируются. Новые API: `POST /api/window-arranger/close-all-tabs`, `POST /api/window-arranger/open-links`. Версия — **1.5.1**.

- **[Security]** Полностью удалено шифрование секретных полей (master key / master password / keytar) и связанный runtime-gate. Секреты профилей и прокси сохраняются и читаются как обычные значения (plaintext): перезапуск или переустановка приложения больше не блокируют редактирование. Удалены crypto-эндпоинты, раздел «Безопасность» в Settings и зависимость `keytar`. Легаси-default пароля кошелька удалён (незаполненное значение — `NULL`). Версия — **1.5.0**.

- **[UX]** Удаление профилей, прокси, расширений и проектов теперь требует обязательного подтверждения: модальное окно с предупреждением и чекбоксом «Я понимаю, что удаление необратимо». Без установленного чекбокса кнопка `OK` недоступна и DELETE-запрос не отправляется. Единый переиспользуемый компонент `ConfirmDeleteModal.vue` (компактная ширина ~420px, прокрутка длинного списка внутри окна). При массовом удалении профилей запущенные профили исключаются заранее: перечисляются с причиной и не удаляются, остальные удаляются одним окном, после операции показывается результат «Удалено/пропущено».

- **[UX]** На странице прокси добавлена колонка `#` с последовательной нумерацией строк в порядке отображения (UI-индекс, продолжается между страницами с учётом выбранного размера страницы; в БД и API не сохраняется).

- **[UX]** Выбор размера страницы (10/20/50/100) в таблицах профилей и прокси больше не сбрасывается на 20. Размер сохраняется в `localStorage` отдельно для профилей (`multimanager.profiles.pageSize`) и прокси (`multimanager.proxies.pageSize`) и восстанавливается при перезапуске; при повреждённом значении используется 50.

- **[UX]** При запуске профиля с нерабочим прокси показывается видимое уведомление с именем профиля — «Профиль «{имя}» не запущен: прокси недоступен.» (ранее ошибка писалась только в консоль DevTools).

- **[Интеграция]** Первый запуск `init_wallet4browser.py` для мигрированных профилей: runtime ID Zerion запрашивается **после** запуска браузера (retry ≤5 попыток, интервал 500 мс, общий deadline 3 c); fallback по имени каталога (`klghhnkeealcohjjanjjdaeeggmfmlpl`) удалён; при недоступности ID скрипт завершается с ошибкой и закрывает браузер; HTTP-сессии MM в `BaseBrowser` закрываются (`_launch_via_multimanager()`, `close()`, `login_zerion()`).

- **[Интеграция]** `GET /api/internal/profile-storage` — MultiManager отдаёт фактический каталог профилей (с учётом `MULTIMANAGER_DATA_DIR`); миграция stAuto0 (`migrate_profile_dirs.py`) копирует профили в `<profiles_dir>/<UUID>/BrowserData` вместо устаревшего `CloakManager/profiles`.

История изменений по версиям — в [CHANGELOG.md](./CHANGELOG.md).

## Обновление

- **MultiManager** обновляется **только вручную** пользователем: скачайте новый установщик/портативную сборку и запустите её. Приложение не проверяет update-серверы, не скачивает и не устанавливает обновления автоматически.
- **CloakBrowser** обновляется отдельно — `npx cloakbrowser update` (см. раздел «CloakBrowser» ниже).

## Архитектура и технологический стек

Монорепозиторий (Full-Stack Desktop Application):

- **Core (бэкенд):** Node.js, Express, SQLite (`better-sqlite3`, WAL+ACID), Pino, WebSocket (`ws`). Работает в фоновом режиме, управляет БД, отпечатками, процессами CloakBrowser и задачами автоматизации.
- **GUI (фронтенд):** Electron, Vue 3 (Composition API), Ant Design Vue, Tailwind CSS, Pinia, Vue Router, i18next.
- **Python-фреймворк (stAuto0):** Playwright + cloakbrowser. Чистая Web3-автоматизация (квесты, дроп-охота, мультиаккаунтинг). Отдельный проект, данные через API. См. [TS_INTEGRATION.md](./TS_INTEGRATION.md).

### Системная интеграция

- **Main / Renderer IPC:** безопасное межпроцессное взаимодействие через `contextBridge` с полной изоляцией (`contextIsolation: true`, `nodeIntegration: false`).
- **Dynamic Port Allocation:** автозапуск бэкенда с автоматическим сканированием свободных портов в диапазоне `3000–3100`.
- **System Tray:** закрытие окна скрывает приложение в трей; полное завершение — только через трей.
- **Automation Matrix (v2.0.0):** матрица Проекты×Профили с чекбоксами, групповые запуски (runs), история.
- **WebSocket:** реалтайм-статусы профилей, аутентификация через `?token=`.
- **Автообновление Electron отсутствует** — обновление MultiManager выполняется вручную.

## Структура проекта

```
MultiManager/
├── TS.md                     # ТЕХНИЧЕСКОЕ ЗАДАНИЕ
├── TS_INTEGRATION.md         # ТЗ интеграции stAuto0 с MultiManager
├── CHANGELOG.md              # История изменений по версиям
├── ToDo.md                   # Реестр нереализованного функционала
├── TASK.md                   # Текущая задача разработки
├── package.json              # Зависимости бэкенда и скрипты
├── vitest.config.js          # Vitest
├── src/                      # БЭКЕНД (Core-движок)
│   ├── index.js              # Точка входа (постоянный API-токен из system_config)
│   ├── core/                 # Express app, WebSocket
│   ├── api/                  # REST API (auth, profiles, proxies, cookies, browser, ...)
│   ├── executor/             # RunExecutor (spawn, parallel limit)
│   ├── db/                   # SQLite (WAL, schema, queries)
│   ├── fingerprint/          # Генератор отпечатков
│   ├── proxy/                # Парсинг, чекер, ротация прокси
│   ├── cookie/               # Инжекция/экспорт сессий
│   ├── typing/               # Human-like Typing (CDP)
│   ├── multi-control/        # Синхронизация окон
│   ├── os-input/             # Захват ввода (CDP + C++ WH_KEYBOARD_LL)
│   ├── logger/               # Pino (core.log + profile_[ID].log)
│   └── utils/
├── gui/                      # ФРОНТЕНД (Electron + Vue 3)
│   ├── package.json          # Зависимости GUI
│   ├── vite.config.js
│   ├── tailwind.config.js
│   └── src/
│       ├── main/             # Electron Main Process
│       │   ├── index.js      # Окно, IPC, graceful shutdown
│       │   ├── tray.js       # Системный трей
│       │   ├── core-manager.js # Fork Core, динамические порты
│       │   ├── browser-manager.js # CloakBrowser check/install
│       │   ├── keyboard-hooks.js # OS-level keyboard hooks
│       │   └── pty.js        # PTY-терминал (IPC tail -f)
│       ├── preload/          # Контекстный мост IPC
│       ├── shared/errors.js  # Коды ошибок
│       └── renderer/         # Vue 3 App (views, components, stores, i18n)
└── tests/                    # Vitest
    ├── unit/                 # Unit-тесты
    └── integration/          # Интеграционные тесты
```

## Быстрый старт (разработка)

```bash
# Установка зависимостей
npm install
cd gui && npm install && cd ..

# Сборка нативного addon (hooks.node для OS keyboard hooks)
npm run build:native

# Запуск (Electron GUI + Core бэкенд автоматически)
npm run dev

# Прогон тестов
npm test
```

## API-токен

API-токен хранится постоянно:

1. Приоритет источников: `--api-token=...` → env `API_TOKEN` → сохранённый `system_config.api_token` → генерация нового (только при отсутствии сохранённого).
2. В обычном режиме токен генерируется один раз при первом запуске, сохраняется в БД и переиспользуется при перезапусках.
3. Ручной standalone-запуск с override:

```bash
API_TOKEN=YOUR_SECRET_TOKEN node src/index.js
# или с портом: API_TOKEN=YOUR_SECRET_TOKEN PORT=3005 node src/index.js
```

Токен копируется из статус-бара GUI; ротация доступна в Settings → **Regenerate API Token**.

## CloakBrowser

```bash
npx cloakbrowser install   # Установка
npx cloakbrowser info      # Версия и путь
npx cloakbrowser update    # Обновление (отдельно от MultiManager)
```

GUI автоматически проверяет наличие CloakBrowser при первом запуске.

## Сборка Windows Installer / Portable

```bash
# Предварительно собрать нативный addon
npm run build:native

# Собрать GUI
cd gui && npm install && npm run build
# Результат: gui/release/
#   MultiManager Setup 1.x.x.exe  — NSIS installer
#   MultiManager 1.x.x.exe        — Portable (single file)
```

Production-сборка выполняется без публикации: `npm run build -- --publish never`. Публикация release-артефактов — только вручную, по инструкциям [docs/DEPLOY.md](./docs/DEPLOY.md) и [docs/CICD.md](./docs/CICD.md).

## Скрипты

| Скрипт | Описание |
|--------|----------|
| `npm run dev` | Бэкенд с авто-рестартом (`node --watch`) |
| `npm start` | Production запуск Core |
| `npm test` | Все Vitest-тесты |
| `npm run test:api` | Интеграционный API-тест |
| `npm run test:all` | Vitest + API-тест |
| `npm run build:native` | Сборка hooks.node (node-gyp rebuild) |
| `npm run lint` | ESLint для src/ |
| `npm run typecheck` | TypeScript-проверка |

## Интеграция с ИИ-Агентами (API Руководство)

Все запросы содержат `Authorization: Bearer <TOKEN>`.

### 1. Запуск профиля

```
POST http://127.0.0.1:{PORT}/api/browser/{profile_id}/start
```

**Ответ:**
```json
{
  "status": "success",
  "profile_id": "8f3b201a-cb41-4c12-8671-50e50f3b4d11",
  "pid": 14208,
  "cdp_port": 9331,
  "ws_endpoint": "http://127.0.0.1:9331"
}
```

> **Примечание:** `ws_endpoint` содержит реальный CDP-порт CloakBrowser (динамический). Статус профиля переходит в `running` только после обнаружения CDP-порта.

### 2. Подключение (Python / Playwright)

```python
import asyncio
from playwright.async_api import async_playwright

async def run_ai_agent():
    ws_endpoint = "http://127.0.0.1:9331"  # реальный CDP-порт из /start

    async with async_playwright() as p:
        browser = await p.chromium.connect_over_cdp(ws_endpoint)
        context = browser.contexts[0]
        page = context.pages[0] if context.pages else await context.new_page()

        await page.goto("https://realsite.com")
        print(await page.title())
        await browser.close()

asyncio.run(run_ai_agent())
```

### 3. Human-like Typing (CDP)

```
POST http://127.0.0.1:{PORT}/api/browser/{profile_id}/type
Content-Type: application/json
{ "text": "MySecretPassword123" }
```

**Ответ:** `{ "status": "success" }`

### 4. Multi-Control API

| Метод | Путь | Описание |
|-------|------|----------|
| `GET` | `/api/multi-control/status` | Текущее состояние |
| `POST` | `/api/multi-control/start` | Активация `{ "masterId": "uuid" }` |
| `POST` | `/api/multi-control/stop` | Остановка |
| `POST` | `/api/multi-control/slave/add` | Добавить slave |
| `POST` | `/api/multi-control/slave/remove` | Удалить slave |
| `GET` | `/api/multi-control/cdp-status` | Статус CDP |
| `POST` | `/api/multi-control/focus-windows` | Окна на передний план |
| `POST` | `/api/multi-control/os-keyboard` | Приём OS-level хуков |

### 5. Массовый импорт профилей

```
POST http://127.0.0.1:{PORT}/api/profiles/batch
Content-Type: application/json
{
  "accounts": [
    { "name": "Worker #1", "platform": "windows", "timezone": "Europe/Berlin" },
    { "name": "Worker #2", "platform": "macos", "timezone": "Asia/Tokyo" }
  ]
}
```

**Ответ (201):** Массив созданных профилей (одна транзакция, автооткат при ошибке).

### 6. Полный цикл

```python
import requests, asyncio
from playwright.async_api import async_playwright

BASE = "http://127.0.0.1:3000"
HEADERS = {"Authorization": "Bearer YOUR_TOKEN"}

# 1. Создаём профиль
profile = requests.post(f"{BASE}/api/profiles", headers=HEADERS, json={
    "name": "AI Worker #1", "platform": "windows"
}).json()

# 2. Запускаем браузер
start = requests.post(f"{BASE}/api/browser/{profile['id']}/start", headers=HEADERS).json()
ws = start["ws_endpoint"]

# 3. Подключаемся и работаем
async def work():
    async with async_playwright() as p:
        browser = await p.chromium.connect_over_cdp(ws)
        page = browser.contexts[0].pages[0]
        await page.goto("https://example.com")
        await browser.close()

asyncio.run(work())

# 4. Останавливаем
requests.post(f"{BASE}/api/browser/{profile['id']}/stop", headers=HEADERS)
```

## Директории хранения данных

| Платформа | Путь |
|-----------|------|
| Windows | `%APPDATA%/MultiManager/` |
| macOS | `~/Library/Application Support/MultiManager/` |
| Linux | `~/.config/MultiManager/` |

### Структура:

- `app.db` — SQLite (WAL). Профили (AES-256-GCM), прокси, куки, projects, runs, run_tasks, system_config.
- `profiles/{UUID}/BrowserData/` — сессии Chromium.
- `extensions/` — установленные расширения Chrome.
- `logs/core.log`, `logs/profile_[ID].log` — логи.
- `backups/` — бэкапы app.db (rolling 7 дней).

## Коды ошибок API

| Код | Описание |
|-----|----------|
| 200 | Успешный запрос |
| 201 | Ресурс создан |
| 400 | Неверный запрос (валидация) |
| 401 | Не авторизован |
| 404 | Ресурс не найден |
| 409 | Конфликт (профиль запущен/остановлен) |
| 412 | Прокси недоступен |
| 500 | Внутренняя ошибка сервера |
| 502 | Ошибка ротации прокси / CDP порт не найден |

## Документация

| Файл | Описание |
|------|----------|
| [TS.md](./TS.md) | Полное ТЗ MultiManager |
| [TS_INTEGRATION.md](./TS_INTEGRATION.md) | ТЗ интеграции stAuto0 |
| [ToDo.md](./ToDo.md) | Реестр нереализованного функционала |
| [TASK.md](./TASK.md) | Текущая задача разработки |
| [CHANGELOG.md](./CHANGELOG.md) | История изменений |
| [docs/DATABASE.md](./docs/DATABASE.md) | Схема БД (таблицы, индексы, триггеры) |
| [docs/API.md](./docs/API.md) | REST API Reference |
| [docs/API.en.md](./docs/API.en.md) | REST API Reference (English) |
| [docs/API.zh.md](./docs/API.zh.md) | REST API Reference (中文) |
| [docs/DEPLOY.md](./docs/DEPLOY.md) | Сборка и развёртывание |
| [docs/CICD.md](./docs/CICD.md) | CI/CD пайплайн |
| [docs/MULTI-CONTROL.md](./docs/MULTI-CONTROL.md) | Архитектура синхронизации окон |

## Лицензия

ISC
