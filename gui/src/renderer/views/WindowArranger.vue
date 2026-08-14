<template>
  <div>
    <div class="flex items-center justify-between mb-4">
      <h1 class="text-xl font-bold">{{ t('sync.title') }}</h1>
      <div class="flex items-center gap-2">
        <a-button v-if="syncStore.active" type="primary" danger :loading="syncStore.loading" @click="stopSync">
          <template #icon><swap-outlined /></template>
          {{ t('sync.stopSync') }}
          <span class="ml-1 text-xs">({{ syncStore.slaveCount }})</span>
        </a-button>
        <a-dropdown v-else :disabled="runningProfiles.length < 2">
          <a-button :loading="syncStore.loading">
            <template #icon><swap-outlined /></template>
            {{ t('sync.startSync') }}
          </a-button>
          <template #overlay>
            <a-menu @click="handleSyncMenu">
              <a-menu-item key="label" disabled>
                <span class="text-slate-400">{{ t('sync.selectMaster') }}</span>
              </a-menu-item>
              <a-menu-divider />
              <a-menu-item v-for="p in runningProfiles" :key="p.id">
                <span class="font-medium">{{ p.name }}</span>
                <span class="text-xs text-slate-500 ml-2">PID: {{ p.pid }}</span>
              </a-menu-item>
            </a-menu>
          </template>
        </a-dropdown>
        <a-tag v-if="syncStore.active" color="green">{{ t('sync.master') }}: {{ masterName }}</a-tag>
        <span class="text-xs text-slate-400">{{ t('sync.runningCount', { count: runningProfiles.length }) }}</span>

        <a-divider type="vertical" />

        <a-button type="primary" @click="arrangeGrid">
          <AppstoreOutlined /> Grid
        </a-button>
        <a-button @click="arrangeCascade">
          <BlockOutlined /> Cascade
        </a-button>
        <a-button @click="refreshWindows">
          <ReloadOutlined /> Refresh
        </a-button>
      </div>
    </div>

    <a-card class="bg-slate-800 mb-4">
      <template #title>{{ t('sync.tabsTitle') }}</template>
      <div class="space-y-4">
        <a-textarea v-model:value="links" :rows="5" :placeholder="t('sync.linksPlaceholder')" />
        <div class="flex items-center gap-2">
          <a-button type="primary" :loading="openingLinks" @click="openLinks">
            {{ t('sync.openLinks') }}
          </a-button>
          <a-button danger :loading="closingTabs" @click="closeAllTabs">
            {{ t('sync.closeAllTabs') }}
          </a-button>
        </div>
      </div>
    </a-card>

    <a-alert v-if="tabResultSummary" :message="tabResultSummary" type="info" show-icon closable class="mb-4" />

    <div class="grid grid-cols-2 gap-4">
      <a-card title="Window Preview" class="bg-slate-800">
        <div class="relative bg-slate-900 rounded border border-slate-600"
          style="height: 400px; overflow: hidden;">
          <div v-for="(win, idx) in windows" :key="win.id"
            class="absolute border rounded cursor-pointer transition-all duration-300"
            :class="selectedWindow === win.id ? 'border-blue-500 bg-blue-500/20' : 'border-slate-500 bg-slate-700/50'"
            :style="getPreviewStyle(win)"
            @click="selectWindow(win.id)">
            <div class="text-xs p-1 truncate text-center">{{ win.name || `Window ${idx + 1}` }}</div>
          </div>

          <div v-if="loading" class="flex items-center justify-center h-full text-slate-500">
            <a-spin size="small" /> Loading windows...
          </div>
          <div v-else-if="windows.length === 0" class="flex items-center justify-center h-full text-slate-500">
            No windows detected
          </div>
        </div>
      </a-card>

      <div>
        <a-card title="Detected Windows" class="bg-slate-800 mb-4">
          <a-table :data-source="windows" size="small" :pagination="false" :columns="columns"
            row-key="id" :loading="loading">
            <template #bodyCell="{ column, record }">
              <template v-if="column.key === 'position'">
                <span class="font-mono text-xs">{{ record.x }}, {{ record.y }} ({{ record.width }}x{{ record.height }})</span>
              </template>
              <template v-if="column.key === 'actions'">
                <a-button size="small" @click="focusWindow(record.id)">Focus</a-button>
              </template>
            </template>
          </a-table>
        </a-card>

        <a-card title="Layout Info" class="bg-slate-800">
          <a-descriptions :column="1" bordered size="small">
            <a-descriptions-item label="Windows">
              {{ windows.length }}
            </a-descriptions-item>
            <a-descriptions-item label="Grid Layout">
              {{ gridCols }}x{{ gridRows }}
            </a-descriptions-item>
            <a-descriptions-item label="Last Action">
              {{ lastAction || 'None' }}
            </a-descriptions-item>
          </a-descriptions>
        </a-card>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, watch } from 'vue';
import { message } from 'ant-design-vue';
import { useTranslation } from 'i18next-vue';
import { AppstoreOutlined, BlockOutlined, ReloadOutlined, SwapOutlined } from '@ant-design/icons-vue';
import client from '../api/client.js';
import { useAppStore } from '../stores/app.js';
import { useProfilesStore } from '../stores/profiles.js';
import { useSyncStore } from '../stores/sync.js';

const { t } = useTranslation();
const appStore = useAppStore();
const profilesStore = useProfilesStore();
const syncStore = useSyncStore();

const windows = ref([]);
const loading = ref(false);
const selectedWindow = ref(null);
const lastAction = ref('');
const gridCols = ref(1);
const gridRows = ref(1);

const links = ref('');
const openingLinks = ref(false);
const closingTabs = ref(false);
const tabResultSummary = ref('');

const runningProfiles = computed(() =>
  profilesStore.profiles.filter(p => p.status === 'running')
);

const masterName = computed(() => {
  const master = profilesStore.profiles.find(p => p.id === syncStore.masterId);
  return master?.name || syncStore.masterId;
});

const columns = [
  { title: 'Name', dataIndex: 'name', key: 'name', ellipsis: true },
  { title: 'Position', key: 'position', width: 200 },
  { title: 'Actions', key: 'actions', width: 80 },
];

const previewScale = 0.2;

function getPreviewStyle(win) {
  const x = Math.min(win.x * previewScale, 380);
  const y = Math.min(win.y * previewScale, 380);
  const w = Math.max(win.width * previewScale, 60);
  const h = Math.max(win.height * previewScale, 40);
  return {
    left: `${x}px`,
    top: `${20 + y}px`,
    width: `${w}px`,
    height: `${h}px`,
  };
}

function selectWindow(id) {
  selectedWindow.value = selectedWindow.value === id ? null : id;
}

async function refreshWindows() {
  loading.value = true;
  try {
    const { data } = await client.get('/api/window-arranger/windows');
    windows.value = data;
  } catch {
    windows.value = [];
  } finally {
    loading.value = false;
  }
}

async function arrangeGrid() {
  try {
    const { data } = await client.post('/api/window-arranger/grid');
    gridCols.value = data.cols || 1;
    gridRows.value = data.rows || 1;
    lastAction.value = `Grid: ${data.arranged} windows (${data.cols}x${data.rows})`;
    await refreshWindows();
  } catch {}
}

async function arrangeCascade() {
  try {
    const { data } = await client.post('/api/window-arranger/cascade');
    lastAction.value = `Cascade: ${data.arranged} windows (offset ${data.offset}px)`;
    await refreshWindows();
  } catch {}
}

async function focusWindow(id) {
  try {
    await client.post(`/api/window-arranger/focus/${id}`);
  } catch {}
}

async function handleSyncMenu({ key }) {
  if (key === 'label') return;
  const runningIds = runningProfiles.value.map(p => p.id);
  try {
    await syncStore.startSync(key, runningIds);
  } catch (err) {
    message.error(err.message || t('sync.startSyncFailed'));
  }
}

async function stopSync() {
  try {
    await syncStore.stopSync();
  } catch (err) {
    message.error(err.message || t('sync.stopSyncFailed'));
  }
}

async function closeAllTabs() {
  closingTabs.value = true;
  try {
    const { data } = await client.post('/api/window-arranger/close-all-tabs');
    showTabResult(data, 'close');
  } catch (err) {
    message.error(err.message || t('sync.closeAllTabsError'));
  } finally {
    closingTabs.value = false;
    refreshWindows();
  }
}

async function openLinks() {
  const items = links.value.split('\n').map(l => l.trim()).filter(l => l.length > 0);
  if (items.length === 0) {
    message.warning(t('sync.noLinks'));
    return;
  }
  openingLinks.value = true;
  try {
    const { data } = await client.post('/api/window-arranger/open-links', { links: items });
    showTabResult(data, 'open');
  } catch (err) {
    message.error(err.message || t('sync.openLinksError'));
  } finally {
    openingLinks.value = false;
    refreshWindows();
  }
}

function showTabResult(data, kind) {
  if (kind === 'open') {
    tabResultSummary.value = t('sync.openResult', { created: data.created, failed: data.failed });
  } else {
    tabResultSummary.value = t('sync.closeResult', { success: data.success, failed: data.failed });
  }
}

watch(() => appStore.initialized, (ready) => {
  if (ready) {
    refreshWindows();
    profilesStore.fetchAll().catch(() => {});
    syncStore.fetchStatus().catch(() => {});
  }
}, { immediate: true });
</script>
