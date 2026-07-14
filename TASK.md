# TASK.md — Рекомендации по улучшению MultiManager

---

## 1. Убрать API-токен из логов (КРИТИЧНО)

**Проблема:** В `src/index.js:41` API-токен логируется в открытом виде в `core.log`. Любой с доступом к логам получает полный доступ к API.

**Шаги:**

1.1. Открыть `src/index.js`, найти строку:
```js
logger.info(`API Token: ${token}`);
```

1.2. Заменить на:
```js
logger.info('Core-движок запущен. Токен скопирован в GUI статус-бар.');
```

1.3. Убедиться, что токен не логируется нигдеelse в проекте:
- Поискать по `src/` паттерн `logger` + `token`
- Проверить `src/core/websocket.js`, `src/executor/index.js` (там передаётся `options.apiToken` в аргументах Python-процесса — это ОК, это не лог)

1.4. Добавить в `README.md` примечание:
```
> API Token отображается только в GUI статус-баре и не записывается в лог-файлы.
```

---

## 2. Добавить валидацию запросов (Zod)

**Проблема:** Роуты проверяют входные данные ad-hoc, без единой схемы. Нет ограничений на размер тел запросов.

**Шаги:**

2.1. Установить зависимость:
```bash
npm install zod
```

2.2. Создать файл `src/api/validate.js` с通用-валидатором:
```js
const { z } = require('zod');

function validate(schema) {
  return (req, res, next) => {
    const result = schema.safeParse(req.body);
    if (!result.success) {
      return res.status(400).json({
        error: 'Ошибка валидации',
        details: result.error.issues.map(i => ({
          field: i.path.join('.'),
          message: i.message,
        })),
      });
    }
    req.body = result.data;
    next();
  };
}

module.exports = { validate, z };
```

2.3. Добавить в `src/core/app.js` лимит на размер тела запроса:
```js
app.use(express.json({ limit: '1mb' }));
```

2.4. Создать схемы валидации для каждого роута. Приоритетные:

- `src/api/profiles.js` — схема создания/обновления профиля
- `src/api/proxies.js` — схема создания прокси (host, port, type)
- `src/api/browser.js` — схема `/type` (text: string, max 10000)
- `src/api/projects.js` — схема создания проекта
- `src/api/runs.js` — схema создания run (parallel_limit: number, max 50)

2.5. Подключить middleware валидации к роутам:
```js
// Пример для profiles.js
const { validate, z } = require('../validate');

const createProfileSchema = z.object({
  name: z.string().min(1).max(100),
  platform: z.enum(['windows', 'macos', 'linux']),
  // ... остальные поля
});

router.post('/', validate(createProfileSchema), async (req, res) => { ... });
```

2.6. Написать тесты для валидации в `tests/unit/validation.test.js`.

---

## 3. Вынести CDP-утилиты в общий модуль

**Проблема:** Паттерн CDP-вызова (создать WS → отправить → ждать ответ с таймаутом) дублируется в `browser.js` и `multi-control/cdp-manager.js`.

**Шаги:**

3.1. Создать файл `src/cdp/client.js`:
```js
const WebSocket = require('ws');

function createCdpClient(port) {
  // Общий CDP-клиент с методами:
  // - connect() → ws
  // - call(ws, method, params, sessionId?) → result
  // - callWithTimeout(ws, method, params, sessionId, timeout) → result
  // - close()
}

module.exports = { createCdpClient };
```

3.2. Реализовать `callWithTimeout` с единым паттерном:
- Автоинкрементный ID сообщений
- Таймаут по умолчанию 15 сек
- Удаление listener при ответе или таймауте

3.3. Рефакторить `src/api/browser.js`:
- Заменить `cdpCall`, `cdpCallRaw`, `createCdpSession` на импорт из `cdp/client.js`
- Оставить `createCdpSession` как обёртку над общим клиентом

3.4. Рефакторить `src/multi-control/cdp-manager.js`:
- Заменить `_sendAndWait` на общий `callWithTimeout`
- Оставить высокие методы (connect, disconnect, dispatch) как бизнес-логику

3.5. Написать unit-тесты для `cdp/client.js` в `tests/unit/cdp-client.test.js`.

---

## 4. Заменить тихие catch-блоки на логирование

**Проблема:** 10+ catch-блоков в `multi-control/cdp-manager.js` и других файлах молча проглатывают ошибки.

**Шаги:**

4.1. Найти все тихие catch в проекте:
```
grep -rn "catch {}" src/
grep -rn "catch(e) {}" src/
grep -rn "catch {" src/
```

4.2. В `src/multi-control/cdp-manager.js` заменить каждый `try { ... } catch {}` на:
```js
try {
  // ... существующий код
} catch (err) {
  logger.debug({ error: err.message, context: 'описание' }, 'CDP: ошибка обработки сообщения');
}
```

Использовать `debug` уровень, чтобы не засорять логи, но при этом иметь возможность отладки.

4.3. В `src/api/browser.js` проверить catch-блоки:
- `findWindowByPid` — уже логирует через caller
- `loadExtensionsViaCDP` — уже логирует
- Остальные — при необходимости добавить логирование

4.4. Добавить eslint-правило, предупреждающее о пустых catch:
```js
// .eslintrc.js
rules: {
  'no-empty': ['error', { allowEmptyCatch: false }],
}
```

---

## 5. Прояснить дублирование gui/src/

**Проблема:** `gui/src/` содержит копии бэкенд-модулей. Это запутывает — работает ли GUI отдельный бэкенд или это мёртвый код.

**Шаги:**

5.1. Проанализировать содержимое `gui/src/`:
- Сравнить `gui/src/core/` с `src/core/`
- Сравнить `gui/src/db/` с `src/db/`
- Сравнить `gui/src/api/` с `src/api/`

5.2. Определить тип дублирования:
- Если это полные копии → удалить дубликаты в `gui/src/`, оставить ссылки на `../src/`
- Если это адаптированные версии для Electron → задокументировать в `gui/README.md` причину
- Если это мёртвый код → удалить

5.3. Если бэкенд запускается из GUI (Electron main process forks core):
- Убедиться, что `gui/package.json` не содержит дублированных зависимостей
- Рассмотреть возможность использования workspace для shared-кода

5.4. Создать `gui/README.md` с описанием архитектуры GUI и его связи с бэкендом.

---

## 6. Добавить тесты для WebSocket

**Проблема:** Реалтайм-слой через WebSocket не тестируется.

**Шаги:**

6.1. Установить тестовую зависимость:
```bash
npm install -D ws  # уже есть, но убедиться что версия совместима
```

6.2. Создать файл `tests/integration/websocket.test.js`:
```js
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import WebSocket from 'ws';
import http from 'http';

describe('WebSocket', () => {
  let server;
  let port;

  beforeAll(async () => {
    // Запустить test-сервер на свободном порту
    const { app, setupWebSocket } = await import('../../src/core/app.js');
    server = http.createServer(app);
    setupWebSocket(server);
    await new Promise(resolve => server.listen(0, resolve));
    port = server.address().port;
  });

  afterAll(() => { server.close(); });

  it('подключается к /ws', async () => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
    await new Promise((resolve, reject) => {
      ws.on('open', resolve);
      ws.on('error', reject);
    });
    ws.close();
  });

  it('получает broadcast статуса профиля', async () => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
    await new Promise(r => ws.on('open', r));

    const message = await new Promise((resolve) => {
      ws.on('message', (data) => resolve(JSON.parse(data)));
      // Вызвать broadcastStatus из кода
    });

    expect(message).toHaveProperty('profile_id');
    expect(message).toHaveProperty('status');
    ws.close();
  });
});
```

6.3. Протестировать сценарии:
- Подключение клиента
- Получение broadcast-сообщений
- Отключение клиента (cleanup)
- Невалидный токен (если WS авторизуется)
- Обработка ошибок

6.4. Добавить в `vitest.config.js` в секцию `test.include` все файлы из `tests/integration/`.

---

## 7. Стандартизировать ответы ошибок

**Проблема:** Непоследовательный формат ошибок: `{ error }` vs `{ error, details }` vs `{ error, message }`.

**Шаги:**

7.1. Создать файл `src/api/errors.js`:
```js
class ApiError extends Error {
  constructor(status, code, message, details = null) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }

  toJSON() {
    const json = { error: this.message, code: this.code };
    if (this.details) json.details = this.details;
    return json;
  }
}

// Фабрики
const badRequest = (msg, details) => new ApiError(400, 'BAD_REQUEST', msg, details);
const unauthorized = () => new ApiError(401, 'UNAUTHORIZED', 'Не авторизован');
const notFound = (resource) => new ApiError(404, 'NOT_FOUND', `${resource} не найден`);
const conflict = (msg) => new ApiError(409, 'CONFLICT', msg);
const preconditionFailed = (msg) => new ApiError(412, 'PRECONDITION_FAILED', msg);
const serverError = (msg, details) => new ApiError(500, 'INTERNAL_ERROR', msg, details);

module.exports = { ApiError, badRequest, unauthorized, notFound, conflict, preconditionFailed, serverError };
```

7.2. Обновить глобальный error handler в `src/core/app.js`:
```js
const { ApiError } = require('./api/errors');

app.use((err, req, res, next) => {
  if (err instanceof ApiError) {
    return res.status(err.status).json(err.toJSON());
  }
  logger.error({ err: err.message, stack: err.stack }, 'Unhandled server error');
  res.status(500).json({ error: 'Внутренняя ошибка сервера', code: 'INTERNAL_ERROR' });
});
```

7.3. Поэтапно рефакторить роуты, заменяя ad-hoc ответы на фабрики:
- `src/api/browser.js` — приоритет (самый большой файл, 800+ строк)
- `src/api/profiles.js`
- `src/api/proxies.js`
- `src/api/multi-control.js`
- Остальные роуты

7.4. Обновить тесты, которые проверяют формат ошибок.

---

## 8. Убрать хардкоженные дефолты

**Проблема:** `wallet_password` по умолчанию `asdfj*KK`, таймзона по умолчанию `Asia/Bishkek`.

**Шаги:**

8.1. В `src/db/schema.js`:
- Убрать `DEFAULT 'asdfj*KK'` из колонки `wallet_password`
- Убрать `DEFAULT 'Asia/Bishkek'` из колонки `timezone`
- Заменить на `DEFAULT NULL`

8.2. В `src/db/schema.js` функция `migrateTables`:
- Убрать специальную обработку timezone и wallet_password
- Все новые колонки добавлять без дефолтов (кроме строковых пустых)

8.3. В `src/fingerprint/index.js`:
- Вынести дефолтную таймзону в конфиг `src/config/index.js`:
```js
module.exports = {
  DEFAULT_TIMEZONE: null, // Пользователь обязан задать
  // ... остальные настройки
};
```

8.4. В GUI (`gui/src/renderer/views/ProfileModal.vue` или аналог):
- Сделать поле timezone обязательным при создании профиля
- Добавить валидацию: timezone не может быть null при сохранении

8.5. В `src/api/profiles.js`:
- При создании профиля без timezone возвращать ошибку 400:
```js
if (!body.timezone) {
  return res.status(400).json({ error: 'timezone обязателен' });
}
```

8.6. Миграция для существующих данных:
- Создать SQL-миграцию, которая заполнит null-значения дефолтным значением из system_config
- Или: оставить дефолт в миграции, но убрать из CREATE TABLE (чтобы новые профили не получали дефолт)

---

## Дополнительно (низкий приоритет)

### 9. Rate limiting

9.1. Установить `npm install express-rate-limit`.

9.2. Добавить в `src/core/app.js`:
```js
const rateLimit = require('express-rate-limit');

const apiLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Слишком много запросов', code: 'RATE_LIMIT' },
});

app.use('/api/', apiLimiter);
```

### 10. Заменить синхронные fs-операции

10.1. Найти все `fs.existsSync`, `fs.readdirSync`, `fs.mkdirSync`, `fs.rmSync` в `src/`.

10.2. Заменить на async-версии (`fs.promises`), где это возможно без существенной переработки.

10.3. Приоритетные места:
- `src/api/browser.js` — проверка существования файлов при запуске
- `src/backup/index.js` — операции с бэкапами
- `src/fingerprint/index.js` — не критично, но хорошо бы

---

*Дата создания: 2026-07-14*
*Источник: Code Review репозитория MultiManager*
