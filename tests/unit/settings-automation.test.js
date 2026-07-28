import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import express from 'express';
import request from 'supertest';

const { initDatabase, getDatabase } = require('../../src/db');
initDatabase();

const { createProjectQueries } = require('../../src/db/queries');
const projects = createProjectQueries(getDatabase());

const app = express();
app.use(express.json());
app.use('/api/settings', require('../../src/api/settings'));

describe('PUT /api/settings/automation — no auto-sync', () => {
  const TEST_PROJECTS = ['__test_save_1', '__test_save_2'];

  beforeAll(() => {
    // Clean up any leftover test projects from previous runs
    TEST_PROJECTS.forEach(name => {
      try { projects.delete(name); } catch {}
    });
    // Create test projects
    projects.sync(TEST_PROJECTS.map(name => ({ name, display_name: name })));
  });

  afterAll(() => {
    // Clean up
    TEST_PROJECTS.forEach(name => {
      try { projects.delete(name); } catch {}
    });
  });

  it('returns 200 with zero syncResult', async () => {
    const res = await request(app)
      .put('/api/settings/automation')
      .send({ stAuto0Path: 'C:\\fake\\stAuto0', pythonPath: 'C:\\fake\\python.exe' });

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('success');
    expect(res.body.syncResult).toEqual({ added: 0, removed: 0, total: 0 });
  });

  it('does not re-create deleted projects after save', async () => {
    expect(projects.getByName('__test_save_1')).toBeTruthy();
    expect(projects.getByName('__test_save_2')).toBeTruthy();

    projects.delete('__test_save_2');
    expect(projects.getByName('__test_save_2')).toBeUndefined();

    await request(app)
      .put('/api/settings/automation')
      .send({ stAuto0Path: 'C:\\fake\\stAuto0', pythonPath: 'C:\\fake\\python.exe', parallelLimit: 2 })
      .expect(200);

    // Deleted project should stay deleted
    expect(projects.getByName('__test_save_2')).toBeUndefined();
    expect(projects.getByName('__test_save_1')).toBeTruthy();
  });
});
