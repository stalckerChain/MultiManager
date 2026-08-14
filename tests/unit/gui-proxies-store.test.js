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

  it('previewDistribution вызывает preview endpoint с mode', async () => {
    client.post.mockResolvedValue({
      data: {
        mode: 'used',
        profiles_count: 3,
        checked_count: 2,
        working_count: 1,
        failed_count: 1,
        working_proxy_ids: [5],
      },
    });
    const store = useProxiesStore();
    const result = await store.previewDistribution('used');
    expect(client.post).toHaveBeenCalledWith('/api/proxies/distribute/preview', { mode: 'used' });
    expect(result.working_count).toBe(1);
    expect(result.working_proxy_ids).toEqual([5]);
  });

  it('previewDistribution передаёт mode "all"', async () => {
    client.post.mockResolvedValue({ data: { mode: 'all', working_count: 0, working_proxy_ids: [] } });
    const store = useProxiesStore();
    const result = await store.previewDistribution('all');
    expect(client.post).toHaveBeenCalledWith('/api/proxies/distribute/preview', { mode: 'all' });
    expect(result.mode).toBe('all');
  });

  it('distributeProxies вызывает distribute endpoint с mode и ID', async () => {
    client.post.mockResolvedValue({ data: { assigned_profiles: 4, used_proxies: 2 } });
    const store = useProxiesStore();
    const result = await store.distributeProxies('all', [1, 2]);
    expect(client.post).toHaveBeenCalledWith('/api/proxies/distribute', {
      mode: 'all',
      working_proxy_ids: [1, 2],
    });
    expect(result.assigned_profiles).toBe(4);
    expect(result.used_proxies).toBe(2);
  });

  it('previewDistribution пробрасывает ошибку', async () => {
    client.post.mockRejectedValue(new Error('preview failed'));
    const store = useProxiesStore();
    await expect(store.previewDistribution('used')).rejects.toThrow('preview failed');
  });

  it('distributeProxies пробрасывает ошибку', async () => {
    client.post.mockRejectedValue(new Error('distribute failed'));
    const store = useProxiesStore();
    await expect(store.distributeProxies('used', [1])).rejects.toThrow('distribute failed');
  });
});
