const express = require('express');
const { spawn } = require('child_process');
const kill = require('tree-kill');
const fs = require('fs');
const path = require('path');
const { getDatabase, createProfileQueries, createProxyQueries, createLogQueries } = require('../db');
const { checkProxy, rotateProxy } = require('../proxy');
const { injectCookies, getProfileDir } = require('../cookie/inject');
const { createProfileLogger } = require('../logger');
const { broadcastStatus } = require('../core/websocket');

const router = express.Router();

const runningProfiles = new Map();

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
    stderrOutput += data.toString();
  });

  child.unref();

  runningProfiles.set(req.params.id, child);

  profileQueries.updatePid(req.params.id, child.pid);
  profileQueries.updateStatus(req.params.id, 'running');
  broadcastStatus(req.params.id, 'running', child.pid);
  logQueries.add(req.params.id, 'info', `Браузер запущен, PID: ${child.pid}`);
  profileLogger.info({ profileId: req.params.id, pid: child.pid }, 'Браузер запущен');

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
  });

  res.json({
    status: 'success',
    profile_id: req.params.id,
    pid: child.pid,
    ws_endpoint: `ws://127.0.0.1:3000/devtools/browser/${req.params.id}`,
  });
});

router.post('/:id/stop', (req, res) => {
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
    
    kill(child.pid, 'SIGTERM', (err) => {
      if (err) {
        logQueries.add(req.params.id, 'error', 'Ошибка остановки', { error: err.message });
      }
    });

    setTimeout(() => {
      if (runningProfiles.has(req.params.id)) {
        kill(child.pid, 'SIGKILL');
        logQueries.add(req.params.id, 'warn', 'Принудительное завершение');
      }
    }, 5000);
  }

  profileQueries.updateStatus(req.params.id, 'stopped');
  broadcastStatus(req.params.id, 'stopped');
  profileQueries.updatePid(req.params.id, null);
  runningProfiles.delete(req.params.id);

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

module.exports = router;
