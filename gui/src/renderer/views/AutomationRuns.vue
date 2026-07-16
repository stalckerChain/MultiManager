<template>
  <div>
    <div class="flex items-center justify-between mb-4">
      <h1 class="text-xl font-bold">{{ t('automation.runsTitle') }}</h1>
      <a-button @click="refresh">
        <ReloadOutlined />
      </a-button>
    </div>

    <div v-if="store.runs.length === 0 && !store.loading" class="text-center py-16 text-slate-400">
      {{ t('automation.runsEmpty') }}
    </div>

    <div v-else class="space-y-3">
      <div
        v-for="run in store.runs"
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
            </div>
          </div>
          <div class="flex items-center gap-3">
            <a-tag :color="statusColor(run.status)">
              {{ t(`automation.status.${run.status}`) }}
            </a-tag>
            <div class="text-sm text-slate-300 whitespace-nowrap">
              {{ run.completed_tasks || 0 }}/{{ run.total_tasks || 0 }}
            </div>
            <a-progress
              type="circle"
              :percent="progressPercent(run)"
              :size="32"
              :stroke-color="progressColor(run)"
              :show-info="false"
            />
          </div>
          <div class="flex items-center gap-2 ml-2">
            <a-button
              v-if="run.status === 'pending' || run.status === 'partial'"
              size="small"
              type="primary"
              @click.stop="handleStart(run)"
            >
              {{ t('automation.start') }}
            </a-button>
            <a-button
              v-if="run.status === 'running'"
              size="small"
              danger
              @click.stop="handleCancel(run)"
            >
              {{ t('automation.stop') }}
            </a-button>
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
  </div>
</template>

<script setup>
import { ref, onMounted, onUnmounted } from 'vue';
import { useTranslation } from 'i18next-vue';
import { message } from 'ant-design-vue';
import { ReloadOutlined } from '@ant-design/icons-vue';
import { useAutomationStore } from '../stores/automation.js';

const { t } = useTranslation();
const store = useAutomationStore();

const expandedId = ref(null);
const runTasks = ref({});
const runProjects = ref({});

function statusColor(status) {
  const map = {
    pending: 'default',
    running: 'processing',
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
  if (run.status === 'running') return '#3b82f6';
  if (run.status === 'completed' && run.failed_tasks === 0) return '#22c55e';
  if (run.status === 'completed' || run.status === 'partial') return '#eab308';
  if (run.status === 'cancelled') return '#ef4444';
  return '#64748b';
}

function formatDate(dateStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  return d.toLocaleString();
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
  const tasks = runTasks.value[runId] || [];
  const group = groupedTasks(runId)[profileKey];
  if (!group) return null;
  const task = group.tasks.find(t => t.project_name === projectName);
  return task ? task.status : null;
}

function getTaskLog(runId, projectName, profileKey) {
  const tasks = runTasks.value[runId] || [];
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
  if (logPath) {
    if (window.electronAPI?.openFile) {
      window.electronAPI.openFile(logPath);
    }
  }
}

async function handleStart(run) {
  try {
    await store.startRun(run.id);
    message.success(t('automation.runStarted'));
    run.status = 'running';
  } catch (err) {
    message.error(err.message);
  }
}

async function handleCancel(run) {
  try {
    await store.cancelRun(run.id);
    message.success(t('automation.runCancelled'));
    run.status = 'cancelled';
  } catch (err) {
    message.error(err.message);
  }
}

async function refresh() {
  await store.fetchRuns(1, 50);
}

let refreshTimer = null;

function startAutoRefresh() {
  stopAutoRefresh();
  refreshTimer = setInterval(async () => {
    const hasRunning = store.runs.some(r => r.status === 'running');
    if (hasRunning) {
      await store.fetchRuns(1, 50);
      // Also refresh expanded run details
      if (expandedId.value) {
        try {
          const data = await store.fetchRun(expandedId.value);
          runTasks.value[expandedId.value] = data.tasks || [];
          const projSet = new Set();
          for (const task of runTasks.value[expandedId.value]) {
            projSet.add(task.project_name);
          }
          runProjects.value[expandedId.value] = Array.from(projSet);
        } catch {
          // ignore
        }
      }
    }
  }, 3000);
}

function stopAutoRefresh() {
  if (refreshTimer) {
    clearInterval(refreshTimer);
    refreshTimer = null;
  }
}

onMounted(() => {
  store.fetchRuns(1, 50);
  startAutoRefresh();
});

onUnmounted(() => {
  stopAutoRefresh();
});
</script>
