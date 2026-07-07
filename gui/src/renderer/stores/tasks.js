import { defineStore } from 'pinia';
import { ref } from 'vue';
import client from '../api/client.js';

export const useTasksStore = defineStore('tasks', () => {
  const tasks = ref([]);
  const loading = ref(false);

  async function fetchAll() {
    loading.value = true;
    try {
      const { data } = await client.get('/api/tasks');
      tasks.value = data;
    } finally {
      loading.value = false;
    }
  }

  async function create(task) {
    const { data } = await client.post('/api/tasks', task);
    tasks.value.push(data);
    return data;
  }

  async function update(id, updates) {
    const { data } = await client.put(`/api/tasks/${id}`, updates);
    const idx = tasks.value.findIndex(t => t.id === id);
    if (idx !== -1) tasks.value[idx] = data;
    return data;
  }

  async function remove(id) {
    await client.delete(`/api/tasks/${id}`);
    tasks.value = tasks.value.filter(t => t.id !== id);
  }

  async function run(id) {
    const { data } = await client.post(`/api/tasks/${id}/run`);
    return data;
  }

  async function getExecutions(id) {
    const { data } = await client.get(`/api/tasks/${id}/executions`);
    return data;
  }

  return { tasks, loading, fetchAll, create, update, remove, run, getExecutions };
});
