<template>
  <div>
    <div class="flex items-center justify-between mb-4">
      <h1 class="text-xl font-bold">{{ t('automation.historyTitle') }}</h1>
      <a-button @click="refresh">
        <ReloadOutlined />
      </a-button>
    </div>

    <div v-if="items.length === 0 && !loading" class="text-center py-16 text-slate-400">
      {{ t('automation.historyEmpty') }}
    </div>

    <div v-else class="space-y-3">
      <div
        v-for="run in items"
        :key="run.id"
        class="bg-slate-800 rounded-lg border border-slate-700 overflow-hidden"
      >
        <div
          class="flex items-center gap-4 px-4 py-3 cursor-pointer hover:bg-slate-750 transition-colors"
          @click="toggleExpand(run.id)"
        >
          <div class="flex-1 min-w-0">
            <div class="font-medium truncate">{{ run.name || run.id }}</div>
            <div class="text-xs text-slate-400 mt-0.5">
              {{ formatDate(run.created_at) }}
              <span v-if="run.completed_at" class="ml-2">
                &middot; {{ duration(run) }}
              </span>
            </div>
          </div>
          <div class="flex items-center gap-3">
            <a-tag :color="statusColor(run.status)">
              {{ t(`automation.status.${run.status}`) }}
            </a-tag>
            <div class="text-sm text-slate-300 whitespace-nowrap">
              {{ run.success_tasks || 0 }}/{{ run.total_tasks || 0 }}
            </div>
            <a-progress
              type="circle"
              :percent="progressPercent(run)"
              :size="32"
              :stroke-color="progressColor(run)"
              :show-info="false"
            />
          </div>
        </div>

        <div v-if="expandedId === run.id" class="border-t border-slate-700 p-4">
          <div v-if="runTasks[run.id]">
            <div class="flex items-center gap-4 mb-3 text-xs text-slate-400">
              <span class="flex items-center gap-1"><span class="w-3 h-3 rounded bg-slate-600 inline-block"></span> {{ t('automation.status.pending') }}</span>
              <span class="flex items-center gap-1"><span class="w-3 h-3 rounded bg-blue-500 inline-block"></span> {{ t('automation.status.running') }}</span>
              <span class="flex items-center gap-1"><span class="w-3 h-3 rounded bg-green-500 inline-block"></span> {{ t('automation.status.success') }}</span>
              <span class="flex items-center gap-1"><span class="w-3 h-3 rounded bg-red-500 inline-block"></span> {{ t('automation.status.failed') }}</span>
              <span class="flex items-center gap-1"><span class="w-3 h-3 rounded bg-yellow-500 inline-block"></span> {{ t('automation.status.cancelled') }}</span>
            </div>
            <div class="overflow-auto">
              <table class="w-full text-xs border-collapse">
                <thead>
                  <tr>
                    <th class="text-left p-2 border border-slate-600 bg-slate-700 whitespace-nowrap">{{ t('automation.columns.profile') }}</th>
                    <th class="text-left p-2 border border-slate-600 bg-slate-700 whitespace-nowrap">{{ t('automation.columns.profileId') }}</th>
                    <th
                      v-for="proj in runProjects[run.id]"
                      :key="proj"
                      class="text-center p-2 border border-slate-600 bg-slate-700 whitespace-nowrap"
                    >
                      {{ proj }}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="(group, profileKey) in groupedTasks(run.id)" :key="profileKey">
                    <td class="p-2 border border-slate-600 font-medium whitespace-nowrap">{{ group.profileName }}</td>
                    <td class="p-2 border border-slate-600 text-xs text-slate-400 whitespace-nowrap">{{ group.profileId }}</td>
                    <td
                      v-for="proj in runProjects[run.id]"
                      :key="proj"
                      class="p-1 border border-slate-600 text-center"
                    >
                      <div
                        v-if="getTaskStatus(run.id, proj, profileKey)"
                        class="w-full h-full min-h-[24px] flex items-center justify-center"
                      >
                        <div
                          class="w-4 h-4 rounded cursor-pointer"
                          :class="cellColorClass(getTaskStatus(run.id, proj, profileKey))"
                          :title="getTaskStatus(run.id, proj, profileKey)"
                          @click="openLog(getTaskLog(run.id, proj, profileKey))"
                        />
                      </div>
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
          <div v-else class="text-center text-slate-500 py-4">
            <a-spin size="small" />
          </div>
        </div>
      </div>
    </div>

    <div v-if="hasMore" class="text-center mt-4">
      <a-button :loading="loadingMore" @click="loadMore">
        {{ t('automation.loadMore') }}
      </a-button>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue';
import { useTranslation } from 'i18next-vue';
import { ReloadOutlined } from '@ant-design/icons-vue';
import { useAutomationStore } from '../stores/automation.js';

const { t } = useTranslation();
const store = useAutomationStore();

const items = ref([]);
const expandedId = ref(null);
const runTasks = ref({});
const runProjects = ref({});
const page = ref(1);
const total = ref(0);
const loading = ref(false);
const loadingMore = ref(false);
const hasMore = computed(() => items.value.length < total.value);

const COMPLETED_STATUSES = ['completed', 'partial', 'cancelled'];

function statusColor(status) {
  const map = {
    completed: 'success',
    partial: 'warning',
    cancelled: 'error',
  };
  return map[status] || 'default';
}

function progressPercent(run) {
  if (!run.total_tasks) return 0;
  return Math.round(((run.completed_tasks || 0) / run.total_tasks) * 100);
}

function progressColor(run) {
  if (run.failed_tasks === 0 && run.completed_tasks === run.total_tasks) return '#22c55e';
  if (run.completed_tasks < run.total_tasks) return '#eab308';
  return '#ef4444';
}

function formatDate(dateStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  return d.toLocaleString();
}

function duration(run) {
  if (!run.started_at || !run.completed_at) return '';
  const start = new Date(run.started_at);
  const end = new Date(run.completed_at);
  const diff = Math.round((end - start) / 1000);
  if (diff < 60) return `${diff}s`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ${diff % 60}s`;
  return `${Math.floor(diff / 3600)}h ${Math.floor((diff % 3600) / 60)}m`;
}

async function toggleExpand(runId) {
  if (expandedId.value === runId) {
    expandedId.value = null;
    return;
  }
  expandedId.value = runId;
  if (!runTasks.value[runId]) {
    try {
      const data = await store.fetchRun(runId);
      runTasks.value[runId] = data.tasks || [];
      const projSet = new Set();
      for (const task of runTasks.value[runId]) {
        projSet.add(task.project_name);
      }
      runProjects.value[runId] = Array.from(projSet);
    } catch {
      runTasks.value[runId] = [];
      runProjects.value[runId] = [];
    }
  }
}

function groupedTasks(runId) {
  const tasks = runTasks.value[runId] || [];
  const groups = {};
  for (const task of tasks) {
    const profileKey = task.profile_id;
    if (!groups[profileKey]) {
      groups[profileKey] = {
        profileName: task.profile_name || task.profile_id,
        profileId: task.profile_id,
        tasks: [],
      };
    }
    groups[profileKey].tasks.push(task);
  }
  return groups;
}

function getTaskStatus(runId, projectName, profileKey) {
  const group = groupedTasks(runId)[profileKey];
  if (!group) return null;
  const task = group.tasks.find(t => t.project_name === projectName);
  return task ? task.status : null;
}

function getTaskLog(runId, projectName, profileKey) {
  const group = groupedTasks(runId)[profileKey];
  if (!group) return null;
  const task = group.tasks.find(t => t.project_name === projectName);
  return task ? task.log_file_path : null;
}

function cellColorClass(status) {
  const map = {
    pending: 'bg-slate-600',
    running: 'bg-blue-500',
    success: 'bg-green-500',
    failed: 'bg-red-500',
    cancelled: 'bg-yellow-500',
  };
  return map[status] || 'bg-slate-700';
}

function openLog(logPath) {
  if (logPath && window.electronAPI?.openFile) {
    window.electronAPI.openFile(logPath);
  }
}

async function loadItems(pageNum) {
  if (pageNum === 1) loading.value = true;
  else loadingMore.value = true;
  try {
    const result = await store.fetchRuns(pageNum, 50);
    const filtered = (result.items || []).filter(r => COMPLETED_STATUSES.includes(r.status));
    if (pageNum === 1) {
      items.value = filtered;
    } else {
      items.value.push(...filtered);
    }
    total.value = result.total || 0;
  } catch {
    if (pageNum === 1) items.value = [];
  } finally {
    loading.value = false;
    loadingMore.value = false;
  }
}

async function loadMore() {
  page.value += 1;
  await loadItems(page.value);
}

async function refresh() {
  page.value = 1;
  items.value = [];
  runTasks.value = {};
  runProjects.value = {};
  await loadItems(1);
}

onMounted(() => {
  loadItems(1);
});
</script>
