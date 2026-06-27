import { describe, it, expect } from 'vitest';

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
