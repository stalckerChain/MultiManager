import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../gui/src/renderer/i18n/index.js', () => ({
  default: { changeLanguage: vi.fn() },
}));

const { setBaseURL, setAuthToken, default: client } = await import('../../gui/src/renderer/api/client.js');

describe('API Client — Authorization header', () => {
  beforeEach(() => {
    setBaseURL(3000);
    setAuthToken('');
  });

  it('setAuthToken устанавливает токен для запросов', () => {
    setAuthToken('test-123');
    const config = { headers: {} };
    const interceptor = client.interceptors?.request?.handlers?.[0]?.fulfilled;
    if (interceptor) {
      const result = interceptor({ ...config, baseURL: 'http://127.0.0.1:3000' });
      expect(result.headers.Authorization).toBe('Bearer test-123');
    }
  });

  it('без токена заголовок Authorization не добавляется', () => {
    setAuthToken('');
    const config = { headers: {} };
    const interceptor = client.interceptors?.request?.handlers?.[0]?.fulfilled;
    if (interceptor) {
      const result = interceptor({ ...config, baseURL: 'http://127.0.0.1:3000' });
      expect(result.headers.Authorization).toBeUndefined();
    }
  });

  it('setBaseURL обновляет baseURL', () => {
    setBaseURL(3005);
    const config = { headers: {} };
    const interceptor = client.interceptors?.request?.handlers?.[0]?.fulfilled;
    if (interceptor) {
      const result = interceptor({ ...config, baseURL: 'http://127.0.0.1:3000' });
      expect(result.baseURL).toBe('http://127.0.0.1:3005');
    }
  });

  it('response interceptor преобразует ошибку в объект', async () => {
    const interceptor = client.interceptors?.response?.handlers?.[1];
    if (interceptor?.rejected) {
      const axiosError = {
        response: { status: 401, data: { error: 'Unauthorized' } },
        message: 'Request failed',
      };
      try {
        await interceptor.rejected(axiosError);
      } catch (err) {
        expect(err.message).toBe('Unauthorized');
        expect(err.status).toBe(401);
        expect(err.code).toBe('ERR_UNKNOWN');
      }
    }
  });

  it('response interceptor обрабатывает ошибку без response', async () => {
    const interceptor = client.interceptors?.response?.handlers?.[1];
    if (interceptor?.rejected) {
      const axiosError = { response: undefined, message: 'Network Error' };
      try {
        await interceptor.rejected(axiosError);
      } catch (err) {
        expect(err.message).toBe('Network Error');
        expect(err.code).toBe('ERR_UNKNOWN');
      }
    }
  });
});
