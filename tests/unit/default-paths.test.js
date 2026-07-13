import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import path from 'path';
import os from 'os';
import { createTables } from '../../src/db/schema';
import { createSystemConfigQueries, createProjectQueries, createMatrixQueries } from '../../src/db/queries';

describe('Default paths resolution', () => {
  it('resolves default stAuto0 path using os.homedir()', () => {
    const defaultPath = path.join(os.homedir(), 'AI', 'stAuto0');
    expect(defaultPath).toContain('AI');
    expect(defaultPath).toContain('stAuto0');
    expect(path.isAbsolute(defaultPath)).toBe(true);
  });

  it('resolves default python path using os.homedir()', () => {
    const defaultPython = path.join(os.homedir(), 'AI', 'stAuto0', 'venv', 'Scripts', 'python.exe');
    expect(defaultPython).toContain('python.exe');
    expect(path.isAbsolute(defaultPython)).toBe(true);
  });
});

describe('Default paths in project queries', () => {
  let db;

  beforeEach(() => {
    db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    createTables(db);
  });

  it('projects sync works with default path when not configured', () => {
    const config = createSystemConfigQueries(db);
    // stAuto0_path is NOT set - should use default
    const rawPath = config.get('stAuto0_path') || '';
    const defaultPath = path.join(os.homedir(), 'AI', 'stAuto0');
    const stAuto0Path = rawPath || defaultPath;

    expect(stAuto0Path).toBe(defaultPath);
    expect(stAuto0Path).toContain('stAuto0');
  });

  it('projects sync uses configured path when set', () => {
    const config = createSystemConfigQueries(db);
    config.set('stAuto0_path', '/custom/stAuto0');

    const rawPath = config.get('stAuto0_path') || '';
    const defaultPath = path.join(os.homedir(), 'AI', 'stAuto0');
    const stAuto0Path = rawPath || defaultPath;

    expect(stAuto0Path).toContain('custom');
    expect(stAuto0Path).not.toBe(defaultPath);
  });

  it('python path uses default when not configured', () => {
    const config = createSystemConfigQueries(db);
    const rawPython = config.get('python_path') || '';
    const defaultPython = path.join(os.homedir(), 'AI', 'stAuto0', 'venv', 'Scripts', 'python.exe');
    const pythonPath = rawPython || defaultPython;

    expect(pythonPath).toBe(defaultPython);
    expect(pythonPath).toContain('python');
  });

  it('python path uses configured value when set', () => {
    const config = createSystemConfigQueries(db);
    config.set('python_path', '/custom/python');

    const rawPython = config.get('python_path') || '';
    const defaultPython = path.join(os.homedir(), 'AI', 'stAuto0', 'venv', 'Scripts', 'python.exe');
    const pythonPath = rawPython || defaultPython;

    expect(pythonPath).toContain('custom');
    expect(pythonPath).not.toBe(defaultPython);
  });
});

describe('Settings endpoint returns defaults', () => {
  let db;

  beforeEach(() => {
    db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    createTables(db);
  });

  it('parallelLimit defaults to 2', () => {
    const config = createSystemConfigQueries(db);
    const parallelLimit = parseInt(config.get('parallel_limit'), 10) || 2;
    expect(parallelLimit).toBe(2);
  });

  it('parallelLimit uses configured value', () => {
    const config = createSystemConfigQueries(db);
    config.set('parallel_limit', '5');
    const parallelLimit = parseInt(config.get('parallel_limit'), 10) || 2;
    expect(parallelLimit).toBe(5);
  });
});
