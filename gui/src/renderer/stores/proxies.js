import { defineStore } from 'pinia';
import { ref } from 'vue';
import client from '../api/client.js';

export const useProxiesStore = defineStore('proxies', () => {
  const proxies = ref([]);
  const loading = ref(false);

  async function fetchAll() {
    loading.value = true;
    try {
      const { data } = await client.get('/api/proxies');
      proxies.value = data;
    } catch {
      proxies.value = [];
    } finally {
      loading.value = false;
    }
  }

  async function create(proxy) {
    const { data } = await client.post('/api/proxies', proxy);
    proxies.value.push(data);
    return data;
  }

  async function importBulk(text) {
    const { data } = await client.post('/api/proxies/import', { text });
    proxies.value.push(...data.proxies);
    return data;
  }

  async function update(id, updates) {
    const { data } = await client.put(`/api/proxies/${id}`, updates);
    const idx = proxies.value.findIndex(p => p.id === id);
    if (idx !== -1) proxies.value[idx] = data;
    return data;
  }

  async function remove(id) {
    await client.delete(`/api/proxies/${id}`);
    proxies.value = proxies.value.filter(p => p.id !== id);
  }

  async function check(id) {
    const { data } = await client.post(`/api/proxies/${id}/check`);
    return data;
  }

  return { proxies, loading, fetchAll, create, importBulk, update, remove, check };
});
