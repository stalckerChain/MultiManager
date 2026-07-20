const path = require('path');
const fs = require('fs');

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

      const promise = this._executeProfile(profileId, profileTasks).catch((err) => {
        if (this.options.logger) {
          this.options.logger.error({ err: err.message, profileId }, 'Profile execution failed');
        }
        for (const task of profileTasks) {
          if (task.status === 'running' || task.status === 'pending') {
            this.options.updateRunTaskStatus(task.id, 'failed');
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
      const allDone = tasks.every(t => t.status === 'success' || t.status === 'failed');
      if (allDone) {
        const hasFailures = tasks.some(t => t.status === 'failed');
        this.options.updateRun(this.run.id, hasFailures ? 'partial' : 'completed', new Date().toISOString());
      } else {
        // Some tasks never reported back — mark remaining as failed
        for (const task of tasks) {
          if (task.status === 'running' || task.status === 'pending') {
            this.options.updateRunTaskStatus(task.id, 'failed');
          }
        }
        this.options.updateRun(this.run.id, 'partial', new Date().toISOString());
      }
    }
  }

  async _executeProfile(profileId, tasks) {
    for (const task of tasks) {
      await this.options.updateRunTaskStatus(task.id, 'running');
      task.status = 'running';
    }

    const profile = this.options.getProfileById
      ? await this.options.getProfileById(profileId)
      : null;
    const profileNumber = profile ? profile.number : 1;
    const profileName = profile ? profile.name : profileId;

    const projectNames = tasks.map(t => t.project_name).join(',');
    const range = `${String(profileNumber).padStart(3, '0')}-${String(profileNumber).padStart(3, '0')}`;
    const args = [
      'main.py',
      `--project=${projectNames}`,
      `--range=${range}`,
      `--log-name=${this.run.id}`,
      `--run-id=${this.run.id}`,
      `--port=${this.options.mmPort}`,
    ];

    const logDir = path.join('logs', 'runs', this.run.id);
    fs.mkdirSync(logDir, { recursive: true });
    const logPath = path.join(logDir, `${profileName}.log`);
    const logStream = fs.createWriteStream(logPath, { flags: 'a' });

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
    try {
      child = this.options.spawn(this.options.pythonPath, args, {
        cwd: this.options.stAuto0Path,
        stdio: ['ignore', 'pipe', 'pipe'],
        env: { ...process.env, MM_TOKEN: this.options.apiToken },
      });
    } catch (err) {
      logStream.end();
      if (this.options.logger) {
        this.options.logger.error({ err: err.message, profileId, pythonPath: this.options.pythonPath }, 'Failed to spawn Python process');
      }
      for (const task of tasks) {
        this.options.updateRunTaskStatus(task.id, 'failed');
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
        if (this.options.logger) {
          this.options.logger.error({ err: err.message, profileId, code: err.code }, 'Child process error');
        }
        for (const task of tasks) {
          if (task.status === 'running') {
            this.options.updateRunTaskStatus(task.id, 'failed');
          }
        }
        reject(err);
      });

      child.on('close', (code) => {
        logStream.end();
        this.processes.delete(profileId);
        if (this.options.logger) {
          this.options.logger.info({ code, profileId, profileName }, 'Child process exited');
        }
        // Mark tasks that weren't reported back as failed
        for (const task of tasks) {
          if (task.status === 'running') {
            this.options.updateRunTaskStatus(task.id, 'failed');
          }
        }
        resolve();
      });
    });
  }

  cancel() {
    this._cancelled = true;
    for (const [profileId, child] of this.processes) {
      try {
        child.kill();
      } catch (e) {
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
