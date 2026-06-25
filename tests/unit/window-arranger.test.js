import { describe, it, expect, vi } from 'vitest';

vi.mock('../../src/db/index.js', () => ({
  getDatabase: vi.fn(() => ({})),
  createProfileQueries: vi.fn(() => ({
    getAll: vi.fn(() => []),
  })),
}));

describe('Window Arranger', () => {
  it('router содержит все роуты', async () => {
    const mod = await import('../../src/api/window-arranger.js');
    expect(mod.default).toBeDefined();
    const paths = mod.default.stack
      .filter(r => r.route)
      .map(r => r.route.path);
    expect(paths).toContain('/windows');
    expect(paths).toContain('/grid');
    expect(paths).toContain('/cascade');
    expect(paths).toContain('/focus/:windowId');
    expect(paths).toContain('/windows/grouped');
    expect(paths).toContain('/grid/grouped');
    expect(paths).toContain('/cascade/grouped');
  });
});
