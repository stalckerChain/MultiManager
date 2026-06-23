<template>
  <div>
    <div class="flex items-center justify-between mb-4">
      <h1 class="text-xl font-bold">{{ t('profiles.title') }}</h1>
      <div class="flex items-center gap-2">
        <a-input-search v-model:value="search" :placeholder="t('profiles.search')" style="width: 250px" />
        <a-button type="primary" @click="showCreateModal">
          {{ t('profiles.create') }}
        </a-button>
        <a-button @click="handleOneClick">
          {{ t('profiles.createOneClick') }}
        </a-button>
      </div>
    </div>

    <div v-if="selectedRowKeys.length" class="mb-3 flex items-center gap-2">
      <a-space>
        <a-button size="small" @click="bulkStart">{{ t('profiles.bulkStart') }}</a-button>
        <a-button size="small" @click="bulkStop">{{ t('profiles.bulkStop') }}</a-button>
        <a-button size="small" danger @click="bulkDelete">{{ t('profiles.bulkDelete') }}</a-button>
        <a-button size="small" @click="bulkClean">{{ t('profiles.bulkClean') }}</a-button>
      </a-space>
      <span class="text-xs text-slate-400">Selected: {{ selectedRowKeys.length }}</span>
    </div>

    <a-table :columns="columns" :data-source="filteredProfiles" :loading="profilesStore.loading"
      row-key="id" :pagination="{ pageSize: 20, showSizeChanger: true }" :row-selection="rowSelection"
      size="small" :scroll="{ y: 'calc(100vh - 260px)' }">
      <template #bodyCell="{ column, record }">
        <template v-if="column.key === 'name'">
          <div>
            <span class="font-medium">{{ record.name }}</span>
            <div class="flex gap-1 mt-1">
              <a-tag v-for="tag in parseTags(record.tags)" :key="tag" size="small" color="blue">{{ tag }}</a-tag>
            </div>
          </div>
        </template>

        <template v-if="column.key === 'proxy'">
          <span v-if="record.proxy_id" class="text-slate-300">Proxy #{{ record.proxy_id }}</span>
          <span v-else class="text-slate-500">—</span>
        </template>

        <template v-if="column.key === 'fingerprint'">
          <div class="text-xs">
            <div>{{ record.platform }} · {{ record.hardware_cores }}C / {{ record.hardware_memory }}GB</div>
            <div class="text-slate-500">{{ record.screen_resolution }}</div>
          </div>
        </template>

        <template v-if="column.key === 'status'">
          <a-badge :status="statusBadge(record.status)" :text="t(`profiles.status.${record.status}`)" />
          <span v-if="record.pid" class="text-xs text-slate-500 ml-1">PID: {{ record.pid }}</span>
        </template>

        <template v-if="column.key === 'actions'">
          <a-space>
            <a-button v-if="record.status === 'stopped'" size="small" type="primary" @click="startProfile(record.id)">
              {{ t('common.start') }}
            </a-button>
            <a-button v-else size="small" danger @click="stopProfile(record.id)">
              {{ t('common.stop') }}
            </a-button>
            <a-dropdown>
              <a-button size="small">...</a-button>
              <template #overlay>
                <a-menu @click="handleContext($event, record)">
                  <a-menu-item key="edit">Edit</a-menu-item>
                  <a-menu-item key="regenerate">Regenerate</a-menu-item>
                  <a-menu-item key="clean">Clean Cache</a-menu-item>
                  <a-menu-item key="importCookies">Import Cookies</a-menu-item>
                  <a-menu-item key="exportCookies">Export Cookies</a-menu-item>
                  <a-menu-item key="delete" danger>Delete</a-menu-item>
                </a-menu>
              </template>
            </a-dropdown>
          </a-space>
        </template>
      </template>
    </a-table>

    <ProfileModal v-model:open="modalOpen" :profile="editingProfile" @save="handleSave" />
  </div>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue';
import { useI18n } from 'vue-i18next';
import { useProfilesStore } from '../stores/profiles.js';
import { useBrowserStore } from '../stores/browser.js';
import ProfileModal from './ProfileModal.vue';

const { t } = useI18n();
const profilesStore = useProfilesStore();
const browserStore = useBrowserStore();

const search = ref('');
const selectedRowKeys = ref([]);
const modalOpen = ref(false);
const editingProfile = ref(null);

const columns = [
  { title: '#', dataIndex: 'number', key: 'number', width: 60 },
  { title: t('profiles.columns.name'), key: 'name', width: 200 },
  { title: t('profiles.columns.proxy'), key: 'proxy', width: 150 },
  { title: t('profiles.columns.fingerprint'), key: 'fingerprint', width: 200 },
  { title: t('profiles.columns.status'), key: 'status', width: 150 },
  { title: t('profiles.columns.actions'), key: 'actions', width: 200, fixed: 'right' },
];

const filteredProfiles = computed(() => {
  if (!search.value) return profilesStore.profiles;
  const q = search.value.toLowerCase();
  return profilesStore.profiles.filter(p =>
    p.name.toLowerCase().includes(q) || p.id.includes(q)
  );
});

const rowSelection = {
  selectedRowKeys,
  onChange: (keys) => { selectedRowKeys.value = keys; },
};

function parseTags(tags) {
  if (!tags) return [];
  try { return JSON.parse(tags); } catch { return []; }
}

function statusBadge(status) {
  return { stopped: 'default', starting: 'processing', running: 'success' }[status] || 'default';
}

function showCreateModal() {
  editingProfile.value = null;
  modalOpen.value = true;
}

function showEditModal(profile) {
  editingProfile.value = profile;
  modalOpen.value = true;
}

async function handleOneClick() {
  await profilesStore.create({
    name: `Profile ${Date.now()}`,
    platform: 'windows',
  });
}

async function handleSave(values) {
  if (editingProfile.value) {
    await profilesStore.update(editingProfile.value.id, values);
  } else {
    await profilesStore.create(values);
  }
  modalOpen.value = false;
}

async function startProfile(id) {
  await browserStore.start(id);
  await profilesStore.fetchAll();
}

async function stopProfile(id) {
  await browserStore.stop(id);
  await profilesStore.fetchAll();
}

function handleContext({ key }, record) {
  switch (key) {
    case 'edit': showEditModal(record); break;
    case 'regenerate': profilesStore.regenerate(record.id); break;
    case 'clean': browserStore.clean(record.id); break;
    case 'delete':
      profilesStore.remove(record.id);
      break;
  }
}

async function bulkStart() {
  for (const id of selectedRowKeys.value) {
    const profile = profilesStore.profiles.find(p => p.id === id);
    if (profile?.status === 'stopped') await startProfile(id);
  }
  selectedRowKeys.value = [];
}

async function bulkStop() {
  for (const id of selectedRowKeys.value) {
    await stopProfile(id);
  }
  selectedRowKeys.value = [];
}

function bulkDelete() {
  for (const id of selectedRowKeys.value) {
    profilesStore.remove(id);
  }
  selectedRowKeys.value = [];
}

async function bulkClean() {
  for (const id of selectedRowKeys.value) {
    await browserStore.clean(id);
  }
  selectedRowKeys.value = [];
}

onMounted(() => profilesStore.fetchAll());
</script>
