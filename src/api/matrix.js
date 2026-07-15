const express = require('express');
const { getDatabase } = require('../db');
const { createMatrixQueries, createProfileQueries, createProjectQueries } = require('../db/queries');
const { parseAccountRanges } = require('../config/stauto0-config');

function createMatrixRouter(opts = {}) {
  const router = express.Router();
  const _parseAccountRanges = opts.parseAccountRanges || parseAccountRanges;

  function getMatrix() {
    return opts.matrixQueries || createMatrixQueries(getDatabase());
  }

  function getProfiles() {
    return opts.profileQueries || createProfileQueries(getDatabase());
  }

  function getProjects() {
    return opts.projectQueries || createProjectQueries(getDatabase());
  }

  router.get('/', (req, res) => {
    const profileList = getProfiles().getAll();
    const matrixEntries = getMatrix().getAll();

    // Read active projects from database (not filesystem)
    const activeProjects = getProjects().getActive();

    // Build allowed_profile_ids for each active project based on accounts config
    const projectsWithAllowed = activeProjects.map(proj => {
      const config = JSON.parse(proj.default_config || '{}');
      let allowedProfileIds = profileList.map(p => p.id);

      if (config.accounts && config.accounts.length > 0) {
        const allowedNames = _parseAccountRanges(config.accounts);
        allowedProfileIds = profileList
          .filter(p => allowedNames.includes(p.name))
          .map(p => p.id);
      }

      return {
        ...proj,
        allowed_profile_ids: allowedProfileIds,
      };
    });

    const enrichedMatrix = matrixEntries.map(entry => ({
      ...entry,
      profile_name: profileList.find(p => p.id === entry.profile_id)?.name || '',
      project_display: activeProjects.find(p => p.name === entry.project_name)?.display_name || '',
    }));

    res.json({
      projects: projectsWithAllowed,
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
