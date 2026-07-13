import { describe, it, expect, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import Database from 'better-sqlite3';
import { createTables } from '../../src/db/schema';
import { createProjectQueries, createRunQueries, createRunTaskQueries, createMatrixQueries, createProfileQueries } from '../../src/db/queries';
import { createInternalRunsRouter } from '../../src/api/internal-runs';

function seedRun(db, runQueries, runTaskQueries, profileQueries) {
  const projects = createProjectQueries(db);
  projects.sync([{ name: 'concrete', display_name: 'Concrete' }]);
  const profile = profileQueries.create({
    name: 'auto_001', fingerprint_seed: 'seed1', platform: 'windows', user_agent: 'ua',
    screen_resolution: '1920x1080', hardware_cores: 4, hardware_memory: 8,
  });
  const matrix = createMatrixQueries(db);
  matrix.batchUpdate([{ project_name: 'concrete', profile_id: profile.id, is_enabled: 1 }]);
  const run = runQueries.create({ name: 'Test' });
  runTaskQueries.batchInsert(run.id, [{ project_name: 'concrete', profile_id: profile.id }]);
  return { run, profile };
}

describe('POST /api/internal/runs/:id/task-status', () => {
  let db, app, runQueries, runTaskQueries, profileQueries;

  beforeEach(() => {
    db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    createTables(db);
    runQueries = createRunQueries(db);
    runTaskQueries = createRunTaskQueries(db);
    profileQueries = createProfileQueries(db);
    app = express();
    app.use(express.json());
    app.use('/api/internal/runs', createInternalRunsRouter({
      runQueries,
      runTaskQueries,
      profileQueries,
      skipLocalhostCheck: true,
    }));
  });

  it('updates task status to success', async () => {
    const { run } = seedRun(db, runQueries, runTaskQueries, profileQueries);
    const res = await request(app)
      .post(`/api/internal/runs/${run.id}/task-status`)
      .send({ project_name: 'concrete', profile_name: 'auto_001', status: 'success', attempts: 1 });
    expect(res.status).toBe(200);
    const tasks = runTaskQueries.getByRunId(run.id);
    expect(tasks[0].status).toBe('success');
    expect(tasks[0].attempts).toBe(1);
  });

  it('updates task status to failed', async () => {
    const { run } = seedRun(db, runQueries, runTaskQueries, profileQueries);
    const res = await request(app)
      .post(`/api/internal/runs/${run.id}/task-status`)
      .send({ project_name: 'concrete', profile_name: 'auto_001', status: 'failed' });
    expect(res.status).toBe(200);
    const tasks = runTaskQueries.getByRunId(run.id);
    expect(tasks[0].status).toBe('failed');
  });

  it('increments run counters on status update', async () => {
    const { run } = seedRun(db, runQueries, runTaskQueries, profileQueries);
    await request(app)
      .post(`/api/internal/runs/${run.id}/task-status`)
      .send({ project_name: 'concrete', profile_name: 'auto_001', status: 'success' });
    const updatedRun = runQueries.getById(run.id);
    expect(updatedRun.completed_tasks).toBe(1);
    expect(updatedRun.success_tasks).toBe(1);
  });

  it('marks run as completed when all tasks done', async () => {
    const { run } = seedRun(db, runQueries, runTaskQueries, profileQueries);
    await request(app)
      .post(`/api/internal/runs/${run.id}/task-status`)
      .send({ project_name: 'concrete', profile_name: 'auto_001', status: 'success' });
    const updatedRun = runQueries.getById(run.id);
    expect(updatedRun.status).toBe('completed');
  });

  it('marks run as partial when some tasks fail', async () => {
    const projects = createProjectQueries(db);
    projects.sync([{ name: 'concrete', display_name: 'Concrete' }, { name: 'allscale', display_name: 'AllScale' }]);
    const profile = profileQueries.create({
      name: 'auto_001', fingerprint_seed: 'seed1', platform: 'windows', user_agent: 'ua',
      screen_resolution: '1920x1080', hardware_cores: 4, hardware_memory: 8,
    });
    const matrix = createMatrixQueries(db);
    matrix.batchUpdate([
      { project_name: 'concrete', profile_id: profile.id, is_enabled: 1 },
      { project_name: 'allscale', profile_id: profile.id, is_enabled: 1 },
    ]);
    const run = runQueries.create({ name: 'Multi' });
    runTaskQueries.batchInsert(run.id, [
      { project_name: 'concrete', profile_id: profile.id },
      { project_name: 'allscale', profile_id: profile.id },
    ]);
    await request(app)
      .post(`/api/internal/runs/${run.id}/task-status`)
      .send({ project_name: 'concrete', profile_name: 'auto_001', status: 'success' });
    await request(app)
      .post(`/api/internal/runs/${run.id}/task-status`)
      .send({ project_name: 'allscale', profile_name: 'auto_001', status: 'failed' });
    const updatedRun = runQueries.getById(run.id);
    expect(updatedRun.status).toBe('partial');
  });

  it('returns 404 for non-existent run', async () => {
    const res = await request(app)
      .post('/api/internal/runs/nonexistent/task-status')
      .send({ project_name: 'concrete', profile_name: 'auto_001', status: 'success' });
    expect(res.status).toBe(404);
  });

  it('returns 400 if required fields missing', async () => {
    const { run } = seedRun(db, runQueries, runTaskQueries, profileQueries);
    const res = await request(app)
      .post(`/api/internal/runs/${run.id}/task-status`)
      .send({ status: 'success' });
    expect(res.status).toBe(400);
  });

  it('returns 404 if task not found for given project+profile', async () => {
    const { run } = seedRun(db, runQueries, runTaskQueries, profileQueries);
    const res = await request(app)
      .post(`/api/internal/runs/${run.id}/task-status`)
      .send({ project_name: 'nonexistent', profile_name: 'auto_001', status: 'success' });
    expect(res.status).toBe(404);
  });
});
