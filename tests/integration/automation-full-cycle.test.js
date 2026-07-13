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
    db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    createTables(db);

    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'stauto0-'));
    stAuto0MockDir = path.join(tmpDir, 'projects');
    fs.mkdirSync(stAuto0MockDir, { recursive: true });

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

  it('1. sync: сканирует projects/*.py, игнорирует системные файлы', () => {
    const projects = queries.createProjectQueries(db);
    const files = fs.readdirSync(stAuto0MockDir)
      .filter(f => f.endsWith('.py') && !['__init__.py', 'base.py', 'loader.py'].includes(f))
      .map(f => ({
        name: f.replace(/\.py$/, ''),
        display_name: f.replace(/\.py$/, '').charAt(0).toUpperCase() + f.replace(/\.py$/, '').slice(1),
      }));
    projects.sync(files);

    const list = projects.getAll();
    expect(list.length).toBe(2);
    expect(list.find(p => p.name === 'concrete')).toBeTruthy();
    expect(list.find(p => p.name === 'allscale')).toBeTruthy();
  });

  it('2. matrix: добавляет профили, отмечает чекбоксы', () => {
    const profileQueries = queries.createProfileQueries(db);
    const p1 = profileQueries.create({
      name: 'auto_001', platform: 'windows', user_agent: 'ua',
      screen_resolution: '1920x1080', hardware_cores: 4, hardware_memory: 8,
      fingerprint_seed: 'seed-001',
    });
    const p2 = profileQueries.create({
      name: 'auto_002', platform: 'windows', user_agent: 'ua',
      screen_resolution: '1920x1080', hardware_cores: 4, hardware_memory: 8,
      fingerprint_seed: 'seed-002',
    });

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

  it('4. run_tasks: полный цикл обновления статусов через callback', () => {
    const matrix = queries.createMatrixQueries(db);
    const runs = queries.createRunQueries(db);
    const runTasks = queries.createRunTaskQueries(db);

    const enabled = matrix.getEnabledPairs();
    const run = runs.create({ name: 'Callback Test', parallel_limit: 2 });
    runTasks.batchInsert(run.id, enabled.map(e => ({
      project_name: e.project_name,
      profile_id: e.profile_id,
    })));

    runs.updateStatus(run.id, 'running', new Date().toISOString());

    const allTasks = runTasks.getByRunId(run.id);
    expect(allTasks.length).toBe(3);

    allTasks.forEach(t => {
      runTasks.updateStatus(t.id, 'success', 0, `/logs/${run.id}/${t.profile_id}.log`, 1);
      runs.incrementCompleted(run.id, true);
    });

    const updated = runs.getById(run.id);
    expect(updated.completed_tasks).toBe(3);
    expect(updated.success_tasks).toBe(3);
    expect(updated.failed_tasks).toBe(0);

    const tasks = runTasks.getByRunId(run.id);
    tasks.forEach(t => {
      expect(t.status).toBe('success');
      expect(t.exit_code).toBe(0);
      expect(t.attempts).toBe(1);
    });
  });

  it('5. run: обработка частичного успеха', () => {
    const runs = queries.createRunQueries(db);
    const runTasks = queries.createRunTaskQueries(db);
    const matrix = queries.createMatrixQueries(db);

    const enabled = matrix.getEnabledPairs();
    const run = runs.create({ name: 'Partial Test', parallel_limit: 2 });
    runTasks.batchInsert(run.id, enabled.map(e => ({
      project_name: e.project_name,
      profile_id: e.profile_id,
    })));

    runs.updateStatus(run.id, 'running', new Date().toISOString());

    const tasks = runTasks.getByRunId(run.id);
    runTasks.updateStatus(tasks[0].id, 'success', 0, '/logs/test.log', 1);
    runs.incrementCompleted(run.id, true);

    runTasks.updateStatus(tasks[1].id, 'failed', 1, '/logs/test.log', 2);
    runs.incrementCompleted(run.id, false);

    runTasks.updateStatus(tasks[2].id, 'success', 0, '/logs/test.log', 1);
    runs.incrementCompleted(run.id, true);

    const updated = runs.getById(run.id);
    expect(updated.completed_tasks).toBe(3);
    expect(updated.success_tasks).toBe(2);
    expect(updated.failed_tasks).toBe(1);
  });
});
