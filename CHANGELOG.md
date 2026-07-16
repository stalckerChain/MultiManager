# Changelog

## v1.3.0

### Исправления

- **[BUG] Automation Matrix: кнопка "Create Run" неактивна при отметке чекбоксов в первых столбцах.**
  `selectedCount` был `ref(0)` + `watch({ deep: true })` — Vue 3 не отслеживала добавление новых свойств в `ref({})`.
  **Фикс:** замена на `computed` — ленивое отслеживание зависимостей работает корректно для любых изменений.
  Добавлены 3 регрессионных теста, гарантирующих корректный подсчёт для каждого столбца независимо.

- **[BUG] Automation Matrix: кнопка "Create Run" неактивна для проектов без привязки к аккаунтам.**
  `allowed_profile_ids` возвращался как `[]` (пустой массив). В JS `[]` truthy, поэтому `|| fallback` не срабатывал — `allowedIds` оставался `[]` и проверка `includes()` всегда возвращала false.
  **Фикс:** замена `proj?.allowed_profile_ids || fallback` на `proj?.allowed_profile_ids?.length ? ... : fallback` в `selectedCount` и `getEnabledEntries`.

- **[BUG] Automation Matrix: снятие галочки не отключало ячейку в БД.**
  `getEnabledEntries()` отправляла только включённые записи (`is_enabled: 1`). Отключённые ячейки не отправлялись на сервер и оставались `is_enabled: 1` в БД.
  **Фикс:** `getEnabledEntries()` теперь отправляет все записи (включая `is_enabled: 0`).

- **[BUG] Executor: необработанная ошибка спавна Python молча убивала процесс.**
  Отсутствовал `child.on('error')` обработчик. Если Python не найден (ENOENT), необработанное событие crash-ило Node.js процесс.
  **Фикс:** добавлен `child.on('error')` с логированием и пометкой задач как `failed`.

- **[BUG] Executor: `incrementRun` передавался но нигде не вызывался.**
  Счётчики `completed_tasks`/`success_tasks`/`failed_tasks` обновлялись только через HTTP-колбэк Python-скрипта — если скрипт падал до колбэка, счётчики оставались 0.
  **Фикс:** добавлен `.catch()` на `executor.start()` с финализацией статуса и пометкой задач.

- **[BUG] Bilid: бэкенд не попадал в packaged app из-за .gitignore.**
  `gui/backend/` был в `.gitignore` → electron-builder исключал его из asar и extraResources → `core-manager.js` не мог найти `index.js` → бэкенд не стартовал → фронт не коннектился к беку.
  **Фикс:** добавлен хук `afterPack` (`scripts/copy-backend.js`) для копирования бэкенда в `resources/backend/`. Исправлен путь в `core-manager.js`.

- **[BUG] Runs: нет автообновления статуса выполнения.**
  Страница Runs не обновляла прогресс без ручного рефреша.
  **Фикс:** добавлен polling каждые 3 сек пока есть running-раны.

---

## Тесты

- Всего: **671 тест** (43 файла)
- Обновлены регрессионные тесты в `gui-matrix-selection.test.js`:
  - Пустой `allowed_profile_ids: []` не блокирует подсчёт (3 новых теста)
  - `undefined allowed_profile_ids` не блокирует подсчёт
  - Пустой `allowed_profile_ids: []` не блокирует серверные ячейки
  - `getEnabledEntries` создаёт entries для всех профилей когда `allowed_profile_ids` пуст
  - Согласованность `selectedCount` и `getEnabledEntries`
