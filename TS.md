-------------------------------
## SOFTWARE REQUIREMENTS SPECIFICATION (SRS) / ТЕХНИЧЕСКОЕ ЗАДАНИЕ
## AI-Driven Web Automation Platform на базе антидетект-браузера (MVP аналог AdsPower + ферма автоматизации)
**Версия системы:** 1.2.1 | **Multi-Control:** 0.13.0 | **Дата ревизии:** 2026-07-08 | **Ф6:** 2026-07-08 ✅

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

**Тестирование:** Vitest (unit + integration), 558 тестов (30 файлов). ✅ `tests/`, `vitest.config.js`

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

**`profiles` (30 колонок, всё ✅):** `id` (UUIDv4 PK), `number`, `name`, `proxy_id` FK, `fingerprint_seed`, `platform`, `user_agent`, `screen_resolution`, `hardware_cores`, `hardware_memory`, `extensions` (JSON), `tags` (JSON), `notes`, `status` (stopped|starting|running), `pid`, `timezone`, `email`, `email_password`, `twitter_username`, `twitter_password`, `twitter_auth_token`, `twitter_email`, `discord_username`, `discord_password`, `discord_token`, `discord_email`, `wallet_evm_address`, `wallet_sol_address`, `wallet_password`, `created_at`, `updated_at`.

### 3.2. Расширение схемы v1.1.0 ✅ РЕАЛИЗОВАНО (Roadmap Ф1)

**Новые колонки таблицы `profiles`:**
| Колонка | Тип | Назначение |
|---------|-----|-----------|
| `timezone` | TEXT DEFAULT 'Asia/Bishkek' | Прокидывается через CDP `Emulation.setTimezoneOverride` при старте |
| `email` | TEXT | Email аккаунта |
| `email_password` | TEXT | Пароль почты (см. ToDo.md §7.2 — шифрование) |
| `twitter_username` | TEXT | Логин X/Twitter |
| `twitter_password` | TEXT | Пароль X (см. ToDo.md §7.2) |
| `twitter_auth_token` | TEXT | Auth token X (см. ToDo.md §7.2) |
| `twitter_email` | TEXT | Email X |
| `discord_username` | TEXT | Логин Discord |
| `discord_password` | TEXT | Пароль Discord (см. ToDo.md §7.2) |
| `discord_token` | TEXT | Token Discord (см. ToDo.md §7.2) |
| `discord_email` | TEXT | Email Discord |
| `wallet_evm_address` | TEXT | EVM-адрес (публичный) |
| `wallet_sol_address` | TEXT | Solana-адрес (публичный) |
| `wallet_password` | TEXT | Пароль расширения Zerion, default 'asdfj*KK' (см. ToDo.md §7.2) |

> **🛑 КРИТИЧНОЕ РЕШЕНИЕ:** приватных ключей (`wallet_evm_private`, `wallet_sol_private`) **В СХЕМЕ НЕТ**. Сид-фразы хранятся только во временном файле `config/auto_sids.py` и уничтожаются после инициализации (см. TS_INTEGRATION.md §5). Recovery кошелька по базе невозможен по дизайну — это сознательный параноидальный выбор.

**Миграция:** через `ALTER TABLE ADD COLUMN` — реализована в `src/db/schema.js:migrateTables()`. При инициализации БД проверяет `PRAGMA table_info` и добавляет недостающие колонки.

### 3.3. Новые таблицы планировщика ✅ РЕАЛИЗОВАНО (Roadmap Ф1)

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
- **Дедупликация:** при добавлении одиночного или массового импорта прокси проверяется уникальность по `host:port`. Дубликаты отбрасываются с сообщением в ответе (`duplicate_count`, `duplicates`). ✅ `src/api/proxies.js`, `src/db/queries.js`, `gui/src/api/proxies.js`, `gui/src/db/queries.js`
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

### 4.5. Human-like Typing (для ИИ-агента) ✅ РЕАЛИЗОВАНО
- Функция `humanType(cdp, text)` есть: задержки 50–150 мс, 3% опечаток с Backspace. ✅ `src/typing/index.js`
- **HTTP endpoint:** `POST /api/browser/:id/type {text}` — обёртка, открывающая CDP-сессию и вызывающая `humanType()`. ✅ `src/api/browser.js:587-630

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

### 4.10. Hot Backup + Rolling Window ✅ РЕАЛИЗОВАНО (Roadmap Ф3)

**Реализация:**
- `src/backup/index.js`: метод `db.backup()` библиотеки better-sqlite3 (асинхронный, копирование на лету, исключает повреждение WAL). ✅ `src/backup/index.js`
- Триггер: холодный старт приложения, сразу после `initDatabase()` в `src/index.js:20`. ✅ `src/index.js:20`
- Бэкапится **только** `app.db`. Папки кэша браузеров полностью игнорируются.
- Ротация Rolling Window: дампы в `backups/app_YYYYMMDD_HHmmss.db` старше 7 дней (168 ч) удаляются по `mtime`.
- Папка `backups/` создаётся в директории приложения (рядом с `app.db`).
- 8 unit-тестов: проверка создания, валидности SQLite, ротации, игнорирования посторонних файлов. ✅ `tests/unit/backup.test.js`

### 4.11. Шифрование AES-256-GCM секретов ✅ РЕАЛИЗОВАНО (Roadmap Ф2)

> **Синхронизация с TS_ADDON §2:** AES-256-GCM для приватников реализован в полном объёме.

**Реализация:**

**Мастер-ключ — гибрид (решение #6):**
1. **Дефолт: OS Keyring** (`keytar`). Случайный 256-бит ключ генерируется 1 раз при первом старте, сохраняется в Windows Credential Manager (win32) / macOS Keychain (darwin) / libsecret/Secret Service (linux). ✅ `src/crypto/index.js:initMasterKey()`
2. **Фоллбэк: system_config** — если keytar недоступен, ключ хранится в `system_config` таблице БД. ✅ `src/crypto/index.js`
3. **Опция: Мастер-пароль.** В Settings пользователь задаёт пароль → PBKDF2 (210000 итераций, SHA-256, salt из system_config) → ключ в RAM на время сессии. ✅ `src/api/settings.js:set-master-password`, `gui/.../Settings.vue`
4. **Recovery-key.** Показывается 1 раз в Settings. ✅ `src/api/settings.js:recovery-key`, `gui/.../Settings.vue`

**Шифруемые колонки:** `email_password`, `twitter_password`, `twitter_auth_token`, `discord_password`, `discord_token`, `wallet_password`.

**Формат хранения:** `aes-256-gcm:<iv_hex>:<ciphertext_hex>:<tag_hex>` (GCM даёт аутентификацию + целостность).

**Модуль:** `src/crypto/index.js` — функции `encrypt(plaintext)`, `decrypt(blob)`, `rotateKey(oldMaster, newMaster)`, `hasMasterKey()`. Интегрирована в `src/db/queries.js` (прозрачное шифрование при записи, расшифровка при чтении). ✅

> **🛑 Сиды — НИКОГДА в БД и RAM GUI.** Этот инвариант нельзя нарушать шифрованием приватников в БД (см. §3.2): сид-фраза существует только во временном файле stAuto0 и уничтожается.

### 4.12. Endpoints для интеграции со stAuto0 ✅ РЕАЛИЗОВАНО (Roadmap Ф4)

| Endpoint | Метод | Назначение | Статус |
|----------|-------|-----------|--------|
| `/api/internal/profiles` | GET | **Выборка аккаунтов для Python.** Query `?range=001-010` разворачивается в `auto_001..auto_010`. Возвращает массив JSON со всеми Web3-метриками, почтами, соцсетями, прокси (готовая строка `host:port:user:pass`). | ✅ `src/api/internal.js` |
| `/api/browser/:id/type` | POST | Human-like typing через CDP (обёртка над `humanType()`). Тело `{text}`. | ✅ `src/api/browser.js:587-630` |
| `/api/browser/:id/zerion-login` | POST | Авто-логин Zerion (логика перенесена из `stAuto0/Core/browser.py::login_zerion`). | ✅ `src/api/browser.js` |
| `/api/tasks/:id/run` | POST | Триггер внешнего планировщика. | ✅ `src/api/tasks.js` |
| `/api/profiles/batch` | POST | Массовый импорт для Wallet Factory (1 транзакция вместо N запросов). Тело `{accounts: [...]}`. | ✅ `src/api/profiles.js:24-81` |
| `/api/tasks` | CRUD | Управление задачами (UI Tasks Manager). | ✅ `src/api/tasks.js` |

> **`/api/internal/profiles` минует часть шифрования:** Python-агенту нужен cleartext для работы. Этот endpoint защищён тем же Bearer-token, но логируется как `[INTERNAL]` для аудита.

### 4.13. Авто-логин Zerion по CDP ✅ РЕАЛИЗОВАНО (Roadmap Ф2 + Ф4)
> Логика перенесена из Python (`stAuto0/Core/browser.py:348 login_zerion`) в Node.js. Python получает уже залогиненный `ws_endpoint`.

Zerion ID: `klghhnkeealcohjjanjjdaeeggmfmlpl`. Flow:
1. Открыть `chrome-extension://{ZERION_ID}/popup.8e8f209b.html?windowType=dialog#/login` через CDP.
2. `wait_for_selector("input[type='password']", 15000)`.
3. `fill(wallet_password)`, `press("Enter")`.
4. `wait_for_selector("input[type='password']", state="hidden", 10000)`.
Реализован как `POST /api/browser/:id/zerion-login` ✅ `src/api/browser.js`.

### 4.14. Migration Wizard (AdsPower/Dolphin{anty}) ❌ ЗАМОРОЖЕНО
Подробности в [ToDo.md](./ToDo.md) §5.

### 4.15. Cloud Sync ❌ ЗАМОРОЖЕНО
Подробности в [ToDo.md](./ToDo.md) §6.

-------------------------------
## 5. Стратегия логирования ✅ РЕАЛИЗОВАНО
- **Системный лог `logs/core.log`:** запуск API, ошибки SQLite, генерация токенов, общие сбои. Dev → pino-pretty. ✅ `src/logger/index.js`
- **Лог профиля `logs/profile_[ID].log`:** изолированный файл (ротация прокси, Proxy Checker, ошибки запуска, сессии автоматизации). Запись синхронная (`pino.destination({ sync: true })`) — гарантированный сброс на диск без задержек. ✅ `src/api/browser.js:10` (`createProfileLogger`)
- **Лог задачи** (новый ✅ Roadmap Ф4): `logs/task_{task_id}_{timestamp}.log` — stdout/stderr spawn'нутого Python. Путь пишется в `task_executions.log_file_path`. Tail'ится встроенным терминалом GUI (§9.5). API готов, терминал ✅ (Ф6).

-------------------------------
## 6. Стратегия тестирования ✅ РЕАЛИЗОВАНО
Фреймворк **Vitest v3.x**, 558 тестов (30 файлов). Запуск: `npm test`, `npm run test:watch`.

**Unit (24 файла):** парсеры прокси/куки, fingerprint, auth middleware, расширения, CDP Manager, Multi-Control, Window Arranger, Human-like Typing, backup, crypto.

**Integration (5 файлов):** SQLite WAL (параллельная запись), API endpoints, lifecycle профиля, Proxy Checker, extensions.

**К новым тестам:** crypto (encrypt/decrypt/rotate) — ✅, backup (rolling cleanup) — ✅, `/api/internal/profiles` range-parsing — ✅, `tasks` CRUD — ✅, `zerion-login` с моком CDP — в работе.

-------------------------------
## 7. Формат ответа API для ИИ/Python ✅ ИСПРАВЛЕНО (Roadmap Ф4)

**Код** возвращает реальный CDP-порт, захваченный из stderr в `cdpPorts` Map (`src/api/browser.js:344-348`). Ответ содержит discovery-URL:

```json
{
  "status": "success",
  "profile_id": "8f3b201a-...",
  "pid": 14208,
  "cdp_port": 9331,
  "ws_endpoint": "http://127.0.0.1:9331"
}
```

✅ `src/api/browser.js:377-419` — `await waitForCdpPort(req.params.id)` ждёт порт до 15 сек, затем `cdp_port` и `ws_endpoint` формируются из реального порта.

Python: `connect_over_cdp("http://127.0.0.1:9331")`.

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

**Реализовано ✅ (Roadmap Ф5):**
- **Новые вкладки в ProfileModal:**
  - «Аккаунты»: `email`, `email_password`, блоки X/Twitter и Discord (4+4 поля). Пароли маскируются, есть кнопка «показать/скрыть».
  - «Кошельки»: `wallet_evm_address`, `wallet_sol_address` (read-only, копируемые), `wallet_password` (с возможностью смены).
  - Поле `timezone` (select из common tz: Asia/Bishkek, Asia/Tokyo, Europe/Berlin, Europe/London, America/New_York, UTC).

### 9.2. Window Arranger ⚠️ ЧАСТИЧНО (см. §4.7)
### 9.3. Экран «Менеджер прокси» ✅ РЕАЛИЗОВАНО (`gui/src/renderer/views/Proxies.vue`)
### 9.4. Cookie Manager ⚠️ ЧАСТИЧНО (`gui/src/renderer/views/CookieImportModal.vue`)
- Drag-and-drop + пре-валидатор — ❌ (ToDo.md §2).
### 9.5. Extensions Manager ✅ РЕАЛИЗОВАНО (`gui/src/renderer/views/Extensions.vue`)
- На каждой карточке расширения кнопка «Назначить всем профилям» → `POST /api/extensions/:id/assign-all`.

### 9.6. Мониторинг логов и статуса API ✅ РЕАЛИЗОВАНО
- Панель разработчика: бегущая строка core.log. ✅ `gui/src/renderer/components/LogPanel.vue`
- Статус-бар: статус сервера, порт, копирование AUTH_TOKEN. ✅ `gui/src/renderer/components/StatusBar.vue`

### 9.7. Экран «Tasks Manager» (Планировщик) ✅ РЕАЛИЗОВАНО (Roadmap Ф5)
- Таблица задач: name, script_name, schedule_type, is_active, last_run. ✅ `gui/src/renderer/views/Tasks.vue`
- История executions (task_executions): статус, exit_code, время, ссылка на лог. ✅ `gui/src/renderer/views/Tasks.vue`
- Кнопка «Run now» → `POST /api/tasks/:id/run`. ✅ `gui/src/renderer/views/Tasks.vue`
- CRUD задач (создание/редактирование с выбором script_name). ✅ `gui/src/renderer/views/Tasks.vue`
- Pinia store: `stores/tasks.js` c CRUD + run + getExecutions. ✅ `gui/src/renderer/stores/tasks.js`

### 9.8. Встроенный терминал (xterm.js + child_process) ✅ РЕАЛИЗОВАНО (Roadmap Ф6)
> **Компонент:** `gui/src/renderer/components/Terminal.vue` (xterm.js renderer).
> **Бэкенд:** `gui/src/main/pty.js` — IPC-модуль на child_process.spawn (powershell Get-Content -Wait на Windows, tail -f на Linux/macOS).
> **Интеграция:** Расположен над LogPanel в Layout.vue. Поле ввода пути к файлу + кнопки Tail/Stop.
> **Зависимости:** xterm ^5.3.0, xterm-addon-fit ^0.8.0 (без node-pty — используется нативный child_process).
> **Тесты:** `tests/unit/pty.test.js` (4 теста: экспорт, ошибка несуществующего файла, успешный запуск, безопасный stop).

### 9.9. Локализация (i18n) ✅ РЕАЛИЗОВАНО
- i18next, English (default) / Русский / 简体中文. Ключи `t('...')`. Выбор сохраняется в SQLite. ✅ `gui/src/renderer/i18n/`
- Коды ошибок бэкенда (`ERR_PROXY_REFUSED`) локализуются на фронтенде.

## 10. Системная интеграция
### 10.1. Темизация ✅ РЕАЛИЗОВАНО (`gui/src/renderer/composables/useTheme.js`)
### 10.2. Автозапуск Core и конфликты портов ✅ РЕАЛИЗОВАНО (`gui/src/main/core-manager.js:42-49` — инкрементный поиск 3000–3100)
### 10.3. WebSocket Auto-Reconnect ✅ РЕАЛИЗОВАНО (exponential backoff 1→2→4→8 сек)
### 10.4. Системный трей ✅ РЕАЛИЗОВАНО (`gui/src/main/tray.js`)
### 10.5. Автообновление ✅ РЕАЛИЗОВАНО (`gui/src/main/updater.js` — electron-updater + GitHub Releases)

### 10.6. Settings — расширение ✅ РЕАЛИЗОВАНО (Roadmap Ф5)
- Раздел «Безопасность»: toggle мастер-пароль, поле ввода/смены пароля, отображение recovery-key, статус OS Keyring. ✅ `gui/src/renderer/views/Settings.vue`, `src/api/settings.js`
- Раздел «Автоматизация»: путь к stAuto0, выбор Python-интерпретатора, список доступных проектов. ✅ `gui/src/renderer/views/Settings.vue`, `src/api/settings.js`

-------------------------------
## 11. Roadmap реализации (MultiManager-сторона)

| Фаза | Задача | Файлы | Зависимости |
|------|--------|-------|-------------|
| **Ф1** | **✅ Расширение БД:** `timezone`, новые колонки `profiles`, таблицы `tasks`/`task_executions`. Миграция `ALTER TABLE`. | `src/db/schema.js`, `src/db/queries.js` | — |
| **Ф2** | **✅ Crypto-модуль AES-256-GCM + гибрид мастер-ключа (Keyring/PBKDF2/recovery) + авто-логин Zerion.** | `src/crypto/index.js`, `src/db/queries.js`, `src/api/browser.js`, `src/api/settings.js`, `src/api/internal.js`, `src/api/tasks.js`, `gui/.../Settings.vue` | Ф1 |
| **Ф3** | **✅ Backup Hot Backup + Rolling 7д.** | `src/backup/index.js`, `src/index.js`, `tests/unit/backup.test.js` | — |
| **Ф4** | **✅ Все endpoints:** `/api/browser/:id/type`, `/api/profiles/batch`, `ws_endpoint`, `/api/internal/profiles`, `/api/browser/:id/zerion-login`, `/api/tasks/:id/run`, `/api/tasks` CRUD. | `src/api/browser.js`, `src/api/profiles.js`, `src/api/internal.js`, `src/api/tasks.js` | Ф1, Ф2 |
| **Ф5** | **✅ ProfileModal** вкладки (Аккаунты + Кошельки). **✅ Settings** crypto/automation. **✅ Экран Tasks Manager.** | `gui/src/renderer/views/ProfileModal.vue`, `gui/src/renderer/views/Tasks.vue`, `gui/src/renderer/views/Settings.vue` | Ф1, Ф2, Ф4 |
| **Ф6** | **✅ Терминал xterm.js + child_process.** | `gui/package.json`, `gui/src/main/pty.js`, `gui/src/renderer/components/Terminal.vue`, `tests/unit/pty.test.js` | Ф4 |

> **Параллельный трек (TS_INTEGRATION.md):** миграция stAuto0 идёт фазами ФА–ФД и стыкуется с MultiManager Ф1–Ф4 (API-контракт).

-------------------------------
## 12. Сводная таблица статусов (аудит 2026-07-08, Ф3 ✅, Ф6 ✅)

| # | Фича | В ТЗ | В коде | Приоритет |
|---|------|------|--------|-----------|
| 1 | БД: 30 колонок profiles | ✅ | ✅ `schema.js` | — |
| 2 | БД: новые колонки v1.1.0 | ✅ | ✅ `schema.js:50-63` | Ф1 ✅ |
| 3 | БД: таблицы tasks/task_executions | ✅ | ✅ `schema.js:79-100` | Ф1 ✅ |
| 4 | Timezone в профиле | ✅ | ✅ `schema.js:47` | Ф1 ✅ |
| 5 | Шифрование AES-256-GCM | ✅ | ✅ `src/crypto/index.js` | Ф2 ✅ |
| 6 | Hot Backup + Rolling | ✅ | ✅ `src/backup/index.js` | Ф3 ✅ |
| 7 | `/api/internal/profiles?range=` | ✅ | ✅ `src/api/internal.js` | Ф4 ✅ |
| 8 | Human-like Typing endpoint | ✅ | ✅ `src/api/browser.js:587-630` | Ф4 ✅ |
| 9 | Авто-логин Zerion по CDP | ✅ | ✅ `src/api/browser.js` | Ф2/Ф4 ✅ |
| 10 | `POST /api/tasks/:id/run` | ✅ | ✅ `src/api/tasks.js` | Ф4 ✅ |
| 11 | `POST /api/profiles/batch` | ✅ | ✅ `src/api/profiles.js:24-81` | Ф4 ✅ |
| 12 | Исправление `ws_endpoint` | ✅ | ✅ `src/api/browser.js:377-419` | Ф4 ✅ |
| 13 | ProfileModal вкладки (акки/кошельки) | ✅ | ✅ `gui/src/renderer/components/AccountsTab.vue`, `WalletsTab.vue` | Ф5 ✅ |
| 14 | Экран Tasks Manager | ✅ | ✅ `gui/src/renderer/views/Tasks.vue`, `gui/src/renderer/stores/tasks.js` | Ф5 ✅ |
| 15 | Встроенный терминал | ✅ | ✅ `gui/src/main/pty.js`, `gui/src/renderer/components/Terminal.vue` | Ф6 ✅ |
| 16 | Settings: crypto + automation | ✅ | ✅ `gui/src/renderer/views/Settings.vue`, `src/api/settings.js` | Ф5 ✅ |
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
