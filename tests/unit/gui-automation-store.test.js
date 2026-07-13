import { describe, it, expect, vi, beforeEach } from 'vitest';
import { setActivePinia, createPinia } from 'pinia';

vi.mock('../../gui/src/renderer/api/client.js', () => ({
  default: {
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
  },
}));

import client from '../../gui/src/renderer/api/client.js';
import { useAutomationStore } from '../../gui/src/renderer/stores/automation.js';

function mockMatrixResponse() {
  client.get.mockResolvedValue({
    data: {
      projects: [{ name: 'concrete', display_name: 'Concrete' }],
      profiles: [{ id: 'p1', number: 1, name: 'auto_001' }],
      matrix: [{ project_name: 'concrete', profile_id: 'p1', is_enabled: 1 }],
    },
  });
}

describe('automation store', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.clearAllMocks();
  });

  it('fetchMatrix загружает проекты, профили, матрицу', async () => {
    mockMatrixResponse();
    const store = useAutomationStore();
    await store.fetchMatrix();
    expect(store.projects.length).toBe(1);
    expect(store.profiles.length).toBe(1);
    expect(store.matrix.length).toBe(1);
  });

  it('fetchMatrix обрабатывает ошибку и очищает данные', async () => {
    client.get.mockRejectedValue(new Error('Network error'));
    const store = useAutomationStore();
    store.projects = [{ name: 'old' }];
    await store.fetchMatrix();
    expect(store.projects.length).toBe(0);
    expect(store.profiles.length).toBe(0);
    expect(store.matrix.length).toBe(0);
  });

  it('createRun отправляет POST /api/runs', async () => {
    client.post.mockResolvedValue({
      data: { run_id: 'run-001', tasks_created: 3 },
    });
    const store = useAutomationStore();
    const result = await store.createRun({ name: 'Test', parallel_limit: 2 });
    expect(result.run_id).toBe('run-001');
    expect(client.post).toHaveBeenCalledWith('/api/runs', { name: 'Test', parallel_limit: 2 });
  });

  it('startRun отправляет POST /api/runs/:id/start', async () => {
    client.post.mockResolvedValue({ data: { status: 'started' } });
    const store = useAutomationStore();
    await store.startRun('run-001');
    expect(client.post).toHaveBeenCalledWith('/api/runs/run-001/start');
  });

  it('cancelRun отправляет POST /api/runs/:id/cancel', async () => {
    client.post.mockResolvedValue({ data: { status: 'cancelled' } });
    const store = useAutomationStore();
    await store.cancelRun('run-001');
    expect(client.post).toHaveBeenCalledWith('/api/runs/run-001/cancel');
  });

  it('fetchRun получает run по ID', async () => {
    client.get.mockResolvedValue({
      data: { id: 'run-001', name: 'Test', tasks: [] },
    });
    const store = useAutomationStore();
    const data = await store.fetchRun('run-001');
    expect(data.id).toBe('run-001');
    expect(store.currentRun?.id).toBe('run-001');
  });

  it('fetchRuns получает пагинированный список', async () => {
    client.get.mockResolvedValue({
      data: { items: [{ id: 'run-001' }, { id: 'run-002' }], total: 2, page: 1 },
    });
    const store = useAutomationStore();
    const result = await store.fetchRuns(1, 20);
    expect(result.items.length).toBe(2);
    expect(store.runs.length).toBe(2);
  });

  it('fetchRuns добавляет к существующему списку при page > 1', async () => {
    client.get.mockResolvedValue({
      data: { items: [{ id: 'run-003' }], total: 3, page: 2 },
    });
    const store = useAutomationStore();
    store.runs = [{ id: 'run-001' }, { id: 'run-002' }];
    await store.fetchRuns(2, 20);
    expect(store.runs.length).toBe(3);
  });

  it('fetchRuns обрабатывает ошибку', async () => {
    client.get.mockRejectedValue(new Error('Network error'));
    const store = useAutomationStore();
    const result = await store.fetchRuns(1, 20);
    expect(result.items).toEqual([]);
    expect(result.total).toBe(0);
  });

  it('updateMatrix отправляет PUT /api/matrix', async () => {
    client.put.mockResolvedValue({ data: { ok: true } });
    const store = useAutomationStore();
    const entries = [{ project_name: 'concrete', profile_id: 'p1', is_enabled: 1 }];
    await store.updateMatrix(entries);
    expect(client.put).toHaveBeenCalledWith('/api/matrix', { entries });
  });

  it('syncProjects отправляет POST /api/projects/sync', async () => {
    client.post.mockResolvedValue({ data: { added: 2, deactivated: 0 } });
    const store = useAutomationStore();
    const result = await store.syncProjects();
    expect(client.post).toHaveBeenCalledWith('/api/projects/sync');
    expect(result.added).toBe(2);
  });

  it('fetchProjects получает список проектов', async () => {
    client.get.mockResolvedValue({ data: [{ name: 'concrete' }, { name: 'allscale' }] });
    const store = useAutomationStore();
    const result = await store.fetchProjects();
    expect(result.length).toBe(2);
  });

  it('fetchProjects обрабатывает ошибку', async () => {
    client.get.mockRejectedValue(new Error('Network error'));
    const store = useAutomationStore();
    const result = await store.fetchProjects();
    expect(result).toEqual([]);
  });
});
