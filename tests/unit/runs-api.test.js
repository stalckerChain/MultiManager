import { describe, it, expect, beforeEach, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import Database from 'better-sqlite3';
import { createTables } from '../../src/db/schema';
import { createProjectQueries, createRunQueries, createRunTaskQueries, createMatrixQueries, createSystemConfigQueries } from '../../src/db/queries';
import { createRunsRouter } from '../../src/api/runs';

describe('POST /api/runs', () => {
  let db, app, runQueries;

  beforeEach(() => {
    db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    createTables(db);

    db.prepare(`INSERT INTO profiles (id, number, name, fingerprint_seed, platform, user_agent, screen_resolution, hardware_cores, hardware_memory)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).run('p1', 1, 'auto_001', 's1', 'windows', 'ua', '1920x1080', 4, 8);
    db.prepare(`INSERT INTO profiles (id, number, name, fingerprint_seed, platform, user_agent, screen_resolution, hardware_cores, hardware_memory)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).run('p2', 2, 'auto_002', 's2', 'windows', 'ua', '1920x1080', 4, 8);

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
      runQueries: runQueries,
      runTaskQueries: createRunTaskQueries(db),
      matrixQueries: matrix,
    }));
  });

  it('creates run from enabled matrix entries', async () => {
    const res = await request(app).post('/api/runs').send({ name: 'Test Run', parallel_limit: 2 });
    expect(res.status).toBe(201);
    expect(res.body.run_id).toBeTruthy();
    expect(res.body.tasks_created).toBe(2);
    const run = runQueries.getById(res.body.run_id);
    expect(run.total_tasks).toBe(2);
  });

  it('auto-generates name if not provided', async () => {
    const res = await request(app).post('/api/runs').send({});
    expect(res.status).toBe(201);
    expect(res.body.name).toBeTruthy();
  });

  it('returns 400 if no enabled entries in matrix', async () => {
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
  let db, app;

  beforeEach(() => {
    db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    createTables(db);
    const runQueries = createRunQueries(db);
    app = express();
    app.use(express.json());
    app.use('/api/runs', createRunsRouter({
      runQueries: runQueries,
      runTaskQueries: createRunTaskQueries(db),
      matrixQueries: createMatrixQueries(db),
    }));
  });

  it('returns paginated list', async () => {
    const runQueries = createRunQueries(db);
    runQueries.create({ name: 'Run 1' });
    runQueries.create({ name: 'Run 2' });
    runQueries.create({ name: 'Run 3' });

    const res = await request(app).get('/api/runs?page=1&limit=2');
    expect(res.status).toBe(200);
    expect(res.body.items.length).toBe(2);
    expect(res.body.total).toBe(3);
    expect(res.body.page).toBe(1);
  });
});

describe('GET /api/runs/:id', () => {
  let db, app, runQueries, runTaskQueries;

  beforeEach(() => {
    db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    createTables(db);

    db.prepare(`INSERT INTO profiles (id, number, name, fingerprint_seed, platform, user_agent, screen_resolution, hardware_cores, hardware_memory)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).run('p1', 1, 'auto_001', 's1', 'windows', 'ua', '1920x1080', 4, 8);

    const projects = createProjectQueries(db);
    projects.sync([{ name: 'concrete', display_name: 'Concrete' }]);

    runQueries = createRunQueries(db);
    runTaskQueries = createRunTaskQueries(db);
    app = express();
    app.use(express.json());
    app.use('/api/runs', createRunsRouter({
      runQueries: runQueries,
      runTaskQueries: runTaskQueries,
      matrixQueries: createMatrixQueries(db),
    }));
  });

  it('returns run with tasks', async () => {
    const run = runQueries.create({ name: 'Test' });
    runTaskQueries.batchInsert(run.id, [
      { project_name: 'concrete', profile_id: 'p1' },
    ]);
    const res = await request(app).get(`/api/runs/${run.id}`);
    expect(res.status).toBe(200);
    expect(res.body.name).toBe('Test');
    expect(res.body.tasks.length).toBe(1);
  });

  it('returns 404 for non-existent run', async () => {
    const res = await request(app).get('/api/runs/nonexistent');
    expect(res.status).toBe(404);
  });
});

describe('POST /api/runs/:id/start', () => {
  let db, app, runQueries, configQueries;

  beforeEach(() => {
    db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    createTables(db);
    configQueries = createSystemConfigQueries(db);
    configQueries.set('stAuto0_path', 'C:\\stAuto0');
    configQueries.set('python_path', 'python');
    runQueries = createRunQueries(db);
    app = express();
    app.use(express.json());
    app.use('/api/runs', createRunsRouter({
      db,
      runQueries: runQueries,
      runTaskQueries: createRunTaskQueries(db),
      matrixQueries: createMatrixQueries(db),
      configQueries,
    }));
  });

  it('starts a pending run', async () => {
    const run = runQueries.create({ name: 'Test' });
    const res = await request(app).post(`/api/runs/${run.id}/start`);
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('started');
    // Status is initially set to 'running'; executor may finalize to 'partial'
    // if Python process fails (expected in test env without real Python)
    const runStatus = runQueries.getById(run.id).status;
    expect(['running', 'partial', 'completed']).toContain(runStatus);
  });

  it('rejects starting a non-pending run', async () => {
    const run = runQueries.create({ name: 'Test', status: 'running' });
    const res = await request(app).post(`/api/runs/${run.id}/start`);
    expect(res.status).toBe(400);
  });

  it('returns 404 for non-existent run', async () => {
    const res = await request(app).post('/api/runs/nonexistent/start');
    expect(res.status).toBe(404);
  });
});

describe('POST /api/runs/:id/cancel', () => {
  let db, app, runQueries, runTaskQueries;

  beforeEach(() => {
    db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    createTables(db);

    db.prepare(`INSERT INTO profiles (id, number, name, fingerprint_seed, platform, user_agent, screen_resolution, hardware_cores, hardware_memory)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).run('p1', 1, 'auto_001', 's1', 'windows', 'ua', '1920x1080', 4, 8);

    const projects = createProjectQueries(db);
    projects.sync([{ name: 'concrete', display_name: 'Concrete' }]);

    runQueries = createRunQueries(db);
    runTaskQueries = createRunTaskQueries(db);
    const configQueries = createSystemConfigQueries(db);
    configQueries.set('stAuto0_path', 'C:\\stAuto0');
    configQueries.set('python_path', 'python');
    app = express();
    app.use(express.json());
    app.use('/api/runs', createRunsRouter({
      runQueries: runQueries,
      runTaskQueries: runTaskQueries,
      matrixQueries: createMatrixQueries(db),
      configQueries,
    }));
  });

  it('cancels a run and fails pending tasks', async () => {
    const run = runQueries.create({ name: 'Test', status: 'running' });
    runTaskQueries.batchInsert(run.id, [
      { project_name: 'concrete', profile_id: 'p1' },
    ]);
    const res = await request(app).post(`/api/runs/${run.id}/cancel`);
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('cancelled');
    expect(runQueries.getById(run.id).status).toBe('cancelled');
    const tasks = runTaskQueries.getByRunId(run.id);
    expect(tasks[0].status).toBe('failed');
  });

  it('returns 404 for non-existent run', async () => {
    const res = await request(app).post('/api/runs/nonexistent/cancel');
    expect(res.status).toBe(404);
  });
});
