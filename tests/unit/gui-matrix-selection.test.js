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
 * 3. allowed_profile_ids === [] (пустой массив) —truthy в JS,
 *    поэтому `|| fallback` не срабатывал. Кнопка не активировалась
 *    для проектов без привязки к аккаунтам.
 *    Фикс: замена `||` на `?.length ? ... : fallback`.
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
  const activeProjectNames = new Set(activeProjects.map(p => p.name));

  for (const key in selectedCells) {
    if (!selectedCells[key]) continue;
    const [profileId, projectName] = key.split('::');
    if (!activeProjectNames.has(projectName)) continue;
    const proj = activeProjects.find(p => p.name === projectName);
    const allowedIds = proj?.allowed_profile_ids?.length ? proj.allowed_profile_ids : profiles.map(p => p.id);
    if (!allowedIds.includes(profileId)) continue;
    count++;
  }

  for (const entry of matrix) {
    if (!entry.is_enabled) continue;
    if (!activeProjectNames.has(entry.project_name)) continue;
    const key = getCellKey(entry.profile_id, entry.project_name);
    if (key in selectedCells) continue;
    const proj = activeProjects.find(p => p.name === entry.project_name);
    const allowedIds = proj?.allowed_profile_ids?.length ? proj.allowed_profile_ids : profiles.map(p => p.id);
    if (!allowedIds.includes(entry.profile_id)) continue;
    count++;
  }

  return count;
}

function getEnabledEntries(projects, profiles, selectedCells, matrix) {
  const entries = [];
  const activeProjects = projects.filter(p => p.is_active);
  for (const proj of activeProjects) {
    const allowedIds = proj.allowed_profile_ids?.length ? proj.allowed_profile_ids : profiles.map(p => p.id);
    for (const prof of profiles) {
      if (!allowedIds.includes(prof.id)) continue;
      const key = getCellKey(prof.id, proj.name);
      const enabled = selectedCells[key] !== undefined
        ? selectedCells[key]
        : (matrix.find(m => m.profile_id === prof.id && m.project_name === proj.name)?.is_enabled || false);
      entries.push({ project_name: proj.name, profile_id: prof.id, is_enabled: enabled ? 1 : 0 });
    }
  }
  return entries;
}

// Чистая логика Shift-диапазона, извлечённая из AutomationMatrix.vue для unit-тестов
function handleCellClickPure(state, event, profileId, projectName) {
  const activeProjects = state.projects.filter(p => p.is_active);
  const activeProjectNames = activeProjects.map(p => p.name);
  const targetProj = activeProjects.find(p => p.name === projectName);
  const targetAllowedIds = targetProj?.allowed_profile_ids?.length
    ? targetProj.allowed_profile_ids
    : state.profiles.map(p => p.id);
  if (!targetAllowedIds.includes(profileId)) return;

  const key = getCellKey(profileId, projectName);

  if (!event.shiftKey || !state.lastSelectedKey) {
    state.selectedCells[key] = !isChecked(profileId, projectName, state.selectedCells, state.matrix);
    state.lastSelectedKey = key;
    return;
  }

  const [anchorProfileId, anchorProjectName] = state.lastSelectedKey.split('::');
  const anchorProfileExists = state.filteredProfiles.some(p => p.id === anchorProfileId);
  const anchorProjectExists = activeProjectNames.includes(anchorProjectName);
  const targetProfileExists = state.filteredProfiles.some(p => p.id === profileId);
  const targetProjectExists = activeProjectNames.includes(projectName);

  if (!anchorProfileExists || !anchorProjectExists || !targetProfileExists || !targetProjectExists) {
    state.selectedCells[key] = !isChecked(profileId, projectName, state.selectedCells, state.matrix);
    state.lastSelectedKey = key;
    return;
  }

  const rowIds = state.filteredProfiles.map(p => p.id);
  const anchorRowIdx = rowIds.indexOf(anchorProfileId);
  const targetRowIdx = rowIds.indexOf(profileId);
  const anchorColIdx = activeProjectNames.indexOf(anchorProjectName);
  const targetColIdx = activeProjectNames.indexOf(projectName);

  const rowStart = Math.min(anchorRowIdx, targetRowIdx);
  const rowEnd = Math.max(anchorRowIdx, targetRowIdx);
  const colStart = Math.min(anchorColIdx, targetColIdx);
  const colEnd = Math.max(anchorColIdx, targetColIdx);

  const anchorEnabled = isChecked(anchorProfileId, anchorProjectName, state.selectedCells, state.matrix);

  for (let r = rowStart; r <= rowEnd; r++) {
    const pid = rowIds[r];
    for (let c = colStart; c <= colEnd; c++) {
      const pname = activeProjectNames[c];
      const proj = activeProjects.find(p => p.name === pname);
      const allowedIds = proj?.allowed_profile_ids?.length
        ? proj.allowed_profile_ids
        : state.profiles.map(p => p.id);
      if (!allowedIds.includes(pid)) continue;
      const cellKey = getCellKey(pid, pname);
      state.selectedCells[cellKey] = anchorEnabled;
    }
  }
}

function createRangeState({ projects: projList, profiles: profList, filteredProfiles, matrix = [], selectedCells = {}, lastSelectedKey = null }) {
  return {
    projects: projList,
    profiles: profList,
    filteredProfiles: filteredProfiles || profList,
    matrix: Array.isArray(matrix) ? matrix : [],
    selectedCells: { ...selectedCells },
    lastSelectedKey,
  };
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

    it('РЕГРЕССИЯ: пустой allowed_profile_ids [] не блокирует подсчёт', () => {
      // Баг: `[] || fallback` === `[]` (пустой массив truthy), fallback не срабатывал.
      // Фикс: `?.length ? ... : fallback`.
      const projWithEmptyAllowed = [
        { name: 'proj_a', display_name: 'A', is_active: true, allowed_profile_ids: [] },
        { name: 'proj_b', display_name: 'B', is_active: true, allowed_profile_ids: [] },
      ];
      const singleProfile = [{ id: 'p1', number: 1, name: 'auto_001' }];

      const cells = {
        [getCellKey('p1', 'proj_a')]: true,
        [getCellKey('p1', 'proj_b')]: true,
      };
      const count = getSelectedCount(projWithEmptyAllowed, singleProfile, cells, []);
      expect(count).toBe(2);
    });

    it('РЕГРЕССИЯ: undefined allowed_profile_ids не блокирует подсчёт', () => {
      const projWithUndefinedAllowed = [
        { name: 'proj_a', display_name: 'A', is_active: true },
        { name: 'proj_b', display_name: 'B', is_active: true },
      ];
      const singleProfile = [{ id: 'p1', number: 1, name: 'auto_001' }];

      const cells = {
        [getCellKey('p1', 'proj_a')]: true,
        [getCellKey('p1', 'proj_b')]: true,
      };
      const count = getSelectedCount(projWithUndefinedAllowed, singleProfile, cells, []);
      expect(count).toBe(2);
    });

    it('РЕГРЕССИЯ: пустой allowed_profile_ids [] не блокирует серверные ячейки', () => {
      const projWithEmptyAllowed = [
        { name: 'proj_a', display_name: 'A', is_active: true, allowed_profile_ids: [] },
      ];
      const matrix = [
        { project_name: 'proj_a', profile_id: 'p1', is_enabled: 1 },
      ];
      const count = getSelectedCount(projWithEmptyAllowed, profiles, {}, matrix);
      expect(count).toBe(1);
    });
  });

  describe('getEnabledEntries', () => {
    it('возвращает все записи с is_enabled: 0 при пустой матрице', () => {
      const entries = getEnabledEntries(projects, profiles, {}, []);
      // 2 активных проекта * 2 профиля = 4 записи, все is_enabled: 0
      expect(entries.length).toBe(4);
      expect(entries.every(e => e.is_enabled === 0)).toBe(true);
    });

    it('возвращает ячейки из store.matrix (баг-фикс: кнопка была disabled)', () => {
      const matrix = [
        { project_name: 'concrete', profile_id: 'p1', is_enabled: 1 },
        { project_name: 'allscale', profile_id: 'p2', is_enabled: 1 },
      ];
      const entries = getEnabledEntries(projects, profiles, {}, matrix);
      const enabled = entries.filter(e => e.is_enabled === 1);
      expect(enabled.length).toBe(2);
      expect(enabled).toContainEqual({ project_name: 'concrete', profile_id: 'p1', is_enabled: 1 });
      expect(enabled).toContainEqual({ project_name: 'allscale', profile_id: 'p2', is_enabled: 1 });
    });

    it('возвращает локально выбранные ячейки', () => {
      const selectedCells = {
        [getCellKey('p1', 'concrete')]: true,
      };
      const entries = getEnabledEntries(projects, profiles, selectedCells, []);
      const enabled = entries.filter(e => e.is_enabled === 1);
      expect(enabled.length).toBe(1);
      expect(enabled[0]).toEqual({ project_name: 'concrete', profile_id: 'p1', is_enabled: 1 });
    });

    it('локальное отключение перезаписывает store.matrix', () => {
      const matrix = [
        { project_name: 'concrete', profile_id: 'p1', is_enabled: 1 },
      ];
      const selectedCells = {
        [getCellKey('p1', 'concrete')]: false,
      };
      const entries = getEnabledEntries(projects, profiles, selectedCells, matrix);
      const enabled = entries.filter(e => e.is_enabled === 1);
      expect(enabled.length).toBe(0);
    });

    it('не включает ячейки неактивных проектов', () => {
      const matrix = [
        { project_name: 'disabled_proj', profile_id: 'p1', is_enabled: 1 },
      ];
      const entries = getEnabledEntries(projects, profiles, {}, matrix);
      expect(entries.some(e => e.project_name === 'disabled_proj')).toBe(false);
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
      const enabled = entries.filter(e => e.is_enabled === 1);
      expect(enabled.length).toBe(1);
      expect(enabled[0].profile_id).toBe('p2');
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
      expect(count).toBe(entries.filter(e => e.is_enabled).length);
    });

    it('РЕГРЕССИЯ: пустой allowed_profile_ids [] не блокирует создание entries', () => {
      const projWithEmptyAllowed = [
        { name: 'proj_a', display_name: 'A', is_active: true, allowed_profile_ids: [] },
        { name: 'proj_b', display_name: 'B', is_active: true, allowed_profile_ids: [] },
      ];
      const singleProfile = [{ id: 'p1', number: 1, name: 'auto_001' }];

      const cells = {
        [getCellKey('p1', 'proj_a')]: true,
        [getCellKey('p1', 'proj_b')]: true,
      };
      const entries = getEnabledEntries(projWithEmptyAllowed, singleProfile, cells, []);
      expect(entries.filter(e => e.is_enabled).length).toBe(2);
    });

    it('включает все ячейки когда allowed_profile_ids пуст', () => {
      const projWithEmptyAllowed = [
        { name: 'proj_a', display_name: 'A', is_active: true, allowed_profile_ids: [] },
      ];
      const entries = getEnabledEntries(projWithEmptyAllowed, profiles, {}, []);
      // Должны получить entries для ВСЕХ профилей (p1 и p2), все is_enabled: 0
      expect(entries.length).toBe(2);
      expect(entries[0]).toEqual({ project_name: 'proj_a', profile_id: 'p1', is_enabled: 0 });
      expect(entries[1]).toEqual({ project_name: 'proj_a', profile_id: 'p2', is_enabled: 0 });
    });
  });

  describe('shift range selection', () => {
    const rangeProjects = [
      { name: 'proj_a', display_name: 'A', is_active: true },
      { name: 'proj_b', display_name: 'B', is_active: true },
      { name: 'proj_c', display_name: 'C', is_active: true },
    ];
    const rangeProfiles = [
      { id: 'p1', number: 1, name: 'auto_001' },
      { id: 'p2', number: 2, name: 'auto_002' },
      { id: 'p3', number: 3, name: 'auto_003' },
    ];

    it('обычный клик переключает только одну ячейку', () => {
      const state = createRangeState({ projects: rangeProjects, profiles: rangeProfiles, filteredProfiles: rangeProfiles });
      handleCellClickPure(state, { shiftKey: false }, 'p1', 'proj_a');
      expect(state.selectedCells[getCellKey('p1', 'proj_a')]).toBe(true);
      expect(Object.keys(state.selectedCells).length).toBe(1);
      expect(state.lastSelectedKey).toBe(getCellKey('p1', 'proj_a'));
      // повторный клик снимает
      handleCellClickPure(state, { shiftKey: false }, 'p1', 'proj_a');
      expect(state.selectedCells[getCellKey('p1', 'proj_a')]).toBe(false);
    });

    it('Shift-click без anchor работает как одиночный клик', () => {
      const state = createRangeState({ projects: rangeProjects, profiles: rangeProfiles, filteredProfiles: rangeProfiles });
      handleCellClickPure(state, { shiftKey: true }, 'p2', 'proj_b');
      expect(state.selectedCells[getCellKey('p2', 'proj_b')]).toBe(true);
      expect(Object.keys(state.selectedCells).length).toBe(1);
      expect(state.lastSelectedKey).toBe(getCellKey('p2', 'proj_b'));
    });

    it('включает прямоугольный диапазон по строкам и столбцам, включая границы', () => {
      const state = createRangeState({ projects: rangeProjects, profiles: rangeProfiles, filteredProfiles: rangeProfiles });
      handleCellClickPure(state, { shiftKey: false }, 'p1', 'proj_a');
      handleCellClickPure(state, { shiftKey: true }, 'p2', 'proj_b');
      // диапазон 2x2 = 4 ячейки
      expect(state.selectedCells[getCellKey('p1', 'proj_a')]).toBe(true);
      expect(state.selectedCells[getCellKey('p1', 'proj_b')]).toBe(true);
      expect(state.selectedCells[getCellKey('p2', 'proj_a')]).toBe(true);
      expect(state.selectedCells[getCellKey('p2', 'proj_b')]).toBe(true);
      expect(Object.keys(state.selectedCells).filter(k => state.selectedCells[k]).length).toBe(4);
      // вне диапазона не затронуты
      expect(state.selectedCells[getCellKey('p3', 'proj_c')]).toBeUndefined();
    });

    it('включает 3x3 прямоугольник полностью', () => {
      const state = createRangeState({ projects: rangeProjects, profiles: rangeProfiles, filteredProfiles: rangeProfiles });
      handleCellClickPure(state, { shiftKey: false }, 'p1', 'proj_a');
      handleCellClickPure(state, { shiftKey: true }, 'p3', 'proj_c');
      for (const prof of rangeProfiles) {
        for (const proj of rangeProjects) {
          expect(state.selectedCells[getCellKey(prof.id, proj.name)]).toBe(true);
        }
      }
      expect(Object.keys(state.selectedCells).filter(k => state.selectedCells[k]).length).toBe(9);
    });

    it('уже включённые ячейки остаются включёнными', () => {
      const state = createRangeState({
        projects: rangeProjects,
        profiles: rangeProfiles,
        filteredProfiles: rangeProfiles,
        selectedCells: { [getCellKey('p1', 'proj_a')]: true, [getCellKey('p1', 'proj_b')]: true },
        lastSelectedKey: getCellKey('p1', 'proj_a'),
      });
      // anchor p1/proj_a включен — shift должен включить диапазон и не снимать
      state.lastSelectedKey = getCellKey('p1', 'proj_a');
      handleCellClickPure(state, { shiftKey: true }, 'p2', 'proj_b');
      expect(state.selectedCells[getCellKey('p1', 'proj_a')]).toBe(true);
      expect(state.selectedCells[getCellKey('p1', 'proj_b')]).toBe(true);
      expect(state.selectedCells[getCellKey('p2', 'proj_a')]).toBe(true);
      expect(state.selectedCells[getCellKey('p2', 'proj_b')]).toBe(true);
    });

    it('не включает ячейки вне allowed_profile_ids', () => {
      const restrictedProjects = [
        { name: 'proj_a', display_name: 'A', is_active: true, allowed_profile_ids: ['p1'] },
        { name: 'proj_b', display_name: 'B', is_active: true, allowed_profile_ids: ['p1', 'p2', 'p3'] },
        { name: 'proj_c', display_name: 'C', is_active: true, allowed_profile_ids: [] },
      ];
      const state = createRangeState({ projects: restrictedProjects, profiles: rangeProfiles, filteredProfiles: rangeProfiles });
      handleCellClickPure(state, { shiftKey: false }, 'p1', 'proj_a');
      handleCellClickPure(state, { shiftKey: true }, 'p2', 'proj_a');
      // proj_a разрешён только p1, поэтому p2/proj_a не должен включиться
      expect(state.selectedCells[getCellKey('p1', 'proj_a')]).toBe(true);
      expect(state.selectedCells[getCellKey('p2', 'proj_a')]).toBeUndefined();
      // но p2/proj_b разрешён — должен включиться если диапазон охватывает proj_b
      const state2 = createRangeState({ projects: restrictedProjects, profiles: rangeProfiles, filteredProfiles: rangeProfiles });
      handleCellClickPure(state2, { shiftKey: false }, 'p1', 'proj_a');
      handleCellClickPure(state2, { shiftKey: true }, 'p2', 'proj_b');
      expect(state2.selectedCells[getCellKey('p1', 'proj_a')]).toBe(true);
      expect(state2.selectedCells[getCellKey('p1', 'proj_b')]).toBe(true);
      expect(state2.selectedCells[getCellKey('p2', 'proj_a')]).toBeUndefined();
      expect(state2.selectedCells[getCellKey('p2', 'proj_b')]).toBe(true);
    });

    it('клик по недоступной ячейке не изменяет selectedCells и anchor', () => {
      const restrictedProjects = [
        { name: 'proj_a', display_name: 'A', is_active: true, allowed_profile_ids: ['p1'] },
        { name: 'proj_b', display_name: 'B', is_active: true },
      ];
      const state = createRangeState({ projects: restrictedProjects, profiles: rangeProfiles, filteredProfiles: rangeProfiles });
      handleCellClickPure(state, { shiftKey: false }, 'p2', 'proj_a');
      expect(state.selectedCells[getCellKey('p2', 'proj_a')]).toBeUndefined();
      expect(state.lastSelectedKey).toBeNull();
      // нормальная ячейка работает
      handleCellClickPure(state, { shiftKey: false }, 'p1', 'proj_a');
      expect(state.lastSelectedKey).toBe(getCellKey('p1', 'proj_a'));
      // shift по недоступной не должен менять диапазон
      handleCellClickPure(state, { shiftKey: true }, 'p2', 'proj_a');
      expect(state.selectedCells[getCellKey('p2', 'proj_a')]).toBeUndefined();
      expect(state.lastSelectedKey).toBe(getCellKey('p1', 'proj_a'));
    });

    it('диапазон при обратном направлении (от нижней/правой к верхней/левой)', () => {
      const state = createRangeState({ projects: rangeProjects, profiles: rangeProfiles, filteredProfiles: rangeProfiles });
      handleCellClickPure(state, { shiftKey: false }, 'p3', 'proj_c');
      handleCellClickPure(state, { shiftKey: true }, 'p1', 'proj_a');
      for (const prof of rangeProfiles) {
        for (const proj of rangeProjects) {
          expect(state.selectedCells[getCellKey(prof.id, proj.name)]).toBe(true);
        }
      }
      // обратный по одной оси: p2/proj_c -> p1/proj_a
      const state2 = createRangeState({ projects: rangeProjects, profiles: rangeProfiles, filteredProfiles: rangeProfiles });
      handleCellClickPure(state2, { shiftKey: false }, 'p2', 'proj_c');
      handleCellClickPure(state2, { shiftKey: true }, 'p1', 'proj_a');
      expect(state2.selectedCells[getCellKey('p1', 'proj_a')]).toBe(true);
      expect(state2.selectedCells[getCellKey('p1', 'proj_c')]).toBe(true);
      expect(state2.selectedCells[getCellKey('p2', 'proj_a')]).toBe(true);
      expect(state2.selectedCells[getCellKey('p2', 'proj_c')]).toBe(true);
      expect(state2.selectedCells[getCellKey('p3', 'proj_a')]).toBeUndefined();
    });

    it('Shift-click копирует включенное состояние anchor на диапазон', () => {
      const state = createRangeState({
        projects: rangeProjects,
        profiles: rangeProfiles,
        filteredProfiles: rangeProfiles,
        selectedCells: { [getCellKey('p1', 'proj_a')]: true },
      });
      state.lastSelectedKey = getCellKey('p1', 'proj_a');
      // уже включена, вторая тоже включена заранее
      state.selectedCells[getCellKey('p2', 'proj_b')] = true;
      handleCellClickPure(state, { shiftKey: true }, 'p2', 'proj_b');
      expect(state.selectedCells[getCellKey('p1', 'proj_a')]).toBe(true);
      expect(state.selectedCells[getCellKey('p1', 'proj_b')]).toBe(true);
      expect(state.selectedCells[getCellKey('p2', 'proj_a')]).toBe(true);
      expect(state.selectedCells[getCellKey('p2', 'proj_b')]).toBe(true);
    });

    it('Shift-click копирует выключенное состояние anchor — массовое снятие выделения', () => {
      // anchor выключен (после клика сняли), shift должен выключить диапазон
      const state = createRangeState({
        projects: rangeProjects,
        profiles: rangeProfiles,
        filteredProfiles: rangeProfiles,
        selectedCells: {
          [getCellKey('p1', 'proj_a')]: false,
          [getCellKey('p1', 'proj_b')]: true,
          [getCellKey('p2', 'proj_a')]: true,
          [getCellKey('p2', 'proj_b')]: true,
        },
      });
      state.lastSelectedKey = getCellKey('p1', 'proj_a');
      handleCellClickPure(state, { shiftKey: true }, 'p2', 'proj_b');
      expect(state.selectedCells[getCellKey('p1', 'proj_a')]).toBe(false);
      expect(state.selectedCells[getCellKey('p1', 'proj_b')]).toBe(false);
      expect(state.selectedCells[getCellKey('p2', 'proj_a')]).toBe(false);
      expect(state.selectedCells[getCellKey('p2', 'proj_b')]).toBe(false);
    });

    it('Shift-click после изменения поиска с невалидным anchor обрабатывается как одиночный', () => {
      const allProfiles = [
        { id: 'p1', number: 1, name: 'auto_001' },
        { id: 'p2', number: 2, name: 'auto_002' },
        { id: 'p3', number: 3, name: 'other' },
      ];
      const filtered = [
        { id: 'p1', number: 1, name: 'auto_001' },
        { id: 'p2', number: 2, name: 'auto_002' },
      ];
      const state = createRangeState({
        projects: rangeProjects,
        profiles: allProfiles,
        filteredProfiles: allProfiles,
        selectedCells: {},
        lastSelectedKey: getCellKey('p3', 'proj_a'),
      });
      // меняем отображение — p3 скрыт
      state.filteredProfiles = filtered;
      handleCellClickPure(state, { shiftKey: true }, 'p2', 'proj_b');
      // должен сработать как одиночный клик на p2/proj_b
      expect(state.selectedCells[getCellKey('p2', 'proj_b')]).toBe(true);
      expect(Object.keys(state.selectedCells).filter(k => state.selectedCells[k]).length).toBe(1);
      expect(state.lastSelectedKey).toBe(getCellKey('p2', 'proj_b'));
      // скрытая строка не используется
      expect(state.selectedCells[getCellKey('p3', 'proj_a')]).toBeUndefined();
    });

    it('диапазон учитывает filteredProfiles порядок и поиск', () => {
      const searchFiltered = [
        { id: 'p2', number: 2, name: 'auto_002' },
        { id: 'p3', number: 3, name: 'auto_003' },
      ];
      const state = createRangeState({
        projects: rangeProjects,
        profiles: rangeProfiles,
        filteredProfiles: searchFiltered,
      });
      handleCellClickPure(state, { shiftKey: false }, 'p2', 'proj_a');
      handleCellClickPure(state, { shiftKey: true }, 'p3', 'proj_c');
      // должны включиться только видимые строки p2,p3
      expect(state.selectedCells[getCellKey('p2', 'proj_a')]).toBe(true);
      expect(state.selectedCells[getCellKey('p3', 'proj_c')]).toBe(true);
      expect(state.selectedCells[getCellKey('p1', 'proj_a')]).toBeUndefined();
    });

    it('не бросает исключение при пустых проектах или профилях', () => {
      const emptyState = createRangeState({ projects: [], profiles: [], filteredProfiles: [] });
      expect(() => handleCellClickPure(emptyState, { shiftKey: true }, 'p1', 'proj_a')).not.toThrow();
      expect(() => handleCellClickPure(emptyState, { shiftKey: false }, 'p1', 'proj_a')).not.toThrow();
    });
  });
});
