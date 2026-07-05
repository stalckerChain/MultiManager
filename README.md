# MultiManager v1.0.0

Промышленный кроссплатформенный антидетект-браузер с графическим интерфейсом и локальным REST API / WebSocket для автономных ИИ-агентов (аналог AdsPower) на базе C++ ядра CloakBrowser.

## Архитектура и Технологический Стек

Проект построен по принципу монорепозитория (Full-Stack Desktop Application):

- **Core-движок (Бэкенд):** Node.js, Express, SQLite (`better-sqlite3`), Pino, WebSocket (`ws`). Работает в скрытом фоновом режиме, управляет базой данных, сетевыми отпечатками и процессами CloakBrowser.
- **GUI (Фронтенд):** Electron.js, Vue 3 (Composition API), Ant Design Vue, Tailwind CSS, Pinia, Vue Router, i18next.

### Кроссплатформенная системная интеграция:

- **Main / Renderer IPC:** Безопасное межпроцессное взаимодействие через `contextBridge` с полной изоляцией (`contextIsolation: true`, `nodeIntegration: false`).
- **Dynamic Port Allocation:** Автозапуск бэкенда с автоматическим сканированием и резервированием свободных портов в диапазоне `3000–3100` при конфликтах (ошибка `EADDRINUSE`).
- **System Tray:** Перехват события закрытия окна, скрытие интерфейса в системный трей Windows/macOS/Linux для обеспечения бесперебойной работы ИИ-агентов в фоне.
- **Auto-Update:** Интеграция фонового обновления приложения через `electron-updater` с поддержкой `autoDownload` и уведомлений (GitHub Releases / latest.yml).
- **Localization (i18n):** Полная поддержка смены языков «на лету» через `i18next` (English, Русский, 简体中文).
- **Theme Switcher:** Динамическая смена тем (Тёмная / Светлая / Системная) через CSS-переменные + `prefers-color-scheme` + Electron `nativeTheme`.
- **WebSocket:** Реалтайм-трансляция статусов профилей и логов из Core-движка в GUI.

---

## Структура проекта

```
MultiManager/
├── package.json              # Зависимости монорепозитория и скрипты сборки
├── tsconfig.json             # Конфигурация TypeScript
├── vitest.config.js          # Конфигурация тестовой среды Vitest
├── src/                      # БЭКЕНД (Core-движок)
│   ├── index.js              # Точка входа бэкенда
│   ├── core/
│   │   ├── app.js            # Инициализация Express.js сервера и маршрутов
│   │   └── websocket.js      # WebSocket-сервер для реалтайм-событий
│   ├── api/                  # Эндпоинты REST API
│   │   ├── auth.js           # Авторизация по Bearer-токену
│   │   ├── profiles.js       # CRUD профилей
│   │   ├── proxies.js        # CRUD прокси + проверка
│   │   ├── cookies.js        # Импорт/экспорт куки
│   │   ├── browser.js        # Запуск/остановка CloakBrowser
│   │   ├── multi-control.js  # Синхронизация окон (CDP + native hooks)
│   │   ├── window-arranger.js # Управление положением окон (Grid, Cascade, Focus)
│   │   ├── extensions.js     # Управление расширениями Chrome
│   │   ├── fingerprint.js    # Генератор отпечатков
│   │   └── logs.js           # Доступ к логам профилей и системы
│   ├── db/                   # SQLite (Инициализация WAL-режима, схемы таблиц, CRUD)
│   │   ├── index.js
│   │   ├── schema.js         # Таблицы, индексы, триггеры
│   │   └── queries.js        # CRUD операции
│   ├── fingerprint/          # Валидатор отпечатков (защита от кроссплатформенных аномалий)
│   │   └── index.js
│   ├── proxy/                # Парсинг, GeoIP чекер (ipify) и логика ротации мобильных прокси
│   │   └── index.js
│   ├── cookie/               # Внедрение и экспорт сессий (JSON / Netscape TXT)
│   │   ├── index.js
│   │   └── inject.js         # Инжекция куки в изолированную директорию профиля
│   ├── typing/               # Эмуляция человеческого ввода текста (Human-like Typing)
│   │   └── index.js
│   ├── multi-control/        # Синхронизатор окон (трансляция мыши/клавиш через CDP)
│   │   ├── index.js          # MultiController: relative coords, smoother, tabMapping
│   │   ├── cdp-manager.js    # CDP-менеджер: WebSocket к CloakBrowser, инъекция listeners
│   │   └── mouse-smoothing.js # MouseSmoother: ghost-cursor path() + flush()
│   ├── os-input/             # Захват ввода (CDP + native hooks)
│   │   ├── input-capture.js  # EventEmitter: mouseMove, keyDown, scroll и т.д.
│   │   └── native-hooks/     # C++ addon WH_KEYBOARD_LL (Windows)
│   ├── logger/               # Высокопроизводительный логгер Pino (core.log + profile_[ID].log)
│   │   └── index.js
│   └── utils/
├── gui/                      # ФРОНТЕНД (Electron + Vue 3 Application)
│   ├── package.json          # Зависимости GUI
│   ├── vite.config.js        # Конфигурация Vite
│   ├── tailwind.config.js    # Конфигурация Tailwind CSS
│   ├── postcss.config.js     # PostCSS плагины
│   └── src/
│       ├── main/             # Electron Main Process
│       │   ├── index.js      # Создание окна, IPC-обработчики, логирование
│       │   ├── tray.js       # Системный трей (контекстное меню)
│       │   ├── core-manager.js # Fork Core-движка, динамические порты
│       │   ├── browser-manager.js # Проверка/установка CloakBrowser
│       │   └── updater.js    # Автообновления через electron-updater
│       ├── preload/          # Изолированный контекстный мост IPC
│       │   └── index.js      #暴露 electronAPI (getPort, getToken, quitApp, события)
│       ├── shared/
│       │   └── errors.js     # Общие коды ошибок
│       └── renderer/         # Vue 3 App
│           ├── main.js       # Точка входа Vue
│           ├── App.vue       # Корневой компонент
│           ├── router.js     # Маршрутизация (Hash Router)
│           ├── style.css     # Глобальные стили + Tailwind
│           ├── i18n/         # Локализация
│           │   ├── index.js  # Инициализация i18next
│           │   ├── en.json   # English
│           │   ├── ru.json   # Русский
│           │   └── zh.json   # 简体中文
│           ├── stores/       # Pinia Store
│           │   ├── app.js    # Глобальное состояние приложения
│           │   ├── profiles.js # Состояние профилей
│           │   ├── proxies.js  # Состояние прокси
│           │   ├── browser.js  # Состояние браузера
│           │   └── sync.js     # Состояние синхронизации (Multi-Control)
│           ├── views/        # Экраны
│           │   ├── Profiles.vue
│           │   ├── Proxies.vue
│           │   ├── WindowArranger.vue
│           │   ├── Extensions.vue
│           │   ├── Settings.vue
│           │   ├── ProfileModal.vue
│           │   └── CookieImportModal.vue
│           ├── components/   # Переиспользуемые компоненты
│           │   ├── Layout.vue
│           │   ├── StatusBar.vue
│           │   ├── LogPanel.vue
│           │   └── BrowserDownload.vue # Модалка установки CloakBrowser
│           ├── composables/  # Vue Composables
│           │   ├── useTheme.js         # Темизация (Dark/Light/System)
│           │   ├── useWebSocket.js     # WebSocket auto-reconnect (exp backoff)
│           │   └── useApi.js           # HTTP-клиент для запросов к Core
│           └── api/          # HTTP-клиент для запросов к Core
└── tests/                    # Инфраструктура тестирования (Vitest, ~470 тестов)
    ├── unit/                 # Юнит-тесты модулей (nock для моков сети)
    │   ├── auth.test.js
    │   ├── cookie.test.js
    │   ├── core-manager.test.js
    │   ├── fingerprint.test.js
    │   ├── fingerprint-edge.test.js
    │   ├── proxy.test.js
    │   ├── typing.test.js
    │   ├── multi-control.test.js
    │   ├── multi-control-api.test.js
    │   ├── cdp-manager.test.js
    │   ├── cdp-port-capture.test.js
    │   ├── mouse-smoothing.test.js
    │   ├── window-arranger.test.js
    │   ├── extensions.test.js
    │   ├── os-input.test.js
    │   ├── app-store.test.js
    │   ├── api-client.test.js
    │   ├── race-condition.test.js
    │   ├── browser-shutdown.test.js
    │   └── window-filter.test.js
    └── integration/          # Интеграционные тесты (SQLite WAL, API, CloakBrowser)
        ├── database.test.js
        ├── wal-stress.test.js
        ├── api-real.test.js
        └── profile-launch.test.js
```

---

## Быстрый старт (Разработка)

```bash
# Установка зависимостей бэкенда и фронтенда
npm install

# Запуск всего приложения в режиме разработки (Electron GUI + Автозапуск Core фоном)
npm run dev

# Прогон полной базы тестов
npm test
```

### Параметры ручного запуска Core (без GUI)

```bash
npm start -- --api-token=YOUR_SECRET_TOKEN --port=3005
```

### Сборка Windows Installer

```bash
# Требования: Node.js >=20, Visual Studio Build Tools (workload "Desktop development with C++")
cd gui
npm install
npx vite build
npx electron-builder --win
# Результат: gui/release/MultiManager Setup 1.0.0.exe
```

### Установка CloakBrowser

CloakBrowser — stealth Chromium, управляется через npm-пакет `cloakbrowser`:

```bash
# Установка/обновление CloakBrowser
npx cloakbrowser install

# Проверка версии и пути
npx cloakbrowser info

# Обновление до последней версии
npx cloakbrowser update
```

При первом запуске GUI автоматически проверяет наличие CloakBrowser и предлагает установить.

### Скрипты

| Скрипт | Описание |
|--------|----------|
| `npm run dev` | Запуск бэкенда с авто-рестартом (`node --watch`) |
| `npm start` | Production запуск Core-движка |
| `npm test` | Прогон всех Vitest-тестов |
| `npm run test:api` | Запуск интеграционного API-теста |
| `npm run test:all` | Vitest + API-тест |
| `npm run lint` | ESLint-проверка `src/` |
| `npm run typecheck` | TypeScript-проверка без компиляции |

### Логирование (Разработка)

При запуске через `npm run dev` (или `npm start`) логи выводятся в консоль в формате **pino-pretty** (цветной, человекочитаемый) автоматически — это включается при `NODE_ENV !== 'production'`.

Для записи в файл логи всегда дублируются:

| Лог | Путь |
|-----|------|
| Системный | `%APPDATA%/CloakManager/logs/core.log` (Windows) |
| Профиль | `%APPDATA%/CloakManager/logs/profile_[ID].log` |

На macOS/Linux пути см. в разделе «Директории хранения данных» ниже.

**Управление уровнем логирования:**

```bash
# По умолчанию: info
npm run dev

# Debug (подробный вывод)
LOG_LEVEL=debug npm run dev

# Только ошибки
LOG_LEVEL=error npm run dev
```

**Быстрый просмотр логов в консоли (без файла):**

```bash
# Tail лог-файла в реальном времени (Windows — PowerShell)
Get-Content "$env:APPDATA\CloakManager\logs\core.log" -Wait

# macOS / Linux
tail -f ~/Library/Application\ Support/CloakManager/logs/core.log
```

---

## Интеграция с ИИ-Агентами (API Руководство)

Все запросы к локальному серверу должны содержать заголовок авторизации `Authorization: Bearer <TOKEN>`. Токен генерируется автоматически при старте Electron и доступен для копирования в статус-баре GUI.

### 1. Запуск профиля браузера для ИИ

**Запрос:**
```
POST http://127.0.0.1:{PORT}/api/browser/{profile_id}/start
```

**Ответ движка:**
При успешной валидации прокси и генерации отпечатка, Core-движок запускает CloakBrowser и возвращает ИИ-агенту WebSocket-endpoint для автоматизации:
```json
{
  "status": "success",
  "profile_id": "8f3b201a-cb41-4c12-8671-50e50f3b4d11",
  "pid": 14208,
  "ws_endpoint": "ws://127.0.0.1:3000/devtools/browser/8f3b201a-cb41-4c12-8671-50e50f3b4d11"
}
```

### 2. Пример подключения ИИ-агента (Python / Playwright)

ИИ-агент считывает полученный `ws_endpoint` и мгновенно перехватывает управление сессией:

```python
import asyncio
from playwright.async_api import async_playwright

async def run_ai_agent():
    ws_endpoint = "ws://127.0.0.1:3000/devtools/browser/8f3b201a-cb41-4c12-8671-50e50f3b4d11"

    async with async_playwright() as p:
        browser = await p.chromium.connect_over_cdp(ws_endpoint)
        context = browser.contexts[0]
        page = context.pages[0] if context.pages else await context.new_page()

        await page.goto("https://realsite.com")
        print(await page.title())

        await browser.close()

asyncio.run(run_ai_agent())
```

### 3. Метод «Человеческого ввода» для ИИ (Human-like Typing)

Чтобы обойти защиту от роботов (Cloudflare/Google), Core-движок включает утилиту `humanType()`, имитирующую опечатки (3% chance) и задержки (50–150ms на символ). Встроенного HTTP-эндпоинта пока нет — вызов через CDP напрямую:

```js
const { humanType } = require('./typing');
await humanType(page, 'MySecretPassword123');
```

### 4. Синхронизация окон (Multi-Control API)

Модуль синхронизации транслирует действия мыши и клавиатуры из «главного» (Master) окна во все «ведомые» (Slave) окна через Chrome DevTools Protocol (CDP).

**Как работает:**
1. CloakBrowser запускается с `--remote-debugging-port=0` (свободный порт)
2. При активации синхронизации Core подключается к CDP master-окна
3. В master окно инжектится JS-скрипт (`SYNC_EVENT_SCRIPT`) для перехвата `mousemove/click/scroll/keydown/keyup` + `visibilitychange` (THROTTLE=16ms)
4. Дополнительно: C++ addon **WH_KEYBOARD_LL** перехватывает ВСЕ клавиши на уровне ОС (browser shortcuts, адресная строка)
5. Мышь в slave: MouseSmoother с `ghost-cursor path()` — кубическая Безье + Fitts's Law + overshoot. `flush()` перед кликом гарантирует точность
6. Скролл разбивается на микрошаги (SCROLL_STEP_PX=40, SCROLL_TICK_MS=16)
7. Multi-tab: HTTP `/json` polling (300ms) для обнаружения нативно-открытых вкладок. Tab mapping 1:N через `tabIndex` matrix

**Эндпоинты:**

| Метод | Путь | Описание |
|-------|------|----------|
| `GET` | `/api/multi-control/status` | Текущее состояние (active, masterId, slaves) |
| `POST` | `/api/multi-control/start` | Активировать синхронизацию `{ "masterId": "uuid" }` |
| `POST` | `/api/multi-control/stop` | Остановить синхронизацию |
| `POST` | `/api/multi-control/slave/add` | Добавить slave `{ "profileId": "uuid" }` |
| `POST` | `/api/multi-control/slave/remove` | Удалить slave `{ "profileId": "uuid" }` |
| `POST` | `/api/multi-control/window-position` | Установить позицию окна `{ "profileId", "x", "y", "width", "height" }` |
| `GET` | `/api/multi-control/cdp-status` | Статус CDP-подключений |
| `POST` | `/api/multi-control/focus-windows` | Вывести окна синхронизации на передний план (сначала слейвы, потом мастер) |
| `POST` | `/api/multi-control/os-keyboard` | Приём событий клавиатуры от OS-level hook (WH_KEYBOARD_LL) |

**Пример использования (Python):**

```python
import requests

BASE = "http://127.0.0.1:3000"
TOKEN = "your-api-token"
HEADERS = {"Authorization": f"Bearer {TOKEN}"}

# Запускаем 3 профиля
profiles = []
for i in range(3):
    p = requests.post(f"{BASE}/api/profiles", headers=HEADERS, json={
        "name": f"Worker {i}", "platform": "windows"
    }).json()
    requests.post(f"{BASE}/api/browser/{p['id']}/start", headers=HEADERS)
    profiles.append(p)

# Активируем синхронизацию с первым профилем как Master
requests.post(f"{BASE}/api/multi-control/start", headers=HEADERS, json={
    "masterId": profiles[0]["id"]
})

# Добавляем остальных как Slave
for p in profiles[1:]:
    requests.post(f"{BASE}/api/multi-control/slave/add", headers=HEADERS, json={
        "profileId": p["id"]
    })

# Теперь все клики/ввод в master окне дублируются в slave-окна
# ...

# Останавливаем
requests.post(f"{BASE}/api/multi-control/stop", headers=HEADERS)
```

### 5. Полный цикл автоматизации (Пример)

```python
import requests
import asyncio
from playwright.async_api import async_playwright

BASE = "http://127.0.0.1:3000"
TOKEN = "your-api-token"
HEADERS = {"Authorization": f"Bearer {TOKEN}"}

# 1. Создаём профиль
profile = requests.post(f"{BASE}/api/profiles", headers=HEADERS, json={
    "name": "AI Worker #1",
    "platform": "windows"
}).json()

# 2. Запускаем браузер
start = requests.post(f"{BASE}/api/browser/{profile['id']}/start", headers=HEADERS).json()
ws = start["ws_endpoint"]

# 3. Подключаемся через Playwright и работаем
async def work():
    async with async_playwright() as p:
        browser = await p.chromium.connect_over_cdp(ws)
        page = browser.contexts[0].pages[0]
        await page.goto("https://example.com")
        # ... автоматизация
        await browser.close()

asyncio.run(work())

# 4. Останавливаем
requests.post(f"{BASE}/api/browser/{profile['id']}/stop", headers=HEADERS)
```

---

## Директории хранения данных (Data Integrity)

Все изолированные пользовательские данные сохраняются по путям:

| Платформа | Путь |
|-----------|------|
| Windows | `%APPDATA%/CloakManager/` |
| macOS | `~/Library/Application Support/CloakManager/` |
| Linux | `~/.config/CloakManager/` |

### Структура системной директории:

- `app.db` — База данных SQLite в режиме WAL (Конфигурации, Прокси, Отпечатки, Куки).
- `profiles_data/` — Изолированные папки сессий Chromium (`BrowserData/` для каждого аккаунта: Cookies, LocalStorage, Cache).
- `extensions/` — Установленные расширения Chrome.
- `logs/core.log` — Общие системные логи (Pino JSON).
- `logs/profile_[ID].log` — Индивидуальная телеметрия сессий автоматизации.

---

## Тестирование

Проект включает 24 тестовых файла (~470 тестов) на базе **Vitest**:

| Тест | Тип | Описание |
|------|-----|----------|
| `auth.test.js` | Unit | Middleware авторизации по Bearer-токену |
| `cookie.test.js` | Unit | Парсинг JSON/Netscape куки |
| `core-manager.test.js` | Unit | Пути CORE_PATH, packaged/DEV-режимы, структура сборки |
| `fingerprint.test.js` | Unit | Корректность генерации отпечатков |
| `fingerprint-edge.test.js` | Unit | Граничные кейсы (кроссплатформенные аномалии) |
| `proxy.test.js` | Unit | Парсинг прокси-строк, rotateProxy, checkProxy (HTTP/SOCKS5/HTTPS) |
| `typing.test.js` | Unit | Human-like эмуляция ввода (задержки, опечатки) |
| `multi-control.test.js` | Unit | MultiController: MouseSmoother, flush, scroll, tabIndex |
| `multi-control-api.test.js` | Unit | Multi-control API логика (syncNewMasterTab, discoverActiveTab) |
| `cdp-manager.test.js` | Unit | CDP-менеджер: сессии, dispatch, getHttpTabs, activateAndFocusTarget |
| `cdp-port-capture.test.js` | Unit | Захват CDP-порта из stderr, regex, chunked output |
| `mouse-smoothing.test.js` | Unit | MouseSmoother: setTarget, flush, stop, ghost-cursor path() |
| `window-arranger.test.js` | Unit | Маршруты window-arranger API |
| `extensions.test.js` | Unit | Парсинг manifest, i18n MSG, CRX, Chrome Web Store ID |
| `os-input.test.js` | Unit | InputCapture: mouseMove без throttle, keyDown, scroll |
| `app-store.test.js` | Unit | Состояние инициализации приложения (initialized flag) |
| `api-client.test.js` | Unit | Authorization header, response interceptor |
| `race-condition.test.js` | Unit | Предотвращение race condition при старте (initialized pattern) |
| `browser-shutdown.test.js` | Unit | Graceful shutdown, health check процессов, SIGTERM/SIGKILL, timeout |
| `window-filter.test.js` | Unit | Фильтрация crash-recovery окон, размер диалогов |
| `database.test.js` | Integration | CRUD операции SQLite |
| `wal-stress.test.js` | Integration | Стресс-тест WAL-режима |
| `api-real.test.js` | Integration | Полный цикл REST API |
| `profile-launch.test.js` | Integration | Запуск CloakBrowser и перехват PID |

```bash
# Запуск всех тестов
npm test

# С подробным выводом
npx vitest run --reporter=verbose
```

---

## Лицензия

ISC
