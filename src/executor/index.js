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

      const promise = this._executeProfile(profileId, profileTasks).finally(() => {
        const idx = running.indexOf(promise);
        if (idx >= 0) running.splice(idx, 1);
      });
      running.push(promise);
    }

    await Promise.all(running);
  }

  async _executeProfile(profileId, tasks) {
    for (const task of tasks) {
      await this.options.updateRunTaskStatus(task.id, 'running');
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
      `--token=${this.options.apiToken}`,
      `--port=${this.options.mmPort}`,
    ];

    const logDir = path.join('logs', 'runs', this.run.id);
    fs.mkdirSync(logDir, { recursive: true });
    const logPath = path.join(logDir, `${profileName}.log`);
    const logStream = fs.createWriteStream(logPath, { flags: 'a' });

    const child = this.options.spawn(this.options.pythonPath, args, {
      cwd: this.options.stAuto0Path,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    this.processes.set(profileId, child);

    child.stdout.pipe(logStream);
    child.stderr.pipe(logStream);

    return new Promise((resolve) => {
      child.on('close', (code) => {
        logStream.end();
        this.processes.delete(profileId);
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
