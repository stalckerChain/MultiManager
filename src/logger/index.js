const pino = require('pino');
const path = require('path');
const fs = require('fs');
const { getDataDir } = require('../core/data-dir');

function getAppDir() {
  return getDataDir();
}

function ensureDir(dir) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

const appDir = getAppDir();
ensureDir(appDir);
ensureDir(path.join(appDir, 'logs'));
ensureDir(path.join(appDir, 'logs', 'runs'));

let coreTarget;
try {
  require.resolve('pino-roll');
  coreTarget = {
    target: 'pino-roll',
    level: 'info',
    options: {
      file: path.join(appDir, 'logs', 'core.log'),
      size: '10m',
      limit: { count: 5 },
      mkdir: true,
    },
  };
} catch {
  coreTarget = {
    target: 'pino/file',
    level: 'info',
    options: { destination: path.join(appDir, 'logs', 'core.log'), mkdir: true },
  };
}

const targets = [coreTarget];

if (process.env.NODE_ENV !== 'production') {
  try {
    require.resolve('pino-pretty');
    targets.push({
      target: 'pino-pretty',
      level: 'info',
      options: {},
    });
  } catch { /* pino-pretty not available */ }
} else {
  targets.push({
    target: 'pino/file',
    options: { destination: 1 },
    level: 'info',
  });
}

const logger = pino({
  level: process.env.LOG_LEVEL || 'info',
  transport: { targets },
});

function createProfileLogger(profileId) {
  const logsDir = path.join(appDir, 'logs');
  ensureDir(logsDir);

  const logFile = path.join(logsDir, `profile_${profileId}.log`);
  const dest = pino.destination({ dest: logFile, sync: true });

  return pino({
    level: 'debug',
  }, dest);
}

// --- Run-логи automation ---

const RUN_NAME_LIMIT = 100;
const RUN_LOGS_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;
const RUN_LOGS_MAX_BYTES = 1024 * 1024 * 1024;

function getRunLogsDir() {
  return path.join(getAppDir(), 'logs', 'runs');
}

/**
 * Безопасное имя файла: только символы, допустимые в имени файла на всех
 * платформах. Убирает хвостовые точки/пробелы и ограничивает длину.
 */
function sanitizeLogName(raw, fallback) {
  const cleaned = String(raw == null ? '' : raw)
    // eslint-disable-next-line no-control-regex
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, '')
    .replace(/[.\s]+$/g, '')
    .slice(0, RUN_NAME_LIMIT);
  return cleaned || fallback || 'profile';
}

/**
 * Единый путь run-лога: logs/runs/<run_id>/<safe_profile_name>.log.
 * Не выполняет файловых операций — только вычисляет пути.
 */
function resolveRunLogPath(runId, profileName, profileId) {
  const safeRun = sanitizeLogName(runId, 'run');
  const fallback = profileId ? `profile_${profileId}` : 'profile';
  const safeProfile = sanitizeLogName(profileName, fallback);
  const dir = path.join(getRunLogsDir(), safeRun);
  const filePath = path.join(dir, `${safeProfile}.log`);
  return { dir, filePath, safeProfile };
}

/**
 * Структурированная строка этапа run-лога в формате JSON.
 * Ошибки записи не роняют вызывающий код (логируется в основной logger).
 */
function appendRunStage(logPath, stage, data = {}) {
  const line = JSON.stringify({
    ts: new Date().toISOString(),
    stage,
    ...data,
  });
  try {
    fs.appendFileSync(logPath, line + '\n', 'utf8');
  } catch (err) {
    logger.error({ logPath, stage, err: err.message }, 'Failed to append run stage');
  }
}

function dirSizeBytes(dirPath) {
  let size = 0;
  try {
    for (const entry of fs.readdirSync(dirPath, { withFileTypes: true })) {
      const full = path.join(dirPath, entry.name);
      if (entry.isDirectory()) {
        size += dirSizeBytes(full);
      } else if (entry.isFile()) {
        size += fs.statSync(full).size;
      }
    }
  } catch { /* ignore */ }
  return size;
}

/**
 * Очистка каталога run-логов без постоянно работающего процесса:
 *  - удаляет run-каталоги старше 30 дней;
 *  - затем удаляет самые старые, пока суммарный размер не станет ≤ 1 GB;
 *  - никогда не удаляет активный каталог current run.
 */
function cleanupRunLogs(opts = {}) {
  const runsDir = getRunLogsDir();
  if (!fs.existsSync(runsDir)) return { removed: 0, freedBytes: 0 };

  const activeRunId = opts.activeRunId != null ? String(opts.activeRunId) : null;
  const now = Date.now();
  const entries = [];
  let removed = 0;
  let freedBytes = 0;

  for (const entry of fs.readdirSync(runsDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const dirPath = path.join(runsDir, entry.name);
    let mtime;
    try {
      mtime = fs.statSync(dirPath).mtimeMs;
    } catch { continue; }
    entries.push({
      name: entry.name,
      dirPath,
      mtime,
      size: dirSizeBytes(dirPath),
      isActive: activeRunId !== null && entry.name === activeRunId,
    });
  }

  // 1. Удаление по возрасту.
  const ageRemoved = entries.filter(e => !e.isActive && now - e.mtime > RUN_LOGS_MAX_AGE_MS);
  for (const ent of ageRemoved) {
    try {
      fs.rmSync(ent.dirPath, { recursive: true, force: true });
      removed++;
      freedBytes += ent.size;
    } catch { /* ignore */ }
  }

  // 2. Ограничение суммарного размера (только неактивные, самые старые вперёд).
  const remaining = entries
    .filter(e => !e.isActive && fs.existsSync(e.dirPath))
    .sort((a, b) => a.mtime - b.mtime);
  let totalBytes = remaining.reduce((sum, e) => sum + e.size, 0);
  if (totalBytes > RUN_LOGS_MAX_BYTES) {
    for (const ent of remaining) {
      if (totalBytes <= RUN_LOGS_MAX_BYTES) break;
      try {
        fs.rmSync(ent.dirPath, { recursive: true, force: true });
        removed++;
        freedBytes += ent.size;
        totalBytes -= ent.size;
      } catch { /* ignore */ }
    }
  }

  return { removed, freedBytes };
}

module.exports = {
  logger,
  createProfileLogger,
  getAppDir,
  getRunLogsDir,
  sanitizeLogName,
  resolveRunLogPath,
  appendRunStage,
  cleanupRunLogs,
};