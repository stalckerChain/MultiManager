import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';

const read = (rel) => readFileSync(new URL(rel, import.meta.url), 'utf-8');

describe('Фильтрация сырых input/mouse-событий', () => {
  it('multi-control/index.js: нет per-event SENT/BROADCAST с координатами', () => {
    const src = read('../../src/multi-control/index.js');
    expect(src).not.toMatch(/SENT to slave/);
    expect(src).not.toMatch(/BROADCAST to slaves/);
    expect(src).toContain('mouse error slave');
  });

  it('multi-control/index.js: клавиши не логируются в MC-KEY', () => {
    const src = read('../../src/multi-control/index.js');
    expect(src).not.toMatch(/logger\.debug\(\{[^}]*key: params\.key/);
  });

  it('cdp-manager.js: нет per-event Input.dispatchMouseEvent и sync-лога с key', () => {
    const src = read('../../src/multi-control/cdp-manager.js');
    expect(src).not.toContain('CDP: Input.dispatchMouseEvent');
    expect(src).not.toContain('CDP-SYNC: received event');
    expect(src).not.toMatch(/logger\.info\(\{[^}]*key: event\.key/);
    // предупреждения об отсутствии соединения остаются
    expect(src).toContain('CDP: dispatchMouseEvent — no session');
    expect(src).toContain('CDP: dispatchMouseEventToSession — session not found');
  });

  it('api/multi-control.js: OS-KEYBOARD без key, диагностика Ctrl+T/W остаётся', () => {
    const src = read('../../src/api/multi-control.js');
    expect(src).not.toMatch(/logger\.info\(\{[^}]*event\.key/);
    expect(src).toContain('OS-KEYBOARD: Ctrl+T detected');
    expect(src).toContain('OS-KEYBOARD: Ctrl+W detected');
    expect(src).toContain('logger.error');
  });
});

describe('Защита логов и связь run-логов (browser/executor/runs)', () => {
  it('api/browser.js: proxyUrl не логируется целиком', () => {
    const src = read('../../src/api/browser.js');
    expect(src).not.toMatch(/logger\.info\(\{[^}]*proxyUrl/);
    expect(src).toContain('hasAuth: !!proxy.username');
  });

  it('api/browser.js: loadExtensionsViaCDP вызывается через await и принимает runId', () => {
    const src = read('../../src/api/browser.js');
    expect(src).toContain('await loadExtensionsViaCDP(');
    expect(src).toContain('req.body?.run_id');
    // ошибка не проглатывается: детализированное сообщение с этапом
    expect(src).toContain('CDP extension loading:');
  });

  it('executor: статусы обновляются с logPath и log_файлом передаётся в updateRunTaskStatus', () => {
    const src = read('../../src/executor/index.js');
    expect(src).toMatch(/updateRunTaskStatus\([^)]*filePath/s);
    expect(src).toContain(`task.log_file_path`);
  });

  it('api/runs.js: параметры логирования пробрасываются в query', () => {
    const src = read('../../src/api/runs.js');
    expect(src).toContain('(taskId, status, exitCode, logPath, attempts, errorMessage)');
  });

  it('logger: pino-roll с ротацией 10 MB и лимитом 5', () => {
    const src = read('../../src/logger/index.js');
    expect(src).toContain('pino-roll');
    expect(src).toContain(`size: '10m'`);
    expect(src).toContain('count: 5');
  });
});

describe('Секреты отсутствуют в логируемых объектах', () => {
  it('executor не логирует apiToken/MM_TOKEN', () => {
    const src = read('../../src/executor/index.js');
    expect(src).not.toMatch(/logger\.(info|error|warn|debug)\(\{[^}]*apiToken/);
  });

  it('executor передаёт MM_TOKEN только через env, не в args-логи', () => {
    const src = read('../../src/executor/index.js');
    // MM_TOKEN есть в env, но не во всех log-вызовах
    expect(src).toContain('MM_TOKEN');
    expect(src).not.toMatch(/logger\.[a-z]+\([^)]*MM_TOKEN/);
  });

  it('browser: zerionLogin логирует только hasPassword, не значение', () => {
    const src = read('../../src/api/browser.js');
    expect(src).toContain('hasPassword: !!walletPassword');
    expect(src).not.toMatch(/hasPassword:\s*walletPassword\b(?!\s*\?)/);
  });
});