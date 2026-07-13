const express = require('express');
const fs = require('fs');
const path = require('path');
const { getDatabase } = require('../db');
const { createProjectQueries, createMatrixQueries, createSystemConfigQueries } = require('../db/queries');

function createProjectsRouter(opts = {}) {
  const router = express.Router();

  function getDb() {
    return opts.db || getDatabase();
  }

  function getProjects() {
    return opts.projectQueries || createProjectQueries(getDb());
  }

  function getCfg() {
    return opts.configQueries || createSystemConfigQueries(getDb());
  }

  router.get('/', (req, res) => {
    res.json(getProjects().getAll());
  });

  router.post('/sync', (req, res) => {
    const stAuto0Path = getCfg().get('stAuto0_path');

    if (!stAuto0Path) {
      return res.status(400).json({ error: 'stAuto0_path not configured' });
    }

    const projectsDir = path.join(stAuto0Path, 'projects');
    let files;
    try {
      files = fs.readdirSync(projectsDir)
        .filter(f => f.endsWith('.py') && !['__init__.py', 'base.py', 'loader.py'].includes(f))
        .map(f => ({
          name: f.replace(/\.py$/, ''),
          display_name: f.replace(/\.py$/, ''),
          module_path: `projects.${f.replace(/\.py$/, '')}`,
          class_name: '',
        }));
    } catch (err) {
      return res.status(500).json({ error: 'Failed to scan projects directory', details: err.message });
    }

    const existing = getProjects().getAll();
    const existingNames = existing.map(p => p.name);
    const incomingNames = files.map(f => f.name);

    const added = files.filter(f => !existingNames.includes(f.name));
    const removed = existing.filter(p => !incomingNames.includes(p.name) && p.is_active);

    getProjects().sync(files);

    res.json({ added: added.length, removed: removed.length, total: getProjects().getAll().length });
  });

  router.get('/:name', (req, res) => {
    const project = getProjects().getByName(req.params.name);
    if (!project) {
      return res.status(404).json({ error: 'Project not found' });
    }
    const matrix = createMatrixQueries(getDb());
    const profiles = matrix.getByProject(req.params.name);
    res.json({ ...project, profiles });
  });

  router.put('/:name', (req, res) => {
    const existing = getProjects().getByName(req.params.name);
    if (!existing) {
      return res.status(404).json({ error: 'Project not found' });
    }
    const { display_name, is_active, default_config, module_path, class_name } = req.body;
    const updated = getProjects().update(req.params.name, {
      display_name,
      is_active: is_active !== undefined ? is_active : undefined,
      default_config,
      module_path,
      class_name,
    });
    res.json(updated);
  });

  return router;
}

module.exports = { createProjectsRouter };
