const fs = require('fs');
const path = require('path');

/**
 * Parse account ranges from PROJECT_FLAGS accounts array.
 * Input: ['001-050', '055', '060-065']
 * Output: ['auto_001', ..., 'auto_050', 'auto_055', 'auto_060', ..., 'auto_065']
 */
function parseAccountRanges(ranges) {
  const result = [];
  for (const range of ranges) {
    if (typeof range !== 'string') continue;

    const dashIndex = range.indexOf('-');
    if (dashIndex === -1) {
      // Single number: '055'
      result.push(`auto_${range}`);
    } else {
      // Range: '001-050'
      const start = parseInt(range.substring(0, dashIndex), 10);
      const end = parseInt(range.substring(dashIndex + 1), 10);
      const startLen = dashIndex; // Length of start string determines padding
      for (let i = start; i <= end; i++) {
        result.push(`auto_${String(i).padStart(startLen, '0')}`);
      }
    }
  }
  return result;
}

/**
 * Parse Python dict from file content line by line.
 * Handles: {"key": "value"}, {'key': ("path", "Class")}, {'key': {'accounts': ['001-050']}}
 */
function parsePythonDict(content, dictName) {
  // Extract dict body between DICT_NAME = { and closing }
  const dictStart = content.indexOf(`${dictName}`);
  if (dictStart === -1) return {};

  const openBrace = content.indexOf('{', dictStart);
  if (openBrace === -1) return {};

  // Find matching closing brace, counting nesting
  let depth = 0;
  let closeBrace = -1;
  for (let i = openBrace; i < content.length; i++) {
    if (content[i] === '{') depth++;
    else if (content[i] === '}') {
      depth--;
      if (depth === 0) { closeBrace = i; break; }
    }
  }
  if (closeBrace === -1) return {};

  const dictBody = content.substring(openBrace + 1, closeBrace);
  const result = {};

  // Parse each line
  const lines = dictBody.split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;

    // Pattern 1: "key": "value" or 'key': 'value'
    const strMatch = trimmed.match(/^['"](\w+)['"]\s*:\s*['"]([^'"]*)['"]/);
    if (strMatch) {
      result[strMatch[1]] = strMatch[2];
      continue;
    }

    // Pattern 2: "key": ("path", "Class") or 'key': ('path', 'Class')
    const tupleMatch = trimmed.match(/^['"](\w+)['"]\s*:\s*\(['"]([^'"]+)['"]\s*,\s*['"]([^'"]+)['"]\)/);
    if (tupleMatch) {
      result[tupleMatch[1]] = [tupleMatch[2], tupleMatch[3]];
      continue;
    }

    // Pattern 3: 'key': {'accounts': ['001-050']}
    const dictMatch = trimmed.match(/^['"](\w+)['"]\s*:\s*\{.*'accounts'\s*:\s*\[([^\]]*)\]/);
    if (dictMatch) {
      const accountsStr = dictMatch[2];
      const accounts = accountsStr.match(/'([^']*)'/g)?.map(s => s.replace(/'/g, '')) || [];
      result[dictMatch[1]] = { accounts };
      continue;
    }
  }

  return result;
}

/**
 * Read stAuto0 config/projects.py and return parsed data.
 * @param {string} stAuto0Path - Path to stAuto0 directory
 * @returns {{ status: {}, registry: {}, flags: {} } | null}
 */
function readStAuto0Config(stAuto0Path) {
  const configPath = path.join(stAuto0Path, 'config', 'projects.py');

  try {
    const content = fs.readFileSync(configPath, 'utf-8');

    const status = parsePythonDict(content, 'PROJECT_STATUS');
    const registry = parsePythonDict(content, 'PROJECT_REGISTRY');
    const flags = parsePythonDict(content, 'PROJECT_FLAGS');

    return { status, registry, flags };
  } catch (err) {
    console.error('[stAuto0-config] Failed to read config:', err.message);
    return null;
  }
}

/**
 * Build project list from stAuto0 config.
 * Returns array of project objects ready for sync.
 */
function buildProjectsFromConfig(stAuto0Path) {
  const config = readStAuto0Config(stAuto0Path);
  if (!config) return [];

  const projects = [];

  for (const [name, status] of Object.entries(config.status)) {
    const registry = config.registry[name] || [];
    const flags = config.flags[name] || {};

    const modulePath = Array.isArray(registry) ? registry[0] : '';
    const className = Array.isArray(registry) ? registry[1] : '';
    const accounts = flags.accounts || [];

    projects.push({
      name,
      display_name: name.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()),
      module_path: modulePath,
      class_name: className,
      is_active: status === 'active',
      default_config: JSON.stringify({ accounts }),
    });
  }

  return projects;
}

module.exports = {
  parseAccountRanges,
  readStAuto0Config,
  buildProjectsFromConfig,
};
