import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import path from 'path';
import os from 'os';
import fs from 'fs';
import { createRequire } from 'module';

let logMod;
let appDir;

beforeAll(() => {
  appDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mm-logtest-'));
  process.env.APPDATA = appDir;
  const require = createRequire(import.meta.url);
  logMod = require('../../src/logger');
});

afterAll(() => {
  try { fs.rmSync(appDir, { recursive: true, force: true }); } catch { /* ignore */ }
});

describe('sanitizeLogName', () => {
  it('убирает символы, запрещённые в имени файла', () => {
    const bad = `ab<>:"/\\|?*${String.fromCharCode(1)}cd`;
    expect(logMod.sanitizeLogName(bad, 'fallback')).toBe('abcd');
  });

  it('убирает хвостовые точки и пробелы', () => {
    expect(logMod.sanitizeLogName('profile.  ', 'fallback')).toBe('profile');
  });

  it('ограничивает имя 100 символами', () => {
    const long = 'x'.repeat(150);
    const out = logMod.sanitizeLogName(long, 'fallback');
    expect(out.length).toBeLessThanOrEqual(100);
  });

  it('использует fallback при пустом результате', () => {
    expect(logMod.sanitizeLogName('<>:"/\\|?*', 'profile_p99')).toBe('profile_p99');
    expect(logMod.sanitizeLogName(null, 'profile_p99')).toBe('profile_p99');
  });
});

describe('resolveRunLogPath', () => {
  it('строит единый путь logs/runs/<run_id>/<safe_profile>.log', () => {
    const { dir, filePath, safeProfile } = logMod.resolveRunLogPath('run 1', 'my:profile', 'p1');
    expect(safeProfile).toBe('myprofile');
    expect(dir.endsWith(path.join('logs', 'runs', 'run 1'))).toBe(true);
    expect(filePath.endsWith(path.join('logs', 'runs', 'run 1', 'myprofile.log'))).toBe(true);
  });

  it('использует profile_<profile_id> как fallback для имени', () => {
    const { safeProfile } = logMod.resolveRunLogPath('r1', null, 'p1');
    expect(safeProfile).toBe('profile_p1');
  });
});

describe('appendRunStage', () => {
  it('записывает структурированную JSON-строку с этапом', () => {
    const file = path.join(appDir, 'stage-test.log');
    logMod.appendRunStage(file, 'python_spawn', { runId: 'r1', profileId: 'p1' });
    const content = fs.readFileSync(file, 'utf8');
    const parsed = JSON.parse(content);
    expect(parsed.stage).toBe('python_spawn');
    expect(parsed.runId).toBe('r1');
    expect(parsed.profileId).toBe('p1');
    expect(typeof parsed.ts).toBe('string');
  });

  it('не бросает ошибку при отсутствии каталога', () => {
    expect(() => logMod.appendRunStage(path.join(appDir, 'missing', 'x.log'), 's', {})).not.toThrow();
  });
});

describe('cleanupRunLogs', () => {
  function makeRunDir(name, ageDays) {
    const dir = path.join(logMod.getRunLogsDir(), name);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'p1.log'), 'x');
    const ts = new Date(Date.now() - ageDays * 24 * 60 * 60 * 1000);
    fs.utimesSync(dir, ts, ts);
    return dir;
  }

  it('удаляет run-каталоги старше 30 дней', () => {
    logMod.cleanupRunLogs({ activeRunId: null });
    makeRunDir('old-run', 40);
    fs.mkdirSync(path.join(appDir, 'logs', 'runs', 'recent-keep'), { recursive: true });

    const result = logMod.cleanupRunLogs({ activeRunId: 'active-run' });
    expect(result.removed).toBeGreaterThanOrEqual(1);
    expect(fs.existsSync(path.join(logMod.getRunLogsDir(), 'old-run'))).toBe(false);
  });

  it('не удаляет активный лог текущего run', () => {
    const activeDir = makeRunDir('active-run', 60);
    const result = logMod.cleanupRunLogs({ activeRunId: 'active-run' });
    expect(result.removed).toBe(0);
    expect(fs.existsSync(activeDir)).toBe(true);
  });

  it('возвращает { removed: 0 } когда каталога нет', () => {
    fs.rmSync(logMod.getRunLogsDir(), { recursive: true, force: true });
    expect(logMod.cleanupRunLogs({ activeRunId: null })).toEqual({ removed: 0, freedBytes: 0 });
  });
});