const fs = require('fs');
const path = require('path');
const os = require('os');
const { logger } = require('../logger');

const CLOAKBROWSER_CACHE_DIR = path.join(os.homedir(), '.cloakbrowser');
const DEFAULT_VERSION = '146.0.7680.177';

/**
 * Detect CloakBrowser Chromium version from cache directory.
 * Scans ~/.cloakbrowser/ for chromium-{version} directories.
 * @returns {string|null} version string or null if not found
 */
function detectVersionFromCache() {
  try {
    if (!fs.existsSync(CLOAKBROWSER_CACHE_DIR)) return null;

    const entries = fs.readdirSync(CLOAKBROWSER_CACHE_DIR);
    const versions = entries
      .filter(d => d.startsWith('chromium-'))
      .map(d => d.replace('chromium-', ''))
      .sort((a, b) => {
        const pa = a.split('.').map(Number);
        const pb = b.split('.').map(Number);
        for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
          const na = pa[i] || 0;
          const nb = pb[i] || 0;
          if (na !== nb) return nb - na;
        }
        return 0;
      });

    return versions[0] || null;
  } catch (err) {
    logger.warn({ err: err.message }, 'Failed to detect CloakBrowser version from cache');
    return null;
  }
}

/**
 * Get CloakBrowser version with priority:
 * 1. Manual override from system_config ('cloakbrowser_version')
 * 2. Auto-detected from cache directory
 * 3. Default fallback
 *
 * @param {Function} configGet - system_config.get(key) function
 * @returns {string} version string (major.minor.patch)
 */
function getCloakBrowserVersion(configGet) {
  // 1. Manual override
  const manual = configGet?.('cloakbrowser_version');
  if (manual && /^\d+\.\d+\.\d+/.test(manual)) {
    return manual;
  }

  // 2. Auto-detect from cache
  const detected = detectVersionFromCache();
  if (detected) {
    logger.info({ version: detected }, 'CloakBrowser version detected from cache');
    return detected;
  }

  // 3. Default fallback
  logger.info({ version: DEFAULT_VERSION }, 'Using default CloakBrowser version');
  return DEFAULT_VERSION;
}

/**
 * Extract major version number from version string.
 * "146.0.7680.177" -> "146"
 */
function getMajorVersion(version) {
  return version.split('.')[0];
}

module.exports = {
  detectVersionFromCache,
  getCloakBrowserVersion,
  getMajorVersion,
  DEFAULT_VERSION,
  CLOAKBROWSER_CACHE_DIR,
};
