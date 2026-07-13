import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { createTables } from '../../src/db/schema';
const {
  createProjectQueries,
  createMatrixQueries,
  createRunQueries,
  createRunTaskQueries,
} = require('../../src/db/queries');

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

    projects.sync([
      { name: 'concrete', display_name: 'Concrete', module_path: 'projects.concrete', class_name: 'ConcreteProject' },
    ]);
    const list = projects.getAll();
    expect(list.length).toBe(2);
    const allscale = list.find(p => p.name === 'allscale');
    expect(allscale.is_active).toBe(0);
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
  let db, projects, matrix;

  beforeEach(() => {
    db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    createTables(db);
    projects = createProjectQueries(db);
    matrix = createMatrixQueries(db);

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
  let db, projects, runs, runTasks, matrix;

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
    expect(loaded.total_tasks).toBe(2);
  });

  it('getAll — пагинированный список', () => {
    runs.create({ name: 'Run 1' });
    runs.create({ name: 'Run 2' });
    runs.create({ name: 'Run 3' });

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

