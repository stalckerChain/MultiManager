const { initDatabase, createProfileQueries, createProxyQueries, createCookieQueries, createLogQueries } = require('../../src/db');
const { generateFingerprint } = require('../../src/fingerprint');
const { injectCookies, getProfileDir } = require('../../src/cookie/inject');
const { createProfileLogger } = require('../../src/logger');
const path = require('path');
const fs = require('fs');

async function testProfileLaunch() {
  console.log('=== Тест запуска профиля с куками ===\n');

  const db = initDatabase();
  const profileQueries = createProfileQueries(db);
  const cookieQueries = createCookieQueries(db);
  const logQueries = createLogQueries(db);

  db.exec('DELETE FROM profiles');
  db.exec('DELETE FROM cookies');
  db.exec('DELETE FROM profile_logs');

  console.log('1. Создаем профиль...');
  const fingerprint = generateFingerprint('macos');
  const profile = profileQueries.create({
    name: 'Test Profile',
    platform: fingerprint.platform,
    fingerprint_seed: fingerprint.fingerprint_seed,
    user_agent: fingerprint.user_agent,
    screen_resolution: fingerprint.screen_resolution,
    hardware_cores: fingerprint.hardware_cores,
    hardware_memory: fingerprint.hardware_memory,
  });
  console.log(`   Профиль создан: ${profile.id}\n`);

  console.log('2. Импортируем куки...');
  const testCookies = [
    { name: 'session_id', value: 'abc123xyz', domain: '.example.com', path: '/', httpOnly: true, secure: true },
    { name: 'user_pref', value: 'dark_mode', domain: '.example.com', path: '/settings', httpOnly: false, secure: false, expires: Math.floor(Date.now() / 1000) + 86400 },
    { name: 'token', value: 'jwt_token_here', domain: '.api.example.com', path: '/auth', httpOnly: true, secure: true },
  ];
  cookieQueries.import(profile.id, testCookies);
  const savedCookies = cookieQueries.getByProfileId(profile.id);
  console.log(`   Импортировано ${savedCookies.length} куки\n`);

  console.log('3. Инжектируем куки в профильную директорию...');
  injectCookies(profile.id);

  const profileDir = getProfileDir(profile.id);
  const cookieFile = path.join(profileDir, 'Default', 'Cookies');
  console.log(`   Файл куки: ${cookieFile}`);

  if (fs.existsSync(cookieFile)) {
    const content = fs.readFileSync(cookieFile, 'utf-8');
    const lines = content.split('\n').filter(l => l && !l.startsWith('#'));
    console.log(`   Записей в файле: ${lines.length}`);
    console.log(`   Содержимое:\n${content}\n`);
  } else {
    console.log('   ОШИБКА: Файл куки не создан!\n');
  }

  console.log('4. Пишем лог профиля...');
  const profileLogger = createProfileLogger(profile.id);
  profileLogger.info({ profileId: profile.id }, 'Профиль запущен');
  profileLogger.info({ cookieCount: savedCookies.length }, 'Куки инжектированы');

  const logs = logQueries.getByProfileId(profile.id);
  console.log(`   Логов в БД: ${logs.length}\n`);

  console.log('5. Проверяем файл лога...');
  const logDir = path.join(process.env.HOME || process.env.USERPROFILE, '.config', 'CloakManager', 'logs');
  const logFile = path.join(logDir, `profile_${profile.id}.log`);
  if (fs.existsSync(logFile)) {
    const logContent = fs.readFileSync(logFile, 'utf-8');
    console.log(`   Файл лога: ${logFile}`);
    console.log(`   Содержимое:\n${logContent}`);
  } else {
    console.log(`   Файл лога: ${logFile} (создастся при реальном запуске)\n`);
  }

  console.log('\n=== Тест завершен успешно ===');
}

testProfileLaunch().catch(console.error);
