<template>
  <div>
    <div class="flex items-center justify-between mb-4">
      <h1 class="text-xl font-bold">{{ t('automation.matrix') }}</h1>
      <div class="flex items-center gap-3">
        <a-input
          v-model:value="searchQuery"
          :placeholder="t('automation.searchProfile')"
          class="w-64"
          allow-clear
        />
        <a-badge :count="selectedCount" :overflow-count="999">
          <a-button type="primary" :disabled="selectedCount === 0" @click="openCreateModal">
            {{ t('automation.createRun') }}
          </a-button>
        </a-badge>
      </div>
    </div>

    <div v-if="projects.length === 0" class="text-center py-16 text-slate-400">
      <p class="mb-4">{{ t('automation.noProjects') }}</p>
      <a-button type="primary" :loading="syncing" @click="handleSyncProjects">
        <ReloadOutlined class="mr-1" /> {{ t('settings.syncProjects') }}
      </a-button>
    </div>

    <div v-else class="overflow-auto">
      <a-table
        :columns="columns"
        :data-source="filteredProfiles"
        :pagination="false"
        :scroll="{ x: 'max-content' }"
        size="small"
        row-key="id"
        :loading="store.loading"
        bordered
      >
        <template #headerCell="{ column }">
          <span v-if="column.dataIndex === 'name'" class="font-semibold whitespace-nowrap">{{ column.title }}</span>
          <span v-else class="text-xs font-semibold whitespace-nowrap">{{ column.title }}</span>
        </template>
        <template #bodyCell="{ column, record }">
          <template v-if="column.dataIndex === 'name'">
            <span class="whitespace-nowrap">{{ record.name }}</span>
          </template>
          <template v-else-if="column.dataIndex.startsWith('proj_')">
            <div class="flex justify-center">
              <a-checkbox
                :checked="isChecked(record.id, column.projectName)"
                @change="toggleCell(record.id, column.projectName)"
              />
            </div>
          </template>
        </template>
      </a-table>
    </div>

    <a-modal
      v-model:open="showCreateModal"
      :title="t('automation.createRun')"
      @ok="handleCreateRun"
      :confirm-loading="creating"
      :ok-text="t('automation.create')"
      :cancel-text="t('automation.cancel')"
    >
      <a-form layout="vertical">
        <a-form-item :label="t('automation.runName')">
          <a-input v-model:value="newRunName" :placeholder="t('automation.runNamePlaceholder')" />
        </a-form-item>
        <a-form-item :label="t('automation.parallelLimit')">
          <a-input-number v-model:value="newRunParallelLimit" :min="1" :max="20" class="w-full" />
        </a-form-item>
      </a-form>
    </a-modal>
  </div>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue';
import { useRouter } from 'vue-router';
import { useTranslation } from 'i18next-vue';
import { message } from 'ant-design-vue';
import { ReloadOutlined } from '@ant-design/icons-vue';
import { useAutomationStore } from '../stores/automation.js';

const { t } = useTranslation();
const router = useRouter();
const store = useAutomationStore();

const searchQuery = ref('');
const showCreateModal = ref(false);
const creating = ref(false);
const newRunName = ref('');
const newRunParallelLimit = ref(2);
const syncing = ref(false);

const columns = computed(() => {
  const cols = [
    {
      title: t('automation.columns.profile'),
      dataIndex: 'name',
      key: 'name',
      fixed: 'left',
      width: 180,
    },
  ];
  for (const proj of store.projects) {
    cols.push({
      title: proj.display_name || proj.name,
      dataIndex: `proj_${proj.name}`,
      key: `proj_${proj.name}`,
      projectName: proj.name,
      width: 100,
      align: 'center',
    });
  }
  return cols;
});

const filteredProfiles = computed(() => {
  if (!searchQuery.value) return store.profiles;
  const q = searchQuery.value.toLowerCase();
  return store.profiles.filter(p =>
    p.name.toLowerCase().includes(q) || String(p.number).includes(q)
  );
});

const selectedCount = computed(() => {
  return Object.keys(selectedCells.value).filter(k => selectedCells.value[k]).length;
});

const selectedCells = ref({});

function getCellKey(profileId, projectName) {
  return `${profileId}::${projectName}`;
}

function isChecked(profileId, projectName) {
  const key = getCellKey(profileId, projectName);
  if (selectedCells.value[key] !== undefined) return selectedCells.value[key];
  const entry = store.matrix.find(
    m => m.profile_id === profileId && m.project_name === projectName
  );
  return entry ? Boolean(entry.is_enabled) : false;
}

function toggleCell(profileId, projectName) {
  const key = getCellKey(profileId, projectName);
  selectedCells.value[key] = !isChecked(profileId, projectName);
}

async function handleSyncProjects() {
  syncing.value = true;
  try {
    const result = await store.syncProjects();
    message.success(t('settings.syncProjectsResult', { added: result.added || 0, removed: result.removed || 0 }));
    await store.fetchMatrix();
  } catch (err) {
    message.error(err.message || t('common.error'));
  } finally {
    syncing.value = false;
  }
}

function getEnabledEntries() {
  const entries = [];
  for (const proj of store.projects) {
    for (const prof of store.profiles) {
      const key = getCellKey(prof.id, proj.name);
      const enabled = selectedCells.value[key] !== undefined
        ? selectedCells.value[key]
        : (store.matrix.find(m => m.profile_id === prof.id && m.project_name === proj.name)?.is_enabled || false);
      if (enabled) {
        entries.push({ project_name: proj.name, profile_id: prof.id, is_enabled: 1 });
      }
    }
  }
  return entries;
}

function openCreateModal() {
  const now = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  newRunName.value = `Run ${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}`;
  newRunParallelLimit.value = 2;
  showCreateModal.value = true;
}

async function handleCreateRun() {
  const entries = getEnabledEntries();
  if (entries.length === 0) {
    message.warning(t('automation.noCellsSelected'));
    return;
  }
  creating.value = true;
  try {
    const entries = getEnabledEntries();
    await store.updateMatrix(entries);
    const result = await store.createRun({
      name: newRunName.value || undefined,
      parallel_limit: newRunParallelLimit.value,
    });
    message.success(t('automation.runCreated'));
    showCreateModal.value = false;
    router.push('/automation/runs');
  } catch (err) {
    message.error(err.message);
  } finally {
    creating.value = false;
  }
}

onMounted(() => {
  store.fetchMatrix();
});
</script>
