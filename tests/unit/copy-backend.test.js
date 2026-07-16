import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';

const COPY_BACKEND_JS = new URL('../../gui/scripts/copy-backend.js', import.meta.url);

describe('copy-backend — source reads from src/, not gui/backend', () => {
  const content = readFileSync(COPY_BACKEND_JS, 'utf-8');

  it('copies from ../src relative to scripts/ dir, not gui/backend', () => {
    // Regression: gui/backend was a stale directory copy, not a symlink.
    // copy-backend must read directly from the canonical source (src/).
    expect(content).toMatch(/path\.join\(__dirname,\s*['"]\.\.['"],\s*['"]\.\.['"],\s*['"]src['"]\)/);
  });

  it('does NOT copy from gui/backend (stale directory)', () => {
    // The old path: path.join(__dirname, '..', 'backend') copied from a stale directory
    // that could diverge from the canonical src/ tree.
    expect(content).not.toMatch(/path\.join\(__dirname,\s*['"]\.\.['"],\s*['"]backend['"]\)/);
  });

  it('uses fs.statSync instead of entry.isDirectory() to follow symlinks', () => {
    // On Windows, Dirent.isDirectory() may not follow symlinks correctly.
    // statSync resolves the symlink target.
    expect(content).toMatch(/fs\.statSync\(srcPath\)/);
  });

  it('does NOT use entry.isDirectory() for the copy decision', () => {
    // entry.isDirectory() returns false for symlinks on Windows
    expect(content).not.toMatch(/entry\.isDirectory\(\)/);
  });
});
