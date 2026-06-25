<template>
  <div>
    <div class="flex items-center justify-between mb-4">
      <h1 class="text-xl font-bold">Window Arranger</h1>
      <div class="flex items-center gap-2">
        <a-button type="primary" @click="arrangeGrid">
          <AppstoreOutlined /> Grid
        </a-button>
        <a-button @click="arrangeCascade">
          <BlockOutlined /> Cascade
        </a-button>
        <a-button @click="arrangeGridGrouped">
          <AppstoreOutlined /> Grid (Groups)
        </a-button>
        <a-button @click="arrangeCascadeGrouped">
          <BlockOutlined /> Cascade (Groups)
        </a-button>
        <a-button @click="refreshWindows">
          <ReloadOutlined /> Refresh
        </a-button>
      </div>
    </div>

    <div class="grid grid-cols-2 gap-4">
      <a-card title="Window Preview" class="bg-slate-800">
        <div class="relative bg-slate-900 rounded border border-slate-600"
          style="height: 400px; overflow: hidden;">
          <div v-for="(group, gIdx) in windowGroups" :key="group.profileId || 'ungrouped'"
            class="absolute border-2 border-dashed rounded cursor-pointer transition-all duration-300"
            :class="selectedGroup === group.profileId ? 'border-blue-500 bg-blue-500/10' : 'border-slate-600 bg-transparent'"
            :style="getGroupBorderStyle(gIdx)"
            @click="selectGroup(group.profileId)">
            <div class="text-xs p-1 text-slate-400 truncate">{{ group.profileName || 'Ungrouped' }}</div>
            <div v-for="(win, idx) in group.windows" :key="win.id"
              class="absolute border rounded cursor-pointer transition-all duration-300"
              :class="selectedWindow === win.id ? 'border-blue-500 bg-blue-500/20' : 'border-slate-500 bg-slate-700/50'"
              :style="getPreviewStyle(win, gIdx, idx)"
              @click.stop="selectWindow(win.id)">
              <div class="text-xs p-1 truncate text-center">{{ win.name || `Window ${idx + 1}` }}</div>
            </div>
          </div>

          <div v-if="windows.length === 0" class="flex items-center justify-center h-full text-slate-500">
            No windows detected
          </div>
        </div>
      </a-card>

      <div>
        <a-card title="Detected Windows" class="bg-slate-800 mb-4">
          <a-table :data-source="windows" size="small" :pagination="false" :columns="columns"
            row-key="id">
            <template #bodyCell="{ column, record }">
              <template v-if="column.key === 'position'">
                <span class="font-mono text-xs">{{ record.x }}, {{ record.y }} ({{ record.width }}x{{ record.height }})</span>
              </template>
              <template v-if="column.key === 'profile'">
                <span v-if="record.profileName" class="text-green-400 text-xs">{{ record.profileName }}</span>
                <span v-else class="text-slate-500 text-xs">—</span>
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
            <a-descriptions-item label="Groups">
              {{ windowGroups.length }}
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
import { ref, computed, onMounted } from 'vue';
import { AppstoreOutlined, BlockOutlined, ReloadOutlined } from '@ant-design/icons-vue';
import client from '../api/client.js';

const windows = ref([]);
const windowGroups = ref([]);
const selectedWindow = ref(null);
const selectedGroup = ref(null);
const lastAction = ref('');
const gridCols = ref(1);
const gridRows = ref(1);

const columns = [
  { title: 'Name', dataIndex: 'name', key: 'name', ellipsis: true },
  { title: 'Profile', key: 'profile', width: 120 },
  { title: 'Position', key: 'position', width: 200 },
  { title: 'Actions', key: 'actions', width: 80 },
];

const previewScale = 0.2;

function getPreviewStyle(win, gIdx, idx) {
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

function getGroupBorderStyle(gIdx) {
  return {
    left: '0px',
    top: `${gIdx * 420}px`,
    width: '100%',
    height: '410px',
  };
}

function selectWindow(id) {
  selectedWindow.value = selectedWindow.value === id ? null : id;
}

function selectGroup(id) {
  selectedGroup.value = selectedGroup.value === id ? null : id;
}

async function refreshWindows() {
  try {
    const [winRes, groupRes] = await Promise.all([
      client.get('/api/window-arranger/windows'),
      client.get('/api/window-arranger/windows/grouped'),
    ]);
    windows.value = winRes.data;
    windowGroups.value = groupRes.data;

    windows.value = windows.value.map(w => {
      const group = windowGroups.value.find(g =>
        g.windows.some(gw => gw.id === w.id)
      );
      return {
        ...w,
        profileName: group?.profileName || null,
        profileId: group?.profileId || null,
      };
    });
  } catch {
    windows.value = [];
    windowGroups.value = [];
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

async function arrangeGridGrouped() {
  try {
    const { data } = await client.post('/api/window-arranger/grid/grouped');
    lastAction.value = `Grid (Groups): ${data.arranged} windows in ${data.groups} groups`;
    await refreshWindows();
  } catch {}
}

async function arrangeCascadeGrouped() {
  try {
    const { data } = await client.post('/api/window-arranger/cascade/grouped');
    lastAction.value = `Cascade (Groups): ${data.arranged} windows (offset ${data.offset}px)`;
    await refreshWindows();
  } catch {}
}

async function focusWindow(id) {
  try {
    await client.post(`/api/window-arranger/focus/${id}`);
  } catch {}
}

onMounted(() => refreshWindows());
</script>
