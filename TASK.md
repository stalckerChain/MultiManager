# TASK: Расширение БД + Crypto-модуль + GUI (ProfileModal)

> **Фазы:** MultiManager Ф1 + Ф2 + Ф5 (вертикальный срез)
> **Описание:** Первая реализационная задача. Добавление новых колонок в БД (timezone, email, Twitter, Discord, Web3), реализация AES-256-GCM шифрования, и расширение GUI модалки профиля для работы с новыми полями.
> **Цель:** После выполнения — пользователь может создавать профили с почтой, соцсетями и кошельками; секреты шифруются в БД и отображаются в интерфейсе.

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

### 2. Crypto-модуль AES-256-GCM (`src/crypto/index.js`) — НОВЫЙ ФАЙЛ

**Что делаем:**
- Создать модуль `src/crypto/index.js` с функциями:
  - `initMasterKey()` — проверить наличие мастер-ключа в OS Keyring / system_config. Если нет — сгенерировать случайный 256-бит ключ и сохранить.
  - `getMasterKey()` → Buffer (ключ в RAM).
  - `encrypt(plaintext) → string` — формат `aes-256-gcm:<iv_hex>:<ciphertext_hex>:<tag_hex>`.
  - `decrypt(blob) → string` — парсит формат, расшифровывает через AES-256-GCM.
  - `hasEncryption() → boolean` — проверяет, есть ли мастер-ключ.
  - `isEncrypted(value) → boolean` — проверяет префикс `aes-256-gcm:`.
- **OS Keyring (дефолт):**
  - Windows: `reg.exe ADD HKCU\Software\CloakManager /v MasterKey /t REG_SZ /d {hex_key}`
  - macOS: `security add-generic-password -a CloakManager -s MasterKey -w {hex_key}`
  - Linux: `secret-tool store --label=MultiManager application CloakManager masterkey {hex_key}`
  - Фоллбэк при ошибке Keyring: сохранить в `system_config` (менее безопасно, но работает).
- **Recovery-key:** при первой инициализации вывести в logger.info() (одноразово). Пользователь записывает вручную.

**Зависимости:** только встроенный `crypto` модуль Node.js (добавлять npm-пакеты НЕ нужно).

**Файлы:** `src/crypto/index.js` (новый)

**Проверка:** написать unit-тест `tests/unit/crypto.test.js` (encrypt → decrypt roundtrip, isEncrypted, формат).

### 3. Queries: прозрачное шифрование (`src/db/queries.js`)

**Что делаем:**
- Список шифруемых колонок: `['email_password', 'twitter_password', 'twitter_auth_token', 'discord_password', 'discord_token', 'wallet_password']`.
- `createProfileQueries(db)`:
  - Обновить `create(data)`: для шифруемых полей — вызвать `encrypt(value)` перед INSERT.
  - Обновить `getById()` / `getAll()`: для шифруемых полей — вызвать `decrypt(value)` после SELECT.
  - Добавить методы для новых полей (timezone, email, wallet_evm_address и т.д.) в UPDATE-запросы.
- `PUT /api/profiles/:id`: при PATCH/PUT — шифровать шифруемые поля перед UPDATE.
- Если `crypto.hasEncryption()` === false (мастер-ключ не инициализирован) — писать в cleartext с logger.warn() (обратная совместимость при первом старте).

**Файлы:** `src/db/queries.js`

**Проверка:** `npm test` — существующие тесты не должны сломаться (новые поля читаются как null/пустые, шифрование только при записи новых данных).

### 4. API: новые поля в Profile endpoints (`src/api/profiles.js`)

**Что делаем:**
- `POST /api/profiles` — принять новые поля из `req.body` (email, twitter_*, discord_*, wallet_*).
- `PUT /api/profiles/:id` — принять и обновить новые поля. Генерация fingerprint при смене platform — уже реализована.
- `GET /api/profiles` и `GET /api/profiles/:id` — вернуть все поля (расшифрованные через queries.js).

**Файлы:** `src/api/profiles.js`

### 5. GUI: ProfileModal — новые вкладки (`gui/src/renderer/views/ProfileModal.vue`)

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

### 6. GUI: i18n ключи (`gui/src/renderer/i18n/ru.json`, `en.json`, `zh.json`)

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
| `src/crypto/index.js` | Создать (AES-256-GCM модуль) |
| `src/db/queries.js` | Изменить (прозрачное шифрование + новые поля) |
| `src/db/index.js` | Изменить (import crypto для init) |
| `src/index.js` | Изменить (initMasterKey при старте) |
| `src/api/profiles.js` | Изменить (новые поля в POST/PUT) |
| `gui/src/renderer/views/ProfileModal.vue` | Изменить (вкладки Аккаунты + Кошельки + timezone) |
| `gui/src/renderer/i18n/ru.json` | Изменить (новые ключи) |
| `gui/src/renderer/i18n/en.json` | Изменить (новые ключи) |
| `gui/src/renderer/i18n/zh.json` | Изменить (новые ключи) |
| `tests/unit/crypto.test.js` | Создать (тесты шифрования) |

---

## Порядок реализации

1. **Schema** → запуск тестов (убедиться что ничего не сломалось)
2. **Crypto** → unit-тесты
3. **Queries** → шифрование при чтении/записи
4. **API** → POST/PUT/GET новых полей
5. **GUI ProfileModal** → вкладки + i18n
6. **Коммит + ручное тестирование в dev-режиме**

---

## Не делаем в рамках этой задачи

- ❌ `/api/internal/profiles` endpoint (Ф4)
- ❌ `/api/browser/:id/type` и `/api/browser/:id/zerion-login` (Ф4)
- ❌ `POST /api/tasks/:id/run` (Ф4)
- ❌ Hot Backup + Rolling (Ф3)
- ❌ Исправление ws_endpoint (Ф4)
- ❌ Экран Tasks Manager (Ф5)
- ❌ Встроенный терминал (Ф6)
- ❌ Рефакторинг stAuto0 (ФА–ФД)
