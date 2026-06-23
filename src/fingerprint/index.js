const { v4: uuidv4 } = require('uuid');

const FINGERPRINT_DB = {
  macos: {
    userAgents: [
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.2 Safari/605.1.15',
    ],
    resolutions: ['2560x1600', '1920x1080', '1440x900', '2560x1440'],
    cores: [8, 10, 12],
    memory: [16, 24, 32],
    colorDepth: [24, 32],
    platform: 'MacIntel',
    userAgentPattern: /Macintosh; Intel Mac OS X/,
  },
  windows: {
    userAgents: [
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:134.0) Gecko/20100101 Firefox/134.0',
    ],
    resolutions: ['1920x1080', '2560x1440', '1366x768', '1536x864'],
    cores: [4, 6, 8, 12, 16],
    memory: [8, 16, 32],
    colorDepth: [24, 32],
    platform: 'Win32',
    userAgentPattern: /Windows NT 10\.0/,
  },
  linux: {
    userAgents: [
      'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
      'Mozilla/5.0 (X11; Linux x86_64; rv:134.0) Gecko/20100101 Firefox/134.0',
    ],
    resolutions: ['1920x1080', '2560x1440', '1366x768'],
    cores: [4, 8, 16],
    memory: [8, 16, 32],
    colorDepth: [24, 32],
    platform: 'Linux x86_64',
    userAgentPattern: /X11; Linux x86_64/,
  },
};

function randomPick(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

function generateFingerprint(platform = 'windows') {
  const config = FINGERPRINT_DB[platform];
  if (!config) {
    throw new Error(`Неподдерживаемая платформа: ${platform}`);
  }

  return {
    platform,
    user_agent: randomPick(config.userAgents),
    screen_resolution: randomPick(config.resolutions),
    hardware_cores: randomPick(config.cores),
    hardware_memory: randomPick(config.memory),
    color_depth: randomPick(config.colorDepth),
    fingerprint_seed: uuidv4(),
  };
}

module.exports = { generateFingerprint, FINGERPRINT_DB };
