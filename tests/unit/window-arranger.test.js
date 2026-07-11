import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';

vi.mock('../../src/db/index.js', () => ({
  getDatabase: vi.fn(() => ({})),
  createProfileQueries: vi.fn(() => ({
    getAll: vi.fn(() => []),
  })),
}));

vi.mock('../../src/logger.js', () => ({
  logger: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  },
}));

describe('Window Arranger', () => {
  it('router содержит все роуты', async () => {
    const mod = await import('../../src/api/window-arranger.js');
    expect(mod.default).toBeDefined();
    const paths = mod.default.stack
      .filter(r => r.route)
      .map(r => r.route.path);
    expect(paths).toContain('/windows');
    expect(paths).toContain('/grid');
    expect(paths).toContain('/cascade');
    expect(paths).toContain('/focus/:windowId');
    expect(paths).not.toContain('/windows/grouped');
    expect(paths).not.toContain('/grid/grouped');
    expect(paths).not.toContain('/cascade/grouped');
  });

  describe('Source code checks (no mocking needed)', () => {
    it('использует spawn + -EncodedCommand (Base64 UTF-16LE), не -File/-Command-', () => {
      const content = readFileSync(
        new URL('../../src/api/window-arranger.js', import.meta.url),
        'utf-8'
      );
      expect(content).toContain('toPSEncoded');
      expect(content).toContain("-EncodedCommand");
      expect(content).toContain("Buffer.from(script, 'utf16le').toString('base64')");
      // Should NOT use -File or temp files
      expect(content).not.toContain('-File "');
      expect(content).not.toContain('mm_windows_');
      expect(content).not.toContain('mm_move_');
      expect(content).not.toContain('mm_focus_');
      expect(content).not.toContain('writeFileSync');
      expect(content).not.toContain('unlinkSync');
      // Should NOT use stdin (`-Command -`) — подавляет stdout при Add-Type
      expect(content).not.toContain("'-Command', '-'");
    });

    it('WIN_GET_WINDOWS_PS скрипт содержит pidOnly и enum-функции', () => {
      const content = readFileSync(
        new URL('../../src/api/window-arranger.js', import.meta.url),
        'utf-8'
      );
      expect(content).toContain('pidOnly');
      expect(content).toContain('EnumWindows');
      expect(content).toContain('IsWindowVisible');
      expect(content).toContain('GetWindowRect');
      expect(content).toContain('GetWindowThreadProcessId');
    });

    it('WIN_GET_WINDOWS_PS использует pipe-разделитель для вывода', () => {
      const content = readFileSync(
        new URL('../../src/api/window-arranger.js', import.meta.url),
        'utf-8'
      );
      expect(content).toContain('handle + "|" + pid + "|" + title');
    });

    it('moveWindow содержит MoveWindow DllImport и runPowerShellScript', () => {
      const content = readFileSync(
        new URL('../../src/api/window-arranger.js', import.meta.url),
        'utf-8'
      );
      expect(content).toContain('MoveWindow');
      expect(content).toContain('DllImport("user32.dll")] public static extern bool MoveWindow');
      expect(content).toContain('runPowerShellScript');
    });

    it('focusWindow содержит SetForegroundWindow DllImport и runPowerShellScript', () => {
      const content = readFileSync(
        new URL('../../src/api/window-arranger.js', import.meta.url),
        'utf-8'
      );
      expect(content).toContain('SetForegroundWindow');
      expect(content).toContain('DllImport("user32.dll")] public static extern bool SetForegroundWindow');
      expect(content).toContain('runPowerShellScript');
    });

    it('PID-only скрипт содержит _pidOnly и !_pidOnly флаги, без @(...) обёртки', () => {
      const content = readFileSync(
        new URL('../../src/api/window-arranger.js', import.meta.url),
        'utf-8'
      );
      expect(content).toContain('pidOnly');
      expect(content).toContain('!_pidOnly');
      expect(content).toContain('static bool _pidOnly = false');
      expect(content).toContain("$pidOnly = @@PIDONLY@@");
    });

    it('fallback по заголовку содержит chrome/chromium/MultiManager', () => {
      const content = readFileSync(
        new URL('../../src/api/window-arranger.js', import.meta.url),
        'utf-8'
      );
      expect(content).toContain('chrome');
      expect(content).toContain('chromium');
      expect(content).toContain('MultiManager');
      expect(content).toContain('Cloak');
    });

    it('PID-only логика: _pidOnly = pidOnly и пропуск fallback', () => {
      const content = readFileSync(
        new URL('../../src/api/window-arranger.js', import.meta.url),
        'utf-8'
      );
      expect(content).toContain('} else if (!_pidOnly) {');
      expect(content).toContain('_pidOnly = pidOnly');
    });

    it('getScreenSize использует runPowerShellScript, не execAsync(powershell -Command)', () => {
      const content = readFileSync(
        new URL('../../src/api/window-arranger.js', import.meta.url),
        'utf-8'
      );
      expect(content).toContain('getScreenSize');
      expect(content).toContain('runPowerShellScript(ps)');
      expect(content).not.toContain('powershell -Command');
      expect(content).not.toContain("execAsync('powershell");
    });
  });

  describe('multi-control.js также использует spawn + -EncodedCommand', () => {
    it('содержит toPSEncoded/-EncodedCommand, не содержит -File/-Command-', () => {
      const content = readFileSync(
        new URL('../../src/api/multi-control.js', import.meta.url),
        'utf-8'
      );
      expect(content).toContain('toPSEncoded');
      expect(content).toContain('-EncodedCommand');
      expect(content).not.toContain('-File "');
      expect(content).not.toContain("'-Command', '-'");
      expect(content).not.toContain('writeFileSync');
      expect(content).not.toContain('unlinkSync');
    });
  });
});
