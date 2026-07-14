const express = require('express');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { getDatabase } = require('../db');
const { createProjectQueries, createMatrixQueries, createProfileQueries, createSystemConfigQueries } = require('../db/queries');
const { buildProjectsFromConfig, parseAccountRanges } = require('../config/stauto0-config');

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
    const defaultPath = path.join(os.homedir(), 'AI', 'stAuto0');
    const stAuto0Path = getCfg().get('stAuto0_path') || defaultPath;

    if (!stAuto0Path) {
      return res.status(400).json({ error: 'stAuto0_path not configured' });
    }

    // Read config/projects.py for status, registry, and account flags
    const configProjects = buildProjectsFromConfig(stAuto0Path);

    // Also scan projects/*.py for any additional projects not in config
    const projectsDir = path.join(stAuto0Path, 'projects');
    let files = [];
    try {
      files = fs.readdirSync(projectsDir)
        .filter(f => f.endsWith('.py') && !['__init__.py', 'base.py', 'loader.py'].includes(f))
        .map(f => ({
          name: f.replace(/\.py$/, ''),
          display_name: f.replace(/\.py$/, ''),
          module_path: `projects.${f.replace(/\.py$/, '')}`,
          class_name: '',
          is_active: 1,
          default_config: '{}',
        }));
    } catch (err) {
      // If projects dir doesn't exist, continue with config-only projects
    }

    // Merge: config projects take precedence over scanned files
    const configNames = configProjects.map(p => p.name);
    const scannedOnly = files.filter(f => !configNames.includes(f.name));
    const merged = [...configProjects, ...scannedOnly];

    const existing = getProjects().getAll();
    const existingNames = existing.map(p => p.name);
    const incomingNames = merged.map(f => f.name);

    const added = merged.filter(f => !existingNames.includes(f.name));
    const removed = existing.filter(p => !incomingNames.includes(p.name) && p.is_active);

    getProjects().sync(merged);

    // Auto-populate matrix entries based on account flags
    const profiles = createProfileQueries(getDb()).getAll();
    const matrix = createMatrixQueries(getDb());
    if (profiles.length > 0) {
      const entries = [];
      for (const proj of merged) {
        let allowedProfiles = profiles;

        // If project has accounts config, filter profiles
        const config = JSON.parse(proj.default_config || '{}');
        if (config.accounts && config.accounts.length > 0) {
          const allowedNames = parseAccountRanges(config.accounts);
          allowedProfiles = profiles.filter(p => allowedNames.includes(p.name));
        }

        for (const prof of allowedProfiles) {
          entries.push({
            project_name: proj.name,
            profile_id: prof.id,
            is_enabled: 0,
          });
        }
      }
      matrix.batchUpdate(entries);
    }

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
