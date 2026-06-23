<template>
  <div class="bg-slate-900 border-t border-slate-700 flex flex-col" :style="{ height: expanded ? '300px' : '36px' }">
    <div class="h-9 flex items-center justify-between px-3 cursor-pointer select-none border-b border-slate-700"
      @click="expanded = !expanded">
      <div class="flex items-center gap-2">
        <span class="font-medium text-sm">Logs</span>
        <a-tag v-if="connected" color="green" size="small">LIVE</a-tag>
        <a-tag v-else color="red" size="small">OFFLINE</a-tag>
      </div>
      <div class="flex items-center gap-2">
        <a-select v-model:value="selectedFile" size="small" style="width: 200px"
          placeholder="Select log file" @click.stop @change="loadLogs">
          <a-select-option v-for="file in logFiles" :key="file.name" :value="file.name">
            {{ file.name }} ({{ formatSize(file.size) }})
          </a-select-option>
        </a-select>
        <a-button size="small" type="text" @click.stop="clearLogs">
          <DeleteOutlined />
        </a-button>
        <a-button size="small" type="text" @click.stop="refreshLogs">
          <ReloadOutlined />
        </a-button>
        <span class="text-xs text-slate-500">{{ expanded ? '▼' : '▶' }}</span>
      </div>
    </div>

    <div v-if="expanded" ref="logContainer" class="flex-1 overflow-auto font-mono text-xs p-2">
      <div v-for="(log, idx) in displayedLogs" :key="idx"
        class="py-0.5 px-2 hover:bg-slate-800 rounded"
        :class="levelColor(log.level)">
        <span class="text-slate-500 mr-2">{{ formatTime(log.time) }}</span>
        <span class="mr-2 font-bold">{{ (log.level || 'info').toUpperCase().padEnd(5) }}</span>
        <span>{{ log.msg || log.message || JSON.stringify(log) }}</span>
        <span v-if="log.profileId" class="ml-2 text-blue-400">[{{ log.profileId.substring(0, 8) }}]</span>
      </div>

      <div v-if="displayedLogs.length === 0" class="text-center text-slate-500 py-4">
        No logs to display
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, nextTick, onMounted, onUnmounted } from 'vue';
import { ReloadOutlined, DeleteOutlined } from '@ant-design/icons-vue';
import client from '../api/client.js';

const expanded = ref(false);
const connected = ref(false);
const logFiles = ref([]);
const selectedFile = ref('core.log');
const displayedLogs = ref([]);
const logContainer = ref(null);
let refreshInterval = null;

function formatTime(ts) {
  if (!ts) return '';
  const d = new Date(ts);
  return d.toLocaleTimeString('en-US', { hour12: false });
}

function formatSize(bytes) {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

function levelColor(level) {
  return {
    error: 'text-red-400',
    warn: 'text-yellow-400',
    warning: 'text-yellow-400',
    debug: 'text-slate-400',
  }[level] || 'text-slate-300';
}

async function loadLogFiles() {
  try {
    const { data } = await client.get('/api/logs/files');
    logFiles.value = data;
    if (!selectedFile.value && data.length > 0) {
      selectedFile.value = data[0].name;
    }
  } catch {}
}

async function loadLogs() {
  try {
    const file = selectedFile.value;
    if (!file) return;

    const endpoint = file.startsWith('profile_')
      ? `/api/logs/profile/${file.replace('profile_', '').replace('.log', '')}`
      : `/api/logs?limit=200`;

    const { data } = await client.get(endpoint);
    displayedLogs.value = data;
    connected.value = true;

    await nextTick();
    if (logContainer.value) {
      logContainer.value.scrollTop = logContainer.value.scrollHeight;
    }
  } catch {
    connected.value = false;
  }
}

function refreshLogs() {
  loadLogs();
}

function clearLogs() {
  displayedLogs.value = [];
}

onMounted(() => {
  loadLogFiles();
  loadLogs();
  refreshInterval = setInterval(loadLogs, 5000);
});

onUnmounted(() => {
  if (refreshInterval) clearInterval(refreshInterval);
});
</script>
