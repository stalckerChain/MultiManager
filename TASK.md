# План реализации Ф6: Spawn-ядро и доработки

## Статус
**Дата:** 2026-07-10 | **Актуально:** после аудита TS_INTEGRATION.md §12.2

**Что уже работает:** Ручной/CLI запуск `python main.py` поверх живого Core — ✅ стыкуется полностью (Ф1–Ф5). CRUD задач и tail-терминал — ✅.

**Что НЕ работает:** `POST /api/tasks/:id/run` не spawn'ит Python, не пишет логи, не обновляет статус исполнения.

---

## 1. Текущая архитектура (как есть)

### 1.1. `src/api/tasks.js:94-133` — заглушка
- `POST /api/tasks/:id/run` создаёт `task_executions` со статусом `'running'` и возвращает `{status:'started'}`
- **Не использует** `child_process.spawn` — нет `require('child_process')`
- **Не передаёт** `cwd` (путь к stAuto0), `--project`, `--range`, `--log-name`
- `log_file_path` всегда `null` — `createExecution` вызывается без него
- `updateExecutionStatus` определён в `queries.js:374`, но **никогда не вызывается**

### 1.2. `src/api/settings.js:91-128` — настройки готовы
- `GET/PUT /api/settings/automation` — хранит `stAuto0_path` и `python_path` в таблице `system_config`
- Сканирует `projects/*.py` для списка доступных скриптов

### 1.3. `gui/src/main/pty.js` — терминал изолирован
- Только tail'ит файл по **вручную введённому** пути
- Не связан с задачами и `task_executions.log_file_path`

### 1.4. `src/api/internal.js:30-42` — баг с range
- `parseRange('abc')` возвращает `null` → вызывается `getAll()`, а не `400 Bad Request`

---

## 2. План реализации (4 шага)

### Шаг 1: Spawn-ядро в `POST /api/tasks/:id/run`

**Файл:** `src/api/tasks.js`

**Что изменить:**
1. Добавить `const { spawn } = require('child_process')` и `const path = require('path')`
2. В `POST /:id/run` считать настройки автоматизации из БД (`system_config` через `createSystemConfigQueries`)
3. Определить `logsDir` — `path.join(appDir, 'logs', 'tasks')` (рядом с `logs/core.log`)
4. Для каждого профиля (или range из `task.params`) создать исполнение:
   - Сгенерировать имя лог-файла: `task_{taskId}_{profileId}_{timestamp}.log`
   - Создать `log_file_path` при вызове `createExecution`
   - Создать `WriteStream` в этот файл
   - `spawn(pythonPath, [mainPy, '--project='+task.script_name, '--range='+range, '--log-name='+task.id, '--token='+apiToken], { cwd: stAuto0Path })`
   - Подписать `child.stdout.on('data')` и `child.stderr.on('data')` → пишем в `WriteStream`
   - `child.on('exit', (code) => updateExecutionStatus(execId, code===0?'success':'failed', code))`
   - `child.on('error', (err) => updateExecutionStatus(execId, 'failed', -1))`
5. Разобрать `task.params.range` — если не задан, использовать все профили (как сейчас)
6. Если `stAuto0_path` или `python_path` не настроены — возвращать `400` с сообщением

**Псевдокод изменений в `router.post('/:id/run')`:**
```js
const configQueries = createSystemConfigQueries(db);
const stAuto0Path = configQueries.get('stAuto0_path');
const pythonPath = configQueries.get('python_path');
if (!stAuto0Path) return res.status(400).json({ error: 'stAuto0_path не настроен' });
if (!pythonPath) return res.status(400).json({ error: 'python_path не настроен' });

const runRange = taskParams.range || null;
const profiles = runRange
  ? profileQueries.getAll().filter(p => {
      const num = p.number; return num >= start && num <= end;
    })
  : profileQueries.getAll();

const tasksLogDir = path.join(getAppDir(), 'logs', 'tasks');
fs.mkdirSync(tasksLogDir, { recursive: true });

for (const profile of profiles) {
  const timestamp = Date.now();
  const logFileName = `task_${task.id}_${profile.id}_${timestamp}.log`;
  const logFilePath = path.join(tasksLogDir, logFileName);
  const execId = taskQueries.createExecution(task.id, profile.id, 'running', logFilePath);
  
  const logStream = fs.createWriteStream(logFilePath, { flags: 'a' });
  const child = spawn(pythonPath, [
    'main.py',
    `--project=${task.script_name}`,
    `--range=${String(profile.number).padStart(3, '0')}-${String(profile.number).padStart(3, '0')}`,
    `--log-name=${task.id}`,
    `--token=${getToken()}`,
  ], { cwd: stAuto0Path, stdio: ['ignore', 'pipe', 'pipe'] });
  
  child.stdout.on('data', d => logStream.write(d));
  child.stderr.on('data', d => logStream.write(d));
  
  child.on('exit', (code) => {
    logStream.end();
    taskQueries.updateExecutionStatus(execId, code === 0 ? 'success' : 'failed', code);
    logger.info({ taskId: task.id, execId, code }, 'Task execution completed');
  });
  
  child.on('error', (err) => {
    logStream.write(`[SYSTEM] Spawn error: ${err.message}\n`);
    logStream.end();
    taskQueries.updateExecutionStatus(execId, 'failed', -1);
  });
}
```

**Что важно:**
- `--range` передаётся **одиночным** (один профиль на один spawn), как делает `main.py`
- Токен API передаётся через `--token` для авторизации Python→Core
- Лог-файлы пишутся в `%APPDATA%/CloakManager/logs/tasks/` (рядом с `core.log`)
- `updateExecutionStatus` обновит строку в БД — GUI Executions подхватит

---

### Шаг 2: Привязка терминала к логам исполнения

**Файлы:** `gui/src/main/pty.js`, `gui/src/renderer/views/Tasks.vue`

**Что изменить:**
1. В `Tasks.vue` колонка `logFile` в модалке исполнений — сделать путь кликабельным или добавить кнопку "View log"
2. По клику послать IPC-событие `pty:start` с `log_file_path`
3. Открыть терминал (новое окно или вкладку) с tail'ом этого файла

**Конкретные изменения в Tasks.vue:**
- В `<template #default="{ record }">` для `logFile`:
  ```vue
  <a-button v-if="record.log_file_path" size="small" type="link" @click="openLog(record.log_file_path)">
    {{ t('tasks.viewLog') }}
  </a-button>
  ```
- В `<script>` добавить:
  ```js
  const { ipcRenderer } = require('electron');
  function openLog(filePath) {
    ipcRenderer.invoke('pty:start', filePath);
  }
  ```

---

### Шаг 3: Исправление `parseRange` — 400 при невалидном range

**Файл:** `src/api/internal.js`

**Что изменить:**
```js
router.get('/profiles', (req, res) => {
  if (req.query.range) {
    const rangeNames = parseRange(req.query.range);
    if (!rangeNames) {
      return res.status(400).json({ error: 'Invalid range format. Use e.g. 001-010' });
    }
    // ... filter by rangeNames
  } else {
    // getAll()
  }
});
```

---

### Шаг 4: Мелкие доработки (необязательные, но рекомендованные)

#### 4.1. Timing-safe сравнение токена

**Файл:** `src/api/auth.js`

Использовать `crypto.timingSafeEqual`:
```js
const crypto = require('crypto');

function authMiddleware(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  const token = authHeader.slice(7);
  
  if (token.length !== state.apiToken.length ||
      !crypto.timingSafeEqual(Buffer.from(token), Buffer.from(state.apiToken))) {
    return res.status(401).json({ error: 'Invalid token' });
  }
  next();
}
```

#### 4.2. Zerion extension ID — вынести в константу

**Файл:** `src/api/browser.js:645`

Вынести `ZERION_ID` в конфиг или константу в начале файла:
```js
const ZERION_EXTENSION_ID = 'klghhnkeealcohjjanjjdaeeggmfmlpl';
```
Использовать `ZERION_EXTENSION_ID` везде.

---

## 3. Порядок выполнения

| № | Шаг | Файлы | Время | Зависимости |
|---|-----|-------|-------|------------|
| 1 | Spawn-ядро | `src/api/tasks.js` | ~1ч | — |
| 2 | Терминал→логи | `Tasks.vue`, `pty.js` | ~30м | Шаг 1 (чтоб был log_file_path) |
| 3 | 400 на invalid range | `src/api/internal.js` | ~10м | — |
| 4 | Мелкие доработки | `auth.js`, `browser.js` | ~15м | — |

**Итого:** ~2 часа

---

## 4. Тестирование

### 4.1. Unit-тесты для шага 1
- `tests/unit/tasks.test.js` — добавить тест на вызов `updateExecutionStatus`
- Создать `tests/integration/tasks-run.test.js` для интеграции:
  - Mock `spawn`
  - Проверить, что создаётся `log_file_path`
  - Проверить, что `updateExecutionStatus` вызывается с exit_code

### 4.2. Ручное тестирование
1. Настроить `stAuto0_path` и `python_path` через Settings GUI
2. Создать задачу с `script_name: concrete`, `params: {"range":"001-002"}`
3. Нажать "Run Now" → проверить что:
   - В БД `task_executions` появились записи с `log_file_path`
   - Файлы логов создались в `%APPDATA%/CloakManager/logs/tasks/`
   - Статус изменился с `running` на `success`/`failed`
4. Нажать "View Log" → открылся терминал с живым логом

### 4.3. Smoke test range
- `curl "http://127.0.0.1:3000/api/internal/profiles?range=abc"` → `400 Invalid range`
- `curl "http://127.0.0.1:3000/api/internal/profiles?range=001-003"` → отфильтрованные профили
