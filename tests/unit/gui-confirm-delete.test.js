import { describe, it, expect } from 'vitest';

/**
 * Логика массового удаления профилей (из Profiles.vue).
 *
 * Требования TASK:
 * - профиль удаляем только при status === 'stopped';
 * - запущенные профили исключаются до открытия подтверждения и не получают DELETE-запросов;
 * - если все выбранные профили запущены, удаляемых нет — DELETE не выполняется;
 * - результат массового удаления: deleted + skipped (running + failed).
 */

function splitProfilesForDelete(selectedProfiles) {
  const running = selectedProfiles.filter(p => p.status !== 'stopped');
  const deletable = selectedProfiles.filter(p => p.status === 'stopped');
  return { running, deletable };
}

function computeBulkResult({ deleted, runningCount, failed }) {
  return { deleted, skipped: runningCount + failed };
}

const stopped = (id, name) => ({ id, name, status: 'stopped' });
const running = (id, name) => ({ id, name, status: 'running' });
const starting = (id, name) => ({ id, name, status: 'starting' });

describe('bulk profile delete split', () => {
  it('разделяет выбранные профили на запущенные и удаляемые', () => {
    const selected = [
      stopped('p1', 'auto_001'),
      running('p2', 'auto_002'),
      stopped('p3', 'auto_003'),
    ];
    const { running: r, deletable } = splitProfilesForDelete(selected);
    expect(r.map(p => p.id)).toEqual(['p2']);
    expect(deletable.map(p => p.id)).toEqual(['p1', 'p3']);
  });

  it('считает профиль удаляемым только при status === "stopped"', () => {
    const selected = [
      stopped('p1', 'auto_001'),
      running('p2', 'auto_002'),
      starting('p3', 'auto_003'),
    ];
    const { deletable } = splitProfilesForDelete(selected);
    expect(deletable.map(p => p.id)).toEqual(['p1']);
  });

  it('если все выбранные профили запущены, удаляемых нет', () => {
    const selected = [
      running('p1', 'auto_001'),
      starting('p2', 'auto_002'),
    ];
    const { running: r, deletable } = splitProfilesForDelete(selected);
    expect(deletable.length).toBe(0);
    expect(r.length).toBe(2);
  });

  it('пустой выбор не даёт ни запущенных, ни удаляемых', () => {
    const { running: r, deletable } = splitProfilesForDelete([]);
    expect(r.length).toBe(0);
    expect(deletable.length).toBe(0);
  });

  it('статус starting не является удаляемым (не stopped)', () => {
    const { deletable } = splitProfilesForDelete([starting('p1', 'auto_001')]);
    expect(deletable.length).toBe(0);
  });
});

describe('bulk profile delete result', () => {
  it('пропущенные = запущенные + неудавшиеся', () => {
    const result = computeBulkResult({ deleted: 2, runningCount: 1, failed: 1 });
    expect(result).toEqual({ deleted: 2, skipped: 2 });
  });

  it('нет пропущенных, когда всё удалилось', () => {
    const result = computeBulkResult({ deleted: 3, runningCount: 0, failed: 0 });
    expect(result).toEqual({ deleted: 3, skipped: 0 });
  });

  it('все выбранные запущены -> deleted 0 и skipped = числу выбранных', () => {
    const selected = [
      running('p1', 'auto_001'),
      running('p2', 'auto_002'),
    ];
    const { deletable } = splitProfilesForDelete(selected);
    expect(deletable.length).toBe(0);
    const result = computeBulkResult({ deleted: 0, runningCount: selected.length, failed: 0 });
    expect(result).toEqual({ deleted: 0, skipped: 2 });
  });
});
