const path = require('path');
const fs = require('fs');
const { getExtensionsDir, resolveRuntimeId } = require('../api/extensions');
const { getBrowserDataDir } = require('../core/profile-path');
const { appendRunStage, resolveRunLogPath, cleanupRunLogs } = require('../logger');

class RunExecutor {
  static instances = new Map();

  constructor(run, options) {
    this.run = { ...run };
    this.options = options;
    this.processes = new Map();
    this._cancelled = false;
    this._tasks = [];
  }

  _groupByProfile() {
    const groups = {};
    for (const task of this._tasks) {
      if (!groups[task.profile_id]) {
        groups[task.profile_id] = [];
      }
      groups[task.profile_id].push(task);
    }
    return groups;
  }

  async start() {
    this._tasks = await this.options.getRunTasks();
    const groups = this._groupByProfile();

    const running = [];
    const limit = this.run.parallel_limit || 2;

    for (const [profileId, profileTasks] of Object.entries(groups)) {
      if (this._cancelled) break;

      if (running.length >= limit) {
        await Promise.race(running);
      }

      const promise = this._executeProfile(profileId, profileTasks).catch(async (err) => {
        if (this.options.logger) {
          this.options.logger.error({ err: err.message, profileId }, 'Profile execution failed');
        }
        const live = await this.options.getRunTasks();
        for (const task of profileTasks) {
          const current = live.find(t => t.id === task.id);
          const stillActive = !current || current.status === 'running' || current.status === 'pending';
          if (stillActive) {
            this.options.updateRunTaskStatus(
              task.id,
              'failed',
              null,
              (current && current.log_file_path) || null,
              null,
              current && current.error_message ? null : `Profile execution failed: ${err.message}`
            );
          }
        }
      }).finally(() => {
        const idx = running.indexOf(promise);
        if (idx >= 0) running.splice(idx, 1);
      });
      running.push(promise);
    }

    await Promise.all(running);

    // Finalize run status if still running (Python scripts may not have reported back)
    if (!this._cancelled && this.options.updateRun) {
      const tasks = await this.options.getRunTasks();
      const statusCounts = { success: 0, failed: 0, running: 0, pending: 0 };
      for (const t of tasks) {
        statusCounts[t.status] = (statusCounts[t.status] || 0) + 1;
      }
      if (this.options.logger) {
        this.options.logger.info({ runId: this.run.id, ...statusCounts }, 'Run finalization: task status summary');
      }

      const allDone = tasks.every(t => t.status === 'success' || t.status === 'failed');
      if (allDone) {
        const hasFailures = tasks.some(t => t.status === 'failed');
        this.options.updateRun(this.run.id, hasFailures ? 'partial' : 'completed', new Date().toISOString());
      } else {
        // Some tasks never reported back — mark remaining as failed
        for (const task of tasks) {
          if (task.status === 'running' || task.status === 'pending') {
            this.options.updateRunTaskStatus(
              task.id,
              'failed',
              null,
              task.log_file_path || null,
              null,
              task.error_message ? null : 'Run finalization: task did not report back'
            );
          }
        }
        this.options.updateRun(this.run.id, 'partial', new Date().toISOString());
      }
    }
  }

  async _executeProfile(profileId, tasks) {
    const profile = this.options.getProfileById
      ? await this.options.getProfileById(profileId)
      : null;
    const profileName = profile ? profile.name : profileId;

    // Безусловное создание run-лога ДО любых pre-flight операций (resolveRuntimeId
    // и spawn находятся ниже), чтобы ранние ошибки не терялись.
    let runLog = null;
    try {
      runLog = resolveRunLogPath(this.run.id, profileName, profileId);
      fs.mkdirSync(runLog.dir, { recursive: true });
      appendRunStage(runLog.filePath, 'profile_preflight_started', {
        runId: this.run.id,
        profileId,
        profileName,
      });
      // Ротация размера/возраста run-логов при создании нового лога.
      cleanupRunLogs({ activeRunId: this.run.id });
    } catch (err) {
      if (this.options.logger) {
        this.options.logger.error({ err: err.message, runId: this.run.id, profileId }, 'Failed to create run log');
      }
      throw err;
    }

    const filePath = runLog.filePath;
    const setTaskStatus = (taskId, status, errorMessage) => {
      return this.options.updateRunTaskStatus(taskId, status, null, runLog ? filePath : null, null, errorMessage ? String(errorMessage) : null);
    };

    for (const task of tasks) {
      await setTaskStatus(task.id, 'running');
      task.status = 'running';
      appendRunStage(filePath, 'task_status', {
        runId: this.run.id,
        profileId,
        taskId: task.id,
        projectName: task.project_name,
        status: 'running',
      });
    }

    const projectNames = tasks.map(t => t.project_name).join(',');
    const nameMatch = profileName.match(/\d+$/);
    const accountNumber = nameMatch ? parseInt(nameMatch[0], 10) : 1;
    const range = `${String(accountNumber).padStart(3, '0')}-${String(accountNumber).padStart(3, '0')}`;
    const args = [
      'main.py',
      `--token=${this.options.apiToken}`,
      `--project=${projectNames}`,
      `--range=${range}`,
      `--log-name=${this.run.id}`,
      `--run-id=${this.run.id}`,
      `--port=${this.options.mmPort}`,
    ];

    // Zerion extension ID — из профайловых extensions (не логируем секреты).
    let zerionId = '';
    try {
      if (profile && profile.extensions) {
        const extensions = JSON.parse(profile.extensions);
        if (Array.isArray(extensions) && extensions.length > 0) {
          const folderName = extensions[0];
          const extDir = getExtensionsDir();
          const extPath = path.join(extDir, folderName);
          const profileDir = getBrowserDataDir(profile);
          const runtimeId = await resolveRuntimeId(extPath, profileDir);
          if (runtimeId) zerionId = runtimeId;
        }
      }
      appendRunStage(filePath, 'runtime_id_resolution', {
        runId: this.run.id,
        profileId,
        hasZerionId: !!zerionId,
      });
    } catch (e) {
      if (this.options.logger) {
        this.options.logger.warn({ err: e.message, profileId }, 'Runtime ID resolution failed');
      }
      appendRunStage(filePath, 'runtime_id_resolution', {
        runId: this.run.id,
        profileId,
        hasZerionId: false,
        error: e.message,
      });
    }

    if (this.options.logger) {
      this.options.logger.info({
        pythonPath: this.options.pythonPath,
        stAuto0Path: this.options.stAuto0Path,
        projectNames,
        range,
        profileId,
        profileName,
      }, 'Spawning Python process');
    }

    let child;
    let logStream;
    try {
      logStream = fs.createWriteStream(filePath, { flags: 'a' });
      logStream.on('error', (err) => {
        if (this.options.logger) {
          this.options.logger.warn({ err: err.message, profileId, runId: this.run.id }, 'Run log stream error');
        }
      });
      child = this.options.spawn(this.options.pythonPath, args, {
        cwd: this.options.stAuto0Path,
        stdio: ['ignore', 'pipe', 'pipe'],
        env: { ...process.env, MM_TOKEN: this.options.apiToken, ...(zerionId ? { ZERION_ID: zerionId } : {}) },
      });
      appendRunStage(filePath, 'python_spawn', { runId: this.run.id, profileId });
    } catch (err) {
      appendRunStage(filePath, 'run_error', { runId: this.run.id, profileId, phase: 'python_spawn', error: err.message });
      if (logStream) logStream.end();
      if (this.options.logger) {
        this.options.logger.error({ err: err.message, profileId, pythonPath: this.options.pythonPath }, 'Failed to spawn Python process');
      }
      for (const task of tasks) {
        await setTaskStatus(task.id, 'failed', `Python spawn: ${err.message}`);
      }
      throw err;
    }
    this.processes.set(profileId, child);

    child.stdout.pipe(logStream);
    child.stderr.pipe(logStream);

    return new Promise((resolve, reject) => {
      child.on('error', (err) => {
        logStream.end();
        this.processes.delete(profileId);
        appendRunStage(filePath, 'run_error', { runId: this.run.id, profileId, phase: 'python_exit', error: err.message });
        if (this.options.logger) {
          this.options.logger.error({ err: err.message, profileId, code: err.code }, 'Child process error');
        }
        for (const task of tasks) {
          if (task.status === 'running') {
            setTaskStatus(task.id, 'failed', `Python process error: ${err.message}`);
          }
        }
        reject(err);
      });

      child.on('close', async (code) => {
        logStream.end();
        this.processes.delete(profileId);
        appendRunStage(filePath, 'python_exit', { runId: this.run.id, profileId, code });
        if (this.options.logger) {
          this.options.logger.info({ code, profileId, profileName }, 'Child process exited');
        }

        // Re-read tasks from DB — Python callback may have updated status
        const updatedTasks = await this.options.getRunTasks();
        let failedCount = 0;
        for (const task of updatedTasks) {
          if (task.status === 'running') {
            setTaskStatus(task.id, 'failed', `Process exited with code ${code} but task did not finish`);
            failedCount++;
          }
        }
        if (this.options.logger && failedCount > 0) {
          this.options.logger.warn({ code, profileId, failedCount }, 'Tasks still running after process exit — marked as failed');
        }
        resolve();
      });
    });
  }

  cancel() {
    this._cancelled = true;
    for (const [, child] of this.processes) {
      try {
        child.kill();
      } catch {
        // ignore
      }
    }
    this.processes.clear();
    if (this.options.updateRun) {
      this.options.updateRun(this.run.id, 'cancelled');
    }
  }
}

module.exports = { RunExecutor };