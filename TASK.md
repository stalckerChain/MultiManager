# Задача: Исправление удаления профилей (FOREIGN KEY constraint failed)

**Дата:** 2026-07-27
**Статус:** Выполнено

---

## Проблема

Удаление профилей работает с ошибками: сразу после создания удаляется нормально, но после участия в авто-ране перестаёт работать. В `core.log` ошибка:
```
SqliteError: FOREIGN KEY constraint failed
  at Object.delete (queries.js:132)
  at profiles.js:184
```

## Корневая причина

`src/db/schema.js:68` — у `run_tasks.profile_id` отсутствует `ON DELETE CASCADE`:
```sql
FOREIGN KEY (profile_id) REFERENCES profiles(id)  -- без CASCADE
```
После участия профиля в авто-ране в `run_tasks` появляются строки с его ID. При попытке DELETE SQLite блокирует операцию из-за FK-constraint.

## План реализации

### 1. `src/db/schema.js` — миграция run_tasks + исправление исходного SQL

**Исходный SQL (строка 68):**
- Добавить `ON DELETE CASCADE` к `FOREIGN KEY (profile_id) REFERENCES profiles(id)`

**Миграция (migrateTables):**
- Проверить, существует ли CASCADE (по `sqlite_master.sql`)
- Если нет — recreate таблицу в транзакции:
  1. `PRAGMA foreign_keys = OFF`
  2. `CREATE TABLE run_tasks_new (... WITH CASCADE)`
  3. `INSERT INTO run_tasks_new SELECT * FROM run_tasks`
  4. `DROP TABLE run_tasks`
  5. `ALTER TABLE run_tasks_new RENAME TO run_tasks`
  6. Создать индексы
  7. `PRAGMA foreign_keys = ON`

### 2. `src/api/profiles.js:171-186` — обработка ошибок DELETE

- Обернуть `queries.delete()` в try/catch
- Ловить `SqliteError`, возвращать понятное сообщение
- Логировать ошибку с profileId

### 3. `gui/src/renderer/stores/profiles.js:35-38` — обработка ошибок в `remove()`

- Добавить try/catch
- Показывать уведомление через `message.error()`

### 4. `gui/src/renderer/views/Profiles.vue:284-298` — error handling в handleContext/bulkDelete
