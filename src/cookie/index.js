const fs = require('fs');
const path = require('path');

function parseJsonCookies(filePath) {
  const content = fs.readFileSync(filePath, 'utf-8');
  const cookies = JSON.parse(content);
  
  if (!Array.isArray(cookies)) {
    throw new Error('Неверный формат JSON куки');
  }

  return cookies.map(cookie => ({
    name: cookie.name,
    value: cookie.value,
    domain: cookie.domain,
    path: cookie.path || '/',
    expires: cookie.expirationDate || -1,
    httpOnly: cookie.httpOnly || false,
    secure: cookie.secure || false,
    sameSite: cookie.sameSite || 'Lax',
  }));
}

function parseNetscapeCookies(filePath) {
  const content = fs.readFileSync(filePath, 'utf-8');
  const lines = content.split('\n');
  const cookies = [];

  for (const line of lines) {
    if (line.startsWith('#') || !line.trim()) continue;

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

function exportCookiesToJson(cookies) {
  return JSON.stringify(cookies, null, 2);
}

module.exports = { parseJsonCookies, parseNetscapeCookies, exportCookiesToJson };
