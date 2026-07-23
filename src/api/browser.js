const express = require('express');
const { spawn } = require('child_process');
const kill = require('tree-kill');
const fs = require('fs');
const path = require('path');
const { getDatabase, createProfileQueries, createProxyQueries, createLogQueries } = require('../db');
const { checkProxy, rotateProxy, getTimezoneByIp } = require('../proxy');
const { injectCookies, getProfileDir } = require('../cookie/inject');
const { logger, createProfileLogger } = require('../logger');
const { broadcastStatus } = require('../core/websocket');
const { getExtensionsDir } = require('./extensions');
const { humanType } = require('../typing');
const { hasMasterKey, getMasterKey } = require('../crypto');
const { validate, browserTypeSchema } = require('./validate');
const { notFound, conflict, preconditionFailed, badRequest, badGateway, serverError, asyncHandler } = require('./errors');
const cdp = require('../cdp/client');

function toPSEncoded(script) {
  return Buffer.from(script, 'utf16le').toString('base64');
}

function runPowerShellScript(script) {
  return new Promise((resolve, reject) => {
    const child = spawn('powershell', [
      '-NoProfile', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', toPSEncoded(script),
    ], { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', d => { stdout += d; });
    child.stderr.on('data', d => { stderr += d; });
    child.on('error', reject);
    child.on('close', code => {
      if (code === 0) resolve({ stdout, stderr });
      else reject(new Error(`PowerShell exited with code ${code}: ${stderr || 'unknown error'}`));
    });
  });
}

const router = express.Router();

async function findWindowByPid(targetPid) {
  if (process.platform !== 'win32') return null;

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
    const { stdout } = await runPowerShellScript(ps);
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
  if (!pid || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    // EPERM — процесс существует, но нет прав (считаем живым)
    // ESRCH — процесс не найден (мёртв)
    // EINVAL — невалидный сигнал, на Windows = процесс не найден
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

async function getBrowserPath() {
  const platform = process.platform;
  const home = process.env.USERPROFILE || process.env.HOME || '';

  if (!home) {
    logger.warn('getBrowserPath: HOME/USERPROFILE not set');
    return null;
  }

  if (platform === 'win32' || platform === 'darwin' || platform === 'linux') {
    const cacheDir = path.join(home, '.cloakbrowser');
    try {
      const versions = (await fs.promises.readdir(cacheDir))
        .filter(d => d.startsWith('chromium-'))
        .sort()
        .reverse();
      for (const ver of versions) {
        const bin = platform === 'win32'
          ? path.join(cacheDir, ver, 'chrome.exe')
          : path.join(cacheDir, ver, 'chrome');
        try {
          await fs.promises.access(bin);
          return bin;
        } catch {}
      }
    } catch {}
  }

  return null;
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
    ws = await cdp.connect(port);

    const { targetId } = await cdp.call(ws, 'Target.createTarget', { url: 'about:blank' });
    const { sessionId } = await cdp.call(ws, 'Target.attachToTarget', { targetId, flatten: true });

    const sc = (method, params) => cdp.call(ws, method, params, { sessionId });

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

router.post('/:id/start', asyncHandler(async (req, res) => {
  const db = getDatabase();
  const profileQueries = createProfileQueries(db);
  const proxyQueries = createProxyQueries(db);
  const logQueries = createLogQueries(db);
  
  const profile = profileQueries.getById(req.params.id);
  if (!profile) {
    throw notFound('Профиль');
  }

  if (profile.status === 'running') {
    throw conflict('Профиль уже запущен');
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
          throw badGateway('Ошибка ротации прокси', err.message);
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
        throw preconditionFailed('Прокси недоступен');
      }

      proxyQueries.updateLastIp(profile.proxy_id, checkResult.ip);
      if (checkResult.detectedType && checkResult.detectedType !== proxy.type) {
        db.prepare('UPDATE proxies SET type = ? WHERE id = ?').run(checkResult.detectedType, profile.proxy_id);
      }
      logQueries.add(req.params.id, 'info', `Прокси проверен, IP: ${checkResult.ip}`);
    }
  }

  // GeoIP timezone: detect timezone from proxy IP, fallback to profile timezone
  let timezone = profile.timezone || 'Asia/Bishkek';
  if (profile.proxy_id) {
    const proxyForGeoip = proxyQueries.getById(profile.proxy_id);
    if (proxyForGeoip && proxyForGeoip.last_ip) {
      try {
        const geoResult = await getTimezoneByIp(proxyForGeoip.last_ip);
        if (geoResult.ok && geoResult.timezone) {
          timezone = geoResult.timezone;
          profileLogger.info({ profileId: req.params.id, timezone, ip: proxyForGeoip.last_ip }, 'Timezone определён по GeoIP');
          logQueries.add(req.params.id, 'info', `GeoIP timezone: ${timezone}`);
        }
      } catch (err) {
        profileLogger.warn({ profileId: req.params.id, error: err.message }, 'GeoIP timezone detection failed, using profile timezone');
      }
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
    '--lang=en-US',
    '--no-first-run',
    '--no-default-browser-check',
    `--fingerprint-timezone=${timezone}`,
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
    const checks = await Promise.all(extIds.map(async (id) => {
      const extPath = path.join(extDir, id);
      try {
        await fs.promises.access(extPath);
        await fs.promises.access(path.join(extPath, '.enabled'));
        return extPath;
      } catch {
        return null;
      }
    }));
    enabledExtPaths = checks.filter(Boolean);
    if (enabledExtPaths.length > 0) {
      args.push(`--load-extension=${enabledExtPaths.join(',')}`);
      logQueries.add(req.params.id, 'info', `Загружено расширений: ${enabledExtPaths.length}`);
    }
  }

  const browserPath = await getBrowserPath();

  if (!browserPath || !fs.existsSync(browserPath)) {
    profileLogger.error({ profileId: req.params.id, browserPath }, 'CloakBrowser не найден');
    profileQueries.updateStatus(req.params.id, 'stopped');
    broadcastStatus(req.params.id, 'stopped');
    logQueries.add(req.params.id, 'error', 'CloakBrowser не установлен');
    return res.status(500).json({ error: 'CloakBrowser не установлен. Запустите приложение для загрузки.', code: 'BROWSER_NOT_INSTALLED' });
  }

  const SPAWN_RETRIES = 3;
  const SPAWN_RETRY_DELAY_MS = 2000;
  let child = null;
  let lastSpawnError = null;

  for (let attempt = 1; attempt <= SPAWN_RETRIES; attempt++) {
    try {
      child = spawn(browserPath, args, {
        detached: true,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      break;
    } catch (err) {
      lastSpawnError = err;
      const isAddressInUse = err.message && err.message.includes('ERR_ADDRESS_IN_USE');
      if (isAddressInUse && attempt < SPAWN_RETRIES) {
        profileLogger.warn({ profileId: req.params.id, attempt, error: err.message }, 'ERR_ADDRESS_IN_USE, retrying...');
        logQueries.add(req.params.id, 'warn', `ERR_ADDRESS_IN_USE, попытка ${attempt}/${SPAWN_RETRIES}`);
        await new Promise(r => setTimeout(r, SPAWN_RETRY_DELAY_MS));
        continue;
      }
      throw err;
    }
  }

  if (!child) {
    profileQueries.updateStatus(req.params.id, 'stopped');
    broadcastStatus(req.params.id, 'stopped');
    logQueries.add(req.params.id, 'error', `Ошибка запуска после ${SPAWN_RETRIES} попыток: ${lastSpawnError?.message}`);
    profileLogger.error({ profileId: req.params.id, error: lastSpawnError?.message }, `Ошибка запуска после ${SPAWN_RETRIES} попыток`);
    return res.status(500).json({ error: 'Ошибка запуска браузера', code: 'SPAWN_FAILED' });
  }

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

  let cdpPort = null;
  try {
    cdpPort = await waitForCdpPort(req.params.id);
  } catch (err) {
    logQueries.add(req.params.id, 'warn', `CDP port not detected: ${err.message}`);
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
    cdp_port: cdpPort,
    ws_endpoint: cdpPort ? `http://127.0.0.1:${cdpPort}` : null,
  });
}));

router.post('/:id/stop', asyncHandler(async (req, res) => {
  const db = getDatabase();
  const profileQueries = createProfileQueries(db);
  const logQueries = createLogQueries(db);
  
  const profile = profileQueries.getById(req.params.id);
  if (!profile) {
    throw notFound('Профиль');
  }

  if (profile.status === 'stopped') {
    throw conflict('Профиль уже остановлен');
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
}));

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

router.post('/:id/clean', asyncHandler(async (req, res) => {
  const db = getDatabase();
  const profileQueries = createProfileQueries(db);

  const profile = profileQueries.getById(req.params.id);
  if (!profile) {
    throw notFound('Профиль');
  }

  if (profile.status !== 'stopped') {
    throw conflict('Невозможно очистить кэш запущенного профиля');
  }

  const profileDir = getProfileDir(req.params.id);
  const cacheDirs = ['BrowserData/Cache', 'BrowserData/Code Cache', 'BrowserData/GPUCache'];

  for (const dir of cacheDirs) {
    const cachePath = path.join(profileDir, dir);
    try {
      await fs.promises.rm(cachePath, { recursive: true, force: true });
    } catch {}
  }

  res.json({ status: 'cleaned' });
}));

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

async function createCdpSession(port) {
  const ws = await cdp.connect(port);

  const { targetInfos } = await cdp.call(ws, 'Target.getTargets');
  let targetId = null;
  if (targetInfos) {
    const page = targetInfos.find(t => t.type === 'page');
    if (page) targetId = page.targetId;
  }
  if (!targetId) {
    const result = await cdp.call(ws, 'Target.createTarget', { url: 'about:blank' });
    targetId = result.targetId;
  }

  const { sessionId } = await cdp.call(ws, 'Target.attachToTarget', { targetId, flatten: true });

  return {
    send(method, params) {
      return cdp.call(ws, method, params, { sessionId });
    },
    close() { ws.close(); },
  };
}

async function waitForSelector(ws, sessionId, selector, timeout = 15000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    const result = await cdp.call(ws, 'Runtime.callFunctionOn', {
      functionDeclaration: `function(sel) { return document.querySelector(sel) !== null; }`,
      arguments: [{ type: 'string', value: selector }],
      returnByValue: true,
    }, { sessionId });
    if (result && result.result && result.result.value) return;
    await new Promise(r => setTimeout(r, 200));
  }
  throw new Error(`Timeout waiting for selector: ${selector}`);
}

async function waitForSelectorHidden(ws, sessionId, selector, timeout = 10000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    const result = await cdp.call(ws, 'Runtime.callFunctionOn', {
      functionDeclaration: `function(sel) { const el = document.querySelector(sel); return el === null || el.offsetParent === null || el.style.display === 'none'; }`,
      arguments: [{ type: 'string', value: selector }],
      returnByValue: true,
    }, { sessionId });
    if (result && result.result && result.result.value) return;
    await new Promise(r => setTimeout(r, 200));
  }
  throw new Error(`Timeout waiting for selector to hide: ${selector}`);
}

const ZERION_EXTENSION_ID = 'klghhnkeealcohjjanjjdaeeggmfmlpl';

async function zerionLogin(port, password) {
  const LOGIN_URL = `chrome-extension://${ZERION_EXTENSION_ID}/popup.8e8f209b.html?windowType=dialog#/login`;

  const ws = await cdp.connect(port);
  try {
    const { targetInfos } = await cdp.call(ws, 'Target.getTargets');
    let targetId = null;
    if (targetInfos) {
      const existing = targetInfos.find(t => t.url && t.url.includes(ZERION_EXTENSION_ID));
      if (existing) targetId = existing.targetId;
    }

    if (!targetId) {
      const result = await cdp.call(ws, 'Target.createTarget', { url: LOGIN_URL });
      targetId = result.targetId;
    }

    const { sessionId } = await cdp.call(ws, 'Target.attachToTarget', { targetId, flatten: true });

    await waitForSelector(ws, sessionId, "input[type='password']", 15000);

    await cdp.call(ws, 'Runtime.callFunctionOn', {
      functionDeclaration: `function(pw) { document.querySelector("input[type='password']").value = pw; }`,
      arguments: [{ type: 'string', value: password }],
      returnByValue: true,
    }, { sessionId });

    await cdp.call(ws, 'Input.dispatchKeyEvent', {
      type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13,
    }, { sessionId });
    await cdp.call(ws, 'Input.dispatchKeyEvent', {
      type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13,
    }, { sessionId });

    await waitForSelectorHidden(ws, sessionId, "input[type='password']", 10000);
  } finally {
    ws.close();
  }
}

router.post('/:id/type', validate(browserTypeSchema), asyncHandler(async (req, res) => {
  const db = getDatabase();
  const profileQueries = createProfileQueries(db);
  const logQueries = createLogQueries(db);

  const { text } = req.body;

  const profile = profileQueries.getById(req.params.id);
  if (!profile) {
    throw notFound('Профиль');
  }

  if (profile.status !== 'running') {
    throw conflict('Профиль не запущен');
  }

  const cdpPort = cdpPorts.get(req.params.id);
  if (!cdpPort) {
    throw badGateway('CDP порт не найден');
  }

  let session;
  try {
    session = await createCdpSession(cdpPort);
  } catch (err) {
    logQueries.add(req.params.id, 'error', `Ошибка CDP подключения: ${err.message}`);
    throw badGateway('Ошибка подключения к CDP', err.message);
  }

  try {
    await humanType(session, text);
    logQueries.add(req.params.id, 'info', `Введен текст: ${text.length} символов`);
    res.json({ status: 'success' });
  } catch (err) {
    logQueries.add(req.params.id, 'error', `Ошибка ввода текста: ${err.message}`);
    throw serverError('Ошибка ввода текста', err.message);
  } finally {
    session.close();
  }
}));

router.post('/:id/zerion-login', asyncHandler(async (req, res) => {
  const db = getDatabase();
  const profileQueries = createProfileQueries(db);
  const logQueries = createLogQueries(db);

  const profile = profileQueries.getById(req.params.id);
  if (!profile) throw notFound('Профиль');
  if (profile.status !== 'running') throw conflict('Профиль не запущен');

  const cdpPort = cdpPorts.get(req.params.id);
  if (!cdpPort) throw badGateway('CDP порт не найден');

  const walletPassword = profile.wallet_password;
  if (!walletPassword) throw badRequest('Не задан wallet_password в профиле');

  try {
    await zerionLogin(cdpPort, walletPassword);
    logQueries.add(req.params.id, 'info', 'Zerion auto-login успешен');
    res.json({ status: 'success' });
  } catch (err) {
    logQueries.add(req.params.id, 'error', `Zerion login failed: ${err.message}`);
    throw serverError('Zerion login failed', err.message);
  }
}));

router.post('/shutdown', asyncHandler(async (req, res) => {
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
}));

module.exports = router;
module.exports.getCdpPort = getCdpPort;
module.exports.createCdpSession = createCdpSession;
module.exports.getProfileWindows = () => profileWindows;
