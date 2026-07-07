const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { getDatabase } = require('../db');
const { createTaskQueries, createProfileQueries } = require('../db/queries');
const { logger } = require('../logger');

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

  const task = taskQueries.getById(req.params.id);
  if (!task) return res.status(404).json({ error: 'Задача не найдена' });
  if (!task.is_active) return res.status(400).json({ error: 'Задача неактивна' });

  const taskParams = typeof task.params === 'string' ? JSON.parse(task.params) : (task.params || {});
  const profiles = profileQueries.getAll();

  if (profiles.length === 0) {
    return res.status(400).json({ error: 'Нет профилей для выполнения задачи' });
  }

  const executions = [];

  for (const profile of profiles) {
    const executionId = taskQueries.createExecution(task.id, profile.id, 'running');
    executions.push({
      executionId,
      profileId: profile.id,
      profileName: profile.name,
      status: 'running',
      scriptName: task.script_name,
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
