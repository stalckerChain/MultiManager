const express = require('express');
const { spawn } = require('child_process');
const kill = require('tree-kill');
const fs = require('fs');
const path = require('path');
const WebSocket = require('ws');
const { getDatabase, createProfileQueries, createProxyQueries, createLogQueries } = require('../db');
const { checkProxy, rotateProxy } = require('../proxy');
const { injectCookies, getProfileDir } = require('../cookie/inject');
const { createProfileLogger } = require('../logger');
const { broadcastStatus } = require('../core/websocket');
const { getExtensionsDir } = require('./extensions');

const router = express.Router();

async function findWindowByPid(targetPid) {
  if (process.platform !== 'win32') return null;
  const { exec } = require('child_process');
  const { promisify } = require('util');
  const execAsync = promisify(exec);

  const ps = `
Add-Type @"
using System;
using System.Runtime.InteropServices;
using System.Text;
public class WinFind {
    [DllImport("user32.dll")] public static extern bool EnumWindows(EnumWindowsProc lpEnumFunc, IntPtr lParam);
    [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hWnd);
    [DllImport("user32.dll")] public static extern int GetWindowText(IntPtr hWnd, StringBuilder lpString, int nMaxCount);
    [DllImport("user32.dll")] public static extern int GetWindowTextLength(IntPtr hWnd);
    [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint lpdwProcessId);
    public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);
}
"@

$found = $null
[WinFind]::EnumWindows({
    param($hWnd, $lParam)
    if ([WinFind]::IsWindowVisible($hWnd)) {
        $len = [WinFind]::GetWindowTextLength($hWnd)
        if ($len -gt 0) {
            $pid = 0
            [WinFind]::GetWindowThreadProcessId($hWnd, [ref]$pid) | Out-Null
            if ($pid -eq ${targetPid}) {
                $found = [string]$hWnd.ToInt64()
            }
        }
    }
    return $true
})
if ($found) { $found }
`;

  try {
    const { stdout } = await execAsync(ps);
    const result = stdout.trim();
    return result || null;
  } catch {
    return null;
  }
}

const runningProfiles = new Map();
const profileWindows = new Map();
const cdpPorts = new Map();
const SHUTDOWN_TIMEOUT_MS = 8000;
const HEALTH_CHECK_INTERVAL_MS = 5000;
let healthCheckTimer = null;

function isProcessAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return e.code === 'EPERM';
  }
}

function cleanupProfile(profileId) {
  const db = getDatabase();
  const profileQueries = createProfileQueries(db);
  const logQueries = createLogQueries(db);
  const profileLogger = createProfileLogger(profileId);

  profileQueries.updateStatus(profileId, 'stopped');
  broadcastStatus(profileId, 'stopped');
  profileQueries.updatePid(profileId, null);

  profileLogger.warn({ profileId }, 'Browser process died unexpectedly, cleaned up');
  logQueries.add(profileId, 'warn', 'Browser process died unexpectedly, cleaned up');

  runningProfiles.delete(profileId);
  profileWindows.delete(profileId);
  cdpPorts.delete(profileId);
}

function startHealthCheck() {
  if (healthCheckTimer) return;

  healthCheckTimer = setInterval(() => {
    for (const [profileId, child] of runningProfiles.entries()) {
      if (child && child.pid && !isProcessAlive(child.pid)) {
        cleanupProfile(profileId);
      }
    }

    if (runningProfiles.size === 0) {
      clearInterval(healthCheckTimer);
      healthCheckTimer = null;
    }
  }, HEALTH_CHECK_INTERVAL_MS);

  healthCheckTimer.unref();
}

function tryParseJson(json) {
  try { return JSON.parse(json); } catch { return []; }
}

function getCdpPort(profileId) {
  return cdpPorts.get(profileId) || null;
}

function getBrowserPath() {
  const platform = process.platform;
  const home = process.env.HOME || process.env.USERPROFILE;

  if (platform === 'win32' || platform === 'darwin' || platform === 'linux') {
    const cacheDir = path.join(home, '.cloakbrowser');
    if (fs.existsSync(cacheDir)) {
      const versions = fs.readdirSync(cacheDir)
        .filter(d => d.startsWith('chromium-'))
        .sort()
        .reverse();
      for (const ver of versions) {
        const bin = platform === 'win32'
          ? path.join(cacheDir, ver, 'chrome.exe')
          : path.join(cacheDir, ver, 'chrome');
        if (fs.existsSync(bin)) return bin;
      }
    }
  }

  return null;
}

function cdpCall(ws, id, method, params, sessionId) {
  return new Promise((resolve, reject) => {
    const msg = { id, method, params };
    if (sessionId) msg.sessionId = sessionId;
    const timeout = setTimeout(() => reject(new Error(`CDP timeout: ${method}`)), 15000);
    const handler = (data) => {
      const resp = JSON.parse(data.toString());
      if (resp.id === id) {
        ws.removeListener('message', handler);
        clearTimeout(timeout);
        if (resp.error) reject(new Error(resp.error.message));
        else resolve(resp.result);
      }
    };
    ws.on('message', handler);
    ws.send(JSON.stringify(msg));
  });
}

function waitForCdpPort(profileId, timeout = 15000) {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const check = () => {
      const port = cdpPorts.get(profileId);
      if (port) return resolve(port);
      if (Date.now() - start > timeout) return reject(new Error('CDP port timeout'));
      setTimeout(check, 100);
    };
    check();
  });
}

async function loadExtensionsViaCDP(profileId, extPaths, logQueries, profileLogger) {
  let ws;
  try {
    const port = await waitForCdpPort(profileId);
    ws = new WebSocket(`ws://127.0.0.1:${port}/devtools/browser`);
    await new Promise((resolve, reject) => {
      ws.on('open', resolve);
      ws.on('error', reject);
      setTimeout(() => reject(new Error('WS connect timeout')), 5000);
    });

    let id = 1;
    const { targetId } = await cdpCall(ws, id++, 'Target.createTarget', { url: 'about:blank' });
    const { sessionId } = await cdpCall(ws, id++, 'Target.attachToTarget', { targetId, flatten: true });

    const sc = (method, params) => cdpCall(ws, id++, method, params, sessionId);

    await sc('Page.enable');
    await sc('Page.navigate', { url: 'chrome://extensions' });
    await new Promise(r => setTimeout(r, 1500));

    for (const extPath of extPaths) {
      try {
        const result = await sc('Runtime.evaluate', {
          expression: `(async()=>{try{await chrome.developerPrivate.updateProfileConfiguration({inDeveloperMode:true});await chrome.developerPrivate.loadUnpacked({path:${JSON.stringify(extPath)}});return{ok:true}}catch(e){return{ok:false,error:e.message}}})()`,
          awaitPromise: true,
        });
        if (result?.result?.value?.ok) {
          logQueries.add(profileId, 'info', `Extension loaded via CDP: ${path.basename(extPath)}`);
          profileLogger.info({ profileId, extPath }, 'Extension loaded via CDP');
        } else {
          logQueries.add(profileId, 'warn', `CDP load failed: ${result?.result?.value?.error || 'unknown'}`);
        }
      } catch (err) {
        logQueries.add(profileId, 'warn', `CDP load error: ${err.message}`);
      }
    }
  } catch (err) {
    profileLogger.warn({ profileId, error: err.message }, 'CDP extension loading unavailable');
  } finally {
    if (ws) ws.close();
  }
}

router.post('/:id/start', async (req, res) => {
  const db = getDatabase();
  const profileQueries = createProfileQueries(db);
  const proxyQueries = createProxyQueries(db);
  const logQueries = createLogQueries(db);
  
  const profile = profileQueries.getById(req.params.id);
  if (!profile) {
    return res.status(404).json({ error: 'Профиль не найден' });
  }

  if (profile.status === 'running') {
    return res.status(409).json({ error: 'Профиль уже запущен' });
  }

  profileQueries.updateStatus(req.params.id, 'starting');
  broadcastStatus(req.params.id, 'starting');
  logQueries.add(req.params.id, 'info', 'Запуск профиля...');

  const profileLogger = createProfileLogger(req.params.id);
  profileLogger.info({ profileId: req.params.id }, 'Начало запуска профиля');

  if (profile.proxy_id) {
    const proxy = proxyQueries.getById(profile.proxy_id);
    
    if (proxy) {
      if (proxy.proxy_rotation_url) {
        try {
          await rotateProxy(proxy.proxy_rotation_url);
          await new Promise(resolve => setTimeout(resolve, 3000));
          logQueries.add(req.params.id, 'info', 'Ротация прокси выполнена');
        } catch (err) {
          profileQueries.updateStatus(req.params.id, 'stopped');
          broadcastStatus(req.params.id, 'stopped');
          logQueries.add(req.params.id, 'error', 'Ошибка ротации прокси', { error: err.message });
          return res.status(502).json({ error: 'Ошибка ротации прокси', details: err.message });
        }
      }

      const checkResult = await checkProxy({
        type: proxy.type,
        host: proxy.host,
        port: proxy.port,
        username: proxy.username,
        password: proxy.password,
      });

      if (!checkResult.ok) {
        profileQueries.updateStatus(req.params.id, 'stopped');
        broadcastStatus(req.params.id, 'stopped');
        logQueries.add(req.params.id, 'error', 'Прокси недоступен', { error: checkResult.error });
        return res.status(412).json({ error: 'Прокси недоступен', details: checkResult.error });
      }

      proxyQueries.updateLastIp(profile.proxy_id, checkResult.ip);
      if (checkResult.detectedType && checkResult.detectedType !== proxy.type) {
        db.prepare('UPDATE proxies SET type = ? WHERE id = ?').run(checkResult.detectedType, profile.proxy_id);
      }
      logQueries.add(req.params.id, 'info', `Прокси проверен, IP: ${checkResult.ip}`);
    }
  }

  const profileDir = getProfileDir(req.params.id);
  const user_data_dir = path.join(profileDir, 'BrowserData');

  injectCookies(req.params.id);
  profileLogger.info({ profileId: req.params.id, profileDir: user_data_dir }, 'Куки инжектированы');

  const args = [
    '--remote-debugging-port=0',
    '--fingerprint-seed=' + profile.fingerprint_seed,
    '--user-agent=' + profile.user_agent,
    '--resolution=' + profile.screen_resolution,
    '--cores=' + profile.hardware_cores,
    '--memory=' + profile.hardware_memory,
    `--user-data-dir=${user_data_dir}`,
  ];

  if (profile.proxy_id) {
    const proxy = proxyQueries.getById(profile.proxy_id);
    if (proxy) {
      const proxyUrl = proxy.username
        ? `${proxy.type}://${proxy.username}:${proxy.password}@${proxy.host}:${proxy.port}`
        : `${proxy.type}://${proxy.host}:${proxy.port}`;
      args.push(`--proxy-server=${proxyUrl}`);
      profileLogger.info({ profileId: req.params.id, proxyUrl }, 'Прокси применён');
    }
  }

  const extIds = tryParseJson(profile.extensions);
  let enabledExtPaths = [];
  if (extIds.length > 0) {
    const extDir = getExtensionsDir();
    enabledExtPaths = extIds
      .map(id => path.join(extDir, id))
      .filter(extPath => fs.existsSync(extPath) && fs.existsSync(path.join(extPath, '.enabled')));
    if (enabledExtPaths.length > 0) {
      args.push(`--load-extension=${enabledExtPaths.join(',')}`);
      logQueries.add(req.params.id, 'info', `Загружено расширений: ${enabledExtPaths.length}`);
    }
  }

  const browserPath = getBrowserPath();

  if (!fs.existsSync(browserPath)) {
    profileQueries.updateStatus(req.params.id, 'stopped');
    broadcastStatus(req.params.id, 'stopped');
    logQueries.add(req.params.id, 'error', 'CloakBrowser не установлен');
    return res.status(500).json({ error: 'CloakBrowser не установлен. Запустите приложение для загрузки.' });
  }

  const child = spawn(browserPath, args, {
    detached: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  let stderrOutput = '';
  child.stderr.on('data', (data) => {
    const chunk = data.toString();
    stderrOutput += chunk;
    const match = chunk.match(/DevTools listening on ws:\/\/127\.0\.0\.1:(\d+)/);
    if (match) {
      cdpPorts.set(req.params.id, parseInt(match[1], 10));
    }
  });

  child.unref();

  runningProfiles.set(req.params.id, child);

  startHealthCheck();

  profileQueries.updatePid(req.params.id, child.pid);
  profileQueries.updateStatus(req.params.id, 'running');
  broadcastStatus(req.params.id, 'running', child.pid);
  logQueries.add(req.params.id, 'info', `Браузер запущен, PID: ${child.pid}`);
  profileLogger.info({ profileId: req.params.id, pid: child.pid }, 'Браузер запущен');

  if (process.platform === 'win32') {
    setTimeout(() => {
      findWindowByPid(child.pid).then((windowId) => {
        if (windowId) {
          profileWindows.set(req.params.id, { pid: child.pid, handle: windowId });
          profileLogger.info({ profileId: req.params.id, pid: child.pid, handle: windowId }, 'Окно привязано к профилю');
        }
      }).catch(() => {});
    }, 2000);
  }

  if (enabledExtPaths.length > 0) {
    loadExtensionsViaCDP(req.params.id, enabledExtPaths, logQueries, profileLogger);
  }

  child.on('error', (err) => {
    profileQueries.updateStatus(req.params.id, 'stopped');
    broadcastStatus(req.params.id, 'stopped');
    logQueries.add(req.params.id, 'error', 'Ошибка запуска', { error: err.message });
    profileLogger.error({ profileId: req.params.id, error: err.message }, 'Ошибка запуска');
    runningProfiles.delete(req.params.id);
  });

  child.on('exit', (code, signal) => {
    profileQueries.updateStatus(req.params.id, 'stopped');
    broadcastStatus(req.params.id, 'stopped');
    profileQueries.updatePid(req.params.id, null);

    const exitInfo = code !== null ? `код ${code}` : `сигнал ${signal}`;
    const logMsg = `Браузер завершен (${exitInfo})`;

    if (stderrOutput) {
      profileLogger.error({ profileId: req.params.id, stderr: stderrOutput }, logMsg);
      logQueries.add(req.params.id, 'error', logMsg, { stderr: stderrOutput });
    } else {
      profileLogger.info({ profileId: req.params.id }, logMsg);
      logQueries.add(req.params.id, 'info', logMsg);
    }

    runningProfiles.delete(req.params.id);
    profileWindows.delete(req.params.id);
    cdpPorts.delete(req.params.id);
  });

  res.json({
    status: 'success',
    profile_id: req.params.id,
    pid: child.pid,
    ws_endpoint: `ws://127.0.0.1:3000/devtools/browser/${req.params.id}`,
  });
});

router.post('/:id/stop', async (req, res) => {
  const db = getDatabase();
  const profileQueries = createProfileQueries(db);
  const logQueries = createLogQueries(db);
  
  const profile = profileQueries.getById(req.params.id);
  if (!profile) {
    return res.status(404).json({ error: 'Профиль не найден' });
  }

  if (profile.status === 'stopped') {
    return res.status(409).json({ error: 'Профиль уже остановлен' });
  }

  const child = runningProfiles.get(req.params.id);
  
  if (child && child.pid) {
    logQueries.add(req.params.id, 'info', `Остановка процесса PID: ${child.pid}`);
    
    const profileLogger = createProfileLogger(req.params.id);
    await gracefulCloseBrowser(child, req.params.id, profileLogger, logQueries);
  }

  profileQueries.updateStatus(req.params.id, 'stopped');
  broadcastStatus(req.params.id, 'stopped');
  profileQueries.updatePid(req.params.id, null);
  runningProfiles.delete(req.params.id);
  profileWindows.delete(req.params.id);
  cdpPorts.delete(req.params.id);

  res.json({ status: 'stopped' });
});

router.get('/:id/status', (req, res) => {
  const db = getDatabase();
  const profileQueries = createProfileQueries(db);
  
  const profile = profileQueries.getById(req.params.id);
  if (!profile) {
    return res.status(404).json({ error: 'Профиль не найден' });
  }

  res.json({
    id: profile.id,
    status: profile.status,
    pid: profile.pid,
  });
});

router.post('/:id/clean', (req, res) => {
  const db = getDatabase();
  const profileQueries = createProfileQueries(db);
  
  const profile = profileQueries.getById(req.params.id);
  if (!profile) {
    return res.status(404).json({ error: 'Профиль не найден' });
  }

  if (profile.status !== 'stopped') {
    return res.status(409).json({ error: 'Невозможно очистить кэш запущенного профиля' });
  }

  const profileDir = getProfileDir(req.params.id);
  const cacheDirs = ['BrowserData/Cache', 'BrowserData/Code Cache', 'BrowserData/GPUCache'];
  
  for (const dir of cacheDirs) {
    const cachePath = path.join(profileDir, dir);
    if (fs.existsSync(cachePath)) {
      fs.rmSync(cachePath, { recursive: true, force: true });
    }
  }

  res.json({ status: 'cleaned' });
});

router.get('/profile-windows', (req, res) => {
  const result = [];
  for (const [profileId, info] of profileWindows.entries()) {
    result.push({ profileId, pid: info.pid, handle: info.handle });
  }
  res.json(result);
});

async function gracefulCloseBrowser(child, profileId, profileLogger, logQueries) {
  return new Promise((resolve) => {
    let resolved = false;
    const done = () => {
      if (!resolved) {
        resolved = true;
        resolve();
      }
    };

    const timer = setTimeout(() => {
      logQueries.add(profileId, 'warn', 'Graceful shutdown timeout, force killing');
      kill(child.pid, 'SIGKILL', (err) => {
        if (err) logQueries.add(profileId, 'warn', `Force kill failed: ${err.message}`);
        done();
      });
    }, SHUTDOWN_TIMEOUT_MS);

    child.on('exit', () => {
      clearTimeout(timer);
      done();
    });

    kill(child.pid, 'SIGTERM', (err) => {
      if (err) {
        clearTimeout(timer);
        logQueries.add(profileId, 'warn', `SIGTERM failed (process may be dead): ${err.message}`);
        kill(child.pid, 'SIGKILL', (err2) => {
          if (err2) logQueries.add(profileId, 'warn', `SIGKILL failed (process may be dead): ${err2.message}`);
          done();
        });
      }
    });
  });
}

router.post('/shutdown', async (req, res) => {
  const db = getDatabase();
  const profileQueries = createProfileQueries(db);
  const logQueries = createLogQueries(db);

  const running = Array.from(runningProfiles.entries());
  if (running.length === 0) {
    return res.json({ stopped: 0 });
  }

  logQueries.add(null, 'info', `Shutdown: closing ${running.length} browsers`);

  const closePromises = running.map(([profileId, child]) => {
    const profileLogger = createProfileLogger(profileId);
    return gracefulCloseBrowser(child, profileId, profileLogger, logQueries).then(() => {
      profileQueries.updateStatus(profileId, 'stopped');
      profileQueries.updatePid(profileId, null);
      profileLogger.info({ profileId }, 'Browser closed on shutdown');
      logQueries.add(profileId, 'info', 'Browser closed on shutdown');
    }).catch(() => {
      profileQueries.updateStatus(profileId, 'stopped');
      profileQueries.updatePid(profileId, null);
    });
  });

  await Promise.allSettled(closePromises);
  runningProfiles.clear();
  profileWindows.clear();
  cdpPorts.clear();

  res.json({ stopped: running.length });
});

module.exports = router;
module.exports.getCdpPort = getCdpPort;
module.exports.getProfileWindows = () => profileWindows;
