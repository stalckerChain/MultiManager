<template>
  <div class="bg-slate-900 border-t border-slate-700 flex flex-col" :style="{ height: expanded ? '300px' : '36px' }">
    <div class="h-9 flex items-center justify-between px-3 cursor-pointer select-none border-b border-slate-700"
      @click="expanded = !expanded">
      <div class="flex items-center gap-2">
        <span class="font-medium text-sm">Logs</span>
        <a-tag v-if="connected" color="green" size="small">LIVE</a-tag>
        <a-tag v-else color="red" size="small">OFFLINE</a-tag>
        <span v-if="logs.length" class="text-xs text-slate-500">{{ logs.length }} lines</span>
        <span v-if="userScrolled" class="text-xs text-yellow-400">⬆ paused</span>
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

    <div v-if="expanded" ref="scrollContainer" class="flex-1 overflow-auto font-mono text-xs"
      @scroll="handleScroll">
      <div :style="{ height: totalHeight + 'px', position: 'relative' }">
        <div :style="{ transform: `translateY(${offsetY}px)`, position: 'absolute', width: '100%' }">
          <div v-for="(log, idx) in visibleLogs" :key="startIndex + idx"
            class="py-0.5 px-2 hover:bg-slate-800 rounded flex"
            :class="levelColor(log.level)">
            <span class="text-slate-500 mr-2 shrink-0">{{ formatTime(log.time) }}</span>
            <span class="mr-2 font-bold shrink-0">{{ levelTag(log.level) }}</span>
            <span class="flex-1 break-all">{{ log.msg || log.message || JSON.stringify(log) }}</span>
            <span v-if="log.profileId" class="ml-2 text-blue-400 shrink-0">[{{ log.profileId.substring(0, 8) }}]</span>
          </div>
        </div>
      </div>

      <div v-if="logs.length === 0" class="text-center text-slate-500 py-4">
        No logs to display
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, nextTick, onMounted, onUnmounted, watch } from 'vue';
import { ReloadOutlined, DeleteOutlined } from '@ant-design/icons-vue';
import client from '../api/client.js';

const ITEM_HEIGHT = 24;
const BUFFER = 10;

const expanded = ref(false);
const connected = ref(false);
const logFiles = ref([]);
const selectedFile = ref('core.log');
const logs = ref([]);
const scrollContainer = ref(null);
const scrollTop = ref(0);
const containerHeight = ref(264);
const userScrolled = ref(false);
let scrollTimeout = null;
let refreshInterval = null;

const totalHeight = computed(() => logs.value.length * ITEM_HEIGHT);

const startIndex = computed(() => {
  return Math.max(0, Math.floor(scrollTop.value / ITEM_HEIGHT) - BUFFER);
});

const endIndex = computed(() => {
  const visible = Math.ceil(containerHeight.value / ITEM_HEIGHT);
  return Math.min(logs.value.length, startIndex.value + visible + BUFFER * 2);
});

const visibleLogs = computed(() => {
  return logs.value.slice(startIndex.value, endIndex.value);
});

const offsetY = computed(() => startIndex.value * ITEM_HEIGHT);

function formatTime(ts) {
  if (!ts) return '';
  const d = new Date(ts);
  return d.toLocaleTimeString('en-US', { hour12: false }) + '.' + String(d.getMilliseconds()).padStart(3, '0');
}

function formatSize(bytes) {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

function levelColor(level) {
  return {
    error: 'text-red-400 bg-red-500/5',
    fatal: 'text-red-400 bg-red-500/5',
    warn: 'text-yellow-400 bg-yellow-500/5',
    warning: 'text-yellow-400 bg-yellow-500/5',
    info: 'text-green-400',
    debug: 'text-slate-400',
    trace: 'text-slate-500',
  }[level] || 'text-slate-300';
}

function levelTag(level) {
  const tag = (level || 'info').toUpperCase().padEnd(5);
  return tag;
}

function handleScroll() {
  if (!scrollContainer.value) return;
  scrollTop.value = scrollContainer.value.scrollTop;
  containerHeight.value = scrollContainer.value.clientHeight;

  const el = scrollContainer.value;
  const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 30;
  userScrolled.value = !atBottom;

  if (scrollTimeout) clearTimeout(scrollTimeout);
  scrollTimeout = setTimeout(() => {
    const atBottomNow = el.scrollHeight - el.scrollTop - el.clientHeight < 30;
    if (atBottomNow) userScrolled.value = false;
  }, 1500);
}

function scrollToBottom() {
  if (userScrolled.value) return;
  if (!scrollContainer.value) return;
  scrollContainer.value.scrollTop = scrollContainer.value.scrollHeight;
}

function loadLogFiles() {
  client.get('/api/logs/files').then(({ data }) => {
    logFiles.value = data;
    if (!selectedFile.value && data.length > 0) {
      selectedFile.value = data[0].name;
    }
  }).catch(() => {});
}

async function loadLogs() {
  try {
    const file = selectedFile.value;
    if (!file) return;

    const endpoint = file.startsWith('profile_')
      ? `/api/logs/profile/${file.replace('profile_', '').replace('.log', '')}`
      : `/api/logs?limit=500`;

    const { data } = await client.get(endpoint);
    logs.value = data;
    connected.value = true;

    await nextTick();
    scrollToBottom();
  } catch {
    connected.value = false;
  }
}

function refreshLogs() { loadLogs(); }

function clearLogs() {
  logs.value = [];
}

watch(expanded, (val) => {
  if (val) {
    nextTick(() => {
      if (scrollContainer.value) {
        containerHeight.value = scrollContainer.value.clientHeight;
        scrollToBottom();
      }
    });
  }
});

onMounted(() => {
  loadLogFiles();
  loadLogs();
  refreshInterval = setInterval(loadLogs, 5000);
});

onUnmounted(() => {
  if (refreshInterval) clearInterval(refreshInterval);
  if (scrollTimeout) clearTimeout(scrollTimeout);
});
</script>
