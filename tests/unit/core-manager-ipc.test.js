import { describe, it, expect, vi } from 'vitest';
import { createTokenHandler } from '../../gui/src/main/core-token-handler.js';

describe('Core Token Handler — startup token и runtime-ротация через IPC', () => {
  it('6.7: повторное сообщение api-token по IPC ротирует токен и уведомляет слушателей', async () => {
    const handler = createTokenHandler();
    const logs = [];
    handler.setLogger((level, msg) => logs.push(msg));

    const startup = handler.waitForToken();
    handler.onTokenReceived('startup-token');
    await startup;

    expect(handler.getCoreToken()).toBe('startup-token');
    expect(logs).toContain('Core token received (startup)');

    const listener = vi.fn();
    handler.onTokenChange(listener);

    // Ротация во время работы — backend присылает новый токен по тому же IPC-каналу
    handler.onTokenReceived('rotated-token');

    expect(handler.getCoreToken()).toBe('rotated-token');
    expect(listener).toHaveBeenCalledWith('rotated-token');
    expect(logs).toContain('Core token rotated (runtime)');
  });

  it('waitForToken разрешается текущим токеном, если он уже установлен', () => {
    const handler = createTokenHandler();
    handler.onTokenReceived('existing');
    return expect(handler.waitForToken()).resolves.toBe('existing');
  });

  it('игнорирует пустые/битые сообщения и не меняет текущий токен', () => {
    const handler = createTokenHandler();
    handler.onTokenReceived('current-token');

    expect(handler.onTokenReceived('')).toBe(false);
    expect(handler.onTokenReceived(undefined)).toBe(false);
    expect(handler.onTokenReceived(null)).toBe(false);
    expect(handler.onTokenReceived(42)).toBe(false);

    expect(handler.getCoreToken()).toBe('current-token');
  });

  it('reset() очищает токен для повторного startCore', () => {
    const handler = createTokenHandler();
    handler.onTokenReceived('old-token');

    handler.reset();
    expect(handler.getCoreToken()).toBe('');

    // после сброса снова можно ждать новый startup-токен
    const waited = handler.waitForToken();
    handler.onTokenReceived('fresh-token');
    return expect(waited).resolves.toBe('fresh-token');
  });

  it('onTokenChange возвращает cleanup-функцию и отписывает слушателя', () => {
    const handler = createTokenHandler();
    const listener = vi.fn();
    const off = handler.onTokenChange(listener);

    handler.onTokenReceived('t1');
    expect(listener).toHaveBeenCalledTimes(1);

    off();
    handler.onTokenReceived('t2');
    expect(listener).toHaveBeenCalledTimes(1);
  });
});