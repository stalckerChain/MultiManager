const express = require('express');
const { getDatabase, createProfileQueries, createProxyQueries } = require('../db');

const PLACEHOLDER = 'Не указано';

// Единообразный HTML-escape для всех пользовательских значений перед вставкой
// в страницу. Имя аккаунта или username не могут внедрить markup/script.
function escapeHtml(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// Отображаемое значение: пустые/отсутствующие поля — безопасный placeholder.
function displayValue(value) {
  if (value == null || String(value).trim() === '') return escapeHtml(PLACEHOLDER);
  return escapeHtml(value);
}

// Безопасная проекция профиля + связанного прокси. Только согласованные поля:
// name, email, wallet_evm_address, wallet_sol_address, twitter_username,
// discord_username, last_ip и location прокси. Секретные поля (пароли, токены,
// proxy credentials, fingerprint seed) в проекцию не попадают.
function buildProfileInfoPage(profile, proxy) {
  const title = displayValue(profile.name);
  const rows = [
    ['Email', displayValue(profile.email)],
    ['EVM кошелёк', displayValue(profile.wallet_evm_address)],
    ['SOL кошелёк', displayValue(profile.wallet_sol_address)],
    ['X username', displayValue(profile.twitter_username)],
    ['Discord', displayValue(profile.discord_username)],
    ['IP прокси', displayValue(proxy ? proxy.last_ip : null)],
    ['Локация прокси', displayValue(proxy ? proxy.location : null)],
  ]
    .map(([label, value]) => `<dt>${escapeHtml(label)}</dt><dd>${value}</dd>`)
    .join('');

  return `<!DOCTYPE html>
<html lang="ru">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title>
<style>
  :root { color-scheme: light dark; }
  body { font-family: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; margin: 0; padding: 2rem 1rem; color: #18181b; background: #f4f4f5; }
  main { max-width: 680px; margin: 0 auto; background: #fff; border: 1px solid #e4e4e7; border-radius: 10px; padding: 1.5rem; }
  h1 { margin: 0 0 1.25rem; font-size: 1.4rem; word-break: break-word; }
  dl { display: grid; grid-template-columns: max-content 1fr; gap: 0.6rem 1.25rem; margin: 0; }
  dt { font-weight: 600; color: #52525b; }
  dd { margin: 0; word-break: break-word; min-width: 0; }
</style>
</head>
<body>
<main>
<h1>${title}</h1>
<dl>${rows}</dl>
</main>
</body>
</html>
`;
}

const router = express.Router();

// Публичный локальный endpoint (loopback-only): без authMiddleware, без rate
// limiter. Предназначен только для локального браузера MultiManager.
router.get('/:profileId', (req, res) => {
  const db = getDatabase();
  const profile = createProfileQueries(db).getById(req.params.profileId);

  if (!profile) {
    return res.status(404).json({ error: 'Профиль не найден' });
  }

  let proxy = null;
  if (profile.proxy_id) {
    proxy = createProxyQueries(db).getById(profile.proxy_id);
  }

  res.type('html').send(buildProfileInfoPage(profile, proxy));
});

module.exports = router;