const express = require('express');
const { getDatabase } = require('../db');
const { createRunQueries, createRunTaskQueries, createProfileQueries } = require('../db/queries');

function createInternalRunsRouter(opts = {}) {
  const router = express.Router();

  router.use((req, res, next) => {
    if (opts.skipLocalhostCheck) return next();
    const remote = req.ip || req.connection?.remoteAddress || '';
    const isLocalhost = remote === '127.0.0.1' || remote === '::1' || remote === '::ffff:127.0.0.1' || remote === 'localhost';
    if (!isLocalhost) {
      return res.status(403).json({ error: 'Only localhost allowed' });
    }
    next();
  });

  function getRuns() {
    return opts.runQueries || createRunQueries(getDatabase());
  }

  function getRunTasks() {
    return opts.runTaskQueries || createRunTaskQueries(getDatabase());
  }

  function getProfiles() {
    return opts.profileQueries || createProfileQueries(getDatabase());
  }

  router.post('/:id/task-status', (req, res) => {
    const { project_name, profile_name, status, attempts } = req.body;
    if (!project_name || !profile_name || !status) {
      return res.status(400).json({ error: 'project_name, profile_name and status are required' });
    }

    const validStatuses = ['success', 'failed', 'running'];
    if (!validStatuses.includes(status)) {
      return res.status(400).json({ error: 'Invalid status' });
    }

    const run = getRuns().getById(req.params.id);
    if (!run) {
      return res.status(404).json({ error: 'Run not found' });
    }

    const allProfiles = getProfiles().getAll();
    const profile = allProfiles.find(p => p.name === profile_name);
    if (!profile) {
      return res.status(404).json({ error: 'Profile not found' });
    }

    const tasks = getRunTasks().getByRunId(req.params.id);
    const task = tasks.find(t => t.project_name === project_name && t.profile_id === profile.id);
    if (!task) {
      return res.status(404).json({ error: 'Task not found' });
    }

    const exitCode = status === 'success' ? 0 : 1;
    getRunTasks().updateStatus(task.id, status, exitCode, null, attempts);

    getRuns().incrementCompleted(req.params.id, status === 'success');

    const updatedTasks = getRunTasks().getByRunId(req.params.id);
    const allDone = updatedTasks.every(t => t.status === 'success' || t.status === 'failed');
    if (allDone) {
      const hasFailures = updatedTasks.some(t => t.status === 'failed');
      getRuns().updateStatus(req.params.id, hasFailures ? 'partial' : 'completed', null, new Date().toISOString());
    }

    res.json({ ok: true });
  });

  return router;
}

module.exports = { createInternalRunsRouter };
