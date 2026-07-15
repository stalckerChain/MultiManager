import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import Database from 'better-sqlite3';
import { createTables } from '../../src/db/schema';
import { createProjectQueries, createSystemConfigQueries } from '../../src/db/queries';
import { createProjectsRouter } from '../../src/api/projects';
import * as stauto0Config from '../../src/config/stauto0-config';

function setupApi(db) {
  const app = express();
  app.use(express.json());
  app.use('/api/projects', createProjectsRouter({
    db,
    projectQueries: createProjectQueries(db),
    configQueries: createSystemConfigQueries(db),
  }));
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

describe('GET /api/projects/:name', () => {
  let db, app;

  beforeEach(() => {
    db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    createTables(db);
    const projects = createProjectQueries(db);
    projects.sync([{ name: 'concrete', display_name: 'Concrete' }]);
    app = setupApi(db);
  });

  it('returns a single project', async () => {
    const res = await request(app).get('/api/projects/concrete');
    expect(res.status).toBe(200);
    expect(res.body.name).toBe('concrete');
  });

  it('returns 404 for non-existent project', async () => {
    const res = await request(app).get('/api/projects/nonexistent');
    expect(res.status).toBe(404);
  });
});

describe('PUT /api/projects/:name', () => {
  let db, app;

  beforeEach(() => {
    db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    createTables(db);
    const projects = createProjectQueries(db);
    projects.sync([{ name: 'concrete', display_name: 'Concrete' }]);
    app = setupApi(db);
  });

  it('updates project fields', async () => {
    const res = await request(app)
      .put('/api/projects/concrete')
      .send({ display_name: 'Concrete Points', is_active: 0 });
    expect(res.status).toBe(200);
    expect(res.body.display_name).toBe('Concrete Points');
    expect(res.body.is_active).toBe(0);
  });

  it('returns 404 for non-existent project', async () => {
    const res = await request(app)
      .put('/api/projects/nonexistent')
      .send({ display_name: 'Test' });
    expect(res.status).toBe(404);
  });
});

describe('POST /api/projects/sync', () => {
  let db, config, app;

  beforeEach(() => {
    db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    createTables(db);
    config = createSystemConfigQueries(db);
    app = setupApi(db);
    // Mock config reader to return empty array (no config file in tests)
    vi.spyOn(stauto0Config, 'buildProjectsFromConfig').mockReturnValue([]);
    vi.spyOn(stauto0Config, 'parseAccountRanges').mockReturnValue([]);
    // Also mock readFileSync to prevent reading real config file
    vi.spyOn(require('fs'), 'readFileSync').mockReturnValue('');
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('uses default stAuto0_path when not configured', async () => {
    vi.spyOn(require('fs'), 'readdirSync').mockReturnValue(['concrete.py']);
    vi.spyOn(require('fs'), 'existsSync').mockReturnValue(true);

    const res = await request(app).post('/api/projects/sync');
    expect(res.status).toBe(200);
    expect(res.body.added).toBe(1);
    expect(res.body.total).toBe(1);

    const projects = createProjectQueries(db);
    expect(projects.getByName('concrete')).toBeTruthy();
  });

  it('scans projects directory and adds new projects', async () => {
    vi.spyOn(require('fs'), 'readdirSync').mockReturnValue(['concrete.py', 'allscale.py', '__init__.py', 'base.py', 'loader.py']);
    config.set('stAuto0_path', '/fake/stAuto0');

    const res = await request(app).post('/api/projects/sync');
    expect(res.status).toBe(200);
    expect(res.body.added).toBe(2);
    expect(res.body.total).toBe(2);

    const projects = createProjectQueries(db);
    expect(projects.getByName('concrete')).toBeTruthy();
    expect(projects.getByName('allscale')).toBeTruthy();
  });

  it('deactivates removed projects', async () => {
    const projects = createProjectQueries(db);
    projects.sync([
      { name: 'concrete', display_name: 'Concrete' },
      { name: 'old_project', display_name: 'Old' },
    ]);
    config.set('stAuto0_path', '/fake/stAuto0');

    vi.spyOn(require('fs'), 'readdirSync').mockReturnValue(['concrete.py']);

    const res = await request(app).post('/api/projects/sync');
    expect(res.status).toBe(200);
    expect(res.body.removed).toBe(1);
    expect(projects.getByName('old_project').is_active).toBe(0);
  });

  it('preserves is_active=0 for existing projects during sync', async () => {
    const projects = createProjectQueries(db);
    // Start with both projects active
    projects.sync([
      { name: 'concrete', display_name: 'Concrete' },
      { name: 'allscale', display_name: 'AllScale' },
    ]);
    // User disables concrete
    projects.update('concrete', { is_active: 0 });
    expect(projects.getByName('concrete').is_active).toBe(0);

    config.set('stAuto0_path', '/fake/stAuto0');
    // Sync returns both projects from filesystem (no is_active field)
    vi.spyOn(require('fs'), 'readdirSync').mockReturnValue(['concrete.py', 'allscale.py']);

    const res = await request(app).post('/api/projects/sync');
    expect(res.status).toBe(200);

    // concrete should still be disabled after sync
    expect(projects.getByName('concrete').is_active).toBe(0);
    // allscale should still be active
    expect(projects.getByName('allscale').is_active).toBe(1);
  });

  it('preserves is_active=0 when sync is called without is_active in data', async () => {
    const projects = createProjectQueries(db);
    projects.sync([
      { name: 'concrete', display_name: 'Concrete' },
      { name: 'allscale', display_name: 'AllScale' },
    ]);
    // User disables concrete
    projects.update('concrete', { is_active: 0 });
    expect(projects.getByName('concrete').is_active).toBe(0);

    // Sync with data that has NO is_active field (like filesystem scan does)
    projects.sync([
      { name: 'concrete', display_name: 'Concrete' },
      { name: 'allscale', display_name: 'AllScale' },
    ]);

    // concrete should STILL be disabled — sync preserves existing is_active
    expect(projects.getByName('concrete').is_active).toBe(0);
    expect(projects.getByName('allscale').is_active).toBe(1);
  });

  it('explicit is_active in sync data overrides existing value', async () => {
    const projects = createProjectQueries(db);
    projects.sync([
      { name: 'concrete', display_name: 'Concrete' },
    ]);
    projects.update('concrete', { is_active: 0 });
    expect(projects.getByName('concrete').is_active).toBe(0);

    // Sync with explicit is_active:1 should override
    projects.sync([
      { name: 'concrete', display_name: 'Concrete', is_active: 1 },
    ]);
    expect(projects.getByName('concrete').is_active).toBe(1);
  });

  it('new projects from sync default to active', async () => {
    const projects = createProjectQueries(db);
    config.set('stAuto0_path', '/fake/stAuto0');
    vi.spyOn(require('fs'), 'readdirSync').mockReturnValue(['new_project.py']);

    const res = await request(app).post('/api/projects/sync');
    expect(res.status).toBe(200);
    expect(projects.getByName('new_project').is_active).toBe(1);
  });
});
