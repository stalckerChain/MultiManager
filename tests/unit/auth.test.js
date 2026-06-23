import { describe, it, expect, beforeEach, vi } from 'vitest';
import { setToken, getToken, authMiddleware } from '../../src/api/auth.js';

describe('Auth Middleware', () => {
  beforeEach(() => {
    setToken('test-token-123');
  });

  it('устанавливает и получает токен', () => {
    setToken('my-secret');
    expect(getToken()).toBe('my-secret');
  });

  it('пропускает запрос с валидным токеном', () => {
    const req = { headers: { authorization: 'Bearer test-token-123' } };
    const res = { status: vi.fn().mockReturnThis(), json: vi.fn() };
    const next = vi.fn();

    authMiddleware(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalled();
  });

  it('отклоняет запрос без токена', () => {
    const req = { headers: {} };
    const res = { status: vi.fn().mockReturnThis(), json: vi.fn() };
    const next = vi.fn();

    authMiddleware(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({ error: 'Unauthorized' });
    expect(next).not.toHaveBeenCalled();
  });

  it('отклоняет запрос с неверным токеном', () => {
    const req = { headers: { authorization: 'Bearer wrong-token' } };
    const res = { status: vi.fn().mockReturnThis(), json: vi.fn() };
    const next = vi.fn();

    authMiddleware(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({ error: 'Invalid token' });
    expect(next).not.toHaveBeenCalled();
  });

  it('отклоняет запрос с неверным форматом заголовка', () => {
    const req = { headers: { authorization: 'Basic test-token-123' } };
    const res = { status: vi.fn().mockReturnThis(), json: vi.fn() };
    const next = vi.fn();

    authMiddleware(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });
});
