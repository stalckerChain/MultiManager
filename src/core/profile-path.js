const fs = require('fs');
const path = require('path');

function getDefaultProfileDir(profileId) {
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
