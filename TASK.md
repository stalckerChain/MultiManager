# TASK — Приведение документации в порядок

## Контекст

Полный аудит документов проекта (TS.md, TS_INTEGRATION.md, ToDo.md, README.md, README.en.md, README.zh.md, docs/API*.md, docs/DATABASE*.md, docs/DEPLOY.md, docs/MULTI-CONTROL.md) и сверка с кодом. Вывод: код — единственный источник правды. Документация местами устарела или содержит фактические ошибки.

---

## Найденные расхождения (по приоритету)

### P0 — Фактические ошибки в README.en.md

| Утверждение в README.en.md | Должно быть (из кода) |
|---|---|
| `ws_endpoint: "ws://127.0.0.1:3000/devtools/..."` | `ws_endpoint: "http://127.0.0.1:{cdpPort}"` (browser.js:438) |
| Human-like typing: `/api/multi-control/keyboard/type` | `POST /api/browser/:id/type` (browser.js:703) |
| Число тестов: 524 | **558** (30 файлов, vitest output) |
| Путь профилей: `profiles_data/` | `profiles/{UUID}/BrowserData/` (browser.js:286) |
| Структура: отсутствуют Tasks.vue, Terminal, AccountsTab, WalletsTab, pty.js, stores/tasks.js | Добавить в дерево проекта |
| Automation settings response: `scripts_dir`, `projects_dir` | `stAuto0Path`, `pythonPath`, `availableProjects` (settings.js:114) |

### P1 — Неверные поля в docs/API*.md (все три языка)

`GET/PUT /api/settings/automation`:
- Документация: `scripts_dir` / `projects_dir`
- Код: `stAuto0Path` / `pythonPath` + `availableProjects` (settings.js:91-128)

Дополнительно в API.en.md:
- В ответе `POST /api/tasks/:id/run` отсутствует поле `logFile`
- Меньший набор error cases (нет stAuto0_path, python_path, range)

### P2 — Устаревший статус в ToDo.md

- §7.15–7.19 помечены ❌, но в TS_INTEGRATION.md §12.1 подтверждены ✅ (131/131 тестов pass)
- Фазы stAuto0 ФА–ФД — все реализованы

### P3 — Косметика в TS.md и README.md

- Число тестов: TS.md говорит ~551, README.md говорит 551+, фактически **558**

---

## План работ

### Шаг 1: README.en.md (P0)
**Файл:** `README.en.md`
**Действия:**
1. Исправить `ws_endpoint` в примере ответа `/api/browser/:id/start`
2. Исправить URL human-like typing с `/api/multi-control/keyboard/type` на `POST /api/browser/:id/type`
3. Обновить число тестов 524→558
4. Исправить `profiles_data/` на `profiles/{UUID}/BrowserData/`
5. Добавить в дерево проекта: `Tasks.vue`, `Terminal.vue`, `AccountsTab.vue`, `WalletsTab.vue`, `pty.js`, `stores/tasks.js`
6. Исправить automation settings на `stAuto0Path`/`pythonPath`/`availableProjects`

**Верификация:** Сверить с README.md (русская версия корректна).

### Шаг 2: docs/API.md (P1)
**Файлы:** `docs/API.md`, `docs/API.en.md`, `docs/API.zh.md`
**Действия:**
1. Исправить поля в GET/PUT `/api/settings/automation`:
   - `scripts_dir` → `stAuto0Path`
   - `projects_dir` → `pythonPath`
   - Добавить `availableProjects` в ответ
2. В `API.en.md`: добавить `logFile` в ответ tasks/run, добавить error cases

**Верификация:** `npm test` — API-тесты должны проходить.

### Шаг 3: ToDo.md (P2)
**Файл:** `ToDo.md`
**Действия:**
1. §7.15: ❌ → ✅ (main.py авто-детект Core)
2. §7.16: ❌ → ✅ (Core/browser.py рефакторинг)
3. §7.17: ❌ → ✅ (Wallet Factory на SQLite)
4. §7.18: ❌ → ✅ (скрипты миграции)
5. §7.19: ❌ → ✅ (MCP-сервер)

**Верификация:** Проверить, что в сводной таблице ToDo нет ❌ для выполненных пунктов.

### Шаг 4: TS.md и README.md (P3)
**Файлы:** `TS.md`, `README.md`
**Действия:**
1. `TS.md` строка 24: ~551 → 558 (30 файлов)
2. `README.md` строка 113: 551+ → 558 (30 файлов)

---

## Проверка после всех правок

```bash
npm test                          # все тесты зелёные
npm run lint                      # нет ошибок линтера
```

Визуально: открыть каждый изменённый файл, убедиться что markdown рендерится корректно.
