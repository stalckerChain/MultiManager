const express = require('express');
const { getDatabase } = require('../db');
const { createMatrixQueries, createProjectQueries, createProfileQueries } = require('../db/queries');

function createMatrixRouter(opts = {}) {
  const router = express.Router();

  function getMatrix() {
    return opts.matrixQueries || createMatrixQueries(getDatabase());
  }

  function getProjects() {
    return opts.projectQueries || createProjectQueries(getDatabase());
  }

  function getProfiles() {
    return opts.profileQueries || createProfileQueries(getDatabase());
  }

  router.get('/', (req, res) => {
    const projectList = getProjects().getAll();
    const profileList = getProfiles().getAll();
    const matrixEntries = getMatrix().getAll();

    const enrichedMatrix = matrixEntries.map(entry => ({
      ...entry,
      profile_name: profileList.find(p => p.id === entry.profile_id)?.name || '',
      project_display: projectList.find(p => p.name === entry.project_name)?.display_name || '',
    }));

    res.json({
      projects: projectList,
      profiles: profileList,
      matrix: enrichedMatrix,
    });
  });

  router.put('/', (req, res) => {
    const { entries } = req.body;
    if (!Array.isArray(entries) || entries.length === 0) {
      return res.status(400).json({ error: 'entries must be a non-empty array' });
    }
    for (const entry of entries) {
      if (!entry.project_name || entry.profile_id === undefined) {
        return res.status(400).json({ error: 'Each entry requires project_name and profile_id' });
      }
    }
    getMatrix().batchUpdate(entries);
    res.json({ updated: entries.length });
  });

  return router;
}

module.exports = { createMatrixRouter };
