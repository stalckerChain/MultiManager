<template>
  <div>
    <div class="flex items-center justify-between mb-4">
      <h1 class="text-xl font-bold">{{ t('tasks.title') }}</h1>
      <div class="flex items-center gap-2">
        <a-input-search v-model:value="search" :placeholder="t('tasks.search')" style="width: 250px" />
        <a-button type="primary" @click="showCreateModal">
          {{ t('tasks.create') }}
        </a-button>
      </div>
    </div>

    <a-table :columns="columns" :data-source="filteredTasks" :loading="tasksStore.loading"
      row-key="id" :pagination="{ pageSize: 20, showSizeChanger: true }"
      size="small" :scroll="{ y: 'calc(100vh - 260px)' }">
      <template #bodyCell="{ column, record }">
        <template v-if="column.key === 'name'">
          <span class="font-medium">{{ record.name }}</span>
        </template>

        <template v-if="column.key === 'schedule'">
          <a-tag>{{ t(`tasks.scheduleTypes.${record.schedule_type}`) }}</a-tag>
          <span v-if="record.cron_expression" class="text-xs text-slate-400 ml-1">{{ record.cron_expression }}</span>
        </template>

        <template v-if="column.key === 'status'">
          <a-badge :status="record.is_active ? 'success' : 'default'"
            :text="record.is_active ? t('tasks.status.active') : t('tasks.status.inactive')" />
        </template>

        <template v-if="column.key === 'lastRun'">
          <span class="text-slate-400">{{ record.updated_at || '—' }}</span>
        </template>

        <template v-if="column.key === 'actions'">
          <a-space>
            <a-button size="small" type="primary" @click="handleRun(record.id)">
              {{ t('tasks.runNow') }}
            </a-button>
            <a-button size="small" @click="showEditModal(record)">
              {{ t('common.edit') || 'Edit' }}
            </a-button>
            <a-button size="small" @click="showExecutions(record)">
              {{ t('tasks.viewExecutions') }}
            </a-button>
            <a-popconfirm :title="t('tasks.confirmDelete')" @confirm="handleDelete(record.id)">
              <a-button size="small" danger>{{ t('common.delete') }}</a-button>
            </a-popconfirm>
          </a-space>
        </template>
      </template>
    </a-table>

    <a-modal v-model:open="modalOpen" :title="editingTask ? t('tasks.edit') : t('tasks.create')"
      @ok="handleSave" :confirm-loading="saveLoading">
      <a-form layout="vertical">
        <a-form-item :label="t('tasks.form.name')" required>
          <a-input v-model:value="form.name" :placeholder="t('tasks.form.namePlaceholder')" />
        </a-form-item>
        <a-form-item :label="t('tasks.form.scriptName')" required>
          <div class="flex gap-2">
            <a-select v-model:value="form.script_name" :placeholder="t('tasks.form.scriptNamePlaceholder')" :loading="projectsLoading" class="flex-1">
              <a-select-option v-for="p in availableProjects" :key="p.name" :value="p.name">
                {{ p.display_name || p.name }}
              </a-select-option>
            </a-select>
            <a-button size="small" :loading="projectsLoading" @click="fetchProjects">
              <ReloadOutlined />
            </a-button>
          </div>
        </a-form-item>
        <a-form-item :label="t('tasks.form.scheduleType')" required>
          <a-select v-model:value="form.schedule_type">
            <a-select-option value="once">{{ t('tasks.scheduleTypes.once') }}</a-select-option>
            <a-select-option value="daily">{{ t('tasks.scheduleTypes.daily') }}</a-select-option>
            <a-select-option value="weekly">{{ t('tasks.scheduleTypes.weekly') }}</a-select-option>
            <a-select-option value="manual">{{ t('tasks.scheduleTypes.manual') }}</a-select-option>
            <a-select-option value="archive">{{ t('tasks.scheduleTypes.archive') }}</a-select-option>
          </a-select>
        </a-form-item>
        <a-form-item :label="t('tasks.form.params')">
          <a-textarea v-model:value="form.params" :placeholder="t('tasks.form.paramsPlaceholder')" :rows="3" />
        </a-form-item>
        <a-form-item :label="t('tasks.form.isActive')">
          <a-switch v-model:checked="form.is_active" />
        </a-form-item>
      </a-form>
    </a-modal>

    <a-modal v-model:open="executionsOpen" :title="t('tasks.executions.title')"
      :footer="null" width="800px">
      <a-table :data-source="executions" :loading="executionsLoading" row-key="id"
        size="small" :pagination="{ pageSize: 10 }">
        <a-table-column :title="t('tasks.executions.columns.profile')" data-index="profileName" key="profile" />
        <a-table-column :title="t('tasks.executions.columns.status')" key="status">
          <template #default="{ record }">
            <a-badge :status="executionStatusBadge(record.status)"
              :text="t(`tasks.executions.status.${record.status}`)" />
          </template>
        </a-table-column>
        <a-table-column :title="t('tasks.executions.columns.exitCode')" data-index="exit_code" key="exitCode">
          <template #default="{ record }">
            <span v-if="record.exit_code !== null && record.exit_code !== undefined">{{ record.exit_code }}</span>
            <span v-else class="text-slate-500">—</span>
          </template>
        </a-table-column>
        <a-table-column :title="t('tasks.executions.columns.startedAt')" data-index="last_run_at" key="startedAt" />
        <a-table-column :title="t('tasks.executions.columns.logFile')" key="logFile">
          <template #default="{ record }">
            <a-button v-if="record.log_file_path" size="small" type="link" @click="openLog(record.log_file_path)">
              {{ t('tasks.executions.viewLog') }}
            </a-button>
            <span v-else class="text-slate-500">{{ t('tasks.executions.noLog') }}</span>
          </template>
        </a-table-column>
      </a-table>
      <div v-if="executions.length === 0 && !executionsLoading" class="text-center text-slate-500 py-8">
        {{ t('tasks.executions.empty') }}
      </div>
    </a-modal>
  </div>
</template>

<script setup>
import { ref, computed, reactive, watch } from 'vue';
import { useTranslation } from 'i18next-vue';
import { useTasksStore } from '../stores/tasks.js';
import { useAppStore } from '../stores/app.js';
import { useAutomationStore } from '../stores/automation.js';
import { message } from 'ant-design-vue';
import { ReloadOutlined } from '@ant-design/icons-vue';

const { t } = useTranslation();
const tasksStore = useTasksStore();
const appStore = useAppStore();
const autoStore = useAutomationStore();

const search = ref('');
const modalOpen = ref(false);
const saveLoading = ref(false);
const editingTask = ref(null);
const executionsOpen = ref(false);
const executions = ref([]);
const executionsLoading = ref(false);
const availableProjects = ref([]);
const projectsLoading = ref(false);

const form = reactive({
  name: '',
  script_name: '',
  schedule_type: 'manual',
  params: '',
  is_active: true,
});

const columns = [
  { title: t('tasks.columns.name'), key: 'name', width: 200 },
  { title: t('tasks.columns.script'), dataIndex: 'script_name', key: 'script', width: 120 },
  { title: t('tasks.columns.schedule'), key: 'schedule', width: 150 },
  { title: t('tasks.columns.status'), key: 'status', width: 100 },
  { title: t('tasks.columns.lastRun'), key: 'lastRun', width: 180 },
  { title: t('tasks.columns.actions'), key: 'actions', width: 320, fixed: 'right' },
];

const filteredTasks = computed(() => {
  if (!search.value) return tasksStore.tasks;
  const q = search.value.toLowerCase();
  return tasksStore.tasks.filter(t =>
    t.name.toLowerCase().includes(q) ||
    t.script_name.toLowerCase().includes(q) ||
    t.id.toLowerCase().includes(q)
  );
});

function executionStatusBadge(status) {
  return { running: 'processing', success: 'success', failed: 'error' }[status] || 'default';
}

function resetForm() {
  form.name = '';
  form.script_name = '';
  form.schedule_type = 'manual';
  form.params = '';
  form.is_active = true;
}

function showCreateModal() {
  editingTask.value = null;
  resetForm();
  modalOpen.value = true;
}

function showEditModal(task) {
  editingTask.value = task;
  form.name = task.name;
  form.script_name = task.script_name;
  form.schedule_type = task.schedule_type;
  form.params = typeof task.params === 'string' ? task.params : JSON.stringify(task.params || {}, null, 2);
  form.is_active = !!task.is_active;
  modalOpen.value = true;
}

async function handleSave() {
  if (!form.name || !form.script_name || !form.schedule_type) {
    message.error(t('common.error'));
    return;
  }

  saveLoading.value = true;
  try {
    let params = {};
    if (form.params) {
      try { params = JSON.parse(form.params); } catch { params = {}; }
    }

    const data = {
      name: form.name,
      script_name: form.script_name,
      schedule_type: form.schedule_type,
      params,
      is_active: form.is_active,
    };

    if (editingTask.value) {
      await tasksStore.update(editingTask.value.id, data);
      message.success(t('tasks.notifications.updated'));
    } else {
      await tasksStore.create(data);
      message.success(t('tasks.notifications.created'));
    }
    modalOpen.value = false;
  } catch (err) {
    message.error(err.message || t('common.error'));
  } finally {
    saveLoading.value = false;
  }
}

async function handleDelete(id) {
  try {
    await tasksStore.remove(id);
    message.success(t('tasks.notifications.deleted'));
  } catch (err) {
    message.error(err.message || t('common.error'));
  }
}

async function handleRun(id) {
  try {
    const result = await tasksStore.run(id);
    message.success(t('tasks.notifications.runStarted'));
  } catch (err) {
    message.error(err.message || t('common.error'));
  }
}

async function openLog(filePath) {
  if (window.electronAPI) {
    window.electronAPI.ptyStart(filePath);
  } else {
    window.open('file://' + filePath);
  }
}

async function showExecutions(task) {
  executionsOpen.value = true;
  executionsLoading.value = true;
  executions.value = [];
  try {
    executions.value = await tasksStore.getExecutions(task.id);
  } finally {
    executionsLoading.value = false;
  }
}

watch(() => appStore.initialized, (ready) => {
  if (ready) {
    tasksStore.fetchAll().catch(() => {});
    fetchProjects();
  }
}, { immediate: true });

async function fetchProjects() {
  projectsLoading.value = true;
  try {
    const data = await autoStore.fetchProjects();
    availableProjects.value = Array.isArray(data) ? data : [];
  } catch {
    availableProjects.value = [];
  } finally {
    projectsLoading.value = false;
  }
}
</script>

<style scoped>
</style>
