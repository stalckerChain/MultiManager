const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { spawn } = require('child_process');
const path = require('path');
const os = require('os');
const fs = require('fs');
const { getDatabase } = require('../db');
const { createTaskQueries, createProfileQueries, createSystemConfigQueries } = require('../db/queries');
const { logger, getAppDir } = require('../logger');
const { getToken } = require('./auth');
const { parseRange } = require('./internal');

const router = express.Router();

router.get('/', (req, res) => {
  const db = getDatabase();
  const taskQueries = createTaskQueries(db);
  const tasks = taskQueries.getAll();
  res.json(tasks);
});

router.get('/:id', (req, res) => {
  const db = getDatabase();
  const taskQueries = createTaskQueries(db);
  const task = taskQueries.getById(req.params.id);
  if (!task) return res.status(404).json({ error: 'Задача не найдена' });
  res.json(task);
});

router.post('/', (req, res) => {
  const db = getDatabase();
  const taskQueries = createTaskQueries(db);

  const { name, script_name, schedule_type, cron_expression, params, is_active } = req.body;

  if (!name || !script_name || !schedule_type) {
    return res.status(400).json({ error: 'name, script_name и schedule_type обязательны' });
  }

  const validTypes = ['once', 'daily', 'weekly', 'manual', 'archive'];
  if (!validTypes.includes(schedule_type)) {
    return res.status(400).json({ error: `schedule_type должен быть одним из: ${validTypes.join(', ')}` });
  }

  const task = taskQueries.create({
    name,
    script_name,
    schedule_type,
    cron_expression,
    params: params || {},
    is_active: is_active !== undefined ? is_active : true,
  });

  res.status(201).json(task);
});

router.put('/:id', (req, res) => {
  const db = getDatabase();
  const taskQueries = createTaskQueries(db);

  const existing = taskQueries.getById(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Задача не найдена' });

  const { name, script_name, schedule_type, cron_expression, params, is_active } = req.body;

  const task = taskQueries.update(req.params.id, {
    name,
    script_name,
    schedule_type,
    cron_expression,
    params,
    is_active,
  });

  res.json(task);
});

router.delete('/:id', (req, res) => {
  const db = getDatabase();
  const taskQueries = createTaskQueries(db);

  const existing = taskQueries.getById(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Задача не найдена' });

  taskQueries.delete(req.params.id);
  res.status(204).end();
});

router.get('/:id/executions', (req, res) => {
  const db = getDatabase();
  const taskQueries = createTaskQueries(db);

  const existing = taskQueries.getById(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Задача не найдена' });

  const executions = taskQueries.getExecutions(req.params.id);
  res.json(executions);
});

router.post('/:id/run', async (req, res) => {
  const db = getDatabase();
  const taskQueries = createTaskQueries(db);
  const profileQueries = createProfileQueries(db);
  const configQueries = createSystemConfigQueries(db);

  const task = taskQueries.getById(req.params.id);
  if (!task) return res.status(404).json({ error: 'Задача не найдена' });
  if (!task.is_active) return res.status(400).json({ error: 'Задача неактивна' });

  const defaultStAuto0 = path.join(os.homedir(), 'AI', 'stAuto0');
  const defaultPython = path.join(os.homedir(), 'AI', 'stAuto0', 'venv', 'Scripts', 'python.exe');
  const stAuto0Path = configQueries.get('stAuto0_path') || defaultStAuto0;
  const pythonPath = configQueries.get('python_path') || defaultPython;
  if (!stAuto0Path) return res.status(400).json({ error: 'stAuto0_path не настроен' });
  if (!pythonPath) return res.status(400).json({ error: 'python_path не настроен' });

  const taskParams = typeof task.params === 'string' ? JSON.parse(task.params) : (task.params || {});

  let profiles;
  if (taskParams.range) {
    const rangeNames = parseRange(taskParams.range);
    if (!rangeNames) return res.status(400).json({ error: 'Неверный формат range' });
    profiles = profileQueries.getAll().filter(p => rangeNames.includes(p.name));
  } else {
    profiles = profileQueries.getAll();
  }

  if (profiles.length === 0) {
    return res.status(400).json({ error: 'Нет профилей для выполнения задачи' });
  }

  const tasksLogDir = path.join(getAppDir(), 'logs', 'tasks');
  fs.mkdirSync(tasksLogDir, { recursive: true });

  const apiToken = getToken();
  const executions = [];

  for (const profile of profiles) {
    const timestamp = Date.now();
    const logFileName = `task_${task.id}_${profile.id}_${timestamp}.log`;
    const logFilePath = path.join(tasksLogDir, logFileName);

    const execId = taskQueries.createExecution(task.id, profile.id, 'running', logFilePath);

    const logStream = fs.createWriteStream(logFilePath, { flags: 'a' });
    const child = spawn(pythonPath, [
      'main.py',
      `--project=${task.script_name}`,
      `--range=${String(profile.number).padStart(3, '0')}-${String(profile.number).padStart(3, '0')}`,
      `--log-name=${task.id}`,
      `--token=${apiToken}`,
    ], { cwd: stAuto0Path, stdio: ['ignore', 'pipe', 'pipe'] });

    child.stdout.on('data', d => logStream.write(d));
    child.stderr.on('data', d => logStream.write(d));

    child.on('exit', (code) => {
      logStream.end();
      taskQueries.updateExecutionStatus(execId, code === 0 ? 'success' : 'failed', code);
      logger.info({ taskId: task.id, execId, code }, 'Task execution completed');
    });

    child.on('error', (err) => {
      logStream.write(`[SYSTEM] Spawn error: ${err.message}\n`);
      logStream.end();
      taskQueries.updateExecutionStatus(execId, 'failed', -1);
    });

    executions.push({
      executionId: execId,
      profileId: profile.id,
      profileName: profile.name,
      status: 'running',
      scriptName: task.script_name,
      logFile: logFilePath,
    });
  }

  logger.info({ taskId: task.id, taskName: task.name, profilesCount: profiles.length }, 'Task run started');

  res.json({
    status: 'started',
    task_id: task.id,
    task_name: task.name,
    script_name: task.script_name,
    profiles_count: profiles.length,
    executions,
  });
});

module.exports = router;
