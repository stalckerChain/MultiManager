import { defineStore } from 'pinia';
import { ref } from 'vue';
import client from '../api/client.js';

export const useProfilesStore = defineStore('profiles', () => {
  const profiles = ref([]);
  const loading = ref(false);

  async function fetchAll() {
    loading.value = true;
    try {
      const { data } = await client.get('/api/profiles');
      profiles.value = data;
    } catch (err) {
      profiles.value = [];
      console.error('[Profiles] fetchAll failed:', err.message || err);
    } finally {
      loading.value = false;
    }
  }

  async function create(profile) {
    const { data } = await client.post('/api/profiles', profile);
    profiles.value.push(data);
    return data;
  }

  async function update(id, updates) {
    const { data } = await client.put(`/api/profiles/${id}`, updates);
    const idx = profiles.value.findIndex(p => p.id === id);
    if (idx !== -1) profiles.value[idx] = data;
    return data;
  }

  async function remove(id) {
    await client.delete(`/api/profiles/${id}`);
    profiles.value = profiles.value.filter(p => p.id !== id);
  }

  async function regenerate(id) {
    const { data } = await client.post(`/api/profiles/${id}/regenerate`);
    const idx = profiles.value.findIndex(p => p.id === id);
    if (idx !== -1) profiles.value[idx] = data;
    return data;
  }

  function updateStatus(id, status) {
    const profile = profiles.value.find(p => p.id === id);
    if (profile) {
      profile.status = status;
    }
  }

  return { profiles, loading, fetchAll, create, update, remove, regenerate, updateStatus };
});
