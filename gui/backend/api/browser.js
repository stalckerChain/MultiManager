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

let cachedBrowserPath = null;

function resolveBrowserPath() {
  if (cachedBrowserPath && fs.existsSync(cachedBrowserPath)) {
    return cachedBrowserPath;
  }

  const home = process.env.USERPROFILE || process.env.HOME || '';
  const cacheDir = path.join(home, '.cloakbrowser');
  if (!fs.existsSync(cacheDir)) return null;

  const versions = fs.readdirSync(cacheDir)
    .filter(d => d.startsWith('chromium-'))
    .sort()
    .reverse();

  for (const ver of versions) {
    const bin = path.join(cacheDir, ver, 'chrome.exe');
    if (fs.existsSync(bin)) {
      cachedBrowserPath = bin;
      console.log('[browser] CloakBrowser found at:', bin);
      return bin;
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
  if (!profile) return res.status(404).json({ error: 'Профиль не найден' });
  if (profile.status === 'running') return res.status(409).json({ error: 'Профиль уже запущен' });

  const browserPath = resolveBrowserPath();
  if (!browserPath) {
    return res.status(500).json({ error: 'CloakBrowser не установлен. Выполните: npx cloakbrowser install' });
  }

  profileQueries.updateStatus(req.params.id, 'starting');
  broadcastStatus(req.params.id, 'starting');
  logQueries.add(req.params.id, 'info', 'Запуск профиля...');

  const profileLogger = createProfileLogger(req.params.id);

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
        host: proxy.host, port: proxy.port,
        username: proxy.username, password: proxy.password,
      });

      if (!checkResult.ok) {
        profileQueries.updateStatus(req.params.id, 'stopped');
        broadcastStatus(req.params.id, 'stopped');
        logQueries.add(req.params.id, 'error', 'Прокси недоступен', { error: checkResult.error });
        return res.status(412).json({ error: 'Прокси недоступен', details: checkResult.error });
      }

      proxyQueries.updateLastIp(profile.proxy_id, checkResult.ip);
      logQueries.add(req.params.id, 'info', `Прокси проверен, IP: ${checkResult.ip}`);
    }
  }

  const profileDir = getProfileDir(req.params.id);
  const user_data_dir = path.join(profileDir, 'BrowserData');
  injectCookies(req.params.id);

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
      args.push(`--proxy=${proxyUrl}`);
    }
  }

  const child = spawn(browserPath, args, { detached: true, stdio: 'ignore' });
  child.unref();
  runningProfiles.set(req.params.id, child);

  profileQueries.updatePid(req.params.id, child.pid);
  profileQueries.updateStatus(req.params.id, 'running');
  broadcastStatus(req.params.id, 'running', child.pid);
  logQueries.add(req.params.id, 'info', `Браузер запущен, PID: ${child.pid}`);

  child.on('error', (err) => {
    profileQueries.updateStatus(req.params.id, 'stopped');
    broadcastStatus(req.params.id, 'stopped');
    logQueries.add(req.params.id, 'error', 'Ошибка запуска', { error: err.message });
    runningProfiles.delete(req.params.id);
  });

  child.on('exit', () => {
    profileQueries.updateStatus(req.params.id, 'stopped');
    broadcastStatus(req.params.id, 'stopped');
    profileQueries.updatePid(req.params.id, null);
    runningProfiles.delete(req.params.id);
  });

  res.json({ status: 'success', profile_id: req.params.id, pid: child.pid });
});

router.post('/:id/stop', (req, res) => {
  const db = getDatabase();
  const profileQueries = createProfileQueries(db);
  const profile = profileQueries.getById(req.params.id);
  if (!profile) return res.status(404).json({ error: 'Профиль не найден' });

  const child = runningProfiles.get(req.params.id);
  if (child && child.pid) {
    kill(child.pid, 'SIGTERM');
    setTimeout(() => {
      if (runningProfiles.has(req.params.id)) kill(child.pid, 'SIGKILL');
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
  if (!profile) return res.status(404).json({ error: 'Профиль не найден' });
  res.json({ id: profile.id, status: profile.status, pid: profile.pid });
});

module.exports = router;
