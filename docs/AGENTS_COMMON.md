# Общие правила для ИИ-агентов

Любой агент обязан сначала прочитать этот файл, затем документ своей роли.

Проект: MultiManager — AI-Driven Web Automation Platform.

Стек: Node.js (Express, better-sqlite3) + Electron (Vue 3, Ant Design Vue).

Тесты: Vitest, `npm test`.

## Принципы принятия решений

- Предпочитать изменение существующего кода созданию нового.
- Если задачу можно решить изменением нескольких строк, не создавать для этого новый класс или модуль.
- Не вводить новые архитектурные сущности (`RuntimeManager`, `Factory`, `Provider`, `Service` и т.п.), если задачу можно решить расширением существующей сущности.
- Если информации недостаточно, не придумывать отсутствующие детали и не делать предположений.
- Не делать предположений о содержимом файлов, структуре проекта и использовании функций без проверки репозитория.
- Перед изменением или удалением функции, API, компонента или другого поведения найти все места их использования в репозитории.
- Количество использований определять только поиском по репозиторию.

## Уточнения у пользователя

Всегда уточнять:

| Ситуация | Что уточнять |
|----------|-------------|
| Задача сформулирована размыто | Конкретику: какой файл, какое поведение, ожидаемый результат |
| Несколько вариантов решения | Предложить варианты с trade-offs, дать выбор |
| Изменение API-контракта | Версионирование, backward compatibility |
| Изменение схемы БД | Миграция, совместимость со старыми данными |
| Добавление новой зависимости | Обоснование, альтернативы, размер бандла |
| Удаление кода | Убедиться что не используется (grep callers) |
| Security-вопросы | Всегда эскалировать на пользователя |
| Масштабирование | Оценка производительности на 100+ профилей |

Не спрашивать отдельно о:

- исправлении очевидных багов (null check, off-by-one, typo);
- добавлении тестов для уже написанного кода;
- обновлении зависимостей с security-patch;
- форматировании и стилизации по существующему конвеншену.

Без явного указания пользователя запрещено изменять версию проекта (`package.json`, `CHANGELOG.md` и любые файлы с номером версии). Версию меняет только пользователь. Агент не должен запускать `npm run bump` или вручную править version в `package.json`.

## Конвенции кода

### JavaScript (Backend: `src/`)

- Стиль: CommonJS (`require`/`module.exports`), без ESM в backend.
- Именование: camelCase для переменных/функций, PascalCase для классов.
- Логирование: `pino` через `require('../core/logger')`. Не `console.log`.
- Ошибки: `throw new Error('...')` с информативным сообщением. Не проглатывать ошибки.
- Асинхронность: `async/await`, не callback-стиль.
- БД-запросы: через query-объекты в `src/db/queries.js`. Не писать SQL в роутерах.

### Vue 3 (Frontend: `gui/src/renderer/`)

- API: Composition API (`<script setup>`), не Options API.
- UI-компоненты: Ant Design Vue (`a-button`, `a-table`, и т.д.).
- Стили: Tailwind CSS. Не писать inline-стили.
- State: Pinia stores.
- i18n: все строки через `t('key')`. Не хардкодить текст.

### Тесты (`tests/`)

- Фреймворк: Vitest (`describe`/`it`/`expect`).
- Именование: `*.test.js` рядом с тестируемым файлом.
- Паттерн: Arrange → Act → Assert.
- Моки: `vi.mock()`, `vi.fn()`. Не мокать то, что можно реально вызвать.
- Интеграционные тесты: `tests/integration/`, требуют запущенный бэкенд.

## Структура проекта

```text
src/                    # Backend (Node.js)
├── core/app.js         # Express + middleware
├── api/                # REST-эндпоинты (авторизация через auth.js)
├── db/                 # SQLite: schema.js, queries.js, index.js
├── crypto/             # Шифрование (AES-256-GCM, master key)
├── proxy/              # Прокси-менеджмент
├── executor/           # Запуск Python-скриптов (stAuto0)
└── cookie/             # Инжект куки

gui/                    # Frontend (Electron + Vue 3)
├── src/main/           # Electron main process (IPC, core-manager)
└── src/renderer/       # Vue 3 app (views, components, stores)

tests/                  # Vitest
├── unit/               # Unit-тесты
└── integration/        # Интеграционные тесты (требуют API)

docs/                   # Документация
├── API.md              # REST API Reference
├── DATABASE.md         # Схема БД + миграции
├── DEPLOY.md           # Деплой и сборка
├── CICD.md             # CI/CD пайплайн
├── MULTI-CONTROL.md    # Синхронизация окон
└── AGENTS.md           # Точка входа для ИИ-агентов
```

## Безопасность

1. Никогда не логировать пароли, токены, proxy-credentials, master key.
2. Все mutating-эндпоинты (POST/PUT/DELETE) к `/api/profiles`, `/api/proxies`, `/api/cookies` требуют master key gate (`hasMasterKey()`).
3. WebSocket требует `?token=` query parameter.
4. CDP-инжект: использовать `Runtime.callFunctionOn`, не конкатенировать JS-строки.
5. Прокси: валидировать scheme, блокировать private/local адреса (SSRF protection).
6. Файлы: всегда удалять temp-файлы в `finally` block.
7. Рекавери-ключ показывается один раз и удаляется из БД.

## Документация

- Все документы в `docs/` ведутся на русском языке (основной), с переводами `*.en.md` и `*.zh.md` при необходимости.
- `API.md` — референс всех эндпоинтов. Обновлять при добавлении или изменении API.
- `DATABASE.md` — схема и миграции. Обновлять при изменении схемы.
- `CHANGELOG.md` — changelog по версиям. Обновлять при каждом релизе.
- `TASK.md` — текущая задача и план реализации.
- `TS.md` — техническое задание. Обновлять при изменении архитектуры или требований.

## Git и команды

- Формат коммита: `<type>(<scope>): <description>`.
- `type`: feat, fix, security, refactor, test, docs, chore.
- `scope`: api, db, gui, crypto, proxy, executor, multi-control.
- Примеры: `feat(api): add cookie bulk import endpoint`, `fix(db): handle migration for missing columns`, `security(crypto): rotate core token on each start`.
- Не коммитить `.env`, credentials, temp-файлы, `node_modules/`.

```bash
npm test                        # Все unit-тесты
npm run test:api                # Интеграционные тесты (требует запущенный бэкенд)
npm run test:all                # Всё вместе
npm run dev                     # Watch-режим бэкенда
cd gui && npm run dev           # Watch-режим GUI
npm run build:native            # Сборка hooks.node (node-gyp rebuild)
cd gui && npm run build         # Сборка GUI
npm run lint                    # ESLint для src/
npm run bump                    # Автобамп версии
```
