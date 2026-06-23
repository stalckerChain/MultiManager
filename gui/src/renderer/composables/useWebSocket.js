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

    const url = `ws://127.0.0.1:${appStore.port}/ws`;
    ws = new WebSocket(url);

    ws.onopen = () => {
      connected.value = true;
      reconnectDelay = 1000;
      console.log('[WS] Connected to', url);
    };

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);

        switch (msg.type) {
          case 'status':
            profilesStore.updateStatus(msg.profileId, msg.status);
            if (msg.pid !== undefined) {
              const profile = profilesStore.profiles.find(p => p.id === msg.profileId);
              if (profile) profile.pid = msg.pid;
            }
            break;

          case 'log':
            console.log(`[Profile ${msg.profileId}] ${msg.level}: ${msg.message}`);
            break;

          case 'profiles_update':
            profilesStore.fetchAll();
            break;

          default:
            console.log('[WS] Unknown message type:', msg.type);
        }
      } catch (e) {
        console.error('[WS] Parse error:', e);
      }
    };

    ws.onclose = () => {
      connected.value = false;
      console.log('[WS] Disconnected. Reconnecting in', reconnectDelay, 'ms');
      scheduleReconnect();
    };

    ws.onerror = (err) => {
      console.error('[WS] Error:', err);
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

  function send(data) {
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(data));
    }
  }

  onMounted(() => connect());
  onUnmounted(() => disconnect());

  return { connected, send, connect, disconnect };
}
