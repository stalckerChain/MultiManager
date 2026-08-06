const path = require('path');
const fs = require('fs');

const ICONS = {
  ico: 'tray-icon.ico',
  png: 'tray-icon.png',
};

function resolveResourcesPath() {
  // Resource files live in gui/resources and are included in the app bundle
  // via the "build.files" config (resources/**/*). Relative to gui/src/main
  // the same path resolves both in dev and inside app.asar (packaged).
  return path.join(__dirname, '..', '..', 'resources');
}

function pickIconFormat(platform) {
  return platform === 'win32' ? 'ico' : 'png';
}

function resolveTrayResources({ resourcesDir, platform, exists = fs.existsSync }) {
  const primaryFormat = pickIconFormat(platform);
  const altFormat = primaryFormat === 'ico' ? 'png' : 'ico';
  const primaryPath = path.join(resourcesDir, ICONS[primaryFormat]);
  const altPath = path.join(resourcesDir, ICONS[altFormat]);

  const primaryExists = Boolean(exists(primaryPath));
  const altExists = Boolean(exists(altPath));

  if (primaryExists) {
    return {
      iconPath: primaryPath,
      format: primaryFormat,
      fallback: false,
      present: true,
      primaryPath,
      altPath,
      primaryExists,
      altExists,
    };
  }

  if (altExists) {
    return {
      iconPath: altPath,
      format: altFormat,
      fallback: true,
      present: true,
      primaryPath,
      altPath,
      primaryExists,
      altExists,
    };
  }

  return {
    iconPath: primaryPath,
    format: primaryFormat,
    fallback: false,
    present: false,
    primaryPath,
    altPath,
    primaryExists,
    altExists,
  };
}

module.exports = { resolveResourcesPath, resolveTrayResources, pickIconFormat, ICONS };