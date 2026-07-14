import { describe, it, expect, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import Database from 'better-sqlite3';
import { createTables } from '../../src/db/schema';
import { createProjectQueries, createMatrixQueries, createProfileQueries, createSystemConfigQueries } from '../../src/db/queries';
import { createMatrixRouter } from '../../src/api/matrix';

const mockProjects = [
  {
    name: 'concrete',
    display_name: 'Concrete',
    module_path: 'projects.concrete',
    class_name: 'ConcreteProject',
    is_active: true,
    default_config: JSON.stringify({ accounts: ['001-050'] }),
  },
  {
    name: 'allscale',
    display_name: 'AllScale',
    module_path: 'projects.allscale',
    class_name: 'AllScaleProject',
    is_active: true,
    default_config: JSON.stringify({ accounts: ['001-050'] }),
  },
  {
    name: 'disabled_proj',
    display_name: 'Disabled',
    module_path: 'projects.disabled',
    class_name: 'DisabledProject',
    is_active: false,
    default_config: '{}',
  },
];

describe('GET /api/matrix', () => {
  let db, app, matrix;

  beforeEach(() => {
    db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    createTables(db);

    db.prepare(`INSERT INTO profiles (id, number, name, fingerprint_seed, platform, user_agent, screen_resolution, hardware_cores, hardware_memory)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).run('p1', 1, 'auto_001', 's1', 'windows', 'ua', '1920x1080', 4, 8);
    db.prepare(`INSERT INTO profiles (id, number, name, fingerprint_seed, platform, user_agent, screen_resolution, hardware_cores, hardware_memory)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).run('p2', 2, 'auto_002', 's2', 'windows', 'ua', '1920x1080', 4, 8);

    // Seed projects in DB (needed for FK constraints in matrix entries)
    const projects = createProjectQueries(db);
    projects.sync([
      { name: 'concrete', display_name: 'Concrete' },
      { name: 'allscale', display_name: 'AllScale' },
    ]);

    matrix = createMatrixQueries(db);
    matrix.batchUpdate([
      { project_name: 'concrete', profile_id: 'p1', is_enabled: 1 },
      { project_name: 'allscale', profile_id: 'p1', is_enabled: 1 },
    ]);

    app = express();
    app.use(express.json());
    app.use('/api/matrix', createMatrixRouter({
      matrixQueries: matrix,
      profileQueries: createProfileQueries(db),
      configQueries: createSystemConfigQueries(db),
      // Dependency injection: mock buildProjectsFromConfig
      buildProjectsFromConfig: () => mockProjects,
    }));
  });

  it('returns active projects, profiles and matrix', async () => {
    const res = await request(app).get('/api/matrix');
    expect(res.status).toBe(200);
    // Only active projects (concrete, allscale) — disabled_proj excluded
    expect(res.body.projects.length).toBe(2);
    expect(res.body.profiles.length).toBe(2);
    expect(res.body.matrix.length).toBe(2);
  });

  it('excludes inactive projects', async () => {
    const res = await request(app).get('/api/matrix');
    const names = res.body.projects.map(p => p.name);
    expect(names).not.toContain('disabled_proj');
    expect(names).toContain('concrete');
    expect(names).toContain('allscale');
  });

  it('each project has allowed_profile_ids based on accounts config', async () => {
    const res = await request(app).get('/api/matrix');
    const concrete = res.body.projects.find(p => p.name === 'concrete');
    // accounts: ['001-050'] → auto_001 and auto_002 are both in range
    expect(concrete.allowed_profile_ids).toContain('p1');
    expect(concrete.allowed_profile_ids).toContain('p2');
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

    // Seed projects in DB for FK
    const projects = createProjectQueries(db);
    projects.sync([
      { name: 'concrete', display_name: 'Concrete' },
      { name: 'allscale', display_name: 'AllScale' },
    ]);

    matrix = createMatrixQueries(db);

    app = express();
    app.use(express.json());
    app.use('/api/matrix', createMatrixRouter({
      matrixQueries: matrix,
      profileQueries: createProfileQueries(db),
      configQueries: createSystemConfigQueries(db),
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
