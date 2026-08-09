const fs = require('fs');
const path = require('path');
const { getDataDir } = require('./data-dir');

function getDefaultProfileDir(profileId) {
  return path.join(getDataDir(), 'profiles', profileId);
}

function getBrowserDataDir(profile) {
  if (profile && profile.profile_path) {
    validateProfilePath(profile.profile_path);
    return path.resolve(profile.profile_path);
  }
  return path.join(getDefaultProfileDir(profile && profile.id ? profile.id : ''), 'BrowserData');
}

function validateProfilePath(value) {
  if (!value || typeof value !== 'string') {
    return;
  }
  if (!path.isAbsolute(value)) {
    throw new Error('profile_path must be an absolute path');
  }
  if (/(^|[\\/])\.\.([\\/]|$)/.test(value)) {
    throw new Error('profile_path contains path traversal');
  }
  if (value.length > 1024) {
    throw new Error('profile_path exceeds maximum length of 1024 characters');
  }
}

function getDefaultCookiesFile(profile) {
  return path.join(getBrowserDataDir(profile), 'Default', 'Cookies');
}

function getExtensionsFromProfileDir(profileDir) {
  const extensionsDir = path.join(profileDir, 'Default', 'Extensions');
  if (!fs.existsSync(extensionsDir)) {
    return [];
  }
  const result = [];
  const extIds = fs.readdirSync(extensionsDir, { withFileTypes: true });
  for (const entry of extIds) {
    if (!entry.isDirectory()) continue;
    const extId = entry.name;
    const versionDir = path.join(extensionsDir, extId);
    const versions = fs.readdirSync(versionDir, { withFileTypes: true });
    for (const versionEntry of versions) {
      if (!versionEntry.isDirectory()) continue;
      const manifestPath = path.join(versionDir, versionEntry.name, 'manifest.json');
      if (fs.existsSync(manifestPath)) {
        result.push(path.join(versionDir, versionEntry.name));
        break;
      }
    }
  }
  return result;
}

module.exports = {
  getDefaultProfileDir,
  getBrowserDataDir,
  validateProfilePath,
  getDefaultCookiesFile,
  getExtensionsFromProfileDir,
};
