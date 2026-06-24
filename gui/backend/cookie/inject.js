const fs = require('fs');
const path = require('path');
const { getDatabase, createCookieQueries } = require('../db');
const { logger } = require('../logger');

function getProfileDir(profileId) {
  const platform = process.platform;
  const home = process.env.HOME || process.env.USERPROFILE;

  if (platform === 'win32') {
    return path.join(process.env.APPDATA, 'CloakManager', 'profiles', profileId);
  } else if (platform === 'darwin') {
    return path.join(home, 'Library', 'Application Support', 'CloakManager', 'profiles', profileId);
  } else {
    return path.join(home, '.config', 'CloakManager', 'profiles', profileId);
  }
}

function ensureDir(dir) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function cookiesToNetscape(cookies) {
  const lines = ['# Netscape HTTP Cookie File'];
  for (const c of cookies) {
    const line = [
      c.domain,
      c.http_only ? 'TRUE' : 'FALSE',
      c.path || '/',
      c.secure ? 'TRUE' : 'FALSE',
      c.expires || 0,
      c.name,
      c.value,
    ].join('\t');
    lines.push(line);
  }
  return lines.join('\n');
}

function injectCookies(profileId) {
  const db = getDatabase();
  const cookieQueries = createCookieQueries(db);
  const cookies = cookieQueries.getByProfileId(profileId);

  if (cookies.length === 0) {
    logger.debug(`Нет куки для профиля ${profileId}`);
    return;
  }

  const profileDir = getProfileDir(profileId);
  ensureDir(profileDir);

  const cookiesDir = path.join(profileDir, 'Default');
  ensureDir(cookiesDir);

  const cookieFile = path.join(cookiesDir, 'Cookies');
  const content = cookiesToNetscape(cookies);
  fs.writeFileSync(cookieFile, content, 'utf-8');

  logger.info(`Инжекция ${cookies.length} куки в ${cookieFile}`);
}

function exportCookies(profileId) {
  const profileDir = getProfileDir(profileId);
  const cookieFile = path.join(profileDir, 'Default', 'Cookies');

  if (!fs.existsSync(cookieFile)) {
    return [];
  }

  const content = fs.readFileSync(cookieFile, 'utf-8');
  const lines = content.split('\n').filter(l => l && !l.startsWith('#'));
  const cookies = [];

  for (const line of lines) {
    const parts = line.split('\t');
    if (parts.length < 7) continue;
    cookies.push({
      domain: parts[0],
      httpOnly: parts[1] === 'TRUE',
      path: parts[2],
      secure: parts[3] === 'TRUE',
      expires: parseInt(parts[4], 10) || -1,
      name: parts[5],
      value: parts[6],
    });
  }

  return cookies;
}

module.exports = { injectCookies, exportCookies, getProfileDir };
