-------------------------------
## SOFTWARE REQUIREMENTS SPECIFICATION (SRS) / ТЕХНИЧЕСКОЕ ЗАДАНИЕ
## AI-Driven Web Automation Platform на базе антидетект-браузера (MVP аналог AdsPower + ферма автоматизации)
**Версия системы:** 1.1.0 | **Multi-Control:** 0.13.0 | **Дата ревизии:** 2026-07-07

> **Принцип маркировки:** ✅ РЕАЛИЗОВАНО в коде | ⚠️ ЧАСТИЧНО | ❌ НЕ РЕАЛИЗОВАНО (в ТЗ, но в коде нет). Каждое утверждение о статусе подкреплено ссылкой на реальный файл аудита.
> **Спутник-документ:** [TS_INTEGRATION.md](./TS_INTEGRATION.md) — миграция Python-фреймворка stAuto0 на интеграцию с MultiManager.
-------------------------------

## 1. Общие сведения и архитектура системы

Продукт — гибрид антидетект-браузера и платформы Web3-автоматизации. В v1.1.0 направление смещается от «чистого антидетекта» к **AI-Driven Web Automation Platform** (квесты, дроп-охота, мультиаккаунтинг с кошельками/соцсетями), при этом ядро антидетекта остаётся фундаментом.

Архитектура жёстко разделена на два независимых слоя:

1. **Core-движок (Бэкенд):** Консольное Node.js-приложение (Express + better-sqlite3), работающее в фоновом режиме ОС. Предоставляет локальный REST API + WebSocket для управления БД, жизненным циклом процессов браузера и задачами автоматизации. ✅ `src/index.js`, `src/core/app.js`
2. **GUI (Фронтенд):** Графическая десктопная оболочка (Electron + Vue 3), выполняющая роль визуального интерфейса. GUI коммуницирует с Core исключительно через локальные HTTP-запросы и WebSocket. ✅ `gui/src/main/index.js`, `gui/src/renderer/`

Система кроссплатформенная (Windows 11, macOS, Linux). Полный антидетект-стек реализован; модули автоматизации (Web3, планировщик, шифрование) — к реализации (см. Roadmap, раздел 11).

**Технологический стек Core:**
- Node.js ≥ 20.x, Express 4.x, better-sqlite3 (WAL + ACID), pino (логирование), ws (WebSocket), socks (SOCKS5-proxy), adm-zip, ghost-cursor, tree-kill, koffi (FFI для нативных Windows-хуков)

**Тестирование:** Vitest (unit + integration), ~500 тестов. ✅ `tests/`, `vitest.config.js`

-------------------------------
## 2. Безопасность и авторизация локального API ✅ РЕАЛИЗОВАНО

- **Локальный хост:** Core открывает порт только на `127.0.0.1`. ✅ `src/index.js:27`
- **Handshake:** GUI при fork Core передаёт токен как `--api-token=SECRET_VALUE` и порт через **env `PORT=N`** (см. примечание в §3.2). ✅ `gui/src/main/core-manager.js:60,70`
- **Авторизация:** Все HTTP-запросы требуют `Authorization: Bearer SECRET`. Middleware возвращает 401 при отсутствии/несовпадении токена. ✅ `src/api/auth.js`
- **Доступ для ИИ-агентов:** Токен доступен для копирования в Settings GUI. ✅ `gui/src/renderer/views/Settings.vue`
- **Health:** `GET /health` — `{"status":"ok"}` (до middleware авторизации). ✅ `src/core/app.js:20`

-------------------------------
## 3. Хранение данных (База данных и локальные файлы) ⚠️ РАСШИРЯЕТСЯ

- **Тип БД:** SQLite через нативную `better-sqlite3`. ✅ `src/db/index.js`
- **Режим:** WAL + ACID (pragma `journal_mode=WAL`, `foreign_keys=ON`). ✅ `src/db/index.js:35-36`
- **Директория приложения:**
  - **Windows:** `%APPDATA%/CloakManager/` ✅ `src/db/index.js:14`
  - **macOS:** `~/Library/Application Support/CloakManager/`
  - **Linux:** `~/.config/CloakManager/`
- **Канонический путь профилей:** `%APPDATA%/CloakManager/profiles/{UUID}/BrowserData/` ✅ `src/cookie/inject.js:6`, используется в `src/api/browser.js:286,476`
  > **Примечание:** документ TS_ADDON предлагал путь `profiles_data/{UUIDv4}`. Каноническим закреплён реально работающий путь `profiles/{UUID}` — переименование не требуется.

### 3.1. Существующая схема БД ✅ РЕАЛИЗОВАНО (`src/db/schema.js`)
| Таблица | Назначение |
|---------|-----------|
| `profiles` | Профили браузера (16 колонок — см. ниже) |
| `proxies` | Прокси (тип, хост, порт, авторизация, rotation_url, last_ip, is_active) |
| `cookies` | Куки профилей |
| `profile_logs` | Логи профилей |
| `system_config` | Системные настройки (key-value) |

**`profiles` (16 колонок, всё ✅):** `id` (UUIDv4 PK), `number`, `name`, `proxy_id` FK, `fingerprint_seed`, `platform`, `user_agent`, `screen_resolution`, `hardware_cores`, `hardware_memory`, `extensions` (JSON), `tags` (JSON), `notes`, `status` (stopped|starting|running), `pid`, `created_at`, `updated_at`.

### 3.2. Расширение схемы v1.1.0 ❌ НЕ РЕАЛИЗОВАНО (Roadmap Ф1)

**Новые колонки таблицы `profiles`:**
| Колонка | Тип | Назначение |
|---------|-----|-----------|
| `timezone` | TEXT DEFAULT 'Asia/Bishkek' | Прокидывается через CDP `Emulation.setTimezoneOverride` при старте |
| `email` | TEXT | Email аккаунта |
| `email_password` | TEXT | Пароль почты (AES-256-GCM, см. §4.X) |
| `twitter_username` | TEXT NOT NULL (если есть X-блок) | Логин X/Twitter |
| `twitter_password` | TEXT | Пароль X (AES) |
| `twitter_auth_token` | TEXT | Auth token X (AES) |
| `twitter_email` | TEXT | Email X |
| `discord_username` | TEXT | Логин Discord |
| `discord_password` | TEXT | Пароль Discord (AES) |
| `discord_token` | TEXT | Token Discord (AES) |
| `discord_email` | TEXT | Email Discord |
| `wallet_evm_address` | TEXT | EVM-адрес (публичный) |
| `wallet_sol_address` | TEXT | Solana-адрес (публичный) |
| `wallet_password` | TEXT | Пароль расширения Zerion (AES, default 'asdfj*KK') |

> **🛑 КРИТИЧНОЕ РЕШЕНИЕ:** приватных ключей (`wallet_evm_private`, `wallet_sol_private`) **В СХЕМЕ НЕТ**. Сид-фразы хранятся только во временном файле `config/auto_sids.py` и уничтожаются после инициализации (см. TS_INTEGRATION.md §5). Recovery кошелька по базе невозможен по дизайну — это сознательный параноидальный выбор.

**Миграция:** через `ALTER TABLE ADD COLUMN` (SQLite безопасно добавляет колонки с дефолтами к существующим БД без потери данных). Новая версия `src/db/schema.js` должна содержать и CREATE для свежих БД, и блок миграций `ALTER ... WHERE NOT EXISTS`.

### 3.3. Новые таблицы планировщика ❌ НЕ РЕАЛИЗОВАНО (Roadmap Ф1)

**`tasks`** — задачи/квесты:
| Колонка | Тип | Назначение |
|---------|-----|-----------|
| `id` | TEXT UUIDv4 PK | |
| `name` | TEXT | Название квеста/задачи |
| `script_name` | TEXT | Соответствует `--project=` аргументу stAuto0 (например, `concrete`) |
| `schedule_type` | TEXT | `once` \| `daily` \| `weekly` \| `manual` \| `archive` |
| `cron_expression` | TEXT | Для daily/weekly (опционально) |
| `params` | TEXT JSON | Динамические параметры (referral codes, диапазоны, теги аккаунтов) |
| `is_active` | INTEGER | 1/0 |
| `created_at`, `updated_at` | DATETIME | |

**`task_executions`** — история запусков:
| Колонка | Тип | Назначение |
|---------|-----|-----------|
| `id` | INTEGER PK AUTOINCREMENT | |
| `task_id` | TEXT FK → tasks(id) | |
| `profile_id` | TEXT FK → profiles(id) | |
| `status` | TEXT | `success` \| `failed` \| `running` |
| `exit_code` | INTEGER | Код выхода Python-процесса (0=success) |
| `last_run_at` | DATETIME | |
| `log_file_path` | TEXT | Путь к логу запуска (tail'ится встроенным терминалом, §9.5) |

> **«Tasks как контейнер» (решение #10):** код самих проектов (Concrete, Paragraph и др.) живёт в `stAuto0/projects/*.py`. MultiManager хранит только мета (script_name, params JSON, schedule). Планировщик может менять параметры задачи без правки Python-кода.

### 3.4. Порт Core (исправление расхождения)
GUI передаёт порт бэкенду через **env-переменную `PORT=N`** ✅ `gui/src/main/core-manager.js:60`, а не через CLI `--port=N`, как утверждал старый TS.md §3.2. `--api-token=` передаётся как CLI-аргумент. ✅ `gui/src/main/core-manager.js:70-71`

**Опциональная правка (Roadmap Ф4):** дополнительно принимать `--port=N` для консистентности с `--api-token=` и упрощения документации.

-------------------------------
## 4. Функциональные модули системы

### 4.1. Генератор случайных отпечатков (Fingerprint Generator) ✅ РЕАЛИЗОВАНО
- `POST /api/fingerprint/generate` — генерация под платформу (windows|macos|linux). ✅ `src/fingerprint/index.js`, `src/api/fingerprint.js`
- Случайный подбор UA, разрешения, ядер CPU, ОЗУ, WebGL-renderer, fingerprint_seed. Логические проверки исключают невалидные комбинации (например, Safari UA на Windows).

### 4.2. Менеджер прокси и ротация (Proxy Manager) ✅ РЕАЛИЗОВАНО
- CRUD `CRUD /api/proxies`, `POST /api/proxies/import`, `POST /api/proxies/:id/check`. ✅ `src/api/proxies.js`
- Протоколы HTTP/HTTPS/SOCKS5. Четыре формата парсинга. ✅ `src/proxy/index.js:7-39`
- Ротация мобильных прокси: GET к `proxy_rotation_url`, пауза 3 сек. ✅ `src/proxy/index.js:180`
- Proxy Checker: тестовый запрос к `api.ipify.org`; при недоступности — 412 Precondition Failed. ✅ `src/api/browser.js:263-276`
- Автоопределение типа (HTTP→SOCKS5 fallback). ✅ `src/proxy/index.js:163-175`
- Флаг браузера `--proxy-server={type}://{user}:{pass}@{host}:{port}`. ✅ `src/api/browser.js:307`

### 4.3. Управление куки (Cookie Import/Export) ✅ РЕАЛИЗОВАНО (частично — GUI)
- `GET|POST|DELETE /api/cookies/:profileId`, экспорт в JSON/Netscape. ✅ `src/api/cookies.js`, `src/cookie/inject.js`
- Инжекция в `--user-data-dir` профиля перед запуском. ✅ `src/api/browser.js:289`

### 4.4. Логика синхронизатора (Multi-Control) v0.13.0 ✅ РЕАЛИЗОВАНО
- CDP-синтез мыши/клавиатуры + Native OS hooks (WH_KEYBOARD_LL) для browser chrome. ✅ `src/multi-control/`, `src/os-input/native-hooks/`
- MouseSmoother (ghost-cursor path(), Безье + Fitts + overshoot), `flush()` перед кликом, микрошаговый скролл. ✅ `src/multi-control/mouse-smoothing.js`
- Tab Mapping 1:N (`Map<masterTargetId, Map<slaveId, slaveTargetId>>`). ✅ `src/multi-control/cdp-manager.js`
- Активация фокуса: `Target.activateTarget` → `Page.bringToFront` → `DOM.focus` + `body.focus()`.
- Endpoints `/api/multi-control/*`, `/api/window-arranger/*`. ✅ `src/core/app.js:28-29`

### 4.5. Human-like Typing (для ИИ-агента) ⚠️ ЧАСТИЧНО
- Функция `humanType(cdp, text)` есть: задержки 50–150 мс, 3% опечаток с Backspace. ✅ `src/typing/index.js`
- **HTTP endpoint отсутствует ❌.** Roadmap Ф4: добавить `POST /api/browser/:id/type {text}` — обёртку, открывающую CDP-сессию и вызывающую `humanType()`.

### 4.6. Менеджер расширений (Extensions Manager) ✅ РЕАЛИЗОВАНО
- `CRUD /api/extensions`, `POST /api/extensions/:id/toggle`, `POST /api/extensions/:id/assign-all`. ✅ `src/api/extensions.js`
- Установка из папки, Chrome Web Store, ZIP/CRX (v2+v3). i18n `__MSG_*__`. Загрузка через `--load-extension` + CDP `chrome.developerPrivate.loadUnpacked`. ✅ `src/api/browser.js:180-222`

### 4.7. Управление окнами (Window Arranger) ⚠️ ЧАСТИЧНО
- `GET /api/window-arranger/windows`, `/grid`, `/cascade`, `/focus/:windowId`. ✅ `src/api/window-arranger.js`
- PowerShell-зависимость (только Windows). ❌ Cross-platform замена (ToDo.md §4).
- Группировка по профилям в GUI. ❌ (ToDo.md §3)

### 4.8. Очистка диска ✅ РЕАЛИЗОВАНО
- `POST /api/browser/:id/clean`. Mutex при starting/running → 409 Conflict. Очистка `Cache`, `Code Cache`, `GPUCache`. ✅ `src/api/browser.js:463-487`

### 4.9. Anti-Zombie контроль процессов ✅ РЕАЛИЗОВАНО
- PID сохраняется в БД при старте. Health-check каждые 5 сек (`process.kill(pid, 0)`). ✅ `src/api/browser.js:71-78,98-115`
- Graceful shutdown: SIGTERM → ожидание 8 сек → SIGKILL (tree-kill). ✅ `src/api/browser.js:497-531`
- `POST /api/browser/shutdown` — массовая остановка. ✅ `src/api/browser.js:533-564`

### 4.10. Hot Backup + Rolling Window ❌ НЕ РЕАЛИЗОВАНО (Roadmap Ф3)
> **Расхождение с TS_ADDON §3.2**, который утверждал «реализована». Аудит: `grep -r backup src/` пуст. Нет ни `db.backup()`, ни папки `backups/`.

**Спецификация к реализации:**
- `src/backup/index.js`: метод `db.backup()` библиотеки better-sqlite3 (копирование на лету, исключает повреждение WAL).
- Триггер: холодный старт приложения, сразу после `initDatabase()` в `src/index.js:15`.
- Бэкапится **только** `app.db`. Папки кэша браузеров полностью игнорируются.
- Ротация Rolling Window: дампы в `backups/app_YYYYMMDD_HHmmss.db` старше 7 дней (168 ч) удаляются по `mtime`.
- Имя файла: `backups/app_{ISO-date}.db`. Папка `backups/` создаётся в директории приложения (рядом с `app.db`).

### 4.11. Шифрование AES-256-GCM секретов ❌ НЕ РЕАЛИЗОВАНО (Roadmap Ф2)
> **Расхождение с TS_ADDON §2**, который требовал AES-256-GCM для приватников. Аудит: `crypto` используется только для генерации api-token (`src/index.js:11`). Шифрования секретов нет, пароли прокси хранятся открыто (`src/db/queries.js:69`).

**Спецификация к реализации:**

**Мастер-ключ — гибрид (решение #6):**
1. **Дефолт: OS Keyring.** Случайный 256-бит ключ генерируется 1 раз при первом старте, сохраняется в Windows Credential Manager (win32) / macOS Keychain (darwin) / libsecret/Secret Service (linux). Автозапуск без ввода пароля. ✅ Подходит для фермы.
2. **Опция: Мастер-пароль.** В Settings пользователь задаёт пароль → PBKDF2 (210000 итераций, SHA-256, salt из system_config) → ключ в RAM на время сессии. Переносимо между ПК.
3. **Recovery-key.** Показывается 1 раз при первом шифровании, хранится пользователем в надёжном месте для emergency (потеря keyring/пароля).

**Шифруемые колонки:** `email_password`, `twitter_password`, `twitter_auth_token`, `discord_password`, `discord_token`, `wallet_password`.

**Формат хранения:** `aes-256-gcm:<iv_hex>:<ciphertext_hex>:<tag_hex>` (GCM даёт аутентификацию + целостность).

**Модуль:** `src/crypto/index.js` — функции `encrypt(plaintext)`, `decrypt(blob)`, `rotateKey(oldMaster, newMaster)`, `hasMasterKey()`. Интегрируется в `src/db/queries.js` (прозрачное шифрование при записи, расшифровка при чтении).

> **🛑 Сиды — НИКОГДА в БД и RAM GUI.** Этот инвариант нельзя нарушать шифрованием приватников в БД (см. §3.2): сид-фраза существует только во временном файле stAuto0 и уничтожается.

### 4.12. Endpoints для интеграции со stAuto0 ❌ НЕ РЕАЛИЗОВАНО (Roadmap Ф4)

| Endpoint | Метод | Назначение |
|----------|-------|-----------|
| `/api/internal/profiles` | GET | **Выборка аккаунтов для Python.** Query `?range=001-010` разворачивается в `auto_001..auto_010`. Возвращает массив JSON со всеми Web3-метриками, почтами, соцсетями, прокси (готовая строка `host:port:user:pass`). Этот endpoint возвращает секреты в **cleartext** — он нужен Python для автоматизации. См. TS_INTEGRATION §2.3 для маппинга полей. |
| `/api/browser/:id/type` | POST | Human-like typing через CDP (обёртка над `humanType()`). Тело `{text}`. |
| `/api/browser/:id/zerion-login` | POST | Авто-логин Zerion (логика перенесена из `stAuto0/Core/browser.py::login_zerion`): открытие `chrome-extension://klghhnkeealcohjjanjjdaeeggmfmlpl/popup.html#/login`, fill `wallet_password`, Enter, ожидание скрытия поля. Тело `{password?}` (если нет — берётся из БД). |
| `/api/tasks/:id/run` | POST | **Триггер внешнего планировщика.** Core spawn `python main.py --project={script_name} --range={params.range} --log-name={task.id}` (решение #8). Пишет строку в `task_executions` со статусом `running`, по exit code обновляет на `success`/`failed`. |
| `/api/profiles/batch` | POST | Массовый импорт для Wallet Factory (1 транзакция вместо N запросов). Тело `{accounts: [...]}`. |
| `/api/tasks` | CRUD | Управление задачами (UI Tasks Manager). |

> **`/api/internal/profiles` минует часть шифрования:** Python-агенту нужен cleartext для работы. Этот endpoint защищён тем же Bearer-token, но логируется как `[INTERNAL]` для аудита.

### 4.13. Авто-логин Zerion по CDP ❌ НЕ РЕАЛИЗОВАНО (Roadmap Ф2 + Ф4)
> Логика сейчас в Python (`stAuto0/Core/browser.py:348 login_zerion`). Переносится в Node.js, чтобы Python получал уже залогиненный `ws_endpoint`.

Zerion ID: `klghhnkeealcohjjanjjdaeeggmfmlpl`. Flow:
1. Открыть `chrome-extension://{ZERION_ID}/popup.8e8f209b.html?windowType=dialog#/login` через CDP.
2. `wait_for_selector("input[type='password']", 15000)`.
3. `fill(wallet_password)`, `press("Enter")`.
4. `wait_for_selector("input[type='password']", state="hidden", 10000)`.
Реализуется как `/api/browser/:id/zerion-login` (§4.12) + используется в расширенном `/:id/start` (опция `auto_login_zerion: true`).

### 4.14. Migration Wizard (AdsPower/Dolphin{anty}) ❌ ЗАМОРОЖЕНО
Подробности в [ToDo.md](./ToDo.md) §5.

### 4.15. Cloud Sync ❌ ЗАМОРОЖЕНО
Подробности в [ToDo.md](./ToDo.md) §6.

-------------------------------
## 5. Стратегия логирования ✅ РЕАЛИЗОВАНО
- **Системный лог `logs/core.log`:** запуск API, ошибки SQLite, генерация токенов, общие сбои. Dev → pino-pretty. ✅ `src/logger/index.js`
- **Лог профиля `logs/profile_[ID].log`:** изолированный файл (ротация прокси, Proxy Checker, ошибки запуска, сессии автоматизации). ✅ `src/api/browser.js:10` (`createProfileLogger`)
- **Лог задачи** (новый ❌ Roadmap Ф4): `logs/task_{task_id}_{timestamp}.log` — stdout/stderr spawn'нутого Python. Путь пишется в `task_executions.log_file_path`. Tail'ится встроенным терминалом GUI (§9.5).

-------------------------------
## 6. Стратегия тестирования ✅ РЕАЛИЗОВАНО
Фреймворк **Vitest v3.x**, ~500 тестов. Запуск: `npm test`, `npm run test:watch`.

**Unit (21 файл):** парсеры прокси/куки, fingerprint, auth middleware, расширения, CDP Manager, Multi-Control, Window Arranger, Human-like Typing.

**Integration (4 файла):** SQLite WAL (параллельная запись), API endpoints, lifecycle профиля, Proxy Checker.

**К новым тестам (Roadmap):** crypto (encrypt/decrypt/rotate), backup (rolling cleanup), `/api/internal/profiles` range-parsing, `tasks` CRUD, `zerion-login` с моком CDP.

-------------------------------
## 7. Формат ответа API для ИИ/Python ❌ ИСПРАВИТЬ (Roadmap Ф4)

**Текущий код** возвращает **нерабочую заглушку**:
```js
ws_endpoint: `ws://127.0.0.1:3000/devtools/browser/${req.params.id}` // src/api/browser.js:410
```
Этот URL не существует — DevTools не挂在ится на порт Core.

**Канон v1.1.0 (решение #12):** использовать реальный CDP-порт, который уже ловится из stderr в `cdpPorts` Map (`src/api/browser.js:344-348`). Ответ должен содержать discovery-URL, из которого Python достаёт browserId через `GET /json/version`, либо прямо готовый `ws_endpoint`:

```json
{
  "status": "success",
  "profile_id": "8f3b201a-...",
  "pid": 14208,
  "cdp_port": 9331,
  "ws_endpoint": "http://127.0.0.1:9331"
}
```
Python: `connect_over_cdp("http://127.0.0.1:9331")`. Таймаут ожидания CDP-порта — 15 сек (`waitForCdpPort` уже есть в `src/api/browser.js:167`).

**Коды ошибок API:** 200 / 201 / 204 / 400 / 401 / 404 / 409 (конфликт) / 412 (прокси недоступен) / 500 / 502 (ротация прокси). ✅ Соответствует коду.

-------------------------------

## РАЗДЕЛ: ГРАФИЧЕСКИЙ ИНТЕРФЕЙС (GUI)

## 8. Технологический стек GUI ✅ РЕАЛИЗОВАНО
- Electron + Vue 3 + Vite + electron-builder (NSIS/DMG/AppImage). ✅ `gui/package.json`
- Tailwind CSS + Ant Design Vue (`ant-design-vue ^4.2.6`).
- HTTP + WebSocket к Core (127.0.0.1:порт).

## 9. Функциональные экраны GUI

### 9.1. Экран «Менеджер профилей» ⚠️ РАСШИРЯЕТСЯ
**Реализовано ✅** (`gui/src/renderer/views/Profiles.vue`, `ProfileModal.vue`):
- Toolbar: Создать, «В 1 клик», активация синхронизатора, массовые операции, поиск, фильтр по тегам.
- Таблица профилей: №, имя+теги, прокси, отпечаток, статус, СТАРТ/СТОП, контекстное меню. WebSocket-обновление статусов.
- Модалка редактирования с вкладками «Основные»/«Прокси»/«Дополнительно».

**К реализации ❌ (Roadmap Ф5):**
- **Новые вкладки в ProfileModal:**
  - «Аккаунты»: `email`, `email_password`, блоки X/Twitter и Discord (4+4 поля). Пароли маскируются, есть кнопка «показать/скрыть».
  - «Кошельки»: `wallet_evm_address`, `wallet_sol_address` (read-only, генерируются Wallet Factory), `wallet_password` (с возможностью смены).
  - Поле `timezone` (select из common tz).
- Эти поля пишутся через `PUT /api/profiles/:id` и шифруются на бэке (§4.11).

### 9.2. Window Arranger ⚠️ ЧАСТИЧНО (см. §4.7)
### 9.3. Экран «Менеджер прокси» ✅ РЕАЛИЗОВАНО (`gui/src/renderer/views/Proxies.vue`)
### 9.4. Cookie Manager ⚠️ ЧАСТИЧНО (`gui/src/renderer/views/CookieImportModal.vue`)
- Drag-and-drop + пре-валидатор — ❌ (ToDo.md §2).
### 9.5. Extensions Manager ✅ РЕАЛИЗОВАНО (`gui/src/renderer/views/Extensions.vue`)

### 9.6. Мониторинг логов и статуса API ✅ РЕАЛИЗОВАНО
- Панель разработчика: бегущая строка core.log. ✅ `gui/src/renderer/components/LogPanel.vue`
- Статус-бар: статус сервера, порт, копирование AUTH_TOKEN. ✅ `gui/src/renderer/components/StatusBar.vue`

### 9.7. Экран «Tasks Manager» (Планировщик) ❌ НЕ РЕАЛИЗОВАНО (Roadmap Ф5)
- Таблица задач: name, script_name, schedule_type, is_active, last_run.
- История executions (task_executions): статус, exit_code, время, ссылка на лог.
- Кнопка «Run now» → `POST /api/tasks/:id/run`.
- CRUD задач (создание/редактирование с выбором script_name из списка доступных проектов stAuto0).

### 9.8. Встроенный терминал (xterm.js + node-pty) ❌ НЕ РЕАЛИЗОВАНО (Roadmap Ф6)
> **Расхождение с TS_ADDON §7.** Аудит: `xterm.js` и `node-pty` отсутствуют в `gui/package.json` dependencies.

**Спецификация:**
- Компонент в `gui/src/renderer/components/Terminal.vue` (xterm.js renderer).
- node-pty spawn на стороне Electron main, IPC-канал передаёт данные в renderer.
- Источник: tail -f файла из `task_executions.log_file_path`. Вкладка в Layout рядом с LogPanel.
- Поддержка цвета ANSI (pino-pretty выводит ANSI-цвета).

### 9.9. Локализация (i18n) ✅ РЕАЛИЗОВАНО
- i18next, English (default) / Русский / 简体中文. Ключи `t('...')`. Выбор сохраняется в SQLite. ✅ `gui/src/renderer/i18n/`
- Коды ошибок бэкенда (`ERR_PROXY_REFUSED`) локализуются на фронтенде.

## 10. Системная интеграция
### 10.1. Темизация ✅ РЕАЛИЗОВАНО (`gui/src/renderer/composables/useTheme.js`)
### 10.2. Автозапуск Core и конфликты портов ✅ РЕАЛИЗОВАНО (`gui/src/main/core-manager.js:42-49` — инкрементный поиск 3000–3100)
### 10.3. WebSocket Auto-Reconnect ✅ РЕАЛИЗОВАНО (exponential backoff 1→2→4→8 сек)
### 10.4. Системный трей ✅ РЕАЛИЗОВАНО (`gui/src/main/tray.js`)
### 10.5. Автообновление ✅ РЕАЛИЗОВАНО (`gui/src/main/updater.js` — electron-updater + GitHub Releases)

### 10.6. Settings — расширение ❌ (Roadmap Ф5)
- Раздел «Безопасность»: переключатель мастер-пароль (вкл/выкл), поле ввода/смены пароля, отображение recovery-key (один раз), статус OS Keyring.
- Раздел «Автоматизация»: путь к stAuto0 (`cwd` для spawn), выбор Python-интерпретатора, список доступных проектов (для Tasks Manager).

-------------------------------
## 11. Roadmap реализации (MultiManager-сторона)

| Фаза | Задача | Файлы | Зависимости |
|------|--------|-------|-------------|
| **Ф1** | Расширение БД: `timezone`, новые колонки `profiles`, таблицы `tasks`/`task_executions`. Миграция `ALTER TABLE`. | `src/db/schema.js`, `src/db/queries.js` | — |
| **Ф2** | Crypto-модуль AES-256-GCM + гибрид мастер-ключа (Keyring/PBKDF2/recovery) + авто-логин Zerion. | `src/crypto/index.js` (новый), `src/db/queries.js`, `src/api/browser.js` | Ф1 |
| **Ф3** | Backup Hot Backup + Rolling 7д. | `src/backup/index.js` (новый), `src/index.js` | — |
| **Ф4** | Endpoints: `/api/internal/profiles`, `/api/browser/:id/type`, `/api/browser/:id/zerion-login`, `/api/tasks/:id/run`, `/api/profiles/batch`. Исправление `ws_endpoint` (реальный CDP-порт). | `src/api/internal.js` (новый), `src/api/browser.js`, `src/api/tasks.js` (новый), `src/core/app.js` | Ф1, Ф2 |
| **Ф5** | GUI: новые вкладки ProfileModal, экран Tasks Manager, Settings crypto/automation. | `gui/src/renderer/views/ProfileModal.vue`, `gui/src/renderer/views/Tasks.vue` (новый), `gui/src/renderer/views/Settings.vue` | Ф1, Ф2, Ф4 |
| **Ф6** | Терминал xterm.js + node-pty. | `gui/package.json`, `gui/src/main/pty.js` (новый), `gui/src/renderer/components/Terminal.vue` (новый) | Ф4 |

> **Параллельный трек (TS_INTEGRATION.md):** миграция stAuto0 идёт фазами ФА–ФД и стыкуется с MultiManager Ф1–Ф4 (API-контракт).

-------------------------------
## 12. Сводная таблица статусов (аудит 2026-07-07)

| # | Фича | В ТЗ | В коде | Приоритет |
|---|------|------|--------|-----------|
| 1 | БД: 16 колонок profiles | ✅ | ✅ `schema.js` | — |
| 2 | БД: новые колонки v1.1.0 | ✅ | ❌ | Ф1 |
| 3 | БД: таблицы tasks/task_executions | ✅ | ❌ | Ф1 |
| 4 | Timezone в профиле | ✅ | ❌ | Ф1 |
| 5 | Шифрование AES-256-GCM | ✅ | ❌ (только token-gen) | Ф2 |
| 6 | Hot Backup + Rolling | ✅ | ❌ | Ф3 |
| 7 | `/api/internal/profiles?range=` | ✅ | ❌ | Ф4 |
| 8 | Human-like Typing endpoint | ✅ | ⚠️ (функция есть) | Ф4 |
| 9 | Авто-логин Zerion по CDP | ✅ | ❌ (в Python) | Ф2/Ф4 |
| 10 | `POST /api/tasks/:id/run` | ✅ | ❌ | Ф4 |
| 11 | `POST /api/profiles/batch` | ✅ | ❌ | Ф4 |
| 12 | Исправление `ws_endpoint` | ✅ | ❌ (заглушка) | Ф4 |
| 13 | ProfileModal вкладки (акки/кошельки) | ✅ | ❌ | Ф5 |
| 14 | Экран Tasks Manager | ✅ | ❌ | Ф5 |
| 15 | Встроенный терминал | ✅ | ❌ (нет deps) | Ф6 |
| 16 | Settings: crypto + automation | ✅ | ⚠️ (базовый Settings) | Ф5 |
| 17 | Cookie drag-and-drop + валидатор | ✅ | ⚠️ | ToDo §2 |
| 18 | Window Arranger cross-platform | ✅ | ⚠️ (Windows-only) | ToDo §4 |
| 19 | Migration Wizard (AdsPower) | ❌ заморожено | ❌ | ToDo §5 |
| 20 | Cloud Sync | ❌ заморожено | ❌ | ToDo §6 |
| 21 | Multi-Control v0.13.0 | ✅ | ✅ | — |
| 22 | Fingerprint Generator | ✅ | ✅ | — |
| 23 | Proxy Manager + ротация | ✅ | ✅ | — |
| 24 | Extensions Manager | ✅ | ✅ | — |
| 25 | Anti-Zombie процесс-контроль | ✅ | ✅ | — |
| 26 | Очистка кэша | ✅ | ✅ | — |
| 27 | i18n / Темизация / Tray / Auto-update | ✅ | ✅ | — |
| 28 | Порт через env `PORT` (не `--port`) | ⚠️ док | ✅ факт | Ф4 док. |

-------------------------------
