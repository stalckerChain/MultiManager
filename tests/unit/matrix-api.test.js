import { describe, it, expect, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import Database from 'better-sqlite3';
import { createTables } from '../../src/db/schema';
import { createProjectQueries, createMatrixQueries, createProfileQueries } from '../../src/db/queries';
import { createMatrixRouter } from '../../src/api/matrix';

describe('GET /api/matrix', () => {
  let db, app, matrix, projects, profiles;

  function seed() {
    db.prepare(`INSERT INTO profiles (id, number, name, fingerprint_seed, platform, user_agent, screen_resolution, hardware_cores, hardware_memory)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).run('p1', 1, 'auto_001', 's1', 'windows', 'ua', '1920x1080', 4, 8);
    db.prepare(`INSERT INTO profiles (id, number, name, fingerprint_seed, platform, user_agent, screen_resolution, hardware_cores, hardware_memory)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).run('p2', 2, 'auto_002', 's2', 'windows', 'ua', '1920x1080', 4, 8);
    projects = createProjectQueries(db);
    projects.sync([{ name: 'concrete', display_name: 'Concrete' }, { name: 'allscale', display_name: 'AllScale' }]);
    matrix = createMatrixQueries(db);
    matrix.batchUpdate([
      { project_name: 'concrete', profile_id: 'p1', is_enabled: 1 },
      { project_name: 'allscale', profile_id: 'p1', is_enabled: 1 },
    ]);
  }

  beforeEach(() => {
    db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    createTables(db);
    seed();
    app = express();
    app.use(express.json());
    app.use('/api/matrix', createMatrixRouter({
      matrixQueries: matrix,
      projectQueries: projects,
      profileQueries: createProfileQueries(db),
    }));
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
  let db, app, matrix;

  beforeEach(() => {
    db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    createTables(db);

    db.prepare(`INSERT INTO profiles (id, number, name, fingerprint_seed, platform, user_agent, screen_resolution, hardware_cores, hardware_memory)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).run('p1', 1, 'auto_001', 's1', 'windows', 'ua', '1920x1080', 4, 8);
    db.prepare(`INSERT INTO profiles (id, number, name, fingerprint_seed, platform, user_agent, screen_resolution, hardware_cores, hardware_memory)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).run('p2', 2, 'auto_002', 's2', 'windows', 'ua', '1920x1080', 4, 8);

    const projects = createProjectQueries(db);
    projects.sync([{ name: 'concrete', display_name: 'Concrete' }, { name: 'allscale', display_name: 'AllScale' }]);

    matrix = createMatrixQueries(db);

    app = express();
    app.use(express.json());
    app.use('/api/matrix', createMatrixRouter({
      matrixQueries: matrix,
      projectQueries: projects,
      profileQueries: createProfileQueries(db),
    }));
  });

  it('batch updates entries', async () => {
    const res = await request(app).put('/api/matrix').send({
      entries: [
        { project_name: 'concrete', profile_id: 'p1', is_enabled: 1 },
        { project_name: 'allscale', profile_id: 'p1', is_enabled: 0 },
      ]
    });
    expect(res.status).toBe(200);
    expect(res.body.updated).toBe(2);

    const all = matrix.getAll();
    expect(all.find(e => e.project_name === 'concrete' && e.profile_id === 'p1').is_enabled).toBe(1);
  });

  it('rejects empty entries array', async () => {
    const res = await request(app).put('/api/matrix').send({ entries: [] });
    expect(res.status).toBe(400);
  });

  it('rejects invalid entries (missing fields)', async () => {
    const res = await request(app).put('/api/matrix').send({
      entries: [{ project_name: 'concrete' }]
    });
    expect(res.status).toBe(400);
  });
});
