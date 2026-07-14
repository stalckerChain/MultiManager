-------------------------------
## SOFTWARE REQUIREMENTS SPECIFICATION (SRS) / ТЕХНИЧЕСКОЕ ЗАДАНИЕ
## AI-Driven Web Automation Platform на базе антидетект-браузера (MVP аналог AdsPower + ферма автоматизации)
**Версия системы:** 2.0.0 | **Multi-Control:** 0.13.0 | **Дата ревизии:** 2026-07-13 | **Ф7 Automation Matrix:** ✅

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

**Тестирование:** Vitest (unit + integration), 563 теста (31 файл). ✅ `tests/`, `vitest.config.js`

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

### 3.3. Новые таблицы Automation Matrix ✅ (Roadmap Ф7)

**`projects`** — проекты/скрипты из stAuto0:
| Колонка | Тип | Назначение |
|---------|-----|-----------|
| `name` | TEXT PK | Имя файла без .py (concrete, allscale...) |
| `display_name` | TEXT | Человеческое название (Concrete Points) |
| `module_path` | TEXT | Путь модуля для динамического импорта |
| `class_name` | TEXT | Имя класса Python |
| `is_active` | INTEGER | 1/0 — возможность временно отключить проект |
| `default_config` | TEXT JSON | Параметры по умолчанию (referral_codes и т.д.) |
| `created_at`, `updated_at` | DATETIME | |

Синхронизируются из `{stAuto0_path}/projects/*.py` + `{stAuto0_path}/config/projects.py` через `POST /api/projects/sync`. На GET `/api/matrix` проекты читаются напрямую из `config/projects.py` (только `PROJECT_STATUS == "active"`), что гарантирует актуальность данных без предварительной синхронизации. `PROJECT_FLAGS.accounts` определяет допустимые диапазоны профилей для каждого проекта.

**`project_profile_config`** — матрица отметок Проекты×Профили:
| Колонка | Тип | Назначение |
|---------|-----|-----------|
| `project_name` | TEXT FK → projects(name) | |
| `profile_id` | TEXT FK → profiles(id) | |
| `is_enabled` | INTEGER | 0/1 — чекбокс в матрице |
| `config_override` | TEXT JSON | Переопределение параметров для конкретной пары |

**`runs`** — групповая задача (batch запуск):
| Колонка | Тип | Назначение |
|---------|-----|-----------|
| `id` | TEXT UUIDv4 PK | |
| `name` | TEXT | Имя запуска |
| `status` | TEXT | pending \| running \| completed \| partial \| cancelled |
| `parallel_limit` | INTEGER | Максимум одновременных аккаунтов |
| `total_tasks` | INTEGER | Всего клеток в этом run |
| `completed_tasks` | INTEGER | Выполнено |
| `success_tasks` / `failed_tasks` | INTEGER | Успешно / с ошибками |
| `started_at`, `completed_at`, `created_at` | DATETIME | |

**`run_tasks`** — каждая клетка матрицы в рамках конкретного run:
| Колонка | Тип | Назначение |
|---------|-----|-----------|
| `id` | INTEGER PK AUTOINCREMENT | |
| `run_id` | TEXT FK → runs(id) | |
| `project_name` | TEXT FK → projects(name) | |
| `profile_id` | TEXT FK → profiles(id) | |
| `status` | TEXT | pending \| running \| success \| failed |
| `exit_code` | INTEGER | Код выхода Python |
| `log_file_path` | TEXT | Путь к логу |
| `attempts` | INTEGER | Сколько попыток заняло |
| `started_at`, `completed_at` | DATETIME | |

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
| `/api/profiles/batch` | POST | Массовый импорт для Wallet Factory (1 транзакция вместо N запросов). Тело `{accounts: [...]}`. | ✅ `src/api/profiles.js:24-81` |

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

### 4.16. Endpoints Automation Matrix ✅ (Roadmap Ф7)

| Endpoint | Метод | Назначение |
|----------|-------|-----------|
| `/api/projects` | GET | Список проектов из БД |
| `/api/projects/sync` | POST | Сканировать `stAuto0/projects/*.py` + `config/projects.py`, обновить БД |
| `/api/projects/:name` | PUT | Обновить настройки проекта |
| `/api/matrix` | GET | Вся матрица: проекты читаются напрямую из `stAuto0/config/projects.py` (только active), профили из БД, отметки из `project_profile_config` |
| `/api/matrix` | PUT | Batch-обновление чекбоксов |
| `/api/runs` | GET | Список запусков (пагинация) |
| `/api/runs` | POST | Создать новый run из текущих отметок |
| `/api/runs/:id` | GET | Run + run_tasks (цветная матрица) |
| `/api/runs/:id/start` | POST | Запустить выполнение |
| `/api/runs/:id/cancel` | POST | Отменить выполнение |
| `/api/internal/runs/:id/task-status` | POST | Callback от stAuto0 — обновить статус клетки |

-------------------------------
## 5. Стратегия логирования ✅ РЕАЛИЗОВАНО
- **Системный лог `logs/core.log`:** запуск API, ошибки SQLite, генерация токенов, общие сбои. Dev → pino-pretty. ✅ `src/logger/index.js`
- **Лог профиля `logs/profile_[ID].log`:** изолированный файл (ротация прокси, Proxy Checker, ошибки запуска, сессии автоматизации). Запись синхронная (`pino.destination({ sync: true })`) — гарантированный сброс на диск без задержек. ✅ `src/api/browser.js:10` (`createProfileLogger`)
- **Лог run** (✅ Roadmap Ф7): `logs/runs/{run_id}/{profile_name}.log` — stdout/stderr spawn'нутого Python для Automation Matrix. Путь пишется в `run_tasks.log_file_path`.

-------------------------------
## 6. Стратегия тестирования ✅ РЕАЛИЗОВАНО
Фреймворк **Vitest v3.x**, 563 теста (31 файл). Запуск: `npm test`, `npm run test:watch`.

**Unit (24 файла):** парсеры прокси/куки, fingerprint, auth middleware, расширения, CDP Manager, Multi-Control, Window Arranger, Human-like Typing, backup, crypto.

**Integration (5 файлов):** SQLite WAL (параллельная запись), API endpoints, lifecycle профиля, Proxy Checker, extensions.

**К новым тестам:** crypto (encrypt/decrypt/rotate) — ✅, backup (rolling cleanup) — ✅, `/api/internal/profiles` range-parsing — ✅, `zerion-login` с моком CDP — в работе.

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

### 9.7. Встроенный терминал (xterm.js + child_process) ✅ РЕАЛИЗОВАНО (Roadmap Ф6)
> **Компонент:** `gui/src/renderer/components/Terminal.vue` (xterm.js renderer).
> **Бэкенд:** `gui/src/main/pty.js` — IPC-модуль на child_process.spawn (powershell Get-Content -Wait на Windows, tail -f на Linux/macOS).
> **Интеграция:** Расположен над LogPanel в Layout.vue. Поле ввода пути к файлу + кнопки Tail/Stop.
> **Зависимости:** xterm ^5.3.0, xterm-addon-fit ^0.8.0 (без node-pty — используется нативный child_process).
> **Тесты:** `tests/unit/pty.test.js` (4 теста: экспорт, ошибка несуществующего файла, успешный запуск, безопасный stop).

### 9.9. Локализация (i18n) ✅ РЕАЛИЗОВАНО
- i18next, English (default) / Русский / 简体中文. Ключи `t('...')`. Выбор сохраняется в SQLite. ✅ `gui/src/renderer/i18n/`
- Коды ошибок бэкенда (`ERR_PROXY_REFUSED`) локализуются на фронтенде.

### 9.10. Automation Matrix ✅ (Roadmap Ф7)
- **Матрица** (`AutomationMatrix.vue`): таблица Проекты (колонки) × Профили (строки) с чекбоксами на пересечениях. Проекты загружаются из `stAuto0/config/projects.py` (только active). Чекбоксы ограничены `allowed_profile_ids` из `PROJECT_FLAGS.accounts`. Фильтр профилей. Кнопка «Создать задачу» → создаёт run.
- **Задачи** (`AutomationRuns.vue`): список созданных runs со статусами. Раскрываемая цветная матрица: ⚪=pending, 🔵=running, 🟢=success, 🔴=failed. Кнопки «Выполнить» и «Отмена».
- **История** (`AutomationHistory.vue`): выполненные runs с ленивой подгрузкой (infinite scroll/pagination).
- Pinia store: `stores/automation.js` — fetchMatrix, updateMatrix, createRun, startRun, fetchRuns, fetchRun.

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
| **Ф1** | **✅ Расширение БД:** `timezone`, новые колонки `profiles`. Миграция `ALTER TABLE`. | `src/db/schema.js`, `src/db/queries.js` | — |
| **Ф2** | **✅ Crypto-модуль AES-256-GCM + гибрид мастер-ключа (Keyring/PBKDF2/recovery) + авто-логин Zerion.** | `src/crypto/index.js`, `src/db/queries.js`, `src/api/browser.js`, `src/api/settings.js`, `src/api/internal.js`, `gui/.../Settings.vue` | Ф1 |
| **Ф3** | **✅ Backup Hot Backup + Rolling 7д.** | `src/backup/index.js`, `src/index.js`, `tests/unit/backup.test.js` | — |
| **Ф4** | **✅ Все endpoints:** `/api/browser/:id/type`, `/api/profiles/batch`, `ws_endpoint`, `/api/internal/profiles`, `/api/browser/:id/zerion-login`. | `src/api/browser.js`, `src/api/profiles.js`, `src/api/internal.js` | Ф1, Ф2 |
| **Ф5** | **✅ ProfileModal** вкладки (Аккаунты + Кошельки). **✅ Settings** crypto/automation. | `gui/src/renderer/views/ProfileModal.vue`, `gui/src/renderer/views/Settings.vue` | Ф1, Ф2, Ф4 |
| **Ф6** | **✅ Терминал xterm.js + child_process.** | `gui/package.json`, `gui/src/main/pty.js`, `gui/src/renderer/components/Terminal.vue`, `tests/unit/pty.test.js` | Ф4 |
| **Ф7** | **✅ Automation Matrix:** Проекты, Матрица, Runs, RunExecutor. Новые таблицы `projects`, `project_profile_config`, `runs`, `run_tasks`. Endpoints `/api/projects`, `/api/matrix`, `/api/runs`. GUI: 3 страницы (Матрица, Задачи, История). stAuto0: `run()` → bool, `--run-id`, callback статуса. Параллельный spawn с лимитом. | `src/db/schema.js`, `src/db/queries.js`, `src/api/projects.js`, `src/api/matrix.js`, `src/api/runs.js`, `src/api/internal-runs.js`, `src/executor/index.js`, `gui/.../AutomationMatrix.vue`, `gui/.../AutomationRuns.vue`, `gui/.../AutomationHistory.vue`, `gui/.../stores/automation.js` + stAuto0: `base.py`, `browser.py`, `multimanager.py`, `main.py` | Ф4, Ф5, Ф6 |

> **Параллельный трек (TS_INTEGRATION.md):** миграция stAuto0 идёт фазами ФА–ФД и стыкуется с MultiManager Ф1–Ф4 (API-контракт).

-------------------------------
## 12. Сводная таблица статусов (аудит 2026-07-13, Ф7 ✅)

| # | Фича | В ТЗ | В коде | Приоритет |
|---|------|------|--------|-----------|
| 1 | БД: 30 колонок profiles | ✅ | ✅ `schema.js` | — |
| 2 | БД: новые колонки v1.1.0 | ✅ | ✅ `schema.js:50-63` | Ф1 ✅ |
| 3 | Timezone в профиле | ✅ | ✅ `schema.js:47` | Ф1 ✅ |
| 4 | Шифрование AES-256-GCM | ✅ | ✅ `src/crypto/index.js` | Ф2 ✅ |
| 5 | Hot Backup + Rolling | ✅ | ✅ `src/backup/index.js` | Ф3 ✅ |
| 6 | `/api/internal/profiles?range=` | ✅ | ✅ `src/api/internal.js` | Ф4 ✅ |
| 7 | Human-like Typing endpoint | ✅ | ✅ `src/api/browser.js:587-630` | Ф4 ✅ |
| 8 | Авто-логин Zerion по CDP | ✅ | ✅ `src/api/browser.js` | Ф2/Ф4 ✅ |
| 9 | `POST /api/profiles/batch` | ✅ | ✅ `src/api/profiles.js:24-81` | Ф4 ✅ |
| 10 | Исправление `ws_endpoint` | ✅ | ✅ `src/api/browser.js:377-419` | Ф4 ✅ |
| 11 | ProfileModal вкладки (акки/кошельки) | ✅ | ✅ `gui/.../AccountsTab.vue`, `WalletsTab.vue` | Ф5 ✅ |
| 12 | Встроенный терминал | ✅ | ✅ `gui/.../pty.js`, `Terminal.vue` | Ф6 ✅ |
| 13 | Settings: crypto + automation | ✅ | ✅ `gui/.../Settings.vue`, `src/api/settings.js` | Ф5 ✅ |
| 14 | БД: таблицы projects/project_profile_config/runs/run_tasks | ✅ | ✅ `schema.js` | Ф7 ✅ |
| 15 | `/api/projects` (CRUD + sync) | ✅ | ✅ `src/api/projects.js` | Ф7 ✅ |
| 16 | `/api/matrix` (GET + PUT) | ✅ | ✅ `src/api/matrix.js` | Ф7 ✅ |
| 17 | `/api/runs` (CRUD + start/cancel) | ✅ | ✅ `src/api/runs.js` | Ф7 ✅ |
| 18 | `/api/internal/runs/:id/task-status` | ✅ | ✅ `src/api/internal-runs.js` | Ф7 ✅ |
| 19 | RunExecutor (parallel spawn) | ✅ | ✅ `src/executor/index.js` | Ф7 ✅ |
| 20 | GUI: Automation Matrix / Runs / History | ✅ | ✅ `gui/.../Automation*.vue`, `stores/automation.js` | Ф7 ✅ |
| 21 | stAuto0: run()→bool, --run-id, callback | ✅ | ✅ внешний репо stAuto0 | Ф7 ✅ |
| 22 | Cookie drag-and-drop + валидатор | ✅ | ⚠️ | ToDo §2 |
| 23 | Window Arranger cross-platform | ✅ | ⚠️ (Windows-only) | ToDo §4 |
| 24 | Migration Wizard (AdsPower) | ❌ заморожено | ❌ | ToDo §5 |
| 25 | Cloud Sync | ❌ заморожено | ❌ | ToDo §6 |
| 26 | Multi-Control v0.13.0 | ✅ | ✅ | — |
| 27 | Fingerprint Generator | ✅ | ✅ | — |
| 28 | Proxy Manager + ротация | ✅ | ✅ | — |
| 29 | Extensions Manager | ✅ | ✅ | — |
| 30 | Anti-Zombie процесс-контроль | ✅ | ✅ | — |
| 31 | Очистка кэша | ✅ | ✅ | — |
| 32 | i18n / Темизация / Tray / Auto-update | ✅ | ✅ | — |
| 33 | Порт через env `PORT` (не `--port`) | ⚠️ док | ✅ факт | Ф4 док. |

-------------------------------
