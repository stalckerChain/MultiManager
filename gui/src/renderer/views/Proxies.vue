<template>
  <div>
    <div class="flex items-center justify-between mb-4">
      <h1 class="text-xl font-bold">{{ t('proxies.title') }}</h1>
      <div class="flex items-center gap-2">
        <a-button type="primary" @click="showAddModal">{{ t('proxies.add') }}</a-button>
        <a-button @click="showImportModal">{{ t('proxies.bulkImport') }}</a-button>
        <a-button danger @click="deleteUnused">{{ t('proxies.deleteUnused') }}</a-button>
      </div>
    </div>

    <a-table :columns="columns" :data-source="proxiesStore.proxies" :loading="proxiesStore.loading"
      row-key="id" size="small" :scroll="{ y: 'calc(100vh - 200px)' }">
      <template #bodyCell="{ column, record }">
        <template v-if="column.key === 'status'">
          <a-badge :status="record.is_active ? 'success' : 'error'"
            :text="record.is_active ? 'Active' : 'Inactive'" />
        </template>
        <template v-if="column.key === 'type'">
          <a-tag :color="typeColor(record.type)">{{ record.type.toUpperCase() }}</a-tag>
        </template>
        <template v-if="column.key === 'connection'">
          <span class="font-mono text-xs">{{ record.host }}:{{ record.port }}</span>
        </template>
        <template v-if="column.key === 'actions'">
          <a-space>
            <a-button size="small" @click="checkProxy(record.id)">Check</a-button>
            <a-button size="small" danger @click="proxiesStore.remove(record.id)">Delete</a-button>
          </a-space>
        </template>
      </template>
    </a-table>

    <a-modal v-model:open="addModal" title="Add Proxy" @ok="handleAddProxy">
      <a-form layout="vertical">
        <a-form-item label="Type">
          <a-select v-model:value="newProxy.type">
            <a-select-option value="socks5">SOCKS5</a-select-option>
            <a-select-option value="http">HTTP</a-select-option>
            <a-select-option value="https">HTTPS</a-select-option>
          </a-select>
        </a-form-item>
        <div class="grid grid-cols-2 gap-3">
          <a-form-item label="Host">
            <a-input v-model:value="newProxy.host" />
          </a-form-item>
          <a-form-item label="Port">
            <a-input-number v-model:value="newProxy.port" :min="1" :max="65535" style="width: 100%" />
          </a-form-item>
        </div>
        <div class="grid grid-cols-2 gap-3">
          <a-form-item label="Username">
            <a-input v-model:value="newProxy.username" />
          </a-form-item>
          <a-form-item label="Password">
            <a-input-password v-model:value="newProxy.password" />
          </a-form-item>
        </div>
      </a-form>
    </a-modal>

    <a-modal v-model:open="importModal" title="Bulk Import" @ok="handleImport">
      <a-textarea v-model:value="importText" :rows="8"
        placeholder="socks5://user:pass@host1:1080&#10;http://host2:8080&#10;IP:Port:User:Pass" />
    </a-modal>
  </div>
</template>

<script setup>
import { ref, reactive, onMounted } from 'vue';
import { useTranslation } from 'i18next-vue';
import { useProxiesStore } from '../stores/proxies.js';

const { t } = useTranslation();
const proxiesStore = useProxiesStore();

const addModal = ref(false);
const importModal = ref(false);
const importText = ref('');
const newProxy = reactive({
  type: 'socks5', host: '', port: 1080, username: '', password: '',
});

const columns = [
  { title: t('proxies.columns.status'), key: 'status', width: 100 },
  { title: t('proxies.columns.type'), key: 'type', width: 80 },
  { title: t('proxies.columns.connection'), key: 'connection', width: 200 },
  { title: t('proxies.columns.rotation'), dataIndex: 'proxy_rotation_url', width: 150 },
  { title: t('proxies.columns.ping'), dataIndex: 'last_ip', width: 120 },
  { title: 'Actions', key: 'actions', width: 150 },
];

function typeColor(type) {
  return { socks5: 'green', http: 'blue', https: 'purple' }[type] || 'default';
}

function showAddModal() {
  Object.assign(newProxy, { type: 'socks5', host: '', port: 1080, username: '', password: '' });
  addModal.value = true;
}

function showImportModal() {
  importText.value = '';
  importModal.value = true;
}

async function handleAddProxy() {
  await proxiesStore.create({ ...newProxy });
  addModal.value = false;
}

async function handleImport() {
  await proxiesStore.importBulk(importText.value);
  importModal.value = false;
}

async function checkProxy(id) {
  await proxiesStore.check(id);
  await proxiesStore.fetchAll();
}

function deleteUnused() {
  // TODO: implement delete unused proxies
}

onMounted(() => proxiesStore.fetchAll());
</script>
