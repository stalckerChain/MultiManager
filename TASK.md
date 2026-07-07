# TASK: Crypto-модуль AES-256-GCM + авто-логин Zerion (Ф2)

> **Статус:** ❌ В работе
> **Фаза:** MultiManager Ф2
> **Основание:** TS.md §4.11 (шифрование), §4.13 (Zerion), §11 Roadmap Ф2
> **Зависимости:** Ф1 ✅ (схема БД, миграции)

---

## Контекст

Сейчас чувствительные поля (`email_password`, `twitter_password`, `twitter_auth_token`, `discord_password`, `discord_token`, `wallet_password`) хранятся в БД открытым текстом. Ф2 реализует:

1. **Crypto-модуль** (`src/crypto/index.js`) — AES-256-GCM шифрование/расшифровка
2. **Мастер-ключ** — гибрид OS Keyring (keytar) + PBKDF2 мастер-пароль + recovery-key
3. **Интеграция в queries.js** — прозрачное шифрование при записи, расшифровка при чтении
4. **Zerion auto-login** — эндпоинт `/api/browser/:id/zerion-login`

---

## 1. Установка зависимостей

**Пакет:** `keytar` (управление системными ключами OS Keyring)

```bash
npm install keytar
```

> **Note:** `keytar` использует нативные binding'и — требуется build toolchain (на Windows — `windows-build-tools` или VS Build Tools). Если установка падает, альтернатива — использовать `@aspect-build/keytar` (форк) или написать тонкую обёртку через `koffi` (уже в зависимостях) для Win32 `CredWrite`/`CredRead`.

---

## 2. Модуль `src/crypto/index.js`

### 2.1. Константы и imports

```js
const crypto = require('crypto');
const ALGORITHM = 'aes-256-gcm';
const KEY_LENGTH = 32;       // 256 bit
const IV_LENGTH = 16;        // 128 bit
const TAG_LENGTH = 16;       // GCM tag
const PBKDF2_ITERATIONS = 210000;
const PBKDF2_DIGEST = 'sha256';
const PREFIX = 'aes-256-gcm:';
```

### 2.2. Функции

#### `encrypt(plaintext, masterKey)` → `string`
- `masterKey` — Buffer 32 байта
- Генерировать случайный IV (16 байт) через `crypto.randomBytes(IV_LENGTH)`
- Создать cipher: `crypto.createCipheriv(ALGORITHM, masterKey, iv)`
- Зашифровать, получить ciphertext + authTag
- Формат: `aes-256-gcm:<iv_hex>:<ciphertext_hex>:<tag_hex>`
- Если `plaintext` — null/undefined, вернуть null

#### `decrypt(blob, masterKey)` → `string`
- Если `blob` null/undefined/не строка — вернуть null
- Если `blob` не начинается с `PREFIX` — вернуть as-is (обратная совместимость с незашифрованными данными)
- Распарсить компоненты из формата `aes-256-gcm:<iv_hex>:<ciphertext_hex>:<tag_hex>`
- Создать decipher: `crypto.createDecipheriv(ALGORITHM, masterKey, iv)`
- Установить authTag: `decipher.setAuthTag(tag)`
- Расшифровать, вернуть строку

#### `generateMasterKey()` → `Buffer`
- `crypto.randomBytes(KEY_LENGTH)` — 32 случайных байта
- Используется при первом запуске для создания мастер-ключа

#### `deriveKeyFromPassword(password, salt)` → `Buffer`
- `crypto.pbkdf2Sync(password, salt, PBKDF2_ITERATIONS, KEY_LENGTH, PBKDF2_DIGEST)`
- Для режима мастер-пароля (опция)

#### `generateRecoveryKey(masterKey)` → `string`
- Сериализовать мастер-ключ в base64 для показа пользователю 1 раз
- recovery-key позволяет восстановить мастер-ключ при потере keyring/пароля

#### `rotateKey(oldMasterKey, newMasterKey, db, profileQueries)` → `void`
- Прочитать все профили с незашифрованными полями
- Для каждого: расшифровать старым ключом, зашифровать новым, обновить в БД
- Используется при смене мастер-пароля

### 2.3. Менеджер мастер-ключа `MasterKeyManager`

Класс (или набор функций) для управления жизненным циклом мастер-ключа.

#### `initMasterKey()` — инициализация при старте Core

Алгоритм:
1. Проверить `system_config` на наличие `master_key_source`:
   - `'keytar'` — пробуем keytar
   - `'password'` — мастер-пароль (ждём ввода от GUI, пока ключ не загружен — `hasMasterKey()` === false)
   - `'recovery'` — восстановление
   - `null`/отсутствует — первый запуск
2. **Первый запуск:**
   - Сгенерировать `generateMasterKey()`
   - Попробовать сохранить через keytar (`keytar.setPassword('CloakManager', 'master-key', key.toString('hex'))`)
   - Если keytar работает: записать `master_key_source = 'keytar'` в `system_config`
   - Если keytar НЕ работает (ошибка / модуль не найден): записать ключ в `system_config` как `master_key: <hex>` (фоллбэк) + `master_key_source = 'system_config'`
   - Сгенерировать recovery-key, записать в `system_config` как `recovery_key: <base64>` (показывается 1 раз в Settings, потом удаляется)
3. **Keytar mode:**
   - `keytar.getPassword('CloakManager', 'master-key')` → hex → Buffer
4. **System config mode (фоллбэк):**
   - Читаем `master_key` из `system_config`
5. **Режим мастер-пароля:**
   - Ключ не загружен — `hasMasterKey()` возвращает false
   - `unlockWithPassword(password)` — `deriveKeyFromPassword(password, salt)` + сравнение с сохранённым хешем
   - Ключ хранится только в RAM (закрытая переменная модуля)

#### `hasMasterKey()` → `boolean`
- Есть ли мастер-ключ в RAM

#### `getMasterKey()` → `Buffer|null`
- Возвращает ключ или null (если не инициализирован)

#### `changeMasterPassword(oldPassword, newPassword)`
- Сменить мастер-пароль: derive новый ключ, вызвать `rotateKey()`, обновить хеш пароля в `system_config`

---

## 3. Интеграция в `src/db/queries.js`

### 3.1. Поля для шифрования

Список полей, которые нужно шифровать при записи и расшифровывать при чтении:

```js
const SECRET_FIELDS = [
  'email_password',
  'twitter_password',
  'twitter_auth_token',
  'discord_password',
  'discord_token',
  'wallet_password',
];
```

### 3.2. Модификация `create(data)`

Перед `insert.run(...)` — для каждого поля из `SECRET_FIELDS`:

```js
if (data[field]) {
  data[field] = encrypt(data[field], masterKey);
}
```

**Особенность:** `wallet_password` имеет дефолт `'asdfj*KK'` — его тоже шифруем.

### 3.3. Модификация `update(id, data)`

Аналогично create — перед `update.run(...)`:

```js
SECRET_FIELDS.forEach(field => {
  if (data[field] !== undefined && data[field] !== null) {
    data[field] = encrypt(String(data[field]), masterKey);
  }
});
```

### 3.4. Модификация `getById(id)` и `getAll()`

После `SELECT` — расшифровать поля перед возвратом:

```js
function decryptRow(row) {
  if (!row) return row;
  SECRET_FIELDS.forEach(field => {
    if (row[field]) {
      row[field] = decrypt(row[field], masterKey);
    }
  });
  return row;
}
```

Применить в:
- `getById(id)`: `return decryptRow(getById.get(id));`
- `getAll()`: `return getAll.all().map(decryptRow);`
- `getByStatus(status)`: `return getByStatus.all(status).map(decryptRow);`

### 3.5. Подключение мастер-ключа

Функции `encrypt`/`decrypt` нужно импортировать из `src/crypto/index.js` и передавать `masterKey`:

```js
const { encrypt, decrypt, getMasterKey } = require('../crypto');
```

> **Вариант:** Можно сделать `initCrypto(db)` в crypto-модуле, которая загружает ключ, а в queries передавать объект crypto с методами `encryptRow`/`decryptRow`.

---

## 4. API endpoint: `/api/browser/:id/zerion-login` (POST)

### 4.1. Zerion ID и flow

**Extension ID:** `klghhnkeealcohjjanjjdaeeggmfmlpl`

**Flow** (перенести из Python в Node.js):
1. Получить CDP-сессию для запущенного профиля (использовать `createCdpSession(cdpPort)`)
2. Открыть страницу логина Zerion:
   ```
   chrome-extension://klghhnkeealcohjjanjjdaeeggmfmlpl/popup.8e8f209b.html?windowType=dialog#/login
   ```
   Через CDP: `Page.navigate` или `Target.createTarget` с этим URL
3. Дождаться появления `input[type='password']` на странице (waitForSelector, опрос через `Runtime.evaluate`)
4. Ввести `wallet_password` (из профиля, расшифрованный через crypto-модуль)
5. Нажать Enter
6. Дождаться, когда `input[type='password']` исчезнет (успешный логин)
7. Закрыть CDP-сессию
8. Вернуть `{ status: 'success' }`

### 4.2. Файл: `src/api/browser.js`

Новый endpoint после `/type`:

```js
router.post('/:id/zerion-login', async (req, res) => {
  const db = getDatabase();
  const profileQueries = createProfileQueries(db);
  const logQueries = createLogQueries(db);

  const profile = profileQueries.getById(req.params.id);
  if (!profile) return res.status(404).json({ error: 'Профиль не найден' });
  if (profile.status !== 'running') return res.status(409).json({ error: 'Профиль не запущен' });

  const cdpPort = cdpPorts.get(req.params.id);
  if (!cdpPort) return res.status(502).json({ error: 'CDP порт не найден' });

  const walletPassword = profile.wallet_password;
  if (!walletPassword) return res.status(400).json({ error: 'Не задан wallet_password в профиле' });

  // Получить CDP сессию
  const session = await createCdpSession(cdpPort);
  try {
    // Шаг 1: открыть страницу логина Zerion
    // Шаг 2: waitForSelector input[type='password']
    // Шаг 3: ввести пароль через session.send('Runtime.evaluate', ...) или humanType
    // Шаг 4: enter
    // Шаг 5: ждать исчезновения input[type='password']
    // (детальная реализация — в отдельной функции zerionLogin(session, password))
    await zerionLogin(session, walletPassword);
    logQueries.add(req.params.id, 'info', 'Zerion auto-login success');
    res.json({ status: 'success' });
  } catch (err) {
    logQueries.add(req.params.id, 'error', `Zerion login failed: ${err.message}`);
    res.status(500).json({ error: 'Zerion login failed', details: err.message });
  } finally {
    session.close();
  }
});
```

### 4.3. Функция `zerionLogin(session, password)` в `src/api/browser.js`

```js
async function zerionLogin(session, password) {
  const ZERION_ID = 'klghhnkeealcohjjanjjdaeeggmfmlpl';
  const LOGIN_URL = `chrome-extension://${ZERION_ID}/popup.8e8f209b.html?windowType=dialog#/login`;
  const TIMEOUT = 15000;

  // Открыть страницу
  await session.send('Page.navigate', { url: LOGIN_URL });

  // waitForSelector input[type='password'] с polling
  await waitForSelector(session, "input[type='password']", TIMEOUT);

  // Ввести пароль
  await session.send('Runtime.evaluate', {
    expression: `document.querySelector("input[type='password']").value = '${password.replace(/'/g, "\\'")}'`
  });

  // Нажать Enter
  await session.send('Input.dispatchKeyEvent', {
    type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13
  });
  await session.send('Input.dispatchKeyEvent', {
    type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13
  });

  // Ждать исчезновения input[type='password'] (успешный логин)
  await waitForSelectorHidden(session, "input[type='password']", 10000);
}

async function waitForSelector(session, selector, timeout) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    const { result } = await session.send('Runtime.evaluate', {
      expression: `document.querySelector('${selector}') !== null`,
    });
    if (result.value) return;
    await new Promise(r => setTimeout(r, 200));
  }
  throw new Error(`Timeout waiting for ${selector}`);
}

async function waitForSelectorHidden(session, selector, timeout) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    const { result } = await session.send('Runtime.evaluate', {
      expression: `(function(){ const el = document.querySelector('${selector}'); return el === null || el.offsetParent === null; })()`,
    });
    if (result.value) return;
    await new Promise(r => setTimeout(r, 200));
  }
  throw new Error(`Timeout waiting for ${selector} to hide`);
}
```

### 4.4. Экспорт `createCdpSession`

Добавить в `module.exports`:

```js
module.exports.createCdpSession = createCdpSession;
```

---

## 5. API endpoint: `/api/internal/profiles` (GET)

**Файл:** `src/api/internal.js` (новый роут)

### 5.1. Query параметры

- `?range=001-010` — разворачивается в `auto_001..auto_010` (по полю `name`)
- Если range не указан — вернуть все профили

### 5.2. Логика

```js
function parseRange(rangeStr) {
  // "001-010" → ["auto_001", "auto_002", ..., "auto_010"]
  if (!rangeStr || !rangeStr.includes('-')) return null;
  const [start, end] = rangeStr.split('-').map(s => parseInt(s, 10));
  const names = [];
  for (let i = start; i <= end; i++) {
    names.push(`auto_${String(i).padStart(3, '0')}`);
  }
  return names;
}
```

### 5.3. Формат ответа

```json
[
  {
    "id": "uuid",
    "number": 1,
    "name": "auto_001",
    "email": "user@example.com",
    "email_password": "cleartext",
    "twitter_username": "user_x",
    "twitter_password": "cleartext",
    "twitter_auth_token": "cleartext",
    "twitter_email": "x@example.com",
    "discord_username": "user_dc",
    "discord_password": "cleartext",
    "discord_token": "cleartext",
    "discord_email": "dc@example.com",
    "wallet_evm_address": "0x...",
    "wallet_sol_address": "...",
    "wallet_password": "cleartext",
    "proxy": {
      "type": "socks5",
      "host": "1.2.3.4",
      "port": 1080,
      "username": "user",
      "password": "pass",
      "connection_string": "socks5://user:pass@1.2.3.4:1080"
    }
  }
]
```

### 5.4. Монтирование роута

В `src/core/app.js`:

```js
const internalRouter = require('../api/internal');
app.use('/api/internal', internalRouter);
```

---

## 6. API endpoint: `/api/tasks` CRUD + `/:id/run`

### 6.1. Файл: `src/api/tasks.js` (новый роут)

Использовать готовые prepared statements из `src/db/queries.js` (для tasks/task_executions они должны быть созданы в Ф1).

#### `GET /api/tasks` — список всех задач
#### `POST /api/tasks` — создать задачу
#### `PUT /api/tasks/:id` — обновить задачу
#### `DELETE /api/tasks/:id` — удалить задачу
#### `POST /api/tasks/:id/run` — запустить задачу

### 6.2. `POST /api/tasks/:id/run` — логика запуска

1. Получить задачу из БД
2. Получить список профилей (можно по тегам из `params` задачи, или все)
3. Для каждого профиля:
   - Парсинг `params` (JSON из задачи)
   - Сбор аргументов: `--project=script_name`, `--profile-id=profile_id`, и т.д.
   - Spawn Python-процесса: `child_process.spawn('python', args, { cwd: stAuto0Path })`
   - Сохранить entry в `task_executions` с `status='running'`
   - Логировать stdout/stderr в `logs/task_{task_id}_{timestamp}.log`
4. Вернуть `{ status: 'started', executions: [...] }`

### 6.3. Монтирование роута

```js
const tasksRouter = require('../api/tasks');
app.use('/api/tasks', tasksRouter);
```

---

## 7. Подготовка queries.js для tasks/task_executions

### 7.1. Функция `createTaskQueries(db)` в `src/db/queries.js`

```js
function createTaskQueries(db) {
  const insert = db.prepare(`
    INSERT INTO tasks (id, name, script_name, schedule_type, cron_expression, params, is_active)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);
  const getById = db.prepare('SELECT * FROM tasks WHERE id = ?');
  const getAll = db.prepare('SELECT * FROM tasks ORDER BY created_at');
  const update = db.prepare(`
    UPDATE tasks SET name = ?, script_name = ?, schedule_type = ?,
      cron_expression = ?, params = ?, is_active = ?, updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `);
  const deleteById = db.prepare('DELETE FROM tasks WHERE id = ?');

  const insertExecution = db.prepare(`
    INSERT INTO task_executions (task_id, profile_id, status, last_run_at)
    VALUES (?, ?, ?, CURRENT_TIMESTAMP)
  `);
  const getExecutionsByTaskId = db.prepare('SELECT * FROM task_executions WHERE task_id = ? ORDER BY last_run_at DESC');

  return {
    create(data) { ... },
    getById(id) { ... },
    getAll() { ... },
    update(id, data) { ... },
    delete(id) { ... },
    createExecution(taskId, profileId, status) { ... },
    getExecutions(taskId) { ... },
  };
}
```

---

## 8. Настройка Settings: crypto/automation (GUI)

### 8.1. Файл: `gui/src/renderer/views/Settings.vue`

Добавить секции:

#### Раздел «Безопасность»
- Toggle: мастер-пароль (вкл/выкл)
- Поле ввода/смены пароля
- Индикатор статуса: OS Keyring / system_config / password
- Recovery key: показать 1 раз (кнопка "Показать recovery-key")

#### Раздел «Автоматизация»
- Поле: путь к stAuto0 (cwd для spawn Python)
- Поле: путь к Python-интерпретатору
- Список доступных проектов (сканирование `stAuto0/projects/*.py`)

### 8.2. API endpoints для Settings

- `GET /api/settings/crypto-status` — статус мастер-ключа (source: keytar|system_config|password, hasKey: bool)
- `POST /api/settings/set-master-password` — установка/смена мастер-пароля
- `POST /api/settings/unlock` — разблокировка (ввод пароля для доступа к секретам)
- `GET /api/settings/automation` — получить настройки автоматизации (путь, Python)
- `PUT /api/settings/automation` — сохранить настройки автоматизации

---

## 9. Экспорт `createCdpSession`

Добавить в `src/api/browser.js`:

```js
module.exports.createCdpSession = createCdpSession;
```

---

## Порядок реализации

| № | Шаг | Файл | Сложность |
|---|-----|------|-----------|
| 1 | **Crypto-модуль:** encrypt, decrypt, generateMasterKey, deriveKeyFromPassword | `src/crypto/index.js` | medium |
| 2 | **MasterKeyManager:** initMasterKey, hasMasterKey, getMasterKey, keytar интеграция | `src/crypto/index.js` | high |
| 3 | **Интеграция encrypt/decrypt в queries.js:** create, update, getById, getAll | `src/db/queries.js` | medium |
| 4 | **system_config queries:** get/set для настроек | `src/db/queries.js` | low |
| 5 | **TaskQueries в queries.js:** CRUD tasks + task_executions | `src/db/queries.js` | low |
| 6 | **Zerion auto-login:** функция + эндпоинт | `src/api/browser.js` | high |
| 7 | **Экспорт createCdpSession** | `src/api/browser.js` | low |
| 8 | **Internal profiles endpoint:** /api/internal/profiles?range= | `src/api/internal.js` | medium |
| 9 | **Tasks CRUD endpoint:** /api/tasks + /:id/run | `src/api/tasks.js` | medium |
| 10 | **Settings crypto/automation GUI:** Vue-компоненты | `Settings.vue` | medium |
| 11 | **Монтирование роутов в app.js** | `src/core/app.js` | low |

---

## Файловый манифест

| Файл | Действие |
|------|----------|
| `src/crypto/index.js` | **НОВЫЙ** — encrypt, decrypt, MasterKeyManager |
| `src/db/queries.js` | **ИЗМЕНИТЬ** — интеграция шифрования + taskQueries |
| `src/api/browser.js` | **ИЗМЕНИТЬ** — zerion-login endpoint + экспорт createCdpSession |
| `src/api/internal.js` | **НОВЫЙ** — /api/internal/profiles |
| `src/api/tasks.js` | **НОВЫЙ** — tasks CRUD + /:id/run |
| `src/core/app.js` | **ИЗМЕНИТЬ** — монтирование новых роутов |
| `gui/src/renderer/views/Settings.vue` | **ИЗМЕНИТЬ** — секции crypto + automation |
| `package.json` | **ИЗМЕНИТЬ** — добавить keytar |

---

## Не делаем в рамках этой задачи

- ❌ Hot Backup + Rolling (Ф3)
- ❌ Tasks Manager экран (Ф5) — только API
- ❌ Встроенный терминал (Ф6)
- ❌ Window Arranger cross-platform
- ❌ Cookie drag-and-drop
