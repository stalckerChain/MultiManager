import { describe, it, expect, vi, beforeEach } from 'vitest';
import { setActivePinia, createPinia } from 'pinia';

vi.mock('../../gui/src/renderer/api/client.js', () => ({
  default: {
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
    delete: vi.fn(),
  },
}));

import client from '../../gui/src/renderer/api/client.js';
import { useProxiesStore } from '../../gui/src/renderer/stores/proxies.js';

describe('proxies store', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.clearAllMocks();
  });

  it('fetchAll загружает прокси', async () => {
    client.get.mockResolvedValue({
      data: [{ id: 1, host: 'proxy.com', port: 1080 }],
    });
    const store = useProxiesStore();
    await store.fetchAll();
    expect(store.proxies.length).toBe(1);
    expect(store.proxies[0].host).toBe('proxy.com');
  });

  it('fetchAll обрабатывает ошибку', async () => {
    client.get.mockRejectedValue(new Error('Network error'));
    const store = useProxiesStore();
    store.proxies = [{ id: 1 }];
    await store.fetchAll();
    expect(store.proxies.length).toBe(0);
    expect(store.loading).toBe(false);
  });

  it('create добавляет прокси в store', async () => {
    client.post.mockResolvedValue({
      data: { id: 2, host: 'new.com', port: 8080 },
    });
    const store = useProxiesStore();
    const result = await store.create({ host: 'new.com', port: 8080 });
    expect(store.proxies.length).toBe(1);
    expect(result.id).toBe(2);
    expect(client.post).toHaveBeenCalledWith('/api/proxies', { host: 'new.com', port: 8080 });
  });

  it('importBulk добавляет прокси из bulk-импорта', async () => {
    client.post.mockResolvedValue({
      data: { count: 2, proxies: [{ id: 3 }, { id: 4 }] },
    });
    const store = useProxiesStore();
    const result = await store.importBulk('socks5://h1:1080\nhttp://h2:8080');
    expect(store.proxies.length).toBe(2);
    expect(result.count).toBe(2);
  });

  it('update обновляет прокси в store', async () => {
    const store = useProxiesStore();
    store.proxies = [{ id: 1, host: 'old.com', port: 1080 }];
    client.put.mockResolvedValue({
      data: { id: 1, host: 'new.com', port: 1080 },
    });
    await store.update(1, { host: 'new.com' });
    expect(store.proxies[0].host).toBe('new.com');
  });

  it('update не падает если прокси не найден', async () => {
    const store = useProxiesStore();
    store.proxies = [];
    client.put.mockResolvedValue({ data: { id: 99 } });
    await store.update(99, { host: 'x' });
    expect(store.proxies.length).toBe(0);
  });

  it('remove удаляет прокси из store', async () => {
    const store = useProxiesStore();
    store.proxies = [{ id: 1 }, { id: 2 }];
    client.delete.mockResolvedValue({});
    await store.remove(1);
    expect(store.proxies.length).toBe(1);
    expect(store.proxies[0].id).toBe(2);
    expect(client.delete).toHaveBeenCalledWith('/api/proxies/1');
  });

  it('check вызывает POST /api/proxies/:id/check', async () => {
    client.post.mockResolvedValue({
      data: { ok: true, ip: '1.2.3.4' },
    });
    const store = useProxiesStore();
    const result = await store.check(5);
    expect(result.ok).toBe(true);
    expect(result.ip).toBe('1.2.3.4');
    expect(client.post).toHaveBeenCalledWith('/api/proxies/5/check');
  });

  it('check обрабатывает ошибку', async () => {
    client.post.mockRejectedValue(new Error('timeout'));
    const store = useProxiesStore();
    await expect(store.check(1)).rejects.toThrow('timeout');
  });

  it('loading сбрасывается после fetchAll', async () => {
    client.get.mockResolvedValue({ data: [] });
    const store = useProxiesStore();
    expect(store.loading).toBe(false);
    const promise = store.fetchAll();
    expect(store.loading).toBe(true);
    await promise;
    expect(store.loading).toBe(false);
  });
});
