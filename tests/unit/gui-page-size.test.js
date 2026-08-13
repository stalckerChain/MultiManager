import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createPageSizeStore } from '../../gui/src/renderer/utils/page-size.js';

function makeStorage(initial = {}) {
  const data = new Map(Object.entries(initial));
  return {
    getItem: vi.fn((key) => (data.has(key) ? data.get(key) : null)),
    setItem: vi.fn((key, value) => { data.set(key, String(value)); }),
    removeItem: vi.fn((key) => { data.delete(key); }),
  };
}

describe('page-size store', () => {
  let storage;

  beforeEach(() => {
    storage = makeStorage();
    vi.stubGlobal('localStorage', storage);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('возвращает fallback 50 при отсутствии значения', () => {
    const store = createPageSizeStore('multimanager.profiles.pageSize');
    expect(store.get()).toBe(50);
  });

  it('сохраняет и восстанавливает выбранный размер', () => {
    const store = createPageSizeStore('multimanager.profiles.pageSize');
    store.set(10);
    expect(storage.setItem).toHaveBeenCalledWith('multimanager.profiles.pageSize', '10');
    expect(store.get()).toBe(10);
  });

  it('поддерживает размеры 10, 20, 50, 100', () => {
    const store = createPageSizeStore('multimanager.profiles.pageSize');
    for (const size of [10, 20, 50, 100]) {
      store.set(size);
      expect(store.get()).toBe(size);
    }
  });

  it('заменяет повреждённое или неподдерживаемое значение на 50', () => {
    const corrupted = makeStorage({ 'multimanager.profiles.pageSize': 'abc' });
    vi.stubGlobal('localStorage', corrupted);
    expect(createPageSizeStore('multimanager.profiles.pageSize').get()).toBe(50);
  });

  it('заменяет недопустимое число на 50', () => {
    const corrupted = makeStorage({ 'multimanager.profiles.pageSize': '0' });
    vi.stubGlobal('localStorage', corrupted);
    expect(createPageSizeStore('multimanager.profiles.pageSize').get()).toBe(50);
  });

  it('использует отдельные ключи для профилей и прокси', () => {
    const profiles = createPageSizeStore('multimanager.profiles.pageSize');
    const proxies = createPageSizeStore('multimanager.proxies.pageSize');
    profiles.set(10);
    expect(proxies.get()).toBe(50);
    proxies.set(100);
    expect(profiles.get()).toBe(10);
    expect(storage.setItem).toHaveBeenCalledWith('multimanager.profiles.pageSize', '10');
    expect(storage.setItem).toHaveBeenCalledWith('multimanager.proxies.pageSize', '100');
  });

  it('возвращает 50 при исключении localStorage при чтении', () => {
    storage.getItem.mockImplementation(() => { throw new Error('denied'); });
    expect(createPageSizeStore('multimanager.profiles.pageSize').get()).toBe(50);
  });

  it('не бросает исключение при ошибке записи localStorage', () => {
    storage.setItem.mockImplementation(() => { throw new Error('quota exceeded'); });
    const store = createPageSizeStore('multimanager.profiles.pageSize');
    expect(() => store.set(20)).not.toThrow();
  });
});
