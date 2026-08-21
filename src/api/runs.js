const express = require('express');
const { spawn } = require('child_process');
const path = require('path');
const os = require('os');
const { getDatabase } = require('../db');
const { createRunQueries, createRunTaskQueries, createMatrixQueries, createSystemConfigQueries, createProfileQueries } = require('../db/queries');
const { RunExecutor } = require('../executor');
const { stopProfile } = require('./browser');
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

    const apiToken = req.headers.authorization?.replace('Bearer ', '') || '';
    if (!apiToken) {
      return res.status(401).json({ error: 'API token is required to start runs' });
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
      apiToken,
      mmPort: req.socket.localPort || process.env.PORT || 3000,
      spawn,
      logger,
      getRunTasks: () => Promise.resolve(getRunTasks().getByRunId(run.id)),
      updateRunTaskStatus: (taskId, status, exitCode, logPath, attempts, errorMessage) => getRunTasks().updateStatus(taskId, status, exitCode, logPath, attempts, errorMessage),
      updateRun: (id, status, completedAt) => getRuns().updateStatus(id, status, null, completedAt),
      incrementRun: (id, success) => getRuns().incrementCompleted(id, success),
      getProfileById: (id) => Promise.resolve(profileQueries.getById(id)),
      stopProfile: (profileId) => stopProfile(profileId),
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

  function handleClone(req, res, mode) {
    const sourceRun = getRuns().getById(req.params.id);
    if (!sourceRun) {
      return res.status(404).json({ error: 'Run not found' });
    }

    let pairs;
    try {
      if (mode === 'retry') {
        pairs = getRunTasks().getRetryPairs(req.params.id);
      } else {
        pairs = getRunTasks().getAllPairs(req.params.id);
      }
    } catch (err) {
      logger.error({ err: err.message, runId: req.params.id, mode }, 'Failed to fetch source run tasks');
      return res.status(500).json({ error: 'Internal server error' });
    }

    if (!pairs || pairs.length === 0) {
      const errorMsg = mode === 'retry'
        ? 'No tasks to retry: all tasks succeeded or source run has no tasks'
        : 'Source run has no tasks to duplicate';
      return res.status(400).json({ error: errorMsg });
    }

    let { name, parallel_limit } = req.body || {};

    // Пустое имя после trim трактуется как отсутствие
    if (typeof name === 'string') {
      const trimmed = name.trim();
      name = trimmed.length ? trimmed : undefined;
    }

    const now = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    const dateStr = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}`;
    const finalName = name || `Run ${dateStr}`;
    const finalLimit = parallel_limit != null ? parallel_limit : 1;

    try {
      const newRun = getRuns().createWithTasks(
        { name: finalName, parallel_limit: finalLimit },
        pairs.map(p => ({ project_name: p.project_name, profile_id: p.profile_id }))
      );
      return res.status(201).json({
        run_id: newRun.id,
        tasks_created: pairs.length,
        name: newRun.name,
        parallel_limit: newRun.parallel_limit,
      });
    } catch (err) {
      logger.error({ err: err.message, runId: req.params.id, mode }, 'Failed to clone run');
      return res.status(500).json({ error: 'Internal server error' });
    }
  }

  router.post('/:id/retry', validate(runCreateSchema), (req, res) => handleClone(req, res, 'retry'));
  router.post('/:id/duplicate', validate(runCreateSchema), (req, res) => handleClone(req, res, 'duplicate'));

  return router;
}

module.exports = { createRunsRouter };
