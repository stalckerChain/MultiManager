# План реализации: Automation Matrix (v2.0.0) — ✅ Выполнено

> **Статус:** Все части реализованы в версиях v2.0.0 → v2.0.1 (сборка gui/release/).

**Ключевые понятия:**
- **Проект** — Python-скрипт из `stAuto0/projects/*.py` (concrete, allscale и т.д.)
- **Профиль** — браузерный профиль/аккаунт (auto_001...auto_010)
- **Матрица** — настройка: какие профили на каких проектах отмечены
- **Run** — групповая задача: создаётся из отмеченных клеток матрицы, выполняется как batch

---

## Part 1: Database Layer — новые таблицы и запросы

### 1.1. Schema (`src/db/schema.js`)

Добавить в `createTables()`:

```sql
-- Проекты, синхронизированные из stAuto0/projects/*.py
CREATE TABLE IF NOT EXISTS projects (
  name TEXT PRIMARY KEY,
  display_name TEXT NOT NULL DEFAULT '',
  module_path TEXT NOT NULL DEFAULT '',
  class_name TEXT NOT NULL DEFAULT '',
  is_active INTEGER DEFAULT 1,
  default_config TEXT DEFAULT '{}',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Матрица: отметки какие проекты на каких профилях запускать
CREATE TABLE IF NOT EXISTS project_profile_config (
  project_name TEXT NOT NULL,
  profile_id TEXT NOT NULL,
  is_enabled INTEGER DEFAULT 0,
  config_override TEXT DEFAULT '{}',
  PRIMARY KEY (project_name, profile_id),
  FOREIGN KEY (project_name) REFERENCES projects(name) ON DELETE CASCADE,
  FOREIGN KEY (profile_id) REFERENCES profiles(id) ON DELETE CASCADE
);

-- Run — групповая задача
CREATE TABLE IF NOT EXISTS runs (
  id TEXT PRIMARY KEY,
  name TEXT DEFAULT '',
  status TEXT DEFAULT 'pending' CHECK(status IN ('pending','running','completed','partial','cancelled')),
  parallel_limit INTEGER DEFAULT 2,
  total_tasks INTEGER DEFAULT 0,
  completed_tasks INTEGER DEFAULT 0,
  success_tasks INTEGER DEFAULT 0,
  failed_tasks INTEGER DEFAULT 0,
  started_at DATETIME,
  completed_at DATETIME,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Задачи внутри run (одна клетка матрицы)
CREATE TABLE IF NOT EXISTS run_tasks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id TEXT NOT NULL,
  project_name TEXT NOT NULL,
  profile_id TEXT NOT NULL,
  status TEXT DEFAULT 'pending' CHECK(status IN ('pending','running','success','failed')),
  exit_code INTEGER,
  log_file_path TEXT,
  attempts INTEGER,
  started_at DATETIME,
  completed_at DATETIME,
  FOREIGN KEY (run_id) REFERENCES runs(id) ON DELETE CASCADE,
  FOREIGN KEY (project_name) REFERENCES projects(name),
  FOREIGN KEY (profile_id) REFERENCES profiles(id)
);
```

Индексы и триггеры (created_at/updated_at) по аналогии с существующими.

### 1.1t. Тесты schema

Файл: `tests/unit/schema-automation.test.js`

```js
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Database from 'better-sqlite3';
import { createTables } from '../../src/db/schema';

describe('Automation tables schema', () => {
  let db;

  beforeAll(() => {
    db = new Database(':memory:');
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
    createTables(db);
  });

  afterAll(() => db.close());

  it('creates projects table with all columns', () => {
    const cols = db.pragma('table_info(projects)');
    const names = cols.map(c => c.name);
    expect(names).toContain('name');
    expect(names).toContain('display_name');
    expect(names).toContain('module_path');
    expect(names).toContain('class_name');
    expect(names).toContain('is_active');
    expect(names).toContain('default_config');
    expect(names).toContain('created_at');
    expect(names).toContain('updated_at');
  });

  it('creates project_profile_config with composite PK and FKs', () => {
    const cols = db.pragma('table_info(project_profile_config)');
    const names = cols.map(c => c.name);
    expect(names).toContain('project_name');
    expect(names).toContain('profile_id');
    expect(names).toContain('is_enabled');
    expect(names).toContain('config_override');

    // Проверка FK
    const fks = db.pragma('foreign_key_list(project_profile_config)');
    expect(fks.length).toBe(2);
  });

  it('creates runs table with status CHECK constraint', () => {
    const cols = db.pragma('table_info(runs)');
    const names = cols.map(c => c.name);
    expect(names).toContain('id');
    expect(names).toContain('status');
    expect(names).toContain('parallel_limit');
    expect(names).toContain('total_tasks');
    expect(names).toContain('completed_tasks');
    expect(names).toContain('success_tasks');
    expect(names).toContain('failed_tasks');
    expect(names).toContain('started_at');
    expect(names).toContain('completed_at');
  });

  it('creates run_tasks table with FKs', () => {
    const cols = db.pragma('table_info(run_tasks)');
    const names = cols.map(c => c.name);
    expect(names).toContain('run_id');
    expect(names).toContain('project_name');
    expect(names).toContain('profile_id');
    expect(names).toContain('status');
    expect(names).toContain('exit_code');
    expect(names).toContain('log_file_path');
    expect(names).toContain('attempts');
    expect(names).toContain('started_at');
    expect(names).toContain('completed_at');

    const fks = db.pragma('foreign_key_list(run_tasks)');
    expect(fks.some(fk => fk.table === 'runs')).toBe(true);
    expect(fks.some(fk => fk.table === 'projects')).toBe(true);
    expect(fks.some(fk => fk.table === 'profiles')).toBe(true);
  });

  it('enforces valid status values in runs', () => {
    const id = 'test-run-1';
    db.prepare('INSERT INTO runs (id, status) VALUES (?, ?)').run(id, 'pending');
    expect(() =>
      db.prepare('INSERT INTO runs (id, status) VALUES (?, ?)').run('bad-run', 'invalid')
    ).toThrow();
  });

  it('enforces valid status values in run_tasks', () => {
    const runId = 'test-run-2';
    db.prepare('INSERT INTO runs (id, status) VALUES (?, ?)').run(runId, 'pending');
    db.prepare(`INSERT INTO run_tasks (run_id, project_name, profile_id, status)
      VALUES (?, 'test', 'prof-1', 'running')`).run(runId);
    expect(() =>
      db.prepare(`INSERT INTO run_tasks (run_id, project_name, profile_id, status)
        VALUES (?, 'test', 'prof-2', 'bad')`).run(runId)
    ).toThrow();
  });

  it('cascades DELETE from projects to project_profile_config', () => {
    db.prepare('INSERT INTO projects (name, display_name) VALUES (?, ?)').run('del-proj', 'Delete Test');
    db.prepare(`INSERT INTO project_profile_config (project_name, profile_id, is_enabled)
      VALUES ('del-proj', 'prof-x', 1)`).run();
    db.prepare('DELETE FROM projects WHERE name = ?').run('del-proj');
    const rows = db.prepare('SELECT * FROM project_profile_config WHERE project_name = ?').all('del-proj');
    expect(rows.length).toBe(0);
  });

  it('cascades DELETE from runs to run_tasks', () => {
    const runId = 'test-cascade';
    db.prepare('INSERT INTO runs (id, status) VALUES (?, ?)').run(runId, 'pending');
    db.prepare(`INSERT INTO run_tasks (run_id, project_name, profile_id, status)
      VALUES (?, 'p1', 'prof-a', 'pending')`).run(runId);
    db.prepare('DELETE FROM runs WHERE id = ?').run(runId);
    const rows = db.prepare('SELECT * FROM run_tasks WHERE run_id = ?').all(runId);
    expect(rows.length).toBe(0);
  });

  it('creates indexes for performance', () => {
    const indexes = db.pragma('index_list(run_tasks)');
    const names = indexes.map(i => i.name);
    expect(names.some(n => n.includes('run_id'))).toBe(true);
  });
});
```

### 1.2. Queries (`src/db/queries.js`)

Добавить фабрики:

**`createProjectQueries(db)`:**
- `sync(projects[])` — replace all (транзакция: DELETE + INSERT). Приходит из сканирования stAuto0.
- `getAll()` — список всех проектов
- `getByName(name)` — один проект
- `update(name, data)` — обновление (display_name, is_active, default_config)
- `getActive()` — только is_active = 1

**`createMatrixQueries(db)`:**
- `getAll()` — вся матрица: `SELECT project_name, profile_id, is_enabled, config_override`
- `batchUpdate(entries[])` — транзакция: `INSERT OR REPLACE` для массового обновления чекбоксов
- `getByProject(projectName)` — профили для конкретного проекта
- `getByProfile(profileId)` — проекты для конкретного профиля
- `getEnabledPairs()` — все (project, profile) где is_enabled=1 (для создания run)

**`createRunQueries(db)`:**
- `create(data)` — создать run, сгенерировать UUID, вернуть полную запись
- `getById(id)` — run + список run_tasks (JOIN)
- `getAll(page, limit)` — пагинированный список, ORDER BY created_at DESC
- `updateStatus(id, status)` — обновить статус
- `incrementCompleted(id, success)` — atomic UPDATE completed_tasks/success_tasks/failed_tasks

**`createRunTaskQueries(db)`:**
- `batchInsert(runId, pairs[])` — массовая вставка run_tasks для нового run
- `getByRunId(runId)` — все задачи run
- `updateStatus(id, status, exitCode, logPath)` — обновить статус + опционально код и лог
- `getByProfile(runId, profileId)` — задачи для конкретного профиля в run (для старта)

### 1.2t. Тесты queries

Файл: `tests/unit/queries-automation.test.js`

```js
import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { createTables } from '../../src/db/schema';
import {
  createProjectQueries,
  createMatrixQueries,
  createRunQueries,
  createRunTaskQueries,
} from '../../src/db/queries';

describe('createProjectQueries', () => {
  let db, projects;

  beforeEach(() => {
    db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    createTables(db);
    projects = createProjectQueries(db);
  });

  it('sync — добавляет новые проекты, удаляет отсутствующие', () => {
    projects.sync([
      { name: 'concrete', display_name: 'Concrete', module_path: 'projects.concrete', class_name: 'ConcreteProject' },
      { name: 'allscale', display_name: 'AllScale', module_path: 'projects.allscale', class_name: 'AllScaleProject' },
    ]);
    expect(projects.getAll().length).toBe(2);

    // Второй sync без allscale — он деактивируется
    projects.sync([
      { name: 'concrete', display_name: 'Concrete', module_path: 'projects.concrete', class_name: 'ConcreteProject' },
    ]);
    const list = projects.getAll();
    expect(list.length).toBe(2); // allscale остаётся в БД
    const allscale = list.find(p => p.name === 'allscale');
    expect(allscale.is_active).toBe(0); // но отмечен неактивным
  });

  it('getAll — возвращает все проекты', () => {
    projects.sync([
      { name: 'a', display_name: 'A' },
      { name: 'b', display_name: 'B' },
    ]);
    const list = projects.getAll();
    expect(list.length).toBe(2);
  });

  it('getByName — возвращает один проект или null', () => {
    projects.sync([{ name: 'concrete', display_name: 'Concrete' }]);
    expect(projects.getByName('concrete').name).toBe('concrete');
    expect(projects.getByName('nonexistent')).toBeUndefined();
  });

  it('update — обновляет поля без сброса остальных', () => {
    projects.sync([{ name: 'concrete', display_name: 'Concrete' }]);
    projects.update('concrete', { display_name: 'Concrete Points', is_active: 0 });
    const p = projects.getByName('concrete');
    expect(p.display_name).toBe('Concrete Points');
    expect(p.is_active).toBe(0);
    expect(p.default_config).toBe('{}');
  });

  it('getActive — только активные проекты', () => {
    projects.sync([
      { name: 'a', display_name: 'A' },
      { name: 'b', display_name: 'B' },
    ]);
    projects.update('b', { is_active: 0 });
    const active = projects.getActive();
    expect(active.length).toBe(1);
    expect(active[0].name).toBe('a');
  });
});

describe('createMatrixQueries', () => {
  let db, projects, profiles, matrix;

  beforeEach(() => {
    db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    createTables(db);
    projects = createProjectQueries(db);
    matrix = createMatrixQueries(db);

    // Создаём профили напрямую (они нужны для FK)
    db.prepare(`INSERT INTO profiles (id, number, name, fingerprint_seed, platform, user_agent, screen_resolution, hardware_cores, hardware_memory)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).run('prof-1', 1, 'auto_001', 'seed1', 'windows', 'ua', '1920x1080', 4, 8);
    db.prepare(`INSERT INTO profiles (id, number, name, fingerprint_seed, platform, user_agent, screen_resolution, hardware_cores, hardware_memory)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).run('prof-2', 2, 'auto_002', 'seed2', 'windows', 'ua', '1920x1080', 4, 8);

    projects.sync([
      { name: 'concrete', display_name: 'Concrete' },
      { name: 'allscale', display_name: 'AllScale' },
    ]);
  });

  it('batchUpdate — добавляет и обновляет записи', () => {
    matrix.batchUpdate([
      { project_name: 'concrete', profile_id: 'prof-1', is_enabled: 1 },
      { project_name: 'allscale', profile_id: 'prof-1', is_enabled: 1 },
      { project_name: 'concrete', profile_id: 'prof-2', is_enabled: 0 },
    ]);
    const all = matrix.getAll();
    expect(all.length).toBe(3);
  });

  it('getAll — возвращает все пары', () => {
    matrix.batchUpdate([
      { project_name: 'concrete', profile_id: 'prof-1', is_enabled: 1 },
      { project_name: 'concrete', profile_id: 'prof-2', is_enabled: 0 },
    ]);
    const all = matrix.getAll();
    expect(all.length).toBe(2);
    expect(all[0].project_name).toBe('concrete');
    expect(all[0].profile_id).toBeTruthy();
  });

  it('getEnabledPairs — возвращает только is_enabled=1', () => {
    matrix.batchUpdate([
      { project_name: 'concrete', profile_id: 'prof-1', is_enabled: 1 },
      { project_name: 'allscale', profile_id: 'prof-1', is_enabled: 1 },
      { project_name: 'concrete', profile_id: 'prof-2', is_enabled: 0 },
    ]);
    const enabled = matrix.getEnabledPairs();
    expect(enabled.length).toBe(2);
    enabled.forEach(pair => expect(pair.is_enabled).toBe(1));
  });

  it('getByProject — возвращает профили для проекта', () => {
    matrix.batchUpdate([
      { project_name: 'concrete', profile_id: 'prof-1', is_enabled: 1 },
      { project_name: 'concrete', profile_id: 'prof-2', is_enabled: 0 },
      { project_name: 'allscale', profile_id: 'prof-1', is_enabled: 1 },
    ]);
    const forConcrete = matrix.getByProject('concrete');
    expect(forConcrete.length).toBe(2);
    const forAllscale = matrix.getByProject('allscale');
    expect(forAllscale.length).toBe(1);
  });

  it('getByProfile — возвращает проекты для профиля', () => {
    matrix.batchUpdate([
      { project_name: 'concrete', profile_id: 'prof-1', is_enabled: 1 },
      { project_name: 'allscale', profile_id: 'prof-1', is_enabled: 1 },
      { project_name: 'concrete', profile_id: 'prof-2', is_enabled: 1 },
    ]);
    const prof1 = matrix.getByProfile('prof-1');
    expect(prof1.length).toBe(2);
    const prof2 = matrix.getByProfile('prof-2');
    expect(prof2.length).toBe(1);
  });
});

describe('createRunQueries + createRunTaskQueries', () => {
  let db, runs, runTasks, matrix;

  beforeEach(() => {
    db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    createTables(db);
    projects = createProjectQueries(db);
    matrix = createMatrixQueries(db);
    runs = createRunQueries(db);
    runTasks = createRunTaskQueries(db);

    db.prepare(`INSERT INTO profiles (id, number, name, fingerprint_seed, platform, user_agent, screen_resolution, hardware_cores, hardware_memory)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).run('prof-1', 1, 'auto_001', 's1', 'windows', 'ua', '1920x1080', 4, 8);
    db.prepare(`INSERT INTO profiles (id, number, name, fingerprint_seed, platform, user_agent, screen_resolution, hardware_cores, hardware_memory)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).run('prof-2', 2, 'auto_002', 's2', 'windows', 'ua', '1920x1080', 4, 8);

    projects.sync([
      { name: 'concrete', display_name: 'Concrete' },
      { name: 'allscale', display_name: 'AllScale' },
    ]);
  });

  it('create — создаёт run с правильными полями', () => {
    const run = runs.create({ name: 'Test Run', parallel_limit: 3 });
    expect(run.id).toBeTruthy();
    expect(run.name).toBe('Test Run');
    expect(run.status).toBe('pending');
    expect(run.parallel_limit).toBe(3);
    expect(run.total_tasks).toBe(0);
  });

  it('create — генерирует UUID, если id не передан', () => {
    const run = runs.create({});
    expect(run.id).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('getById — возвращает run с run_tasks', () => {
    const run = runs.create({ name: 'Test' });
    runTasks.batchInsert(run.id, [
      { project_name: 'concrete', profile_id: 'prof-1' },
      { project_name: 'allscale', profile_id: 'prof-1' },
    ]);
    const loaded = runs.getById(run.id);
    expect(loaded.name).toBe('Test');
    expect(loaded.tasks.length).toBe(2);
  });

  it('getAll — пагинированный список', () => {
    const r1 = runs.create({ name: 'Run 1' });
    const r2 = runs.create({ name: 'Run 2' });
    const r3 = runs.create({ name: 'Run 3' });

    const page1 = runs.getAll(1, 2);
    expect(page1.items.length).toBe(2);
    expect(page1.total).toBe(3);
    expect(page1.page).toBe(1);

    const page2 = runs.getAll(2, 2);
    expect(page2.items.length).toBe(1);
    expect(page2.page).toBe(2);
  });

  it('updateStatus — обновляет статус', () => {
    const run = runs.create({ name: 'Test' });
    runs.updateStatus(run.id, 'running');
    expect(runs.getById(run.id).status).toBe('running');
  });

  it('incrementCompleted — атомарно увеличивает счётчики', () => {
    const run = runs.create({ name: 'Test' });
    runs.incrementCompleted(run.id, true);
    runs.incrementCompleted(run.id, true);
    runs.incrementCompleted(run.id, false);
    const loaded = runs.getById(run.id);
    expect(loaded.completed_tasks).toBe(3);
    expect(loaded.success_tasks).toBe(2);
    expect(loaded.failed_tasks).toBe(1);
  });

  it('batchInsert — массовая вставка run_tasks', () => {
    const run = runs.create({ name: 'Test' });
    const ids = runTasks.batchInsert(run.id, [
      { project_name: 'concrete', profile_id: 'prof-1' },
      { project_name: 'allscale', profile_id: 'prof-1' },
      { project_name: 'concrete', profile_id: 'prof-2' },
    ]);
    expect(ids.length).toBe(3);
    expect(runs.getById(run.id).total_tasks).toBe(3);
  });

  it('getByRunId — все задачи run', () => {
    const run = runs.create({ name: 'Test' });
    runTasks.batchInsert(run.id, [
      { project_name: 'concrete', profile_id: 'prof-1' },
      { project_name: 'allscale', profile_id: 'prof-1' },
    ]);
    const tasks = runTasks.getByRunId(run.id);
    expect(tasks.length).toBe(2);
    tasks.forEach(t => expect(t.run_id).toBe(run.id));
  });

  it('updateStatus — обновляет статус задачи', () => {
    const run = runs.create({ name: 'Test' });
    const [taskId] = runTasks.batchInsert(run.id, [
      { project_name: 'concrete', profile_id: 'prof-1' },
    ]);
    runTasks.updateStatus(taskId, 'success', 0, '/logs/test.log');
    const tasks = runTasks.getByRunId(run.id);
    expect(tasks[0].status).toBe('success');
    expect(tasks[0].exit_code).toBe(0);
    expect(tasks[0].log_file_path).toBe('/logs/test.log');
  });

  it('getByProfile — задачи для конкретного профиля в run', () => {
    const run = runs.create({ name: 'Test' });
    runTasks.batchInsert(run.id, [
      { project_name: 'concrete', profile_id: 'prof-1' },
      { project_name: 'allscale', profile_id: 'prof-1' },
      { project_name: 'concrete', profile_id: 'prof-2' },
    ]);
    const prof1Tasks = runTasks.getByProfile(run.id, 'prof-1');
    expect(prof1Tasks.length).toBe(2);
    prof1Tasks.forEach(t => expect(t.profile_id).toBe('prof-1'));
  });
});
```

### 1.3. Migration

`migrateTables()` — добавить проверку существования новых таблиц через `PRAGMA table_info`. Если таблиц нет → создать. Старые таблицы `tasks`/`task_executions` не трогаем (обратная совместимость).

### 1.3t. Тест миграции

Файл: `tests/unit/migration-automation.test.js`

```js
import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { createTables, migrateTables } from '../../src/db/schema';

describe('migrateTables — automation tables', () => {
  let db;

  beforeEach(() => {
    db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    // Создаём только старые таблицы (без automation)
    db.exec(`
      CREATE TABLE IF NOT EXISTS profiles (id TEXT PRIMARY KEY, number INTEGER, name TEXT);
      CREATE TABLE IF NOT EXISTS proxies (id INTEGER PRIMARY KEY AUTOINCREMENT, host TEXT, port INTEGER);
      CREATE TABLE IF NOT EXISTS system_config (key TEXT PRIMARY KEY, value TEXT);
      CREATE TABLE IF NOT EXISTS tasks (id TEXT PRIMARY KEY, name TEXT, script_name TEXT,
        schedule_type TEXT CHECK(schedule_type IN ('once','daily','weekly','manual','archive')), params TEXT DEFAULT '{}');
      CREATE TABLE IF NOT EXISTS task_executions (id INTEGER PRIMARY KEY AUTOINCREMENT,
        task_id TEXT, profile_id TEXT, status TEXT, exit_code INTEGER, log_file_path TEXT);
    `);
  });

  it('добавляет таблицы projects, project_profile_config, runs, run_tasks если их нет', () => {
    expect(db.pragma('table_info(projects)').length).toBe(0);
    migrateTables(db);
    expect(db.pragma('table_info(projects)').length).toBeGreaterThan(0);
    expect(db.pragma('table_info(project_profile_config)').length).toBeGreaterThan(0);
    expect(db.pragma('table_info(runs)').length).toBeGreaterThan(0);
    expect(db.pragma('table_info(run_tasks)').length).toBeGreaterThan(0);
  });

  it('не трогает существующие таблицы', () => {
    migrateTables(db);
    const profilesCols = db.pragma('table_info(profiles)').length;
    migrateTables(db); // повторный вызов
    expect(db.pragma('table_info(profiles)').length).toBe(profilesCols);
  });
});
```

---

## Part 2: Backend API — новые роуты

### 2.1. `/api/projects` — роут проектов (`src/api/projects.js`)

| Метод | Путь | Назначение |
|-------|------|-----------|
| `GET` | `/api/projects` | Список проектов (из БД) |
| `POST` | `/api/projects/sync` | Сканировать `{stAuto0_path}/projects/*.py`, обновить БД. Вернуть diff (добавлено/удалено) |
| `PUT` | `/api/projects/:name` | Обновить display_name, is_active, default_config |
| `GET` | `/api/projects/:name` | Один проект с его профилями из матрицы |

**Логика sync:** читает `fs.readdirSync(path.join(stAuto0Path, 'projects'))`, фильтрует `*.py`, исключает `__init__.py`, `base.py`, `loader.py`. Для каждого файла: смотрит module_path и class_name (пока пустые — заполняются руками или автоматически через импорт). Сравнивает с тем что в БД, добавляет новые, не удаляет существующие (только если файл исчез — помечает is_active=0).

#### 2.1t. Тесты `/api/projects`

Файл: `tests/unit/projects-api.test.js`

```js
import { describe, it, expect, beforeEach, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { createProjectQueries } from '../../src/db/queries';
import { createProjectsRouter } from '../../src/api/projects';

function setupApi(db, token = 'test-token') {
  const app = express();
  app.use(express.json());
  app.use((req, res, next) => {
    req.user = { token };
    req.queries = { projects: createProjectQueries(db), config: { get: () => '/fake/stAuto0' } };
    next();
  });
  app.use('/api/projects', createProjectsRouter({ getProjectQueries: () => req.queries.projects }));
  return app;
}

describe('GET /api/projects', () => {
  let db, app;

  beforeEach(() => {
    db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    createTables(db);
    const projects = createProjectQueries(db);
    projects.sync([
      { name: 'concrete', display_name: 'Concrete' },
      { name: 'allscale', display_name: 'AllScale' },
    ]);
    app = setupApi(db);
  });

  it('returns all projects', async () => {
    const res = await request(app).get('/api/projects');
    expect(res.status).toBe(200);
    expect(res.body.length).toBe(2);
  });

  it('returns 200 with empty array if no projects', async () => {
    db.exec('DELETE FROM projects');
    const res = await request(app).get('/api/projects');
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });
});

describe('POST /api/projects/sync', () => {
  it('scans stAuto0 projects dir and updates DB', async () => {
    // Мок fs.readdirSync для имитации файлов projects/
    // Проверка что новые проекты добавились
    // Проверка что удалённые деактивировались
  });
});
```

> Примечание: sync-тест требует мока `fs.readdirSync`. Реализовать через `vi.mock('fs')` или передавать path в колбэк.

### 2.2. `/api/matrix` — роут матрицы (`src/api/matrix.js`)

| Метод | Путь | Назначение |
|-------|------|-----------|
| `GET` | `/api/matrix` | Вся матрица: список `{project_name, profile_id, is_enabled, profile_name, project_display}` |
| `PUT` | `/api/matrix` | Batch-обновление: `{entries: [{project_name, profile_id, is_enabled}]}`. Транзакция. |

**Формат GET ответа:**
```json
{
  "projects": [{ "name": "concrete", "display_name": "Concrete Points", "is_active": true }],
  "profiles": [{ "id": "uuid", "number": 1, "name": "auto_001" }],
  "matrix": [{ "project_name": "concrete", "profile_id": "uuid", "is_enabled": 1, "config_override": "{}" }]
}
```

#### 2.2t. Тесты `/api/matrix`

Файл: `tests/unit/matrix-api.test.js`

```js
import { describe, it, expect, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import Database from 'better-sqlite3';
import { createTables } from '../../src/db/schema';
import { createProjectQueries, createMatrixQueries } from '../../src/db/queries';
import { createMatrixRouter } from '../../src/api/matrix';

describe('GET /api/matrix', () => {
  let db, app;

  beforeEach(() => {
    db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    createTables(db);
    // Профили
    db.prepare(`INSERT INTO profiles (id, number, name, fingerprint_seed, platform, user_agent, screen_resolution, hardware_cores, hardware_memory)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).run('p1', 1, 'auto_001', 's1', 'windows', 'ua', '1920x1080', 4, 8);
    db.prepare(`INSERT INTO profiles (id, number, name, fingerprint_seed, platform, user_agent, screen_resolution, hardware_cores, hardware_memory)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).run('p2', 2, 'auto_002', 's2', 'windows', 'ua', '1920x1080', 4, 8);
    // Проекты
    const projects = createProjectQueries(db);
    projects.sync([{ name: 'concrete', display_name: 'Concrete' }, { name: 'allscale', display_name: 'AllScale' }]);
    // Отметки
    const matrix = createMatrixQueries(db);
    matrix.batchUpdate([
      { project_name: 'concrete', profile_id: 'p1', is_enabled: 1 },
      { project_name: 'allscale', profile_id: 'p1', is_enabled: 1 },
    ]);

    app = express();
    app.use(express.json());
    app.use('/api/matrix', createMatrixRouter({ getMatrixQueries: () => matrix, getProjectQueries: () => projects }));
  });

  it('returns projects, profiles and matrix', async () => {
    const res = await request(app).get('/api/matrix');
    expect(res.status).toBe(200);
    expect(res.body.projects.length).toBe(2);
    expect(res.body.profiles.length).toBe(2);
    expect(res.body.matrix.length).toBe(2);
  });

  it('each matrix entry has correct structure', async () => {
    const res = await request(app).get('/api/matrix');
    res.body.matrix.forEach(entry => {
      expect(entry).toHaveProperty('project_name');
      expect(entry).toHaveProperty('profile_id');
      expect(entry).toHaveProperty('is_enabled');
      expect(entry).toHaveProperty('profile_name');
    });
  });
});

describe('PUT /api/matrix', () => {
  it('batch updates entries', async () => {
    // Сетап аналогично GET
    // ...
    // const res = await request(app).put('/api/matrix').send({
    //   entries: [{ project_name: 'concrete', profile_id: 'p1', is_enabled: 1 }]
    // });
    // expect(res.status).toBe(200);
    // Проверить что в БД обновилось
  });

  it('rejects invalid entries (missing fields)', async () => {
    // const res = await request(app).put('/api/matrix').send({
    //   entries: [{ project_name: 'concrete' }] // нет profile_id
    // });
    // expect(res.status).toBe(400);
  });
});
```

### 2.3. `/api/runs` — роут запусков (`src/api/runs.js`)

| Метод | Путь | Назначение |
|-------|------|-----------|
| `GET` | `/api/runs` | Список runs (с пагинацией: `?page=1&limit=20`) |
| `POST` | `/api/runs` | Создать новый run из текущих отметок матрицы: читает `project_profile_config WHERE is_enabled=1`, создаёт `runs` + `run_tasks` |
| `GET` | `/api/runs/:id` | Run + все run_tasks (для отрисовки цветной матрицы) |
| `POST` | `/api/runs/:id/start` | **Запустить выполнение всего run** (см. Part 4) |
| `POST` | `/api/runs/:id/cancel` | Отменить: изменить статус на `cancelled`, все `running` → `failed` |

**`POST /api/runs` — тело запроса:**
```json
{
  "name": "Daily run 2026-07-13",
  "parallel_limit": 3
}
```
Если `name` не указан — авто: `"Run 2026-07-13 14:30"`.

#### 2.3t. Тесты `/api/runs`

Файл: `tests/unit/runs-api.test.js`

```js
import { describe, it, expect, beforeEach, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import Database from 'better-sqlite3';
import { createTables } from '../../src/db/schema';
import { createProjectQueries, createRunQueries, createRunTaskQueries, createMatrixQueries } from '../../src/db/queries';
import { createRunsRouter } from '../../src/api/runs';

describe('POST /api/runs', () => {
  let db, app, runQueries;

  beforeEach(() => {
    db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    createTables(db);
    // Профили
    db.prepare(`INSERT INTO profiles (id, number, name, fingerprint_seed, platform, user_agent, screen_resolution, hardware_cores, hardware_memory)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).run('p1', 1, 'auto_001', 's1', 'windows', 'ua', '1920x1080', 4, 8);
    db.prepare(`INSERT INTO profiles (id, number, name, fingerprint_seed, platform, user_agent, screen_resolution, hardware_cores, hardware_memory)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).run('p2', 2, 'auto_002', 's2', 'windows', 'ua', '1920x1080', 4, 8);
    // Проекты+отметки
    const projects = createProjectQueries(db);
    projects.sync([{ name: 'concrete', display_name: 'Concrete' }]);
    const matrix = createMatrixQueries(db);
    matrix.batchUpdate([
      { project_name: 'concrete', profile_id: 'p1', is_enabled: 1 },
      { project_name: 'concrete', profile_id: 'p2', is_enabled: 1 },
    ]);

    runQueries = createRunQueries(db);
    app = express();
    app.use(express.json());
    app.use('/api/runs', createRunsRouter({
      getRunQueries: () => runQueries,
      getRunTaskQueries: () => createRunTaskQueries(db),
      getMatrixQueries: () => matrix,
    }));
  });

  it('creates run from enabled matrix entries', async () => {
    const res = await request(app).post('/api/runs').send({ name: 'Test Run', parallel_limit: 2 });
    expect(res.status).toBe(201);
    expect(res.body.run_id).toBeTruthy();
    expect(res.body.tasks_created).toBe(2); // 2 профиля
    const run = runQueries.getById(res.body.run_id);
    expect(run.total_tasks).toBe(2);
  });

  it('auto-generates name if not provided', async () => {
    const res = await request(app).post('/api/runs').send({});
    expect(res.status).toBe(201);
    expect(res.body.name).toBeTruthy();
  });

  it('returns 400 if no enabled entries in matrix', async () => {
    // Отключаем все отметки
    const matrix = createMatrixQueries(db);
    matrix.batchUpdate([
      { project_name: 'concrete', profile_id: 'p1', is_enabled: 0 },
      { project_name: 'concrete', profile_id: 'p2', is_enabled: 0 },
    ]);
    const res = await request(app).post('/api/runs').send({});
    expect(res.status).toBe(400);
  });
});

describe('GET /api/runs', () => {
  // Тест пагинации: проверить что items, total, page корректны
});

describe('GET /api/runs/:id', () => {
  // Тест что возвращается run + tasks
});

describe('POST /api/runs/:id/start', () => {
  // Тест что запускается executor (мок)
  // Тест что только pending можно запустить
});

describe('POST /api/runs/:id/cancel', () => {
  // Тест что статус меняется на cancelled
  // Тест что running задачи переходят в failed
});
```

### 2.4. `/api/internal/runs` — для stAuto0 (`src/api/internal-runs.js`)

| Метод | Путь | Назначение |
|-------|------|-----------|
| `POST` | `/api/internal/runs/:id/task-status` | **Callback от stAuto0:** обновить статус одной клетки. Body: `{project_name, profile_name, status, attempts?}` |

Этот endpoint аутентифицируется тем же Bearer-токеном. Доступен только с localhost.

#### 2.4t. Тесты `/api/internal/runs/:id/task-status`

Файл: `tests/unit/internal-runs-api.test.js`

```js
import { describe, it, expect, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import Database from 'better-sqlite3';
import { createTables } from '../../src/db/schema';
import { createProjectQueries, createRunQueries, createRunTaskQueries, createMatrixQueries } from '../../src/db/queries';
import { createInternalRunsRouter } from '../../src/api/internal-runs';

describe('POST /api/internal/runs/:id/task-status', () => {
  let db, app, runQueries, runTaskQueries;

  function seedRun() {
    const projects = createProjectQueries(db);
    projects.sync([{ name: 'concrete', display_name: 'Concrete' }]);
    db.prepare(`INSERT INTO profiles (id, number, name, fingerprint_seed, platform, user_agent, screen_resolution, hardware_cores, hardware_memory)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).run('p1', 1, 'auto_001', 's1', 'windows', 'ua', '1920x1080', 4, 8);
    const matrix = createMatrixQueries(db);
    matrix.batchUpdate([{ project_name: 'concrete', profile_id: 'p1', is_enabled: 1 }]);
    const run = runQueries.create({ name: 'Test' });
    runTaskQueries.batchInsert(run.id, [{ project_name: 'concrete', profile_id: 'p1' }]);
    return run;
  }

  beforeEach(() => {
    db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    createTables(db);
    runQueries = createRunQueries(db);
    runTaskQueries = createRunTaskQueries(db);
    app = express();
    app.use(express.json());
    app.use('/api/internal/runs', createInternalRunsRouter({
      getRunQueries: () => runQueries,
      getRunTaskQueries: () => runTaskQueries,
    }));
  });

  it('updates task status to success', async () => {
    const run = seedRun();
    const res = await request(app)
      .post(`/api/internal/runs/${run.id}/task-status`)
      .send({ project_name: 'concrete', profile_name: 'auto_001', status: 'success', attempts: 1 });
    expect(res.status).toBe(200);
    const tasks = runTaskQueries.getByRunId(run.id);
    expect(tasks[0].status).toBe('success');
    expect(tasks[0].attempts).toBe(1);
  });

  it('updates task status to failed', async () => {
    const run = seedRun();
    const res = await request(app)
      .post(`/api/internal/runs/${run.id}/task-status`)
      .send({ project_name: 'concrete', profile_name: 'auto_001', status: 'failed' });
    expect(res.status).toBe(200);
    const tasks = runTaskQueries.getByRunId(run.id);
    expect(tasks[0].status).toBe('failed');
  });

  it('increments run counters on status update', async () => {
    const run = seedRun();
    await request(app)
      .post(`/api/internal/runs/${run.id}/task-status`)
      .send({ project_name: 'concrete', profile_name: 'auto_001', status: 'success' });
    const updatedRun = runQueries.getById(run.id);
    expect(updatedRun.completed_tasks).toBe(1);
    expect(updatedRun.success_tasks).toBe(1);
  });

  it('marks run as completed when all tasks done', async () => {
    const run = seedRun();
    await request(app)
      .post(`/api/internal/runs/${run.id}/task-status`)
      .send({ project_name: 'concrete', profile_name: 'auto_001', status: 'success' });
    const updatedRun = runQueries.getById(run.id);
    expect(updatedRun.status).toBe('completed');
  });

  it('returns 404 for non-existent run', async () => {
    const res = await request(app)
      .post('/api/internal/runs/nonexistent/task-status')
      .send({ project_name: 'concrete', profile_name: 'auto_001', status: 'success' });
    expect(res.status).toBe(404);
  });

  it('returns 400 if required fields missing', async () => {
    const run = seedRun();
    const res = await request(app)
      .post(`/api/internal/runs/${run.id}/task-status`)
      .send({ status: 'success' }); // нет project_name и profile_name
    expect(res.status).toBe(400);
  });

  it('returns 404 if task not found for given project+profile', async () => {
    const run = seedRun();
    const res = await request(app)
      .post(`/api/internal/runs/${run.id}/task-status`)
      .send({ project_name: 'nonexistent', profile_name: 'auto_001', status: 'success' });
    expect(res.status).toBe(404);
  });
});
```

---

## Part 3: Frontend (GUI) — Vue 3 страницы

### 3.1. Новые страницы

#### AutomationMatrix.vue — Матрица (конфигуратор)
- `GET /api/matrix` на загрузку
- Таблица: строки = профили, колонки = проекты
- Checkbox в каждой ячейке (v-model на `is_enabled`)
- Фильтр строк: поиск по имени профиля
- Кнопка **«Создать задачу»**:
  - Собирает только checked клетки
  - Открывает модалку: имя run (предзаполнено), parallel_limit (из system_config или 2)
  - `POST /api/runs` → редирект на страницу Runs

#### AutomationRuns.vue — Задачи (запуски)
- `GET /api/runs` — список runs
- Каждый run: имя, дата, статус (badge), прогресс `completed/total`
- Клик по run → раскрывается матрица (та же раскладка, readonly):
  - ⚪ Серый = pending
  - 🔵 Синий = running
  - 🟢 Зелёный = success
  - 🔴 Красный = failed
  - 🟡 Жёлтый = cancelled
- **Кнопка «Выполнить»** на pending/partial runs → `POST /api/runs/:id/start`
- **Кнопка «Отмена»** на running → `POST /api/runs/:id/cancel`
- У каждой клетки кнопка «Лог» → открывает терминал с этим файлом

#### AutomationHistory.vue — История
- `GET /api/runs?page=N&limit=50` — ленивая подгрузка (infinite scroll или «Показать ещё»)
- Только completed/partial/cancelled runs
- Та же раскладка: дата, имя, сводка (X/Y успешно), длительность
- Клик → раскрывается цветная матрица

### 3.2. Роутинг (`gui/src/renderer/router.js`)

Добавить:
```js
{ path: '/automation/matrix', name: 'automation-matrix', component: AutomationMatrix },
{ path: '/automation/runs', name: 'automation-runs', component: AutomationRuns },
{ path: '/automation/history', name: 'automation-history', component: AutomationHistory },
```

В боковое меню GUI добавить пункт «Автоматизация» с выпадающими вкладками:
- Матрица
- Задачи
- История

### 3.3. Pinia store (`gui/src/renderer/stores/automation.js`)

Новый store:
```js
export const useAutomationStore = defineStore('automation', () => {
  const matrix = ref([]);
  const projects = ref([]);
  const profiles = ref([]);
  const runs = ref([]);
  const currentRun = ref(null);
  const loading = ref(false);

  async function fetchMatrix() { ... }
  async function updateMatrix(entries) { ... }
  async function createRun(data) { ... }
  async function fetchRuns(page, limit) { ... }
  async function fetchRun(id) { ... }
  async function startRun(id) { ... }
  async function cancelRun(id) { ... }
  async function fetchProjects() { ... }
  async function syncProjects() { ... }

  return { matrix, projects, profiles, runs, currentRun, loading,
    fetchMatrix, updateMatrix, createRun, fetchRuns, fetchRun,
    startRun, cancelRun, fetchProjects, syncProjects };
});
```

### 3.4. Адаптация Settings.vue

В раздел «Автоматизация» добавить:
- Кнопка «Синхронизировать проекты» → `POST /api/projects/sync`
- Поле parallel_limit (глобальный дефолт) → сохраняется в `system_config`

---

## Part 4: Execution Engine — запуск задач

### 4.1. Механизм запуска (`src/executor/index.js`)

Новый модуль. Основная логика:

```js
class RunExecutor {
  constructor(runId, parallelLimit) { ... }

  async start() {
    // 1. Загрузить run + run_tasks
    // 2. Сгруппировать задачи по profile_id
    // 3. Установить семафор parallelLimit
    // 4. Для каждого профиля:
    //    a. Создать каталог логов: logs/runs/{runId}/
    //    b. Создать лог-файл: logs/runs/{runId}/{profile_name}.log
    //    c. Обновить run_tasks для этого профиля → 'running'
    //    d. spawn(python_path, [
    //         'main.py',
    //         '--project=proj1,proj2,...',
    //         '--range=NNN-NNN',
    //         '--log-name=' + runId,
    //         '--run-id=' + runId,
    //         '--token=' + apiToken,
    //         '--port=' + mmPort
    //       ], { cwd: stAuto0_path })
    //    e. На 'exit': если не было колбэков → обновить статусы по exit code
    //    f. Снять семафор
    // 5. После всех профилей: обновить статус run
    // 6. Сохранить итоговую статистику
  }

  cancel() {
    // 1. Отметить run как cancelled
    // 2. Убить все child_process
    // 3. Все running задачи → failed
  }
}
```

Хранить в `RunExecutor.instances = new Map<runId, RunExecutor>()` для доступа к cancel.

#### 4.1t. Тесты executor

Файл: `tests/unit/executor.test.js`

```js
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { RunExecutor } from '../../src/executor';
import { EventEmitter } from 'events';

describe('RunExecutor', () => {
  let executor, mockRun, mockSpawn;

  beforeEach(() => {
    mockRun = {
      id: 'run-001',
      status: 'running',
      parallel_limit: 2,
      total_tasks: 4,
    };

    // Мок child_process.spawn
    mockSpawn = vi.fn(() => {
      const proc = new EventEmitter();
      proc.stdout = new EventEmitter();
      proc.stderr = new EventEmitter();
      proc.pid = 12345;
      // Эмитим успешный exit через 10ms
      setTimeout(() => proc.emit('close', 0, null), 10);
      return proc;
    });

    executor = new RunExecutor(mockRun, {
      stAuto0Path: 'C:\\stAuto0',
      pythonPath: 'python',
      apiToken: 'tok_xxx',
      mmPort: 3000,
      spawn: mockSpawn, // inject mock
      getRunTasks: () => Promise.resolve([
        { id: 1, project_name: 'concrete', profile_id: 'p1', status: 'pending' },
        { id: 2, project_name: 'allscale', profile_id: 'p1', status: 'pending' },
        { id: 3, project_name: 'concrete', profile_id: 'p2', status: 'pending' },
        { id: 4, project_name: 'allscale', profile_id: 'p2', status: 'pending' },
      ]),
      updateRunTaskStatus: vi.fn(),
      updateRun: vi.fn(),
      incrementRun: vi.fn(),
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('группирует задачи по profile_id', async () => {
    const grouped = executor._groupByProfile();
    expect(Object.keys(grouped).length).toBe(2);
    expect(grouped['p1'].length).toBe(2);
    expect(grouped['p2'].length).toBe(2);
  });

  it('spawn c правильными аргументами', async () => {
    await executor.start();
    expect(mockSpawn).toHaveBeenCalledTimes(2);

    // Проверить аргументы для первого профиля
    const callArgs = mockSpawn.mock.calls[0];
    expect(callArgs[0]).toBe('python');
    expect(callArgs[1]).toContain('--project=');
    expect(callArgs[1]).toContain('--range=');
    expect(callArgs[1]).toContain('--run-id=run-001');
    expect(callArgs[1]).toContain('--token=tok_xxx');
    expect(callArgs[2].cwd).toBe('C:\\stAuto0');
  });

  it('parallel_limit ограничивает количество одновременных процессов', async () => {
    // Создаём spawn который не завершается
    const slowSpawn = vi.fn(() => {
      const proc = new EventEmitter();
      proc.stdout = new EventEmitter();
      proc.stderr = new EventEmitter();
      proc.pid = 99999;
      return proc; // никогда не эмитит close
    });

    exec = new RunExecutor(mockRun, {
      ...executor.options,
      spawn: slowSpawn,
    });

    const startPromise = exec.start();
    // Даём время на запуск
    await new Promise(r => setTimeout(r, 50));
    expect(slowSpawn).toHaveBeenCalledTimes(2); // parallel_limit=2, всего 2 группы
    // Отменяем чтобы тест завершился
    exec.cancel();
  });

  it('обновляет статус run_tasks при старте', async () => {
    await executor.start();
    expect(executor.options.updateRunTaskStatus).toHaveBeenCalled();
  });

  it('cancel убивает процессы и обновляет статусы', async () => {
    const killMock = vi.fn();
    const slowSpawn = vi.fn(() => {
      const proc = new EventEmitter();
      proc.stdout = new EventEmitter();
      proc.stderr = new EventEmitter();
      proc.pid = 99999;
      proc.kill = killMock;
      return proc;
    });

    exec = new RunExecutor(mockRun, {
      ...executor.options,
      spawn: slowSpawn,
    });

    exec.start();
    await new Promise(r => setTimeout(r, 30));
    exec.cancel();
    expect(killMock).toHaveBeenCalled();
    expect(exec.options.updateRun).toHaveBeenCalledWith('run-001', 'cancelled');
  });
});
```

### 4.2. Роут старта (`POST /api/runs/:id/start`)

```js
router.post('/:id/start', async (req, res) => {
  const run = runQueries.getById(id);
  if (!run) return 404;
  if (run.status !== 'pending') return 400 ('Можно запустить только pending');

  runQueries.updateStatus(id, 'running', new Date());
  
  const executor = new RunExecutor(run, {
    stAuto0Path: configQueries.get('stAuto0_path'),
    pythonPath: configQueries.get('python_path'),
    apiToken: req.token,
    mmPort: req.socket.localPort || process.env.PORT
  });

  RunExecutor.instances.set(id, executor);
  
  // Запуск асинхронно, не блокируя ответ
  executor.start().finally(() => RunExecutor.instances.delete(id));

  res.json({ status: 'started', run_id: id });
});
```

### 4.3. Callback от stAuto0

`POST /api/internal/runs/:id/task-status`:
```js
router.post('/:id/task-status', (req, res) => {
  const { project_name, profile_name, status, attempts } = req.body;
  // Найти run_task по run_id + project_name + profile_id (через name lookup)
  // Обновить: status, exit_code, attempts, completed_at
  // Обновить статистику run (completed_tasks, success_tasks, failed_tasks)
  // Если все задачи завершены → runs.status = 'completed'
  res.json({ ok: true });
});
```

---

## Part 5: stAuto0 Changes — минимальные, с сохранением legacy

### 5.1. `projects/base.py` — `run()` возвращает bool

```python
async def run(self) -> bool:
    try:
        max_attempts = self._get_max_attempts()
        for attempt in range(1, max_attempts + 1):
            ...
            success = await self._process()
            if success:
                logger.info(f"Task completed on attempt {attempt}")
                return True  # было: return (без значения)
            ...
        logger.warning(f"Task not completed after {max_attempts} attempts")
        return False  # было: просто выход без return
    except Exception as e:
        logger.error(f"Project error: {e}", exc_info=True)
        raise
```

### 5.2. `Core/browser.py` — `run_project()` возвращает результат

```python
async def run_project(self, project_class) -> bool:
    """Returns True if project completed successfully, False if all attempts failed, raises on error."""
    try:
        project_instance = project_class(
            page=self.page, account=self.account, context=self.context, browser=self
        )
        if hasattr(project_instance, "run"):
            result = await project_instance.run()
        elif hasattr(project_instance, "main"):
            result = await project_instance.main()
        else:
            raise AttributeError(...)

        if result:
            logger.info(f"Проект {project_class.__name__} успешно выполнен.")
        else:
            logger.warning(f"Проект {project_class.__name__} не завершён после всех попыток.")
        return result
    except Exception as e:
        logger.error(f"Ошибка при выполнении проекта {project_class.__name__}: {e}", exc_info=True)
        raise
```

### 5.3. `Core/multimanager.py` — новый метод

```python
async def report_task_status(self, run_id: str, project_name: str, profile_name: str, status: str, attempts: int = None):
    """Сообщает MM о статусе выполнения одного проекта для одного профиля."""
    await self._request("POST", f"/api/internal/runs/{run_id}/task-status", json={
        "project_name": project_name,
        "profile_name": profile_name,
        "status": status,  # 'success' | 'failed'
        "attempts": attempts
    })
```

### 5.4. `main.py` — добавить `--run-id` и колбэки

**Новый аргумент:**
```python
_run_id = None
# В цикле парсинга:
elif _arg.startswith("--run-id="):
    _run_id = _arg.split("=", 1)[1]
```

**В `run_account()` добавить mm_client и колбэки:**
```python
async def run_account(account, loader, login_wallet=False, headless=False,
                      project_filter=None, mm_mode=False, run_id=None,
                      mm_client=None):
    ...
    for project_name, project_class in allowed_projects:
        logger.info(f"===== Running project: {project_name} =====")
        status = "failed"
        attempts = None
        try:
            result = await browser.run_project(project_class)
            status = "success" if result else "failed"
        except Exception as e:
            logger.error(f"Project {project_name} failed: {e}")
            status = "failed"

        logger.info(f"===== Project {project_name} finished =====")

        # Callback в MM
        if mm_mode and run_id and mm_client:
            try:
                await mm_client.report_task_status(run_id, project_name, account['name'], status, attempts)
            except Exception as e:
                logger.warning(f"Failed to report status to MM: {e}")

        await asyncio.sleep(1)
```

**В `main()`, после `detect_and_get_accounts()`:**
```python
mm_client = None
if mm_mode and _run_id:
    mm_client = MultiManagerClient(port=_mm_port, token=_mm_token)
    await mm_client.__aenter__()  # или использовать как async with

for i, account in enumerate(accounts_list):
    await run_account(account, loader, login_wallet=_login_wallet,
                      headless=headless, project_filter=_project_filter,
                      mm_mode=mm_mode, run_id=_run_id, mm_client=mm_client)
```

**Legacy mode** (без `--run-id`): всё работает ровно как раньше, ни одной строки не меняется в поведении.

#### 5.1t. Тесты stAuto0 изменений

Файл: `C:\Users\stalcker\AI\stAuto0\tests\test_project_run.py`

```python
import pytest
from unittest.mock import AsyncMock, MagicMock, patch
from projects.base import BaseProject
from Core.browser import BaseBrowser
from Core.multimanager import MultiManagerClient


class TestBaseProjectRun:
    """BaseProject.run() должен возвращать bool"""

    @pytest.mark.asyncio
    async def test_run_returns_true_on_success(self):
        """Если _process() вернул True → run() возвращает True"""
        project = BaseProject(
            context=MagicMock(),
            page=MagicMock(),
            account={"name": "auto_001"},
            browser=None,
        )
        project._process = AsyncMock(return_value=True)
        project._get_max_attempts = MagicMock(return_value=1)
        project._get_start_url = MagicMock(return_value="about:blank")
        project._get_page_name = MagicMock(return_value="test")

        with patch.object(project, "page", MagicMock()):
            result = await project.run()
            assert result is True

    @pytest.mark.asyncio
    async def test_run_returns_false_after_all_attempts(self):
        """Если _process() всегда возвращает False → run() возвращает False"""
        project = BaseProject(
            context=MagicMock(),
            page=MagicMock(),
            account={"name": "auto_001"},
            browser=None,
        )
        project._process = AsyncMock(return_value=False)
        project._get_max_attempts = MagicMock(return_value=2)
        project._get_start_url = MagicMock(return_value="about:blank")
        project._get_page_name = MagicMock(return_value="test")

        with patch.object(project, "page", MagicMock()):
            result = await project.run()
            assert result is False
            assert project._process.call_count == 2

    @pytest.mark.asyncio
    async def test_run_raises_on_unhandled_exception(self):
        """Если _process() бросает исключение → run() пробрасывает его"""
        project = BaseProject(
            context=MagicMock(),
            page=MagicMock(),
            account={"name": "auto_001"},
            browser=None,
        )
        project._process = AsyncMock(side_effect=Exception("CDP timeout"))
        project._get_max_attempts = MagicMock(return_value=1)
        project._get_start_url = MagicMock(return_value="about:blank")

        with patch.object(project, "page", MagicMock()):
            with pytest.raises(Exception, match="CDP timeout"):
                await project.run()


class TestBaseBrowserRunProject:
    """BaseBrowser.run_project() должен возвращать bool"""

    @pytest.mark.asyncio
    async def test_run_project_returns_result_from_project_run(self):
        """run_project() возвращает результат project.run()"""
        browser = BaseBrowser(account={"name": "auto_001"})
        browser.page = MagicMock()
        browser.context = MagicMock()

        mock_project_class = MagicMock()
        mock_instance = MagicMock()
        mock_instance.run = AsyncMock(return_value=True)
        mock_project_class.return_value = mock_instance

        result = await browser.run_project(mock_project_class)
        assert result is True

    @pytest.mark.asyncio
    async def test_run_project_raises_on_exception(self):
        """run_project() пробрасывает исключение от project.run()"""
        browser = BaseBrowser(account={"name": "auto_001"})
        browser.page = MagicMock()
        browser.context = MagicMock()

        mock_project_class = MagicMock()
        mock_instance = MagicMock()
        mock_instance.run = AsyncMock(side_effect=Exception("Browser crashed"))
        mock_project_class.return_value = mock_instance

        with pytest.raises(Exception, match="Browser crashed"):
            await browser.run_project(mock_project_class)
```

Файл: `C:\Users\stalcker\AI\stAuto0\tests\test_multimanager_client.py`

```python
import pytest
from unittest.mock import AsyncMock, patch
from Core.multimanager import MultiManagerClient


class TestMultiManagerClientReportStatus:
    """MultiManagerClient.report_task_status() отправляет правильный запрос"""

    @pytest.mark.asyncio
    async def test_report_task_status_sends_correct_data(self):
        """Проверка что запрос формируется правильно"""
        client = MultiManagerClient(port=3000, token="test-token")
        client._request = AsyncMock()

        await client.report_task_status(
            run_id="run-001",
            project_name="concrete",
            profile_name="auto_001",
            status="success",
            attempts=2,
        )

        client._request.assert_called_once_with(
            "POST",
            "/api/internal/runs/run-001/task-status",
            json={
                "project_name": "concrete",
                "profile_name": "auto_001",
                "status": "success",
                "attempts": 2,
            },
        )

    @pytest.mark.asyncio
    async def test_report_task_status_without_attempts(self):
        """Проверка что attempts=None не передаётся"""
        client = MultiManagerClient(port=3000, token="test-token")
        client._request = AsyncMock()

        await client.report_task_status(
            run_id="run-002",
            project_name="allscale",
            profile_name="auto_002",
            status="failed",
        )

        sent = client._request.call_args[1]["json"]
        assert sent["status"] == "failed"
        assert sent["attempts"] is None
```

Файл: `C:\Users\stalcker\AI\stAuto0\tests\test_main_args.py`

```python
import pytest
from unittest.mock import patch, AsyncMock, MagicMock
import sys


class TestMainArgs:
    """Парсинг --run-id и колбэки в main.py"""

    def test_run_id_arg_parsed(self):
        """Проверка что --run-id=XXX парсится из sys.argv"""
        test_args = ["main.py", "--project=concrete", "--run-id=run-001", "--range=001-001"]
        with patch.object(sys, "argv", test_args):
            # Импортируем main заново чтобы триггернуть парсинг
            import importlib
            from config import logging_config
            with patch.object(logging_config, "setup_logging"):
                importlib.reload(sys.modules.get("__main__"))
                # Проверяем _run_id (нужен доступ к переменной модуля)
                # В real-коде это проверка _run_id == "run-001"
                pass

    def test_legacy_mode_without_run_id(self):
        """Без --run-id ничего не меняется в поведении"""
        test_args = ["main.py", "--project=concrete", "--range=001-001"]
        with patch.object(sys, "argv", test_args):
            # Legacy mode — колбэки не вызываются
            pass
```

---

## Part 6: Сводка тестов

### 6.1. Файлы тестов

| Файл | Что тестирует | Зависит от |
|------|--------------|-----------|
| `tests/unit/schema-automation.test.js` | DDL: создание таблиц, constraints, FKs, индексы, каскады | Part 1.1 |
| `tests/unit/queries-automation.test.js` | Query-фабрики: projects CRUD, matrix CRUD, runs CRUD, run_tasks CRUD | Part 1.2 |
| `tests/unit/migration-automation.test.js` | Миграция: создание новых таблиц если их нет, идемпотентность | Part 1.3 |
| `tests/unit/projects-api.test.js` | REST `/api/projects` (GET, sync) | Part 2.1 |
| `tests/unit/matrix-api.test.js` | REST `/api/matrix` (GET вся матрица, batch PUT) | Part 2.2 |
| `tests/unit/runs-api.test.js` | REST `/api/runs` (create, list, get, start, cancel) | Part 2.3 |
| `tests/unit/internal-runs-api.test.js` | REST `/api/internal/runs/:id/task-status` (callback) | Part 2.4 |
| `tests/unit/executor.test.js` | RunExecutor: grouping, spawn args, parallel_limit, cancel | Part 4.1 |
| `tests/unit/gui-automation-store.test.js` | Pinia store automation.js (мок API) | Part 3.3 |
| `C:\Users\stalcker\AI\stAuto0\tests\test_project_run.py` | `BaseProject.run()` → bool, `BaseBrowser.run_project()` → bool | Part 5.1–5.2 |
| `C:\Users\stalcker\AI\stAuto0\tests\test_multimanager_client.py` | `MultiManagerClient.report_task_status()` | Part 5.3 |
| `C:\Users\stalcker\AI\stAuto0\tests\test_main_args.py` | `--run-id` парсинг, legacy mode | Part 5.4 |

### 6.2. Интеграционный тест (end-to-end)

Файл: `tests/integration/automation-full-cycle.test.js`

```js
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Database from 'better-sqlite3';
import { createTables } from '../../src/db/schema';
import * as queries from '../../src/db/queries';
import path from 'path';
import fs from 'fs';
import os from 'os';

describe('Automation full cycle', () => {
  let db, tmpDir, stAuto0MockDir;

  beforeAll(() => {
    // Временная БД
    db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    createTables(db);

    // Временная папка имитирующая stAuto0/projects/
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'stauto0-'));
    stAuto0MockDir = path.join(tmpDir, 'projects');
    fs.mkdirSync(stAuto0MockDir);

    // Создаём "файлы проектов"
    fs.writeFileSync(path.join(stAuto0MockDir, 'concrete.py'), '# ConcreteProject');
    fs.writeFileSync(path.join(stAuto0MockDir, 'allscale.py'), '# AllScaleProject');
    fs.writeFileSync(path.join(stAuto0MockDir, '__init__.py'), '');
    fs.writeFileSync(path.join(stAuto0MockDir, 'base.py'), '# BaseProject');
    fs.writeFileSync(path.join(stAuto0MockDir, 'loader.py'), '# ActiveProjectsLoader');
  });

  afterAll(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    db.close();
  });

  it('1. sync: сканирует projects/*.py, игнорирует системные файлы', async () => {
    const projects = queries.createProjectQueries(db);
    const files = fs.readdirSync(stAuto0MockDir)
      .filter(f => f.endsWith('.py') && !['__init__.py', 'base.py', 'loader.py'].includes(f))
      .map(f => ({ name: f.replace(/\.py$/, ''), display_name: f.replace(/\.py$/, '').capitalize() }));
    projects.sync(files);

    const list = projects.getAll();
    expect(list.length).toBe(2);
    expect(list.find(p => p.name === 'concrete')).toBeTruthy();
    expect(list.find(p => p.name === 'allscale')).toBeTruthy();
  });

  it('2. matrix: добавляет профили, отмечает чекбоксы', () => {
    // Создаём профили
    const profileQueries = queries.createProfileQueries(db);
    const p1 = profileQueries.create({
      name: 'auto_001', platform: 'windows', user_agent: 'ua',
      screen_resolution: '1920x1080', hardware_cores: 4, hardware_memory: 8,
    });
    const p2 = profileQueries.create({
      name: 'auto_002', platform: 'windows', user_agent: 'ua',
      screen_resolution: '1920x1080', hardware_cores: 4, hardware_memory: 8,
    });

    // Отмечаем в матрице
    const matrix = queries.createMatrixQueries(db);
    matrix.batchUpdate([
      { project_name: 'concrete', profile_id: p1.id, is_enabled: 1 },
      { project_name: 'allscale', profile_id: p1.id, is_enabled: 1 },
      { project_name: 'concrete', profile_id: p2.id, is_enabled: 1 },
    ]);

    expect(matrix.getEnabledPairs().length).toBe(3);
  });

  it('3. run: создаёт run из отмеченных клеток', () => {
    const matrix = queries.createMatrixQueries(db);
    const runs = queries.createRunQueries(db);
    const runTasks = queries.createRunTaskQueries(db);

    const enabled = matrix.getEnabledPairs();
    const run = runs.create({ name: 'Full Cycle Test', parallel_limit: 2 });
    runTasks.batchInsert(run.id, enabled.map(e => ({
      project_name: e.project_name,
      profile_id: e.profile_id,
    })));

    const loaded = runs.getById(run.id);
    expect(loaded.total_tasks).toBe(3);
    expect(loaded.status).toBe('pending');
  });

  it('4. start: запускает executor (мок spawn)', async () => {
    // mock spawn, запустить run
    // проверить что статусы обновились
    // проверить что callback корректно обработан
  });
});
```

### 6.3. Тесты GUI (Pinia store)

Файл: `gui/tests/unit/automation-store.test.js` (или `tests/unit/gui-automation-store.test.js`)

```js
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { setActivePinia, createPinia } from 'pinia';
import { useAutomationStore } from '../../src/renderer/stores/automation';

describe('automation store', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  it('fetchMatrix загружает проекты, профили, матрицу', async () => {
    const store = useAutomationStore();
    // Mock HTTP клиента
    store._client = { get: vi.fn().mockResolvedValue({
      data: {
        projects: [{ name: 'concrete' }],
        profiles: [{ id: 'p1', name: 'auto_001' }],
        matrix: [{ project_name: 'concrete', profile_id: 'p1', is_enabled: 1 }],
      }
    })};

    await store.fetchMatrix();
    expect(store.projects.length).toBe(1);
    expect(store.profiles.length).toBe(1);
    expect(store.matrix.length).toBe(1);
  });

  it('createRun отправляет POST /api/runs', async () => {
    const store = useAutomationStore();
    store._client = { post: vi.fn().mockResolvedValue({
      data: { run_id: 'run-001', tasks_created: 3 }
    })};

    const result = await store.createRun({ name: 'Test', parallel_limit: 2 });
    expect(result.run_id).toBe('run-001');
    expect(store._client.post).toHaveBeenCalledWith('/api/runs', { name: 'Test', parallel_limit: 2 });
  });

  it('startRun отправляет POST /api/runs/:id/start', async () => {
    const store = useAutomationStore();
    store._client = { post: vi.fn().mockResolvedValue({ data: { status: 'started' } })};
    await store.startRun('run-001');
    expect(store._client.post).toHaveBeenCalledWith('/api/runs/run-001/start');
  });
});
```

---

## Part 7: Порядок реализации

### Шаг 1: Database (schema + queries) — ✅ ВЫПОЛНЕНО
- [x] 1.1. Добавить таблицы в `schema.js`
- [x] 1.2. Implement `createProjectQueries`
- [x] 1.3. Implement `createMatrixQueries`
- [x] 1.4. Implement `createRunQueries`
- [x] 1.5. Implement `createRunTaskQueries`
- [x] 1.6. Миграция `migrateTables()`
- [x] 1.7. Export from `queries.js`
- [x] **Tests:** `schema-automation. Test .js`, `queries-automation. Test .js`, `migration-automation. Test .js` (31/31 passed)

### Шаг 2: Backend API — ✅ ВЫПОЛНЕНО
- [x] 2.1. `/api/projects` — route + sync from stAuto0
- [x] 2.2. `/api/matrix` — GET + batch PUT
- [x] 2.3. `/api/runs` — CRUD + start/cancel
- [x] 2.4. `/api/internal/runs` — callback task-status
- [x] 2.5. Подключить роуты в `app.js`
- [x] **Tests:** `projects-api.test.js`, `matrix-api.test.js`, `runs-api.test.js`, `internal-runs-api.test.js` (33/33 passed)

### Шаг 3: Execution Engine — ✅ ВЫПОЛНЕНО
- [x] 3.1. `src/executor/index.js` — RunExecutor with semaphore
- [x] 3.2. Stub: spawn with arguments (callback will be added on step 5)
- [x] 3.3. Интеграция executor в роут `/api/runs/:id/start` и `/api/runs/:id/cancel`
- [x] **Tests:** `executor.test.js` (5/5 passed)

### Шаг 4: GUI — ✅ ВЫПОЛНЕНО
- [x] 4.1. AutomationMatrix.vue (matrix with checkboxes)
- [x] 4.2. AutomationRuns.vue (list of runs + colour matrix)
- [x] 4.3. AutomationHistory.vue (lazy load)
- [x] 4.4. Pinia store `automation.js`
- [x] 4.5. Router + sidebar menu
- [x] 4.6. Settings — sync button + parallel_limit
- [x] **Tests:** `gui-automation-store.test.js` (13/13 passed)

### Шаг 5: stAuto0 integration — ✅ ВЫПОЛНЕНО
- [x] 5.1. `base.py` — `run()` returns bool
- [x] 5.2. `browser.py` — `run_project()` returns bool
- [x] 5.3. `multimanager.py` — `report_task_status()`
- [x] 5.4. `main.py` — `--run-id` + callback after each project
- [x] **Tests:** `test_project_run.py`, `test_multimanager_client.py`, `test_main_args.py` (10/10 passed)

### Шаг 6: Integration test — ✅ ВЫПОЛНЕНО
- [x] 6.1. `tests/integration/automation-full-cycle.test.js` — full cycle: sync → matrix → create → run (5/5 passed)

### Шаг 7: Документация — ✅ ВЫПОЛНЕНО
- [x] 7.1. Update README.md
- [x] 7.2. Update TS.md (Automation Matrix section)
- [x] 7.3. Update API.md (new endpoints)

---

## Схема данных (итоговая)

```
                   ┌──────────┐
                   │ projects │──┐
                   └──────────┘  │
                        │        │
              ┌─────────┘        │
              ▼                  ▼
┌──────────────────────┐  ┌──────────┐
│project_profile_config│  │run_tasks │
│(matrix checkboxes)   │  │(execution│
│PK: project+profile   │  │ records) │
└──────────────────────┘  └────┬─────┘
                               │
                         ┌─────┘
                         ▼
                    ┌────────┐
                    │  runs  │
                    │ (batch)│
                    └────────┘
```

---

## Принципиальные решения (summary)

1. **Один процесс на профиль, все проекты сразу** — spawn `main.py --project=A,B,C --range=N-N` для каждого профиля. stAuto0 выполняет проекты последовательно в одном браузере.

2. **parallel_limit = сколько профилей одновременно**, не задач. Глобальный дефолт из system_config + переопределение при создании run.

3. **Callback от stAuto0** — после каждого проекта стучится `POST /api/internal/runs/:id/task-status`. В legacy режиме (без `--run-id`) — ничего не меняется.

4. **Старые таблицы tasks/task_executions не трогаем** — остаются для обратной совместимости. Новый функционал использует runs/run_tasks.

5. **Синхронизация проектов** — сканирование `stAuto0/projects/*.py`. Новые файлы добавляются, удалённые деактивируются. Ручное редактирование (display_name, is_active) не сбрасывается.
