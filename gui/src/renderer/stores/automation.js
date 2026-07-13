import { defineStore } from 'pinia';
import { ref } from 'vue';
import client from '../api/client.js';

export const useAutomationStore = defineStore('automation', () => {
  const matrix = ref([]);
  const projects = ref([]);
  const profiles = ref([]);
  const runs = ref([]);
  const currentRun = ref(null);
  const loading = ref(false);
  const error = ref(null);

  async function fetchMatrix() {
    loading.value = true;
    error.value = null;
    try {
      const { data } = await client.get('/api/matrix');
      projects.value = data.projects || [];
      profiles.value = data.profiles || [];
      matrix.value = data.matrix || [];
    } catch (err) {
      console.error('[Automation] fetchMatrix failed:', err.message || err);
      error.value = err.message || 'Unknown error';
      projects.value = [];
      profiles.value = [];
      matrix.value = [];
    } finally {
      loading.value = false;
    }
  }

  async function updateMatrix(entries) {
    const { data } = await client.put('/api/matrix', { entries });
    return data;
  }

  async function createRun(data) {
    const res = await client.post('/api/runs', data);
    return res.data;
  }

  async function fetchRuns(page = 1, limit = 20) {
    loading.value = true;
    try {
      const { data } = await client.get('/api/runs', { params: { page, limit } });
      if (page === 1) {
        runs.value = data.items || [];
      } else {
        runs.value.push(...(data.items || []));
      }
      return data;
    } catch (err) {
      console.error('[Automation] fetchRuns failed:', err.message || err);
      if (page === 1) runs.value = [];
      return { items: [], total: 0, page };
    } finally {
      loading.value = false;
    }
  }

  async function fetchRun(id) {
    const { data } = await client.get(`/api/runs/${id}`);
    currentRun.value = data;
    return data;
  }

  async function startRun(id) {
    const { data } = await client.post(`/api/runs/${id}/start`);
    return data;
  }

  async function cancelRun(id) {
    const { data } = await client.post(`/api/runs/${id}/cancel`);
    return data;
  }

  async function fetchProjects() {
    try {
      const { data } = await client.get('/api/projects');
      return data;
    } catch (err) {
      console.error('[Automation] fetchProjects failed:', err.message || err);
      return [];
    }
  }

  async function syncProjects() {
    const { data } = await client.post('/api/projects/sync');
    return data;
  }

  return {
    matrix, projects, profiles, runs, currentRun, loading, error,
    fetchMatrix, updateMatrix, createRun, fetchRuns, fetchRun,
    startRun, cancelRun, fetchProjects, syncProjects,
  };
});
