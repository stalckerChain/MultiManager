import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { readFileSync } from 'fs';
import fs from 'fs';
import path from 'path';
import os from 'os';
import windowArranger from '../../src/api/window-arranger.js';

describe('Window Arranger', () => {
  it('router содержит все роуты', () => {
    const paths = windowArranger.stack
      .filter(r => r.route)
      .map(r => r.route.path);
    expect(paths).toContain('/windows');
    expect(paths).toContain('/grid');
    expect(paths).toContain('/cascade');
    expect(paths).toContain('/focus/:windowId');
    expect(paths).toContain('/close-all-tabs');
    expect(paths).toContain('/open-links');
    expect(paths).not.toContain('/windows/grouped');
    expect(paths).not.toContain('/grid/grouped');
    expect(paths).not.toContain('/cascade/grouped');
  });

  describe('closeAllTabsFor', () => {
    let tabs;

    beforeEach(() => {
      tabs = {
        withProfileSession: vi.fn(),
        listPageTargets: vi.fn(),
        createTarget: vi.fn(),
        closeTarget: vi.fn(),
      };
      tabs.withProfileSession.mockImplementation((profileId, fn) => fn({}));
      windowArranger.setProfileTabsForTesting(tabs);
    });

    it('закрывает только исходные targets, созданная blank не закрывается', async () => {
      tabs.listPageTargets.mockResolvedValue([
        { targetId: 't1', url: 'https://a', type: 'page' },
        { targetId: 't2', url: 'https://b', type: 'page' },
      ]);
      tabs.createTarget.mockResolvedValue('blank-1');
      tabs.closeTarget.mockResolvedValue(true);

      const result = await windowArranger.closeAllTabsFor([{ id: 'p1', name: 'P1' }]);

      expect(result.total).toBe(1);
      expect(result.success).toBe(1);
      expect(result.failed).toBe(0);
      expect(result.profiles[0]).toMatchObject({
        profileId: 'p1',
        success: true,
        closed: 2,
        kept: 1,
        errors: [],
      });
      expect(tabs.createTarget).toHaveBeenCalledWith(expect.anything(), 'about:blank');
      const closedTargets = tabs.closeTarget.mock.calls.map(c => c[1]);
      expect(closedTargets).toContain('t1');
      expect(closedTargets).toContain('t2');
      expect(closedTargets).not.toContain('blank-1');
    });

    it('при ошибке закрытия одного target остальные закрываются и возвращается ошибка', async () => {
      tabs.listPageTargets.mockResolvedValue([
        { targetId: 't1', url: 'https://a', type: 'page' },
        { targetId: 't2', url: 'https://b', type: 'page' },
      ]);
      tabs.createTarget.mockResolvedValue('blank-1');
      tabs.closeTarget.mockImplementation(async (ws, targetId) => {
        if (targetId === 't2') throw new Error('close failed');
        return true;
      });

      const result = await windowArranger.closeAllTabsFor([{ id: 'p1', name: 'P1' }]);

      expect(result.profiles[0].closed).toBe(1);
      expect(result.profiles[0].errors).toHaveLength(1);
      expect(result.profiles[0].errors[0].targetId).toBe('t2');
    });

    it('ошибка одного профиля не останавливает остальные', async () => {
      tabs.listPageTargets.mockResolvedValue([{ targetId: 't1', url: 'https://a', type: 'page' }]);
      tabs.createTarget.mockResolvedValue('blank-1');
      tabs.closeTarget.mockResolvedValue(true);
      tabs.withProfileSession.mockImplementation(async (profileId, fn) => {
        if (profileId === 'p2') throw new Error('CDP port is unavailable');
        return fn({});
      });

      const result = await windowArranger.closeAllTabsFor([
        { id: 'p1', name: 'P1' },
        { id: 'p2', name: 'P2' },
      ]);

      expect(result.success).toBe(1);
      expect(result.failed).toBe(1);
      const p2 = result.profiles.find(p => p.profileId === 'p2');
      expect(p2.success).toBe(false);
      expect(p2.error).toBe('CDP port is unavailable');
    });

    it('возвращает корректный ответ при отсутствии running-профилей', async () => {
      const result = await windowArranger.closeAllTabsFor([]);
      expect(result).toEqual({ total: 0, success: 0, failed: 0, profiles: [] });
      expect(tabs.withProfileSession).not.toHaveBeenCalled();
    });
  });

  describe('openLinksFor', () => {
    let tabs;

    beforeEach(() => {
      tabs = {
        withProfileSession: vi.fn(),
        listPageTargets: vi.fn(),
        createTarget: vi.fn(),
        closeTarget: vi.fn(),
      };
      tabs.withProfileSession.mockImplementation((profileId, fn) => fn({}));
      windowArranger.setProfileTabsForTesting(tabs);
    });

    it('каждая ссылка создаётся отдельной вкладкой для каждого профиля', async () => {
      let idCounter = 0;
      tabs.createTarget.mockImplementation(async (ws, url) => `t${++idCounter}`);

      const result = await windowArranger.openLinksFor(
        [
          { id: 'p1', name: 'P1' },
          { id: 'p2', name: 'P2' },
        ],
        ['https://a', 'https://b']
      );

      expect(result.total).toBe(2);
      expect(result.created).toBe(4);
      expect(result.failed).toBe(0);
      expect(tabs.createTarget).toHaveBeenCalledTimes(4);
      const urls = tabs.createTarget.mock.calls.map(c => c[1]);
      expect(urls.filter(u => u === 'https://a')).toHaveLength(2);
      expect(urls.filter(u => u === 'https://b')).toHaveLength(2);
    });

    it('пустые строки не создают вкладок (нормализация выше уровня функции)', async () => {
      tabs.createTarget.mockResolvedValue('t1');
      // Нормализация выполняется в роуте: сюда уже приходят непустые ссылки.
      const result = await windowArranger.openLinksFor(
        [{ id: 'p1', name: 'P1' }],
        ['https://a', 'https://b']
      );
      expect(result.total).toBe(2);
      expect(result.created).toBe(2);
      expect(result.failed).toBe(0);
    });

    it('ошибка одного профиля не останавливает остальные', async () => {
      tabs.createTarget.mockResolvedValue('t1');
      tabs.withProfileSession.mockImplementation(async (profileId, fn) => {
        if (profileId === 'p2') throw new Error('CDP port is unavailable');
        return fn({});
      });

      const result = await windowArranger.openLinksFor(
        [
          { id: 'p1', name: 'P1' },
          { id: 'p2', name: 'P2' },
        ],
        ['https://a']
      );

      expect(result.created).toBe(1);
      expect(result.failed).toBe(1);
      const p2 = result.profiles.find(p => p.profileId === 'p2');
      expect(p2.success).toBe(false);
      expect(p2.failed).toBe(1);
      expect(p2.error).toBe('CDP port is unavailable');
    });

    it('ошибка одной ссылки не прерывает остальные ссылки того же профиля', async () => {
      tabs.createTarget.mockImplementation(async (ws, url) => {
        if (url === 'https://bad') throw new Error('invalid url');
        return 't1';
      });

      const result = await windowArranger.openLinksFor(
        [{ id: 'p1', name: 'P1' }],
        ['https://ok', 'https://bad', 'https://ok2']
      );

      expect(result.created).toBe(2);
      expect(result.failed).toBe(1);
      expect(result.profiles[0].success).toBe(false);
      expect(result.profiles[0].errors).toHaveLength(1);
      expect(result.profiles[0].errors[0].error).toBe('invalid url');
    });

    it('URL не попадает в сообщения об ошибках результата', async () => {
      tabs.createTarget.mockRejectedValue(new Error('CDP error'));

      const result = await windowArranger.openLinksFor(
        [{ id: 'p1', name: 'P1' }],
        ['https://secret-host/very/secret/path']
      );

      const body = JSON.stringify(result);
      expect(body).not.toContain('secret-host');
      expect(body).not.toContain('very/secret/path');
    });

    it('возвращает корректный ответ при отсутствии running-профилей', async () => {
      const result = await windowArranger.openLinksFor([], ['https://a']);
      expect(result).toEqual({ total: 1, created: 0, failed: 0, profiles: [] });
      expect(tabs.withProfileSession).not.toHaveBeenCalled();
    });
  });

  describe('getRunningProfiles', () => {
    let tmpDir;
    let originalAppData;

    beforeEach(() => {
      originalAppData = process.env.APPDATA;
      tmpDir = path.join(os.tmpdir(), 'wa-test-' + Date.now() + '-' + Math.random().toString(36).slice(2));
      process.env.APPDATA = tmpDir;
      const db = require('../../src/db/index.js');
      db.initDatabase();
      db.getDatabase().exec('DELETE FROM profiles');
      const insert = db.getDatabase().prepare(
        'INSERT INTO profiles (id, number, name, status, fingerprint_seed, platform, user_agent, screen_resolution, hardware_cores, hardware_memory) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
      );
      insert.run('p1', 1, 'P1', 'running', 's1', 'windows', 'ua', '1920x1080', 4, 8);
      insert.run('p2', 2, 'P2', 'stopped', 's2', 'windows', 'ua', '1920x1080', 4, 8);
      insert.run('p3', 3, 'P3', 'running', 's3', 'windows', 'ua', '1920x1080', 4, 8);
    });

    afterEach(() => {
      const db = require('../../src/db/index.js');
      db.closeDatabase();
      process.env.APPDATA = originalAppData;
      if (tmpDir) {
        try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
      }
    });

    it('выбирает только running-профили', () => {
      const running = windowArranger.getRunningProfiles();
      expect(running).toHaveLength(2);
      expect(running.map(p => p.id).sort()).toEqual(['p1', 'p3']);
      expect(running.every(p => p.name)).toBe(true);
    });
  });

  describe('profile name lookup and window conversion', () => {
    it('buildProfileNameByPid строит lookup по запущенным профилям (name с fallback на id)', () => {
      const running = [
        { id: 'p1', pid: '101', name: 'Profile One', status: 'running' },
        { id: 'p2', pid: '202', name: '', status: 'running' },
        { id: 'p4', pid: null, name: 'No pid', status: 'running' },
      ];
      const lookup = windowArranger.buildProfileNameByPid(running);
      expect(lookup.get('101')).toBe('Profile One');
      expect(lookup.get('202')).toBe('p2');
      expect(lookup.has('null')).toBe(false);
    });

    it('parseWindowLine сохраняет HWND как id, координаты и размеры без изменения назначения', () => {
      const lookup = new Map([['1234', 'My Profile']]);
      const win = windowArranger.parseWindowLine(
        ['98765', '1234', 'Untitled - Chromium', '10', '20', '800', '600'],
        lookup
      );
      expect(win.id).toBe('98765');
      expect(win.windowTitle).toBe('Untitled - Chromium');
      expect(win.name).toBe('My Profile');
      expect(win.x).toBe(10);
      expect(win.y).toBe(20);
      expect(win.width).toBe(800);
      expect(win.height).toBe(600);
    });

    it('name выбирает имя профиля при совпадении PID, windowTitle при отсутствии', () => {
      const lookup = new Map([['1234', 'My Profile']]);
      const matched = windowArranger.parseWindowLine(['1', '1234', 'Untitled - Chromium', '0', '0', '800', '600'], lookup);
      expect(matched.name).toBe('My Profile');
      expect(matched.windowTitle).toBe('Untitled - Chromium');

      const unmatched = windowArranger.parseWindowLine(['2', '9999', 'Untitled - Chromium', '0', '0', '800', '600'], lookup);
      expect(unmatched.name).toBe('Untitled - Chromium');
      expect(unmatched.windowTitle).toBe('Untitled - Chromium');
    });

    it('ответ окна не добавляет pid, profileId и profileName', () => {
      const lookup = new Map([['1234', 'My Profile']]);
      const win = windowArranger.parseWindowLine(['98765', '1234', 'Untitled - Chromium', '0', '0', '800', '600'], lookup);
      expect(win).not.toHaveProperty('pid');
      expect(win).not.toHaveProperty('profileId');
      expect(win).not.toHaveProperty('profileName');
      expect(Object.keys(win).sort()).toEqual(['height', 'id', 'name', 'width', 'windowTitle', 'x', 'y']);
    });
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

    it('getScreenSize на Windows явно загружает System.Windows.Forms', () => {
      const content = readFileSync(
        new URL('../../src/api/window-arranger.js', import.meta.url),
        'utf-8'
      );
      expect(content).toContain("Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.Screen]::PrimaryScreen.WorkingArea");
    });

    it('getScreenSize имеет fallback через Win32 SystemParametersInfo(SPI_GETWORKAREA)', () => {
      const content = readFileSync(
        new URL('../../src/api/window-arranger.js', import.meta.url),
        'utf-8'
      );
      expect(content).toContain('SystemParametersInfo');
      expect(content).toContain('DllImport("user32.dll")');
      expect(content).toContain('0x30'); // SPI_GETWORKAREA
      expect(content).toContain('public static string G()');
    });

    it('новые эндпоинты не логируют ссылки', () => {
      const content = readFileSync(
        new URL('../../src/api/window-arranger.js', import.meta.url),
        'utf-8'
      );
      expect(content).not.toMatch(/logger\.[a-z]+\(\{[^}]*links/i);
    });

    it('getRunningWindows строит lookup только по запущенным профилям (pid + status running)', () => {
      const content = readFileSync(
        new URL('../../src/api/window-arranger.js', import.meta.url),
        'utf-8'
      );
      expect(content).toContain("const running = profiles.filter(p => p.pid && p.status === 'running')");
      expect(content).toContain('buildProfileNameByPid(running)');
      expect(content).toContain('p.name || p.id');
      expect(content).toContain('profileNameByPid.get(parts[1])');
    });

    it('windowTitle равен исходному Win32 title, name — lookup или windowTitle', () => {
      const content = readFileSync(
        new URL('../../src/api/window-arranger.js', import.meta.url),
        'utf-8'
      );
      expect(content).toContain('const windowTitle = parts[2];');
      expect(content).toContain('windowTitle,');
      expect(content).toContain('name: profileName || windowTitle');
    });

    it('JSDoc parseWindowLine фиксирует предусловие parts.length >= 7', () => {
      const content = readFileSync(
        new URL('../../src/api/window-arranger.js', import.meta.url),
        'utf-8'
      );
      expect(content).toContain('@param {string[]} parts');
      expect(content).toContain('Предусловие: parts.length >= 7');
    });

    it('Grid и Cascade продолжают использовать HWND из id (id: parts[0], windows[i].id)', () => {
      const content = readFileSync(
        new URL('../../src/api/window-arranger.js', import.meta.url),
        'utf-8'
      );
      expect(content).toContain('id: parts[0]');
      expect(content).toContain('windows[i].id');
    });

    it('focus использует id окна как HWND', () => {
      const content = readFileSync(
        new URL('../../src/api/window-arranger.js', import.meta.url),
        'utf-8'
      );
      expect(content).toContain('req.params.windowId');
      expect(content).toContain('parseInt(windowId)');
    });

    it('PS-скрипт сохраняет фильтры crash/restore и минимального размера', () => {
      const content = readFileSync(
        new URL('../../src/api/window-arranger.js', import.meta.url),
        'utf-8'
      );
      expect(content).toContain('lowerTitle.Contains("restore")');
      expect(content).toContain('lowerTitle.Contains("crashed")');
      expect(content).toContain('w < 300');
      expect(content).toContain('h < 200');
    });
  });

  describe('profile-tabs.js', () => {
    it('не логирует URL', () => {
      const content = readFileSync(
        new URL('../../src/cdp/profile-tabs.js', import.meta.url),
        'utf-8'
      );
      expect(content).toContain('Target.createTarget');
      expect(content).not.toMatch(/logger\.(info|debug|error|warn)\(\{[^}]*url/i);
    });

    it('использует getCdpPort и примитивы cdp/client', () => {
      const content = readFileSync(
        new URL('../../src/cdp/profile-tabs.js', import.meta.url),
        'utf-8'
      );
      expect(content).toContain("require('../api/browser')");
      expect(content).toContain('getCdpPort');
      expect(content).toContain("require('../cdp/client')");
      expect(content).toContain('discoverWsUrl');
      expect(content).toContain('connect');
      expect(content).toContain('Target.closeTarget');
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
