const fs = require('fs');
const path = require('path');
const { getDatabase, createCookieQueries, createProfileQueries } = require('../db');
const { logger } = require('../logger');
const { getDefaultProfileDir, getBrowserDataDir } = require('../core/profile-path');

function getProfileDir(profileId) {
  return getDefaultProfileDir(profileId);
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
  const profileQueries = createProfileQueries(db);
  const cookies = cookieQueries.getByProfileId(profileId);

  if (cookies.length === 0) {
    logger.debug(`Нет куки для профиля ${profileId}`);
    return;
  }

  const profile = profileQueries.getById(profileId);
  const userDataDir = getBrowserDataDir(profile || { id: profileId });

  const cookiesDir = path.join(userDataDir, 'Default');
  ensureDir(cookiesDir);

  const cookieFile = path.join(cookiesDir, 'Cookies');
  const content = cookiesToNetscape(cookies);
  fs.writeFileSync(cookieFile, content, 'utf-8');

  logger.info(`Инжекция ${cookies.length} куки в ${cookieFile}`);
}

function exportCookies(profileId) {
  const db = getDatabase();
  const profileQueries = createProfileQueries(db);
  const profile = profileQueries.getById(profileId);
  const userDataDir = getBrowserDataDir(profile || { id: profileId });
  const cookieFile = path.join(userDataDir, 'Default', 'Cookies');

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
