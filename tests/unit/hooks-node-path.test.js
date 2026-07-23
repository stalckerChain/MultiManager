import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT = resolve(__dirname, '../..');
const KEYBOARD_HOOKS_JS = resolve(ROOT, 'gui/src/main/keyboard-hooks.js');
const GITIGNORE = resolve(ROOT, '.gitignore');
const HOOKS_NODE = resolve(ROOT, 'src/os-input/native-hooks/build/Release/hooks.node');
const BINDING_GYP = resolve(ROOT, 'src/os-input/native-hooks/binding.gyp');
const HOOKS_CC = resolve(ROOT, 'src/os-input/native-hooks/hooks.cc');

describe('hooks.node — native addon availability', () => {
  it('hooks.cc source file exists', () => {
    expect(existsSync(HOOKS_CC)).toBe(true);
  });

  it('binding.gyp exists', () => {
    expect(existsSync(BINDING_GYP)).toBe(true);
  });

  it('compiled hooks.node exists in build/Release/', () => {
    // This is the critical regression test: hooks.node must be compiled
    // and available for the OS keyboard hooks to work.
    expect(existsSync(HOOKS_NODE)).toBe(true);
  });
});

describe('keyboard-hooks.js — addon path lookup', () => {
  const content = readFileSync(KEYBOARD_HOOKS_JS, 'utf-8');

  it('dev mode looks in src/os-input/native-hooks/build/Release/', () => {
    expect(content).toMatch(/path\.join\(__dirname,\s*['"]\.\.['"],\s*['"]\.\.['"],\s*['"]\.\.['"],\s*['"]src['"],\s*['"]os-input['"],\s*['"]native-hooks['"],\s*['"]build['"],\s*['"]Release['"],\s*['"]hooks\.node['"]\)/);
  });

  it('packaged mode looks in resources/backend/os-input/ (no extra src)', () => {
    // Regression: packaged path previously had a stale extra 'src' segment:
    //   resources/backend/src/os-input/... (WRONG)
    // The correct path after copy-backend.js is:
    //   resources/backend/os-input/... (CORRECT)
    expect(content).toMatch(/process\.resourcesPath,\s*['"]backend['"],\s*['"]os-input['"],\s*['"]native-hooks['"],\s*['"]build['"],\s*['"]Release['"],\s*['"]hooks\.node['"]/);
  });

  it('does NOT have extra src in packaged path', () => {
    // Verify the stale bug pattern is gone
    expect(content).not.toMatch(/process\.resourcesPath,\s*['"]backend['"],\s*['"]src['"],\s*['"]os-input['"]/);
  });
});

describe('.gitignore — native-hooks/build is NOT ignored', () => {
  const content = readFileSync(GITIGNORE, 'utf-8');

  it('has negation rule for native-hooks/build', () => {
    expect(content).toMatch(/!src\/os-input\/native-hooks\/build\//);
  });

  it('general build/ rule exists (for other build dirs)', () => {
    expect(content).toMatch(/^build\/$/m);
  });
});

describe('package.json — build:native script exists', () => {
  const pkg = JSON.parse(readFileSync(resolve(ROOT, 'package.json'), 'utf-8'));

  it('has build:native script that runs node-gyp rebuild', () => {
    expect(pkg.scripts['build:native']).toBeDefined();
    expect(pkg.scripts['build:native']).toMatch(/node-gyp rebuild/);
  });
});
