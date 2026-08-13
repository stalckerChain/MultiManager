const express = require('express');
const { spawn } = require('child_process');
const kill = require('tree-kill');
const fs = require('fs');
const path = require('path');
const { getDatabase, createProfileQueries, createProxyQueries, createLogQueries } = require('../db');
const { checkProxy, rotateProxy, getTimezoneByIp } = require('../proxy');
const { injectCookies } = require('../cookie/inject');
const { getBrowserDataDir, getExtensionsFromProfileDir } = require('../core/profile-path');
const { logger, createProfileLogger, appendRunStage, resolveRunLogPath } = require('../logger');
const { broadcastStatus } = require('../core/websocket');
const { getExtensionsDir, getManifest, resolveMSG, resolveRuntimeId } = require('./extensions');
const { humanType } = require('../typing');
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
const CDP_READY_TIMEOUT_MS = 15000;
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
        } catch { /* binary not found at this path */ }
      }
    } catch { /* browser detection failed */ }
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

// Жизненный цикл запуска: spawn → процесс жив → CDP ready → (resolve).
// Retry на ERR_ADDRESS_IN_USE обрабатывает как синхронный throw от spawn(),
// так и асинхронный child.on('error'). Профиль не считается запущенным до
// обнаружения CDP-порта в накопленном stderr-буфере.
async function spawnBrowserWithCdp({
  browserPath,
  args,
  profileId,
  profileLogger,
  logQueries,
  maxRetries,
  retryDelayMs,
  cdpReadyTimeoutMs,
}) {
  let attempt = 0;
  let child = null;
  let cdpTimeoutTimer = null;
  let settled = false;

  const removeLifecycleListeners = (c) => {
    if (!c) return;
    c.removeAllListeners('error');
    c.removeAllListeners('exit');
  };

  const cleanupFailedChild = () => {
    if (cdpTimeoutTimer) {
      clearTimeout(cdpTimeoutTimer);
      cdpTimeoutTimer = null;
    }
    const failedChild = child;
    child = null;
    removeLifecycleListeners(failedChild);
    if (failedChild && failedChild.pid) {
      try {
        kill(failedChild.pid, 'SIGKILL', () => {});
      } catch {
        // процесс уже завершился
      }
    }
    runningProfiles.delete(profileId);
  };

  const logRetry = () => {
    profileLogger.warn({ profileId, attempt, maxRetries }, 'ERR_ADDRESS_IN_USE, retrying...');
    logQueries.add(profileId, 'warn', `ERR_ADDRESS_IN_USE, попытка ${attempt}/${maxRetries}`);
  };

  return new Promise((resolve, reject) => {
    const fail = (err) => {
      if (settled) return;
      settled = true;
      cleanupFailedChild();
      reject(err);
    };

    const succeed = () => {
      if (settled) return;
      settled = true;
      if (cdpTimeoutTimer) {
        clearTimeout(cdpTimeoutTimer);
        cdpTimeoutTimer = null;
      }
      removeLifecycleListeners(child);
      resolve({ child, cdpPort: cdpPorts.get(profileId) });
    };

    const onChildError = (err) => {
      if (settled) return;
      const isAddressInUse = err && err.message && err.message.includes('ERR_ADDRESS_IN_USE');
      if (isAddressInUse && attempt < maxRetries) {
        attempt++;
        logRetry();
        cleanupFailedChild();
        setTimeout(spawnAttempt, retryDelayMs);
        return;
      }
      fail(new Error(`Ошибка запуска браузера: ${err.message}`));
    };

    const onChildExit = (code, signal) => {
      if (settled) return;
      const exitInfo = code !== null ? `code=${code}` : `signal=${signal}`;
      fail(new Error(`Браузер завершился до готовности CDP (${exitInfo})`));
    };

    const onStderrData = (currentChild) => (data) => {
      // Данные могут прийти от уже сброшенной попытки (после retry/timeout) — игнорируем.
      if (currentChild !== child) return;
      const chunk = data.toString();
      currentChild._mmStderrOutput = (currentChild._mmStderrOutput || '') + chunk;
      const match = currentChild._mmStderrOutput.match(/DevTools listening on ws:\/\/127\.0\.0\.1:(\d+)/);
      if (match) {
        cdpPorts.set(profileId, parseInt(match[1], 10));
        succeed();
      }
    };

    const spawnAttempt = () => {
      if (settled) return;
      try {
        child = spawn(browserPath, args, { detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
      } catch (err) {
        const isAddressInUse = err.message && err.message.includes('ERR_ADDRESS_IN_USE');
        if (isAddressInUse && attempt < maxRetries) {
          attempt++;
          logRetry();
          setTimeout(spawnAttempt, retryDelayMs);
          return;
        }
        fail(new Error(`Ошибка запуска браузера: ${err.message}`));
        return;
      }

      child.on('error', onChildError);
      child.on('exit', onChildExit);
      child.stderr.on('data', onStderrData(child));

      cdpTimeoutTimer = setTimeout(() => {
        fail(new Error('CDP port timeout'));
      }, cdpReadyTimeoutMs);
    };

    spawnAttempt();
  });
}

async function loadExtensionsViaCDP(profileId, runId, extPaths, logQueries, profileLogger, profileName) {
  let ws;

  // Если профиль запускается в рамках automation — дублируем этап в связанный
  // run-лог. При ручном запуске runId = null и run-лог не создаётся.
  const runLog = runId ? resolveRunLogPath(runId, profileName || profileId, profileId) : null;
  const logRun = (stage, data) => {
    if (!runLog) return;
    try {
      fs.mkdirSync(runLog.dir, { recursive: true });
    } catch { /* ignore */ }
    appendRunStage(runLog.filePath, stage, { runId, profileId, ...data });
  };

  try {
    const port = await waitForCdpPort(profileId);
    const wsUrl = await cdp.discoverWsUrl(port);
    ws = await cdp.connect(wsUrl);

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
          logRun('cdp_extension_loading', { ok: true, extension: path.basename(extPath) });
        } else {
          const errorDetail = result?.result?.value?.error
            || result?.exceptionDetails?.text
            || result?.exceptionDetails?.exception?.description
            || 'unknown';
          logQueries.add(profileId, 'warn', `CDP load failed: ${errorDetail}`);
          logRun('cdp_extension_loading', { ok: false, extension: path.basename(extPath), error: errorDetail });
        }
      } catch (err) {
        logQueries.add(profileId, 'warn', `CDP load error: ${err.message}`);
        logRun('cdp_extension_loading', { ok: false, extension: path.basename(extPath), error: err.message });
      }
    }
    logRun('browser_connection', { status: 'connected', extensionCount: extPaths.length });
  } catch (err) {
    profileLogger.warn({ profileId, error: err.message }, 'CDP extension loading unavailable');
    logRun('browser_connection', { status: 'error', error: err.message });
    throw new Error(`CDP extension loading: ${err.message}`);
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

  const userDataDir = getBrowserDataDir(profile);

  if (profile.profile_path && !fs.existsSync(userDataDir)) {
    profileQueries.updateStatus(req.params.id, 'stopped');
    broadcastStatus(req.params.id, 'stopped');
    logQueries.add(req.params.id, 'error', `Внешний профиль не найден: ${userDataDir}`);
    profileLogger.error({ profileId: req.params.id, path: userDataDir }, 'External profile directory not found');
    return res.status(400).json({ error: `External profile directory not found: ${userDataDir}`, code: 'PROFILE_DIR_NOT_FOUND' });
  }

  injectCookies(req.params.id);
  profileLogger.info({ profileId: req.params.id, profileDir: userDataDir }, 'Куки инжектированы');

  const args = [
    '--remote-debugging-port=0',
    '--fingerprint=' + profile.fingerprint_seed,
    '--resolution=' + profile.screen_resolution,
    '--cores=' + profile.hardware_cores,
    '--memory=' + profile.hardware_memory,
    `--user-data-dir=${userDataDir}`,
    '--lang=en-US',
    '--no-first-run',
    '--no-default-browser-check',
    `--fingerprint-timezone=${timezone}`,
    '--fingerprint-storage-quota=10240',
  ];

  if (profile.proxy_id) {
    const proxy = proxyQueries.getById(profile.proxy_id);
    if (proxy) {
      const proxyUrl = proxy.username
        ? `${proxy.type}://${proxy.username}:${proxy.password}@${proxy.host}:${proxy.port}`
        : `${proxy.type}://${proxy.host}:${proxy.port}`;
      args.push(`--proxy-server=${proxyUrl}`);
      profileLogger.info({
        profileId: req.params.id,
        proxyType: proxy.type,
        host: proxy.host,
        port: proxy.port,
        hasAuth: !!proxy.username,
      }, 'Прокси применён');
    }
  }

  const extIds = tryParseJson(profile.extensions);
  let enabledExtPaths = [];
  const profileExtPaths = [];

  if (profile.profile_path) {
    const externalExts = getExtensionsFromProfileDir(getBrowserDataDir(profile));
    profileExtPaths.push(...externalExts);
  }

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
  }

  const allExtPaths = [...profileExtPaths, ...enabledExtPaths];

  if (allExtPaths.length > 0) {
    args.push(`--load-extension=${allExtPaths.join(',')}`);
    logQueries.add(req.params.id, 'info', `Загружено расширений: ${allExtPaths.length}`);
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

  let cdpLaunch = null;
  try {
    cdpLaunch = await spawnBrowserWithCdp({
      browserPath,
      args,
      profileId: req.params.id,
      profileLogger,
      logQueries,
      maxRetries: SPAWN_RETRIES,
      retryDelayMs: SPAWN_RETRY_DELAY_MS,
      cdpReadyTimeoutMs: CDP_READY_TIMEOUT_MS,
    });
  } catch (err) {
    profileQueries.updateStatus(req.params.id, 'stopped');
    broadcastStatus(req.params.id, 'stopped');
    profileQueries.updatePid(req.params.id, null);
    runningProfiles.delete(req.params.id);
    logQueries.add(req.params.id, 'error', err.message);
    profileLogger.error({ profileId: req.params.id, error: err.message }, 'Ошибка запуска браузера');
    return res.status(500).json({ error: 'Ошибка запуска браузера', code: 'SPAWN_FAILED', message: err.message });
  }

  const child = cdpLaunch.child;
  const cdpPort = cdpLaunch.cdpPort;

  child.unref();

  runningProfiles.set(req.params.id, child);

  startHealthCheck();

  profileQueries.updatePid(req.params.id, child.pid);
  profileQueries.updateStatus(req.params.id, 'running');
  broadcastStatus(req.params.id, 'running', child.pid);
  logQueries.add(req.params.id, 'info', `Браузер запущен, PID: ${child.pid}, CDP порт: ${cdpPort}`);
  profileLogger.info({ profileId: req.params.id, pid: child.pid, cdpPort }, 'Браузер запущен');

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
    // run_id из тела запроса обязателен при запуске в рамках automation (POST /api/runs/:id/start):
    // automation-клиент (stAuto0) передаёт его в body, т.к. получает --run-id от executor.
    // При ручном запуске run_id = null — этапы CDP не дублируются в run-лог.
    const runId = req.body?.run_id || req.query?.run_id || null;
    try {
      await loadExtensionsViaCDP(req.params.id, runId, enabledExtPaths, logQueries, profileLogger, profile.name);
    } catch (err) {
      profileLogger.error({ profileId: req.params.id, error: err.message }, 'CDP extension loading failed');
      logQueries.add(req.params.id, 'error', `CDP extension loading failed: ${err.message}`);
    }
  }

  child.on('error', (err) => {
    profileQueries.updateStatus(req.params.id, 'stopped');
    broadcastStatus(req.params.id, 'stopped');
    profileQueries.updatePid(req.params.id, null);
    logQueries.add(req.params.id, 'error', 'Ошибка запуска', { error: err.message });
    profileLogger.error({ profileId: req.params.id, error: err.message }, 'Ошибка запуска');
    runningProfiles.delete(req.params.id);
    profileWindows.delete(req.params.id);
    cdpPorts.delete(req.params.id);
  });

  child.on('exit', (code, signal) => {
    profileQueries.updateStatus(req.params.id, 'stopped');
    broadcastStatus(req.params.id, 'stopped');
    profileQueries.updatePid(req.params.id, null);

    const exitInfo = code !== null ? `код ${code}` : `сигнал ${signal}`;
    const logMsg = `Браузер завершен (${exitInfo})`;

    const stderrOutput = child._mmStderrOutput || '';

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
    ws_endpoint: `http://127.0.0.1:${cdpPort}`,
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

  const profileDir = getBrowserDataDir(profile);
  const cacheDirs = ['Cache', 'Code Cache', 'GPUCache'];

  for (const dir of cacheDirs) {
    const cachePath = path.join(profileDir, dir);
    try {
      await fs.promises.rm(cachePath, { recursive: true, force: true });
    } catch { /* cache cleanup failed, non-fatal */ }
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
  const wsUrl = await cdp.discoverWsUrl(port);
  const ws = await cdp.connect(wsUrl);

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

async function removeOverlay(ws, sessionId, attempts = 3) {
  for (let i = 0; i < attempts; i++) {
    const result = await cdp.call(ws, 'Runtime.evaluate', {
      expression: `(function(){var el=document.querySelector('dialog._3ANLXG_dialog');if(el){el.remove();return true;}return false;})()`,
    }, { sessionId });
    if (!result?.result?.value) break;
    await new Promise(r => setTimeout(r, 500));
  }
}

async function waitForSelector(ws, sessionId, selector, timeout = 15000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    const result = await cdp.call(ws, 'Runtime.evaluate', {
      expression: `document.querySelector(${JSON.stringify(selector)}) !== null`,
    }, { sessionId });
    if (result && result.result && result.result.value) return;
    await new Promise(r => setTimeout(r, 200));
  }
  throw new Error(`Timeout waiting for selector: ${selector}`);
}

async function waitForSelectorHidden(ws, sessionId, selector, timeout = 10000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    await cdp.call(ws, 'Runtime.evaluate', {
      expression: `(function(){var o=document.querySelector('dialog._3ANLXG_dialog');if(o)o.remove();})()`,
    }, { sessionId });
    const result = await cdp.call(ws, 'Runtime.evaluate', {
      expression: `(function(){var el=document.querySelector(${JSON.stringify(selector)});return el===null||el.offsetParent===null||el.style.display==='none';})()`,
    }, { sessionId });
    if (result && result.result && result.result.value) return;
    await new Promise(r => setTimeout(r, 200));
  }
  throw new Error(`Timeout waiting for selector to hide: ${selector}`);
}

async function zerionLogin(port, password, extensionId) {
  const LOGIN_URL = `chrome-extension://${extensionId}/popup.8e8f209b.html?windowType=dialog#/login`;

  const wsUrl = await cdp.discoverWsUrl(port);
  logger.info({ port, wsUrl, loginUrl: LOGIN_URL }, 'zerionLogin: connecting to CDP');
  const ws = await cdp.connect(wsUrl);
  try {
    const { targetInfos } = await cdp.call(ws, 'Target.getTargets');
    let targetId = null;
    if (targetInfos) {
      const existing = targetInfos.find(t => t.url && t.url.includes(extensionId) && t.url.includes('#/login'));
      if (existing) targetId = existing.targetId;
    }

    if (!targetId) {
      logger.info({ port }, 'zerionLogin: creating new Zerion tab');
      const result = await cdp.call(ws, 'Target.createTarget', { url: LOGIN_URL });
      targetId = result.targetId;
    } else {
      logger.info({ port, targetId }, 'zerionLogin: found existing Zerion tab');
    }

    const { sessionId } = await cdp.call(ws, 'Target.attachToTarget', { targetId, flatten: true });
    logger.info({ port, targetId, sessionId }, 'zerionLogin: attached to target');

    await new Promise(r => setTimeout(r, 1000));

    await removeOverlay(ws, sessionId);
    logger.info({ port }, 'zerionLogin: overlay removed');

    await waitForSelector(ws, sessionId, "input[type='password']", 15000);
    logger.info({ port }, 'zerionLogin: password input found');

    await cdp.call(ws, 'Runtime.evaluate', {
      expression: `document.querySelector("input[type='password']").click()`,
    }, { sessionId });

    await cdp.call(ws, 'Runtime.evaluate', {
      expression: `document.querySelector("input[type='password']").value = ${JSON.stringify(password)}`,
    }, { sessionId });

    await cdp.call(ws, 'Runtime.evaluate', {
      expression: `(function(){var btn=document.querySelector('button[form]');if(btn)btn.click();})()`,
    }, { sessionId });
    logger.info({ port }, 'zerionLogin: unlock button clicked');

    await waitForSelectorHidden(ws, sessionId, "input[type='password']", 10000);
    logger.info({ port }, 'zerionLogin: login complete');
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

  const extDir = getExtensionsDir();
  const extIds = tryParseJson(profile.extensions);
  const folderName = extIds.length > 0 ? extIds[0] : null;

  if (!folderName) throw badRequest('Не найдено расширение Zerion в профиле');

  const extPath = path.join(extDir, folderName);
  const profileDir = getBrowserDataDir(profile);
  const zerionExtId = await resolveRuntimeId(extPath, profileDir);

  if (!zerionExtId) throw badRequest('Не удалось определить runtime ID расширения Zerion');

  logger.info({ profileId: req.params.id, cdpPort, hasPassword: !!walletPassword, zerionExtId }, 'zerion-login: starting');

  try {
    await zerionLogin(cdpPort, walletPassword, zerionExtId);
    logger.info({ profileId: req.params.id }, 'zerion-login: success');
    logQueries.add(req.params.id, 'info', 'Zerion auto-login успешен');
    res.json({ status: 'success' });
  } catch (err) {
    logger.error({ profileId: req.params.id, error: err.message }, 'zerion-login: failed');
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
