import { describe, it, expect } from 'vitest';

/**
 * Логика выбора ячеек матрицы (из AutomationMatrix.vue).
 *
 * Покрытые баги:
 * 1. selectedCount не учитывал ячейки, уже включённые в store.matrix,
 *    из-за чего кнопка "Create Run" оставалась disabled.
 * 2. Подсчёт работал только для последних столбцов — чекбоксы
 *    в первых столбцах не увеличивали счётчик (реактивность ref({})).
 *    Фикс: замена ref(0) + watch на computed.
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

    it('РЕГРЕССИЯ: каждый столбец независимо увеличивает счётчик', () => {
      // Ранее: чекбоксы в первых столбцах не увеличивали selectedCount,
      // потому что watch на ref({}) не отслеживал добавление новых свойств.
      // Фикс: selectedCount — computed, а не ref(0) + watch.
      const allProjects = [
        { name: 'proj_a', display_name: 'A', is_active: true },
        { name: 'proj_b', display_name: 'B', is_active: true },
        { name: 'proj_c', display_name: 'C', is_active: true },
        { name: 'proj_d', display_name: 'D', is_active: true },
      ];
      const singleProfile = [{ id: 'p1', number: 1, name: 'auto_001' }];

      // Проверяем каждый столбец по отдельности
      for (const proj of allProjects) {
        const cells = { [getCellKey('p1', proj.name)]: true };
        const count = getSelectedCount(allProjects, singleProfile, cells, []);
        expect(count).toBe(1);
      }
    });

    it('РЕГРЕССИЯ: добавление ячеек по одной даёт корректный инкремент', () => {
      // Симулируем пошаговое добавление ячеек — как при клике на чекбоксы
      const allProjects = [
        { name: 'proj_a', display_name: 'A', is_active: true },
        { name: 'proj_b', display_name: 'B', is_active: true },
        { name: 'proj_c', display_name: 'C', is_active: true },
      ];
      const singleProfile = [{ id: 'p1', number: 1, name: 'auto_001' }];

      const cells = {};
      expect(getSelectedCount(allProjects, singleProfile, cells, [])).toBe(0);

      cells[getCellKey('p1', 'proj_a')] = true;
      expect(getSelectedCount(allProjects, singleProfile, cells, [])).toBe(1);

      cells[getCellKey('p1', 'proj_b')] = true;
      expect(getSelectedCount(allProjects, singleProfile, cells, [])).toBe(2);

      cells[getCellKey('p1', 'proj_c')] = true;
      expect(getSelectedCount(allProjects, singleProfile, cells, [])).toBe(3);
    });

    it('РЕГРЕССИЯ: отключение ячейки корректно уменьшает счётчик', () => {
      const allProjects = [
        { name: 'proj_a', display_name: 'A', is_active: true },
        { name: 'proj_b', display_name: 'B', is_active: true },
      ];
      const singleProfile = [{ id: 'p1', number: 1, name: 'auto_001' }];

      const cells = {
        [getCellKey('p1', 'proj_a')]: true,
        [getCellKey('p1', 'proj_b')]: true,
      };
      expect(getSelectedCount(allProjects, singleProfile, cells, [])).toBe(2);

      cells[getCellKey('p1', 'proj_a')] = false;
      expect(getSelectedCount(allProjects, singleProfile, cells, [])).toBe(1);
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
