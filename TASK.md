# ✅ TASK: Расширение БД + GUI (ProfileModal) — ВЫПОЛНЕНО

> **Статус:** ✅ Реализовано
> **Фазы:** MultiManager Ф1 + Ф5 (ProfileModal)
> **Дата:** 2026-07-07

---

## Контекст

MultiManager v1.0.0 имеет 16 колонок в таблице `profiles` и модалку с вкладками «Основные» / «Прокси» / «Дополнительно». Web3-автоматизация (stAuto0) требует полей для email, X/Twitter, Discord, кошельков и таймзоны.

**Ключевое архитектурное решение:** приватные ключи кошельков в БД **НЕ хранятся** (только публичные адреса + зашифрованный пароль). Сиды — только во временном файле stAuto0.

---

## Задачи

### 1. Schema: новые колонки + таблицы (`src/db/schema.js`)

**Что делаем:**
- Добавить колонки в `profiles` (ALTER TABLE для существующих БД + CREATE для новых):
  - `timezone TEXT DEFAULT 'Asia/Bishkek'`
  - `email TEXT`
  - `email_password TEXT`
  - `twitter_username TEXT`
  - `twitter_password TEXT`
  - `twitter_auth_token TEXT`
  - `twitter_email TEXT`
  - `discord_username TEXT`
  - `discord_password TEXT`
  - `discord_token TEXT`
  - `discord_email TEXT`
  - `wallet_evm_address TEXT`
  - `wallet_sol_address TEXT`
  - `wallet_password TEXT DEFAULT 'asdfj*KK'`
- Добавить новые таблицы:
  - `tasks`: id (UUID), name, script_name, schedule_type, cron_expression, params (JSON), is_active, created_at, updated_at
  - `task_executions`: id (AUTO PK), task_id (FK), profile_id (FK), status, exit_code, last_run_at, log_file_path
- Добавить индексы и триггеры `updated_at` для новых таблиц
- Реализовать блок миграций: при инициализации БД проверить наличие колонки (через `PRAGMA table_info`) и добавить недостающие через `ALTER TABLE ADD COLUMN IF NOT EXISTS` (SQLite 3.35+)

**Файлы:** `src/db/schema.js`

**Проверка:** `npm test` — существующие тесты не должны сломаться (новые колонки имеют дефолты).

### 2. Queries: новые поля в CRUD (`src/db/queries.js`)

**Что делаем:**
- Добавить новые поля (timezone, email, twitter_*, discord_*, wallet_*) во все CRUD-запросы:
  - `create(data)`: включить новые поля в INSERT.
  - `getById()` / `getAll()`: включить новые поля в SELECT (plaintext).
  - `update(id, data)`: включить новые поля в UPDATE.
- `PUT /api/profiles/:id`: передавать новые поля в update() без шифрования.

**Файлы:** `src/db/queries.js`

**Проверка:** `npm test` — существующие тесты не должны сломаться (новые поля читаются как null/пустые).

### 3. API: новые поля в Profile endpoints (`src/api/profiles.js`)

**Что делаем:**
- `POST /api/profiles` — принять новые поля из `req.body` (email, twitter_*, discord_*, wallet_*).
- `PUT /api/profiles/:id` — принять и обновить новые поля. Генерация fingerprint при смене platform — уже реализована.
- `GET /api/profiles` и `GET /api/profiles/:id` — вернуть все поля (расшифрованные через queries.js).

**Файлы:** `src/api/profiles.js`

### 4. GUI: ProfileModal — новые вкладки (`gui/src/renderer/views/ProfileModal.vue`)

**Что делаем:**
- Добавить вкладку **«Аккаунты»** (tab key="accounts"):
  - `email` — текстовое поле
  - `email_password` — текстовое поле с кнопкой 👁 показать/скрыть
  - Блок **X / Twitter**:
    - `twitter_username`, `twitter_email`, `twitter_password` (показать/скрыть), `twitter_auth_token` (показать/скрыть)
  - Блок **Discord**:
    - `discord_username`, `discord_email`, `discord_password` (показать/скрыть), `discord_token` (показать/скрыть)
- Добавить вкладку **«Кошельки»** (tab key="wallets"):
  - `wallet_evm_address` — read-only (генерируется Wallet Factory), копируемое
  - `wallet_sol_address` — read-only, копируемое
  - `wallet_password` — текстовое поле с кнопкой показать/скрыть
- Добавить поле **`timezone`** во вкладку «Основные» (select из common tz: Asia/Bishkek, Asia/Tokyo, Europe/Berlin, Europe/London, America/New_York, UTC — предзаполненный список).
- Обновить `form` reactive: добавить новые поля с дефолтами.
- Обновить `watch(() => props.profile)` — читать новые поля из профиля.
- В `handleOk()` — эмитить `{ ...form }` со всеми новыми полями.

**Файлы:** `gui/src/renderer/views/ProfileModal.vue`

### 5. GUI: i18n ключи (`gui/src/renderer/i18n/ru.json`, `en.json`, `zh.json`)

**Что делаем:**
- Добавить ключи для новых полей:
  - `profiles.modal.accounts`, `profiles.modal.wallets`
  - `profiles.modal.email`, `profiles.modal.emailPassword`
  - `profiles.modal.twitterUsername`, `profiles.modal.twitterPassword`, `profiles.modal.twitterAuthToken`, `profiles.modal.twitterEmail`
  - `profiles.modal.discordUsername`, `profiles.modal.discordPassword`, `profiles.modal.discordToken`, `profiles.modal.discordEmail`
  - `profiles.modal.walletEvmAddress`, `profiles.modal.walletSolAddress`, `profiles.modal.walletPassword`
  - `profiles.modal.timezone`

**Файлы:** `gui/src/renderer/i18n/ru.json`, `en.json`, `zh.json`

---

## Файловый清单

| Файл | Действие |
|------|----------|
| `src/db/schema.js` | Изменить (новые колонки + таблицы + миграция) |
| `src/db/queries.js` | Изменить (новые поля в CRUD) |
| `src/db/index.js` | Изменить (import схемы) |
| `src/index.js` | Изменить (init DB) |
| `src/api/profiles.js` | Изменить (новые поля в POST/PUT) |
| `gui/src/renderer/views/ProfileModal.vue` | Изменить (вкладки Аккаунты + Кошельки + timezone) |
| `gui/src/renderer/i18n/ru.json` | Изменить (новые ключи) |
| `gui/src/renderer/i18n/en.json` | Изменить (новые ключи) |
| `gui/src/renderer/i18n/zh.json` | Изменить (новые ключи) |

---

## Порядок реализации

1. **Schema** → запуск тестов (убедиться что ничего не сломалось)
2. **Queries** → новые поля в CRUD
3. **API** → POST/PUT/GET новых полей
4. **GUI ProfileModal** → вкладки + i18n
5. **Коммит + ручное тестирование в dev-режиме**

---

## Не делаем в рамках этой задачи

- ❌ Crypto-модуль AES-256-GCM (вынесено в ToDo.md §7.2 — Ф2)
- ❌ `/api/internal/profiles` endpoint (Ф4)
- ❌ `/api/browser/:id/type` и `/api/browser/:id/zerion-login` (Ф4)
- ❌ `POST /api/tasks/:id/run` (Ф4)
- ❌ Hot Backup + Rolling (Ф3)
- ❌ Исправление ws_endpoint (Ф4)
- ❌ Экран Tasks Manager (Ф5)
- ❌ Встроенный терминал (Ф6)
- ❌ Рефакторинг stAuto0 (ФА–ФД)
