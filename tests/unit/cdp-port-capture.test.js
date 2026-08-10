import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';

const CDP_PORT_REGEX = /DevTools listening on ws:\/\/127\.0\.0\.1:(\d+)/;

describe('CDP port capture from stderr', () => {
  it('extracts port from Chromium stderr output', () => {
    const line = 'DevTools listening on ws://127.0.0.1:9222/devtools/browser/abc-123';
    const match = line.match(CDP_PORT_REGEX);
    expect(match).not.toBeNull();
    expect(parseInt(match[1], 10)).toBe(9222);
  });

  it('handles dynamic port (0)', () => {
    const line = 'DevTools listening on ws://127.0.0.1:54321/devtools/browser/xyz';
    const match = line.match(CDP_PORT_REGEX);
    expect(match).not.toBeNull();
    expect(parseInt(match[1], 10)).toBe(54321);
  });

  it('handles port at end of line', () => {
    const line = 'DevTools listening on ws://127.0.0.1:61234';
    const match = line.match(CDP_PORT_REGEX);
    expect(match).not.toBeNull();
    expect(parseInt(match[1], 10)).toBe(61234);
  });

  it('does not match non-CDP lines', () => {
    const lines = [
      'Starting browser...',
      'Chrome error: something',
      'INFO: Ready',
      '',
    ];
    for (const line of lines) {
      expect(line.match(CDP_PORT_REGEX)).toBeNull();
    }
  });

  it('handles partial stderr chunks (split across multiple writes)', () => {
    const chunk1 = 'some output\nDevTools listen';
    const chunk2 = 'ing on ws://127.0.0.1:8080/devtools/browser/id';

    let stderrOutput = '';
    let capturedPort = null;

    for (const chunk of [chunk1, chunk2]) {
      stderrOutput += chunk;
      const match = stderrOutput.match(CDP_PORT_REGEX);
      if (match) {
        capturedPort = parseInt(match[1], 10);
      }
    }

    expect(capturedPort).toBe(8080);
  });

  it('captures port from chunk even if previous chunk had partial match', () => {
    const chunk1 = 'DevTools listening on ws://127.0.0';
    const chunk2 = '.1:7777/devtools/browser/abc';

    let stderrOutput = '';
    let capturedPort = null;

    for (const chunk of [chunk1, chunk2]) {
      stderrOutput += chunk;
      const match = stderrOutput.match(CDP_PORT_REGEX);
      if (match) {
        capturedPort = parseInt(match[1], 10);
      }
    }

    expect(capturedPort).toBe(7777);
  });

  it('handles marker split across three chunks', () => {
    const chunks = [
      'some startup output\nDevTools list',
      'ening on ws://127.0.0.1:8',
      '080/devtools/browser/xyz',
    ];

    let stderrOutput = '';
    let capturedPort = null;

    for (const chunk of chunks) {
      stderrOutput += chunk;
      const match = stderrOutput.match(CDP_PORT_REGEX);
      if (match) {
        capturedPort = parseInt(match[1], 10);
      }
    }

    expect(capturedPort).toBe(8080);
  });

  it('handles marker split exactly on the port digits boundary', () => {
    const chunks = [
      'DevTools listening on ws://127.0.0.1:55',
      '5',
    ];

    let stderrOutput = '';
    let capturedPort = null;

    for (const chunk of chunks) {
      stderrOutput += chunk;
      const match = stderrOutput.match(CDP_PORT_REGEX);
      if (match) {
        capturedPort = parseInt(match[1], 10);
      }
    }

    expect(capturedPort).toBe(555);
  });

  it('accumulates stderr across chunks even before the marker appears', () => {
    const chunks = [
      'INFO: chrome ready',
      'Starting devtools',
      'DevTools listening on ws://127.0.0.1:9090/devtools/browser/123',
    ];

    let stderrOutput = '';
    let capturedPort = null;

    for (const chunk of chunks) {
      stderrOutput += chunk;
      const match = stderrOutput.match(CDP_PORT_REGEX);
      if (match) {
        capturedPort = parseInt(match[1], 10);
      }
    }

    expect(capturedPort).toBe(9090);
  });
});

describe('CDP port capture — source uses accumulated stderr buffer', () => {
  const content = readFileSync(new URL('../../src/api/browser.js', import.meta.url), 'utf-8');

  it('browser.js matches the CDP marker against the accumulated buffer', () => {
    // Регрессия: раньше match выполнялся по отдельному chunk, и маркер терялся
    // при разбиении строки между data-чантами.
    expect(content).toMatch(/currentChild\._mmStderrOutput\s*=\s*\(currentChild\._mmStderrOutput\s*\|\|\s*''\)\s*\+\s*chunk/);
    expect(content).toMatch(/currentChild\._mmStderrOutput\.match\(\/DevTools listening on ws:/);
  });

  it('browser.js does not match the marker against a single raw chunk', () => {
    expect(content).not.toMatch(/const\s+match\s*=\s*chunk\.match\(\/DevTools listening on ws/);
  });

  it('captured port is stored per profile before the running transition', () => {
    const cdpSetIdx = content.indexOf('cdpPorts.set(profileId, parseInt(match[1], 10))');
    const runningBroadcastIdx = content.indexOf("broadcastStatus(req.params.id, 'running', child.pid)");
    expect(cdpSetIdx).toBeGreaterThan(-1);
    expect(runningBroadcastIdx).toBeGreaterThan(cdpSetIdx);
  });
});

describe('CDP port lifecycle', () => {
  it('port is stored per profile and cleared on stop', () => {
    const cdpPorts = new Map();
    cdpPorts.set('profile-1', 9222);
    cdpPorts.set('profile-2', 9223);

    expect(cdpPorts.get('profile-1')).toBe(9222);
    expect(cdpPorts.get('profile-2')).toBe(9223);

    cdpPorts.delete('profile-1');
    expect(cdpPorts.get('profile-1')).toBeUndefined();
    expect(cdpPorts.get('profile-2')).toBe(9223);
  });

  it('clearAll removes all entries', () => {
    const cdpPorts = new Map();
    cdpPorts.set('a', 1);
    cdpPorts.set('b', 2);
    cdpPorts.clear();
    expect(cdpPorts.size).toBe(0);
  });
});
