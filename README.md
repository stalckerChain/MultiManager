# MultiManager v1.1.0

AI-Driven Web Automation Platform — кроссплатформенный антидетект-браузер с интеграцией Python-фреймворка автоматизации, графическим интерфейсом и локальным REST API / WebSocket для автономных ИИ-агентов (аналог AdsPower) на базе C++ ядра CloakBrowser.

> **Полная спецификация:** [TS.md](./TS.md) (MultiManager) + [TS_INTEGRATION.md](./TS_INTEGRATION.md) (stAuto0 интеграция).
> **Задачи к реализации:** [ToDo.md](./ToDo.md) + [TASK.md](./TASK.md) (текущая задача).

## Архитектура и Технологический Стек

Проект построен по принципу монорепозитория (Full-Stack Desktop Application):

- **Core-движок (Бэкенд):** Node.js, Express, SQLite (`better-sqlite3`, WAL+ACID), Pino, WebSocket (`ws`). Работает в фоновом режиме, управляет БД, отпечатками, процессами CloakBrowser и задачами автоматизации.
- **GUI (Фронтенд):** Electron.js, Vue 3 (Composition API), Ant Design Vue, Tailwind CSS, Pinia, Vue Router, i18next.
- **GUI (Фронтенд):** Electron.js, Vue 3 (Composition API), Ant Design Vue, Tailwind CSS, Pinia, Vue Router, i18next.
- **Python-фреймворк (stAuto0):** Playwright + cloakbrowser. Чистая Web3-автоматизация (квесты, дроп-охота, мультиаккаунтинг). Отдельный проект, данные через API. См. [TS_INTEGRATION.md](./TS_INTEGRATION.md).

### Кроссплатформенная системная интеграция:

- **Main / Renderer IPC:** Безопасное межпроцессное взаимодействие через `contextBridge` с полной изоляцией (`contextIsolation: true`, `nodeIntegration: false`).
- **Dynamic Port Allocation:** Автозапуск бэкенда с автоматическим сканированием свободных портов в диапазоне `3000–3100`. Порт передаётся через **env `PORT=N`**.
- **System Tray:** Перехват закрытия окна → скрытие в трей. Полное завершение только через трей.
- **Auto-Update:** `electron-updater` + GitHub Releases (latest.yml).
- **Localization (i18n):** English, Русский, 简体中文. Ключи `t('...')`.
- **Theme Switcher:** Тёмная / Светлая / Системная. CSS-переменные + `prefers-color-scheme` + `nativeTheme`.
- **WebSocket:** Реалтайм-статусы профилей. Exponential backoff (1→2→4→8 сек).

---

## Структура проекта

```
MultiManager/
├── TS.md                     # ТЕХНИЧЕСКОЕ ЗАДАНИЕ (MultiManager v1.1.0)
├── TS_INTEGRATION.md         # ТЗ интеграции stAuto0 с MultiManager
├── TS_ADDON.txt              # Источник: контекст Web3 Automation Platform
├── ToDo.md                   # Реестр нереализованного функционала
├── TASK.md                   # Текущая задача разработки
├── package.json              # Зависимости бэкенда и скрипты
├── vitest.config.js          # Vitest
├── src/                      # БЭКЕНД (Core-движок)
│   ├── index.js              # Точка входа (fork с --api-token, env PORT)
│   ├── core/
│   │   ├── app.js            # Express + маршруты API
│   │   └── websocket.js      # WebSocket для реалтайм-событий
│   ├── api/                  # REST API эндпоинты
│   │   ├── auth.js           # Bearer-токен авторизация
│   │   ├── profiles.js       # CRUD профилей
│   │   ├── proxies.js        # CRUD прокси + проверка
│   │   ├── cookies.js        # Импорт/экспорт куки
│   │   ├── browser.js        # Запуск/остановка CloakBrowser + CDP
│   │   ├── multi-control.js  # Синхронизация окон (CDP + native hooks)
│   │   ├── window-arranger.js # Управление окнами (Grid, Cascade)
│   │   ├── extensions.js     # Расширения Chrome
│   │   ├── fingerprint.js    # Генератор отпечатков
│   │   └── logs.js           # Логи профилей и системы
│   ├── db/                   # SQLite (WAL, схемы, CRUD)
│   │   ├── index.js          # Инициализация БД, путь к app.db
│   │   ├── schema.js         # Таблицы, индексы, триггеры
│   │   └── queries.js        # CRUD операции
│   ├── fingerprint/          # Валидатор отпечатков
│   ├── proxy/                # Парсинг, чекер, ротация прокси
│   ├── cookie/               # Инжекция/экспорт сессий
│   ├── typing/               # Human-like Typing (CDP)
│   ├── multi-control/        # Синхронизатор окон
│   │   ├── index.js
│   │   ├── cdp-manager.js
│   │   └── mouse-smoothing.js
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
│       │   └── updater.js    # electron-updater
│       ├── preload/          # Контекстный мост IPC
│       ├── shared/errors.js  # Коды ошибок
│       └── renderer/         # Vue 3 App
│           ├── main.js
│           ├── App.vue
│           ├── router.js
│           ├── style.css
│           ├── i18n/         # en.json, ru.json, zh.json
│           ├── stores/       # Pinia (app, profiles, proxies, browser, sync)
│           ├── views/        # Экраны
│           │   ├── Profiles.vue
│           │   ├── Proxies.vue
│           │   ├── WindowArranger.vue
│           │   ├── Extensions.vue
│           │   ├── Settings.vue
│           │   ├── ProfileModal.vue
│           │   └── CookieImportModal.vue
│           ├── components/   # Layout, StatusBar, LogPanel, BrowserDownload, AccountsTab, WalletsTab
│           ├── composables/  # useTheme, useWebSocket
│           └── api/          # HTTP-клиент к Core
└── tests/                    # Vitest (~500 тестов)
    ├── unit/                 # 21 файл: auth, proxy, fingerprint, typing, etc.
    └── integration/          # 4 файла: SQLite WAL, API, lifecycle, proxy
```

---

## Быстрый старт (Разработка)

```bash
# Установка зависимостей
npm install
cd gui && npm install && cd ..

# Запуск (Electron GUI + Core бэкенд автоматически)
npm run dev

# Прогон тестов
npm test
```

### Параметры ручного запуска Core (без GUI)

```bash
node src/index.js --api-token=YOUR_SECRET_TOKEN
# Порт через env: PORT=3005 node src/index.js --api-token=YOUR_SECRET_TOKEN
```

### Сборка Windows Installer

```bash
cd gui && npm install && npx vite build && npx electron-builder --win
# Результат: gui/release/MultiManager Setup 1.0.0.exe
```

### CloakBrowser

```bash
npx cloakbrowser install   # Установка
npx cloakbrowser info       # Версия и путь
npx cloakbrowser update     # Обновление
```

GUI автоматически проверяет наличие CloakBrowser при первом запуске.

### Скрипты

| Скрипт | Описание |
|--------|----------|
| `npm run dev` | Бэкенд с авто-рестартом (`node --watch`) |
| `npm start` | Production запуск Core |
| `npm test` | Все Vitest-тесты |
| `npm run test:api` | Интеграционный API-тест |
| `npm run test:all` | Vitest + API-тест |
| `npm run lint` | ESLint `src/` |
| `npm run typecheck` | TypeScript-проверка |

---

## Интеграция с ИИ-Агентами (API Руководство)

Все запросы содержат `Authorization: Bearer <TOKEN>`. Токен генерируется при старте, копируется из статус-бара GUI.

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
  "ws_endpoint": "http://127.0.0.1:9331"
}
```

> **Примечание:** `ws_endpoint` содержит **реальный CDP-порт** CloakBrowser (динамический, из stderr discovery). Python подключается через `connect_over_cdp(ws_endpoint)`.

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

```js
const { humanType } = require('./typing');
await humanType(cdpSession, 'MySecretPassword123');  // 50-150ms, 3% опечаток
```

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

### 5. Полный цикл

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

---

## Директории хранения данных

| Платформа | Путь |
|-----------|------|
| Windows | `%APPDATA%/CloakManager/` |
| macOS | `~/Library/Application Support/CloakManager/` |
| Linux | `~/.config/CloakManager/` |

### Структура:

- `app.db` — SQLite (WAL). Профили (30 колонок), прокси, куки, задачи (tasks/task_executions).
- `profiles/{UUID}/BrowserData/` — Сессии Chromium (Cookies, LocalStorage, Cache).
- `extensions/` — Установленные расширения Chrome.
- `logs/core.log` — Системные логи.
- `logs/profile_[ID].log` — Логи сессий.
- `backups/` — Бэкапы app.db (Rolling 7 дней).

---

## Коды ошибок API

| Код | Описание |
|-----|----------|
| 200 | Успешный запрос |
| 201 | Ресурс создан |
| 204 | Успешное удаление |
| 400 | Неверный запрос (валидация) |
| 401 | Не авторизован |
| 404 | Ресурс не найден |
| 409 | Конфликт (профиль запущен/остановлен) |
| 412 | Прокси недоступен |
| 500 | Внутренняя ошибка сервера |
| 502 | Ошибка ротации прокси |

---

## Документация

| Файл | Описание |
|------|----------|
| [TS.md](./TS.md) | Полное ТЗ MultiManager v1.1.0 (12 разделов, Roadmap) |
| [TS_INTEGRATION.md](./TS_INTEGRATION.md) | ТЗ интеграции stAuto0 (маппинг полей, рефакторинг, миграция) |
| [TS_ADDON.txt](./TS_ADDON.txt) | Источник: контекст Web3 Automation Platform |
| [ToDo.md](./ToDo.md) | Реестр нереализованного функционала (19 задач) |
| [TASK.md](./TASK.md) | Текущая задача разработки |

---

## Лицензия

ISC
