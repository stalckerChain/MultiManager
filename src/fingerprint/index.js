const { v4: uuidv4 } = require('uuid');

// UA templates — Chrome version is injected dynamically
const UA_TEMPLATES = {
  macos: [
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/__VERSION__ Safari/537.36',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.2 Safari/605.1.15',
  ],
  windows: [
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/__VERSION__ Safari/537.36',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:134.0) Gecko/20100101 Firefox/134.0',
  ],
  linux: [
    'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/__VERSION__ Safari/537.36',
    'Mozilla/5.0 (X11; Linux x86_64; rv:134.0) Gecko/20100101 Firefox/134.0',
  ],
};

const FINGERPRINT_DB = {
  macos: {
    resolutions: ['2560x1600', '1920x1080', '1440x900', '2560x1440'],
    cores: [8, 10, 12],
    memory: [16, 24, 32],
    colorDepth: [24, 32],
    webglRenderer: 'Apple GPU',
    platform: 'MacIntel',
    userAgentPattern: /Macintosh; Intel Mac OS X/,
  },
  windows: {
    resolutions: ['1920x1080', '2560x1440', '1366x768', '1536x864', '3840x2160', '3440x1440'],
    cores: [4, 6, 8, 12, 16],
    memory: [8, 12, 16, 32],
    colorDepth: [24, 32],
    webglRenderer: 'ANGLE (NVIDIA, NVIDIA GeForce GTX 1660, OpenGL 4.5)',
    platform: 'Win32',
    userAgentPattern: /Windows NT 10\.0/,
  },
  linux: {
    resolutions: ['1920x1080', '2560x1440', '1366x768'],
    cores: [4, 8, 16],
    memory: [8, 16, 32],
    colorDepth: [24, 32],
    webglRenderer: 'Mesa DRI Intel(R) UHD Graphics 630',
    platform: 'Linux x86_64',
    userAgentPattern: /X11; Linux x86_64/,
  },
};

const RESOLUTION_HARDWARE_MAP = {
  '3840x2160': { minCores: 8, minMemory: 16 },
  '3440x1440': { minCores: 6, minMemory: 12 },
  '2560x1600': { minCores: 6, minMemory: 12 },
  '2560x1440': { minCores: 4, minMemory: 8 },
};

const MIN_HARDWARE = { cores: 2, memory: 4 };

function randomPick(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

/**
 * Build User-Agent string with dynamic Chrome version.
 * @param {string} platform - 'windows' | 'macos' | 'linux'
 * @param {string} chromeVersion - e.g. '146.0.7680.177'
 * @returns {string} User-Agent string
 */
function buildUserAgent(platform, chromeVersion) {
  const templates = UA_TEMPLATES[platform];
  if (!templates) {
    throw new Error(`Неподдерживаемая платформа: ${platform}`);
  }
  const template = randomPick(templates);
  return template.replace('__VERSION__', chromeVersion);
}

/**
 * Generate fingerprint for a profile.
 * @param {string} platform - 'windows' | 'macos' | 'linux'
 * @param {string} chromeVersion - CloakBrowser version (e.g. '146.0.7680.177')
 * @returns {object} fingerprint data
 */
function generateFingerprint(platform = 'windows', chromeVersion = '146.0.7680.177') {
  const config = FINGERPRINT_DB[platform];
  if (!config) {
    throw new Error(`Неподдерживаемая платформа: ${platform}`);
  }

  let resolution = randomPick(config.resolutions);
  let cores = randomPick(config.cores);
  let memory = randomPick(config.memory);

  const resReq = RESOLUTION_HARDWARE_MAP[resolution];
  if (resReq) {
    if (cores < resReq.minCores) cores = resReq.minCores;
    if (memory < resReq.minMemory) memory = resReq.minMemory;
  }

  if (cores < MIN_HARDWARE.cores) cores = MIN_HARDWARE.cores;
  if (memory < MIN_HARDWARE.memory) memory = MIN_HARDWARE.memory;

  return {
    platform,
    navigator_platform: config.platform,
    user_agent: buildUserAgent(platform, chromeVersion),
    screen_resolution: resolution,
    hardware_cores: cores,
    hardware_memory: memory,
    color_depth: randomPick(config.colorDepth),
    webgl_renderer: config.webglRenderer,
    fingerprint_seed: uuidv4(),
  };
}

module.exports = {
  generateFingerprint,
  buildUserAgent,
  FINGERPRINT_DB,
  UA_TEMPLATES,
  RESOLUTION_HARDWARE_MAP,
  MIN_HARDWARE,
};
