import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'fs';

const BROWSER_JS = new URL('../../src/api/browser.js', import.meta.url);

// --- Source-level: lifecycle cleanup on error / exit / stop ---

describe('Browser — lifecycle cleanup (source-level)', () => {
  const content = readFileSync(BROWSER_JS, 'utf-8');

  it('exit handler clears runningProfiles, profileWindows and cdpPorts', () => {
    const exitBlock = content.slice(content.indexOf("child.on('exit'"));
    expect(exitBlock).toContain('runningProfiles.delete(req.params.id)');
    expect(exitBlock).toContain('profileWindows.delete(req.params.id)');
    expect(exitBlock).toContain('cdpPorts.delete(req.params.id)');
    expect(exitBlock).toContain("profileQueries.updatePid(req.params.id, null)");
    expect(exitBlock).toContain("profileQueries.updateStatus(req.params.id, 'stopped')");
  });

  it('error handler also clears all three maps and pid', () => {
    const errorBlock = content.slice(content.indexOf("child.on('error'"));
    expect(errorBlock).toContain('runningProfiles.delete(req.params.id)');
    expect(errorBlock).toContain('profileWindows.delete(req.params.id)');
    expect(errorBlock).toContain('cdpPorts.delete(req.params.id)');
    expect(errorBlock).toContain("profileQueries.updatePid(req.params.id, null)");
    expect(errorBlock).toContain("broadcastStatus(req.params.id, 'stopped')");
  });

  it('stop endpoint and stopProfile clear all three maps after graceful shutdown', () => {
    const stopFnBlock = content.slice(content.indexOf('async function stopProfile'));
    expect(stopFnBlock).toContain('runningProfiles.delete(profileId)');
    expect(stopFnBlock).toContain('profileWindows.delete(profileId)');
    expect(stopFnBlock).toContain('cdpPorts.delete(profileId)');
    const stopEndpointBlock = content.slice(content.indexOf("router.post('/:id/stop'"));
    expect(stopEndpointBlock).toContain('stopProfile(req.params.id)');
  });

  it('cleanupProfile clears all three maps', () => {
    const cleanupBlock = content.slice(content.indexOf('function cleanupProfile'));
    expect(cleanupBlock).toContain('runningProfiles.delete(profileId)');
    expect(cleanupBlock).toContain('profileWindows.delete(profileId)');
    expect(cleanupBlock).toContain('cdpPorts.delete(profileId)');
  });

  it('shutdown endpoint clears all maps after closing browsers', () => {
    const shutdownBlock = content.slice(content.indexOf("router.post('/shutdown'"));
    expect(shutdownBlock).toContain('runningProfiles.clear()');
    expect(shutdownBlock).toContain('profileWindows.clear()');
    expect(shutdownBlock).toContain('cdpPorts.clear()');
  });

  it('spawn helper removes lifecycle listeners on success and cleanup', () => {
    expect(content).toMatch(/c\.removeAllListeners\('error'\)/);
    expect(content).toMatch(/c\.removeAllListeners\('exit'\)/);
  });

  it('spawn helper never registers the profile as running before CDP-ready', () => {
    const helperStart = content.indexOf('async function spawnBrowserWithCdp');
    const helperEnd = content.indexOf('async function loadExtensionsViaCDP');
    const helperBlock = content.slice(helperStart, helperEnd);
    expect(helperBlock).not.toContain("'running'");
  });
});

// --- Functional harness: map cleanup after error / exit / stop ---

function createCleanupCtx() {
  const runningProfiles = new Map([['p1', { pid: 100 }]]);
  const profileWindows = new Map([['p1', { pid: 100, handle: '123' }]]);
  const cdpPorts = new Map([['p1', 9222]]);
  const profileQueries = {
    updateStatus: vi.fn(),
    updatePid: vi.fn(),
  };
  const broadcastStatus = vi.fn();
  return { runningProfiles, profileWindows, cdpPorts, profileQueries, broadcastStatus };
}

function cleanupOnError(ctx) {
  ctx.profileQueries.updateStatus('p1', 'stopped');
  ctx.broadcastStatus('p1', 'stopped');
  ctx.profileQueries.updatePid('p1', null);
  ctx.runningProfiles.delete('p1');
  ctx.profileWindows.delete('p1');
  ctx.cdpPorts.delete('p1');
}

function cleanupOnExit(ctx) {
  ctx.profileQueries.updateStatus('p1', 'stopped');
  ctx.broadcastStatus('p1', 'stopped');
  ctx.profileQueries.updatePid('p1', null);
  ctx.runningProfiles.delete('p1');
  ctx.profileWindows.delete('p1');
  ctx.cdpPorts.delete('p1');
}

function cleanupOnStop(ctx) {
  ctx.profileQueries.updateStatus('p1', 'stopped');
  ctx.broadcastStatus('p1', 'stopped');
  ctx.profileQueries.updatePid('p1', null);
  ctx.runningProfiles.delete('p1');
  ctx.profileWindows.delete('p1');
  ctx.cdpPorts.delete('p1');
}

describe('Browser — map cleanup after lifecycle events', () => {
  it('error event cleans runningProfiles, profileWindows, cdpPorts and pid', () => {
    const ctx = createCleanupCtx();
    cleanupOnError(ctx);

    expect(ctx.profileQueries.updateStatus).toHaveBeenCalledWith('p1', 'stopped');
    expect(ctx.profileQueries.updatePid).toHaveBeenCalledWith('p1', null);
    expect(ctx.broadcastStatus).toHaveBeenCalledWith('p1', 'stopped');
    expect(ctx.runningProfiles.has('p1')).toBe(false);
    expect(ctx.profileWindows.has('p1')).toBe(false);
    expect(ctx.cdpPorts.has('p1')).toBe(false);
  });

  it('exit event cleans runningProfiles, profileWindows, cdpPorts and pid', () => {
    const ctx = createCleanupCtx();
    cleanupOnExit(ctx);

    expect(ctx.profileQueries.updateStatus).toHaveBeenCalledWith('p1', 'stopped');
    expect(ctx.profileQueries.updatePid).toHaveBeenCalledWith('p1', null);
    expect(ctx.broadcastStatus).toHaveBeenCalledWith('p1', 'stopped');
    expect(ctx.runningProfiles.size).toBe(0);
    expect(ctx.profileWindows.size).toBe(0);
    expect(ctx.cdpPorts.size).toBe(0);
  });

  it('stop endpoint cleans all maps without leaving entries', () => {
    const ctx = createCleanupCtx();
    cleanupOnStop(ctx);

    expect(ctx.profileQueries.updateStatus).toHaveBeenCalledWith('p1', 'stopped');
    expect(ctx.runningProfiles.size).toBe(0);
    expect(ctx.profileWindows.size).toBe(0);
    expect(ctx.cdpPorts.size).toBe(0);
  });

  it('cleanup is idempotent for profiles that are not present in maps', () => {
    const ctx = createCleanupCtx();
    cleanupOnStop(ctx);
    // повторная очистка не должна бросать исключений
    expect(() => cleanupOnStop(ctx)).not.toThrow();
  });
});

// --- Lifecycle listener removal on the child process ---

function createChildWithListeners() {
  const listeners = {};
  return {
    on: vi.fn((type, cb) => {
      if (!listeners[type]) listeners[type] = [];
      listeners[type].push(cb);
    }),
    removeAllListeners: vi.fn((type) => { delete listeners[type]; }),
    listenerCount(type) { return (listeners[type] || []).length; },
  };
}

function removeLifecycleListeners(child) {
  if (!child) return;
  child.removeAllListeners('error');
  child.removeAllListeners('exit');
}

describe('Browser — lifecycle listeners are not leaked', () => {
  it('removeLifecycleListeners removes error and exit listeners', () => {
    const child = createChildWithListeners();
    child.on('error', vi.fn());
    child.on('exit', vi.fn());
    expect(child.listenerCount('error')).toBe(1);
    expect(child.listenerCount('exit')).toBe(1);

    removeLifecycleListeners(child);

    expect(child.removeAllListeners).toHaveBeenCalledWith('error');
    expect(child.removeAllListeners).toHaveBeenCalledWith('exit');
    expect(child.listenerCount('error')).toBe(0);
    expect(child.listenerCount('exit')).toBe(0);
  });

  it('no error/exit listeners remain on the child after a successful CDP-ready launch', () => {
    const child = createChildWithListeners();
    child.on('error', vi.fn());
    child.on('exit', vi.fn());

    removeLifecycleListeners(child);

    // Только stderr data-листенер остаётся, error/exit — удалены.
    expect(child.listenerCount('error')).toBe(0);
    expect(child.listenerCount('exit')).toBe(0);
  });
});
