import { describe, it, expect } from 'vitest';

/**
 * Логика выбора ячеек матрицы (из AutomationMatrix.vue).
 * Тестируем отдельно от компонента, чтобы покрыть баг:
 * selectedCount не учитывал ячейки, уже включённые в store.matrix,
 * из-за чего кнопка "Create Run" оставалась disabled.
 */

function getCellKey(profileId, projectName) {
  return `${profileId}::${projectName}`;
}

function isChecked(profileId, projectName, selectedCells, matrix) {
  const key = getCellKey(profileId, projectName);
  if (selectedCells[key] !== undefined) return selectedCells[key];
  const entry = matrix.find(
    m => m.profile_id === profileId && m.project_name === projectName
  );
  return entry ? Boolean(entry.is_enabled) : false;
}

function getSelectedCount(projects, profiles, selectedCells, matrix) {
  let count = 0;
  const activeProjects = projects.filter(p => p.is_active);
  for (const proj of activeProjects) {
    const allowedIds = proj.allowed_profile_ids || profiles.map(p => p.id);
    for (const prof of profiles) {
      if (!allowedIds.includes(prof.id)) continue;
      if (isChecked(prof.id, proj.name, selectedCells, matrix)) count++;
    }
  }
  return count;
}

function getEnabledEntries(projects, profiles, selectedCells, matrix) {
  const entries = [];
  const activeProjects = projects.filter(p => p.is_active);
  for (const proj of activeProjects) {
    const allowedIds = proj.allowed_profile_ids || profiles.map(p => p.id);
    for (const prof of profiles) {
      if (!allowedIds.includes(prof.id)) continue;
      const key = getCellKey(prof.id, proj.name);
      const enabled = selectedCells[key] !== undefined
        ? selectedCells[key]
        : (matrix.find(m => m.profile_id === prof.id && m.project_name === proj.name)?.is_enabled || false);
      if (enabled) {
        entries.push({ project_name: proj.name, profile_id: prof.id, is_enabled: 1 });
      }
    }
  }
  return entries;
}

// Фикстуры
const projects = [
  { name: 'concrete', display_name: 'Concrete', is_active: true },
  { name: 'allscale', display_name: 'Allscale', is_active: true },
  { name: 'disabled_proj', display_name: 'Disabled', is_active: false },
];

const profiles = [
  { id: 'p1', number: 1, name: 'auto_001' },
  { id: 'p2', number: 2, name: 'auto_002' },
];

describe('matrix selection logic', () => {
  describe('selectedCount', () => {
    it('считает 0 при пустой матрице и без локальных переключений', () => {
      const count = getSelectedCount(projects, profiles, {}, []);
      expect(count).toBe(0);
    });

    it('считает ячейки, уже включённые в store.matrix (баг-фикс)', () => {
      const matrix = [
        { project_name: 'concrete', profile_id: 'p1', is_enabled: 1 },
        { project_name: 'allscale', profile_id: 'p2', is_enabled: 1 },
      ];
      const count = getSelectedCount(projects, profiles, {}, matrix);
      expect(count).toBe(2);
    });

    it('считает локально переключённые ячейки', () => {
      const selectedCells = {
        [getCellKey('p1', 'concrete')]: true,
        [getCellKey('p2', 'allscale')]: true,
      };
      const count = getSelectedCount(projects, profiles, selectedCells, []);
      expect(count).toBe(2);
    });

    it('приоритет локального переключения над store.matrix', () => {
      const matrix = [
        { project_name: 'concrete', profile_id: 'p1', is_enabled: 1 },
      ];
      const selectedCells = {
        [getCellKey('p1', 'concrete')]: false, // пользователь снял галочку
      };
      const count = getSelectedCount(projects, profiles, selectedCells, matrix);
      expect(count).toBe(0);
    });

    it('не считает ячейки неактивных проектов', () => {
      const matrix = [
        { project_name: 'disabled_proj', profile_id: 'p1', is_enabled: 1 },
      ];
      const count = getSelectedCount(projects, profiles, {}, matrix);
      expect(count).toBe(0);
    });

    it('не считает ячейки для профилей вне allowed_profile_ids', () => {
      const restrictedProjects = [
        { name: 'concrete', display_name: 'Concrete', is_active: true, allowed_profile_ids: ['p2'] },
      ];
      const matrix = [
        { project_name: 'concrete', profile_id: 'p1', is_enabled: 1 },
        { project_name: 'concrete', profile_id: 'p2', is_enabled: 1 },
      ];
      const count = getSelectedCount(restrictedProjects, profiles, {}, matrix);
      expect(count).toBe(1); // только p2
    });

    it('смесь локальных и серверных ячеек', () => {
      const matrix = [
        { project_name: 'concrete', profile_id: 'p1', is_enabled: 1 },
      ];
      const selectedCells = {
        [getCellKey('p2', 'allscale')]: true,
      };
      const count = getSelectedCount(projects, profiles, selectedCells, matrix);
      expect(count).toBe(2);
    });
  });

  describe('getEnabledEntries', () => {
    it('возвращает пустой массив при пустой матрице', () => {
      const entries = getEnabledEntries(projects, profiles, {}, []);
      expect(entries).toEqual([]);
    });

    it('возвращает ячейки из store.matrix (баг-фикс: кнопка была disabled)', () => {
      const matrix = [
        { project_name: 'concrete', profile_id: 'p1', is_enabled: 1 },
        { project_name: 'allscale', profile_id: 'p2', is_enabled: 1 },
      ];
      const entries = getEnabledEntries(projects, profiles, {}, matrix);
      expect(entries.length).toBe(2);
      expect(entries).toContainEqual({ project_name: 'concrete', profile_id: 'p1', is_enabled: 1 });
      expect(entries).toContainEqual({ project_name: 'allscale', profile_id: 'p2', is_enabled: 1 });
    });

    it('возвращает локально выбранные ячейки', () => {
      const selectedCells = {
        [getCellKey('p1', 'concrete')]: true,
      };
      const entries = getEnabledEntries(projects, profiles, selectedCells, []);
      expect(entries.length).toBe(1);
      expect(entries[0]).toEqual({ project_name: 'concrete', profile_id: 'p1', is_enabled: 1 });
    });

    it('локальное отключение перезаписывает store.matrix', () => {
      const matrix = [
        { project_name: 'concrete', profile_id: 'p1', is_enabled: 1 },
      ];
      const selectedCells = {
        [getCellKey('p1', 'concrete')]: false,
      };
      const entries = getEnabledEntries(projects, profiles, selectedCells, matrix);
      expect(entries.length).toBe(0);
    });

    it('не включает ячейки неактивных проектов', () => {
      const matrix = [
        { project_name: 'disabled_proj', profile_id: 'p1', is_enabled: 1 },
      ];
      const entries = getEnabledEntries(projects, profiles, {}, matrix);
      expect(entries.length).toBe(0);
    });

    it('не включает ячейки для профилей вне allowed_profile_ids', () => {
      const restrictedProjects = [
        { name: 'concrete', display_name: 'Concrete', is_active: true, allowed_profile_ids: ['p2'] },
      ];
      const matrix = [
        { project_name: 'concrete', profile_id: 'p1', is_enabled: 1 },
        { project_name: 'concrete', profile_id: 'p2', is_enabled: 1 },
      ];
      const entries = getEnabledEntries(restrictedProjects, profiles, {}, matrix);
      expect(entries.length).toBe(1);
      expect(entries[0].profile_id).toBe('p2');
    });

    it('selectedCount и getEnabledEntries согласованы', () => {
      const matrix = [
        { project_name: 'concrete', profile_id: 'p1', is_enabled: 1 },
      ];
      const selectedCells = {
        [getCellKey('p2', 'allscale')]: true,
      };
      const count = getSelectedCount(projects, profiles, selectedCells, matrix);
      const entries = getEnabledEntries(projects, profiles, selectedCells, matrix);
      expect(count).toBe(entries.length);
    });
  });
});
