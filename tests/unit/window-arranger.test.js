import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import path from 'path';
import fs from 'fs';

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
  let originalWriteSync;
  let originalUnlinkSync;

  beforeEach(() => {
    vi.clearAllMocks();
    originalWriteSync = fs.writeFileSync;
    originalUnlinkSync = fs.unlinkSync;
  });

  afterEach(() => {
    fs.writeFileSync = originalWriteSync;
    fs.unlinkSync = originalUnlinkSync;
  });

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
    expect(paths).toContain('/windows/grouped');
    expect(paths).toContain('/grid/grouped');
    expect(paths).toContain('/cascade/grouped');
  });

  describe('Temp file uniqueness (race condition fix)', () => {
    it('каждый вызов создаёт уникальный temp-файл', async () => {
      const writtenFiles = [];
      fs.writeFileSync = vi.fn((filePath) => {
        writtenFiles.push(filePath);
      });
      fs.unlinkSync = vi.fn();

      const mod = await import('../../src/api/window-arranger.js');
      const expressMod = await import('express');
      const app = expressMod.default();
      app.use(mod.default);

      const http = await import('http');
      const server = http.createServer(app);
      await new Promise(r => server.listen(0, r));
      const port = server.address().port;

      try {
        await Promise.all([
          fetch(`http://127.0.0.1:${port}/windows`),
          fetch(`http://127.0.0.1:${port}/windows`),
        ]);

        expect(writtenFiles.length).toBeGreaterThanOrEqual(2);
        const uniqueFiles = new Set(writtenFiles.map(f => path.basename(f)));
        expect(uniqueFiles.size).toBeGreaterThanOrEqual(2);
      } finally {
        server.close();
      }
    });

    it('temp-файл удаляется после выполнения', async () => {
      fs.writeFileSync = vi.fn();
      fs.unlinkSync = vi.fn();

      const mod = await import('../../src/api/window-arranger.js');
      const expressMod = await import('express');
      const app = expressMod.default();
      app.use(mod.default);

      const http = await import('http');
      const server = http.createServer(app);
      await new Promise(r => server.listen(0, r));
      const port = server.address().port;

      try {
        await fetch(`http://127.0.0.1:${port}/windows`);

        expect(fs.writeFileSync).toHaveBeenCalled();
        expect(fs.unlinkSync).toHaveBeenCalled();
      } finally {
        server.close();
      }
    });

    it('temp-файл удаляется даже при ошибке PowerShell', async () => {
      fs.writeFileSync = vi.fn();
      fs.unlinkSync = vi.fn();

      const mod = await import('../../src/api/window-arranger.js');
      const expressMod = await import('express');
      const app = expressMod.default();
      app.use(mod.default);

      const http = await import('http');
      const server = http.createServer(app);
      await new Promise(r => server.listen(0, r));
      const port = server.address().port;

      try {
        const res = await fetch(`http://127.0.0.1:${port}/windows`);
        expect(res.ok).toBe(true);

        expect(fs.writeFileSync).toHaveBeenCalled();
        expect(fs.unlinkSync).toHaveBeenCalled();
      } finally {
        server.close();
      }
    });
  });

  describe('PowerShell script content', () => {
    it('скрипт содержит pidOnly параметр', async () => {
      let writtenContent = '';
      fs.writeFileSync = vi.fn((_, content) => { writtenContent = content; });
      fs.unlinkSync = vi.fn();

      const mod = await import('../../src/api/window-arranger.js');
      const expressMod = await import('express');
      const app = expressMod.default();
      app.use(mod.default);

      const http = await import('http');
      const server = http.createServer(app);
      await new Promise(r => server.listen(0, r));
      const port = server.address().port;

      try {
        await fetch(`http://127.0.0.1:${port}/windows`);

        expect(writtenContent).toContain('pidOnly');
        expect(writtenContent).toContain('EnumWindows');
        expect(writtenContent).toContain('IsWindowVisible');
        expect(writtenContent).toContain('GetWindowRect');
        expect(writtenContent).toContain('GetWindowThreadProcessId');
      } finally {
        server.close();
      }
    });

    it('скрипт использует pipe-разделитель для вывода', async () => {
      let writtenContent = '';
      fs.writeFileSync = vi.fn((_, content) => { writtenContent = content; });
      fs.unlinkSync = vi.fn();

      const mod = await import('../../src/api/window-arranger.js');
      const expressMod = await import('express');
      const app = expressMod.default();
      app.use(mod.default);

      const http = await import('http');
      const server = http.createServer(app);
      await new Promise(r => server.listen(0, r));
      const port = server.address().port;

      try {
        await fetch(`http://127.0.0.1:${port}/windows`);

        expect(writtenContent).toContain('handle + "|" + pid + "|" + title');
      } finally {
        server.close();
      }
    });

    it('moveWindow содержит MoveWindow DllImport', async () => {
      const { readFileSync } = await import('fs');
      const content = readFileSync(
        new URL('../../src/api/window-arranger.js', import.meta.url),
        'utf-8'
      );
      expect(content).toContain('MoveWindow');
      expect(content).toContain('DllImport("user32.dll")] public static extern bool MoveWindow');
      expect(content).toContain('mm_move_');
    });

    it('focusWindow содержит SetForegroundWindow DllImport', async () => {
      const { readFileSync } = await import('fs');
      const content = readFileSync(
        new URL('../../src/api/window-arranger.js', import.meta.url),
        'utf-8'
      );
      expect(content).toContain('SetForegroundWindow');
      expect(content).toContain('DllImport("user32.dll")] public static extern bool SetForegroundWindow');
      expect(content).toContain('mm_focus_');
    });
  });

  describe('PID-only filtering logic', () => {
    it('PID-only скрипт содержит _pidOnly и !_pidOnly флаги', async () => {
      let writtenContent = '';
      fs.writeFileSync = vi.fn((_, content) => { writtenContent = content; });
      fs.unlinkSync = vi.fn();

      const mod = await import('../../src/api/window-arranger.js');
      const expressMod = await import('express');
      const app = expressMod.default();
      app.use(mod.default);

      const http = await import('http');
      const server = http.createServer(app);
      await new Promise(r => server.listen(0, r));
      const port = server.address().port;

      try {
        await fetch(`http://127.0.0.1:${port}/windows`);

        expect(writtenContent).toContain('pidOnly');
        expect(writtenContent).toContain('!_pidOnly');
        expect(writtenContent).toContain('static bool _pidOnly = false');
      } finally {
        server.close();
      }
    });

    it('fallback по заголовку содержит chrome/chromium/MultiManager', async () => {
      let writtenContent = '';
      fs.writeFileSync = vi.fn((_, content) => { writtenContent = content; });
      fs.unlinkSync = vi.fn();

      const mod = await import('../../src/api/window-arranger.js');
      const expressMod = await import('express');
      const app = expressMod.default();
      app.use(mod.default);

      const http = await import('http');
      const server = http.createServer(app);
      await new Promise(r => server.listen(0, r));
      const port = server.address().port;

      try {
        await fetch(`http://127.0.0.1:${port}/windows`);

        expect(writtenContent).toContain('chrome');
        expect(writtenContent).toContain('chromium');
        expect(writtenContent).toContain('MultiManager');
        expect(writtenContent).toContain('Cloak');
      } finally {
        server.close();
      }
    });

    it('PID-only логика: when _pidOnly true, fallback по заголовку пропускается', async () => {
      let writtenContent = '';
      fs.writeFileSync = vi.fn((_, content) => { writtenContent = content; });
      fs.unlinkSync = vi.fn();

      const mod = await import('../../src/api/window-arranger.js');
      const expressMod = await import('express');
      const app = expressMod.default();
      app.use(mod.default);

      const http = await import('http');
      const server = http.createServer(app);
      await new Promise(r => server.listen(0, r));
      const port = server.address().port;

      try {
        await fetch(`http://127.0.0.1:${port}/windows`);

        expect(writtenContent).toContain('} else if (!_pidOnly) {');
        expect(writtenContent).toContain('_pidOnly = pidOnly');
      } finally {
        server.close();
      }
    });
  });
});
