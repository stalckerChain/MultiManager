import { describe, it, expect, vi } from 'vitest';
import { resolveToken } from '../../src/api/auth.js';

function fakeConfig(seed = {}) {
  const store = new Map(Object.entries(seed));
  return {
    get: vi.fn((k) => store.get(k) ?? null),
    set: vi.fn((k, v) => store.set(k, String(v))),
  };
}

describe('resolveToken — приоритет источников токена', () => {
  it('6.1: генерирует и сохраняет токен, если в БД ничего нет', () => {
    const config = fakeConfig();
    const generate = vi.fn(() => 'generated-token');
    const result = resolveToken({ explicitToken: null, configQueries: config, generate });

    expect(result.token).toBe('generated-token');
    expect(result.generated).toBe(true);
    expect(config.set).toHaveBeenCalledWith('api_token', 'generated-token');
  });

  it('6.2: при повторной инициализации сохраняет существующий токен и не генерирует новый', () => {
    const config = fakeConfig({ api_token: 'persisted-token' });
    const generate = vi.fn();
    const result = resolveToken({ explicitToken: null, configQueries: config, generate });

    expect(result.token).toBe('persisted-token');
    expect(result.generated).toBe(false);
    expect(generate).not.toHaveBeenCalled();
    expect(config.set).not.toHaveBeenCalled();
  });

  it('6.3: явный токен (CLI/env) имеет приоритет над БД', () => {
    const config = fakeConfig({ api_token: 'persisted-token' });
    const generate = vi.fn();
    const result = resolveToken({ explicitToken: 'cli-token', configQueries: config, generate });

    expect(result.token).toBe('cli-token');
    expect(result.generated).toBe(false);
    expect(generate).not.toHaveBeenCalled();
    expect(config.set).not.toHaveBeenCalled();
  });
});