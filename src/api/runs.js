const express = require('express');
const { spawn } = require('child_process');
const path = require('path');
const os = require('os');
const { getDatabase } = require('../db');
const { createRunQueries, createRunTaskQueries, createMatrixQueries, createSystemConfigQueries, createProfileQueries } = require('../db/queries');
const { RunExecutor } = require('../executor');
const { validate, runCreateSchema } = require('./validate');
const { logger } = require('../logger');

function createRunsRouter(opts = {}) {
  const router = express.Router();

  function getDb() {
    return opts.db || getDatabase();
  }

  function getRuns() {
    return opts.runQueries || createRunQueries(getDb());
  }

  function getRunTasks() {
    return opts.runTaskQueries || createRunTaskQueries(getDb());
  }

  function getMatrix() {
    return opts.matrixQueries || createMatrixQueries(getDb());
  }

  function getCfg() {
    return opts.configQueries || createSystemConfigQueries(getDb());
  }

  router.get('/', (req, res) => {
    const page = parseInt(req.query.page, 10) || 1;
    const limit = parseInt(req.query.limit, 10) || 20;
    const result = getRuns().getAll(page, limit);
    res.json(result);
  });

  router.post('/', validate(runCreateSchema), (req, res) => {
    const { name, parallel_limit } = req.body;

    const enabledPairs = getMatrix().getEnabledPairs();
    if (enabledPairs.length === 0) {
      return res.status(400).json({ error: 'No enabled entries in matrix' });
    }

    const now = new Date();
    const dateStr = now.toISOString().slice(0, 16).replace('T', ' ');
    const runName = name || `Run ${dateStr}`;
    const run = getRuns().create({ name: runName, parallel_limit: parallel_limit || 2 });

    const ids = getRunTasks().batchInsert(run.id, enabledPairs.map(e => ({
      project_name: e.project_name,
      profile_id: e.profile_id,
    })));

    res.status(201).json({ run_id: run.id, tasks_created: ids.length, name: runName });
  });

  router.get('/:id', (req, res) => {
    const run = getRuns().getById(req.params.id);
    if (!run) {
      return res.status(404).json({ error: 'Run not found' });
    }
    const tasks = getRunTasks().getByRunId(req.params.id);
    res.json({ ...run, tasks });
  });

  router.post('/:id/start', (req, res) => {
    const run = getRuns().getById(req.params.id);
    if (!run) {
      return res.status(404).json({ error: 'Run not found' });
    }
    if (run.status !== 'pending') {
      return res.status(400).json({ error: 'Only pending runs can be started' });
    }

    getRuns().updateStatus(req.params.id, 'running', new Date().toISOString());

    const profileQueries = createProfileQueries(getDb());
    const cfg = getCfg();
    const defaultStAuto0 = path.join(os.homedir(), 'AI', 'stAuto0');
    const defaultPython = path.join(os.homedir(), 'AI', 'stAuto0', 'venv', 'Scripts', 'python.exe');
    const stAuto0Path = cfg.get('stAuto0_path') || defaultStAuto0;
    const pythonPath = cfg.get('python_path') || defaultPython;

    logger.info({ runId: run.id, stAuto0Path, pythonPath }, 'Starting run');

    const executor = new RunExecutor(run, {
      stAuto0Path,
      pythonPath,
      apiToken: req.headers.authorization?.replace('Bearer ', '') || '',
      mmPort: req.socket.localPort || process.env.PORT || 3000,
      spawn,
      logger,
      getRunTasks: () => Promise.resolve(getRunTasks().getByRunId(run.id)),
      updateRunTaskStatus: (taskId, status) => getRunTasks().updateStatus(taskId, status),
      updateRun: (id, status, completedAt) => getRuns().updateStatus(id, status, null, completedAt),
      incrementRun: (id, success) => getRuns().incrementCompleted(id, success),
      getProfileById: (id) => Promise.resolve(profileQueries.getById(id)),
    });

    RunExecutor.instances.set(run.id, executor);
    executor.start()
      .catch((err) => {
        logger.error({ err: err.message, runId: run.id }, 'Run executor failed');
        const tasks = getRunTasks().getByRunId(run.id);
        for (const task of tasks) {
          if (task.status === 'running' || task.status === 'pending') {
            getRunTasks().updateStatus(task.id, 'failed');
          }
        }
        getRuns().updateStatus(run.id, 'partial', null, new Date().toISOString());
      })
      .finally(() => RunExecutor.instances.delete(run.id));

    res.json({ status: 'started', run_id: req.params.id });
  });

  router.post('/:id/cancel', (req, res) => {
    const run = getRuns().getById(req.params.id);
    if (!run) {
      return res.status(404).json({ error: 'Run not found' });
    }

    const executor = RunExecutor.instances.get(req.params.id);
    if (executor) {
      executor.cancel();
    }

    getRuns().updateStatus(req.params.id, 'cancelled', null, new Date().toISOString());
    const tasks = getRunTasks().getByRunId(req.params.id);
    for (const task of tasks) {
      if (task.status === 'running' || task.status === 'pending') {
        getRunTasks().updateStatus(task.id, 'failed');
      }
    }
    res.json({ status: 'cancelled', run_id: req.params.id });
  });

  return router;
}

module.exports = { createRunsRouter };
