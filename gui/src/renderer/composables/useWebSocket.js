import { ref, onMounted, onUnmounted } from 'vue';
import { useAppStore } from '../stores/app.js';
import { useProfilesStore } from '../stores/profiles.js';

export function useWebSocket() {
  const appStore = useAppStore();
  const profilesStore = useProfilesStore();
  const connected = ref(false);
  let ws = null;
  let reconnectDelay = 1000;
  let reconnectTimer = null;

  function connect() {
    if (!appStore.port) return;

    ws = new WebSocket(`ws://127.0.0.1:${appStore.port}/ws`);

    ws.onopen = () => {
      connected.value = true;
      reconnectDelay = 1000;
    };

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        if (msg.type === 'status') {
          profilesStore.updateStatus(msg.profileId, msg.status);
        }
      } catch (e) {
        console.error('WebSocket message parse error:', e);
      }
    };

    ws.onclose = () => {
      connected.value = false;
      scheduleReconnect();
    };

    ws.onerror = () => {
      ws.close();
    };
  }

  function scheduleReconnect() {
    if (reconnectTimer) return;
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      reconnectDelay = Math.min(reconnectDelay * 2, 8000);
      connect();
    }, reconnectDelay);
  }

  function disconnect() {
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
    if (ws) {
      ws.close();
      ws = null;
    }
  }

  onMounted(() => connect());
  onUnmounted(() => disconnect());

  return { connected };
}
