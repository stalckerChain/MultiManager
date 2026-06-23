import { defineStore } from 'pinia';
import { ref } from 'vue';
import client from '../api/client.js';

export const useBrowserStore = defineStore('browser', () => {
  const running = ref(new Map());

  async function start(profileId) {
    const { data } = await client.post(`/api/browser/${profileId}/start`);
    running.value.set(profileId, data);
    return data;
  }

  async function stop(profileId) {
    await client.post(`/api/browser/${profileId}/stop`);
    running.value.delete(profileId);
  }

  async function getStatus(profileId) {
    const { data } = await client.get(`/api/browser/${profileId}/status`);
    return data;
  }

  async function clean(profileId) {
    await client.post(`/api/browser/${profileId}/clean`);
  }

  return { running, start, stop, getStatus, clean };
});
