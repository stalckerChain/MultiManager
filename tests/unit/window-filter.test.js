import { describe, it, expect } from 'vitest';

const CRASH_DIALOG_TITLES = [
  'Восстановить страницы?',
  'Restore pages?',
  'Chromium crashed',
  'Браузер не завершил работу',
  'Работа Chromium была завершена некорректно',
  'Crashed tab',
];

const VALID_BROWSER_TITLES = [
  'Google - CloakBrowser',
  'Profile 1 - Chromium',
  'MultiManager Session',
  'chrome://settings',
  'Example.com - Google Chrome',
  'Новая вкладка',
];

const SMALL_DIALOG_TITLES = [
  'Error',
  'Alert',
  'Confirm',
  'Settings',
];

function isCrashDialog(title) {
  const lower = title.toLowerCase();
  return lower.includes('restore') || lower.includes('восстановить')
    || lower.includes('crashed') || lower.includes('не заверш')
    || lower.includes('некорректно') || lower.includes('завершен некорректно');
}

function isTooSmall(width, height) {
  return width < 300 || height < 200;
}

describe('Window filter — crash dialog detection', () => {
  it('фильтрует "Восстановить страницы?"', () => {
    expect(isCrashDialog('Восстановить страницы?')).toBe(true);
  });

  it('фильтрует "Restore pages?"', () => {
    expect(isCrashDialog('Restore pages?')).toBe(true);
  });

  it('фильтрует "Chromium crashed"', () => {
    expect(isCrashDialog('Chromium crashed')).toBe(true);
  });

  it('фильтрует "не завершил работу"', () => {
    expect(isCrashDialog('Браузер не завершил работу')).toBe(true);
  });

  it('фильтрует "завершена некорректно"', () => {
    expect(isCrashDialog('Работа Chromium была завершена некорректно')).toBe(true);
  });

  it('case insensitive для restore', () => {
    expect(isCrashDialog('RESTORE PAGES?')).toBe(true);
    expect(isCrashDialog('Restore Pages')).toBe(true);
  });

  it('case insensitive для crashed', () => {
    expect(isCrashDialog('CRASHED')).toBe(true);
    expect(isCrashDialog('Browser Crashed')).toBe(true);
  });
});

describe('Window filter — valid browser windows pass', () => {
  for (const title of VALID_BROWSER_TITLES) {
    it(`не фильтрует "${title}"`, () => {
      expect(isCrashDialog(title)).toBe(false);
    });
  }
});

describe('Window filter — small window detection', () => {
  it('фильтрует окно 200x150', () => {
    expect(isTooSmall(200, 150)).toBe(true);
  });

  it('фильтрует окно 100x500', () => {
    expect(isTooSmall(100, 500)).toBe(true);
  });

  it('фильтрует окно 500x100', () => {
    expect(isTooSmall(500, 100)).toBe(true);
  });

  it('не фильтрует окно 800x600', () => {
    expect(isTooSmall(800, 600)).toBe(false);
  });

  it('не фильтрует окно 1920x1080', () => {
    expect(isTooSmall(1920, 1080)).toBe(false);
  });

  it('не фильтрует ровно 300x200', () => {
    expect(isTooSmall(300, 200)).toBe(false);
  });

  it('фильтрует 299x200', () => {
    expect(isTooSmall(299, 200)).toBe(true);
  });

  it('фильтрует 300x199', () => {
    expect(isTooSmall(300, 199)).toBe(true);
  });
});

describe('Window filter — all crash dialog titles', () => {
  for (const title of CRASH_DIALOG_TITLES) {
    it(`фильтрует "${title}"`, () => {
      expect(isCrashDialog(title)).toBe(true);
    });
  }
});

describe('Window filter — combined scenario', () => {
  const windows = [
    { title: 'Google - CloakBrowser', width: 1200, height: 800 },
    { title: 'Profile 2 - Chromium', width: 960, height: 540 },
    { title: 'Восстановить страницы?', width: 400, height: 250 },
    { title: 'Chromium crashed', width: 350, height: 180 },
    { title: 'Новая вкладка', width: 100, height: 80 },
  ];

  it('оставляет только 2 валидных окна из 5', () => {
    const valid = windows.filter(w => !isCrashDialog(w.title) && !isTooSmall(w.width, w.height));
    expect(valid.length).toBe(2);
    expect(valid[0].title).toBe('Google - CloakBrowser');
    expect(valid[1].title).toBe('Profile 2 - Chromium');
  });
});
