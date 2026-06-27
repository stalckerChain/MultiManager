import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import client from '../api/client.js';

export const useSyncStore = defineStore('sync', () => {
  const active = ref(false);
  const masterId = ref(null);
  const slaves = ref([]);
  const loading = ref(false);

  const slaveCount = computed(() => slaves.value.length);

  async function fetchStatus() {
    try {
      const { data } = await client.get('/api/multi-control/status');
      active.value = data.active;
      masterId.value = data.masterId;
      slaves.value = data.slaves || [];
    } catch {
      active.value = false;
      masterId.value = null;
      slaves.value = [];
    }
  }

  async function startSync(masterProfileId, allRunningIds) {
    loading.value = true;
    try {
      await client.post('/api/multi-control/start', { masterId: masterProfileId });
      masterId.value = masterProfileId;
      active.value = true;

      const slaveIds = allRunningIds.filter(id => id !== masterProfileId);
      for (const id of slaveIds) {
        try {
          await client.post('/api/multi-control/slave/add', { profileId: id });
        } catch {}
      }
      await fetchStatus();
    } finally {
      loading.value = false;
    }
  }

  async function stopSync() {
    loading.value = true;
    try {
      await client.post('/api/multi-control/stop');
      active.value = false;
      masterId.value = null;
      slaves.value = [];
    } finally {
      loading.value = false;
    }
  }

  return { active, masterId, slaves, slaveCount, loading, fetchStatus, startSync, stopSync };
});
