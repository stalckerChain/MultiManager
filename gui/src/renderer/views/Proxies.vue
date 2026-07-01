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
            <a-button size="small" :loading="checkLoading === record.id" @click="checkProxy(record.id)">Check</a-button>
            <a-button size="small" @click="showEditModal(record)">Edit</a-button>
            <a-button size="small" danger @click="proxiesStore.remove(record.id)">Delete</a-button>
          </a-space>
        </template>
      </template>
    </a-table>

    <a-modal v-model:open="addModal" title="Add Proxy" @ok="handleAddProxy" :confirm-loading="addLoading">
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

    <a-modal v-model:open="importModal" title="Bulk Import" @ok="handleImport" :confirm-loading="importLoading">
      <a-textarea v-model:value="importText" :rows="8"
        placeholder="socks5://user:pass@host1:1080&#10;http://host2:8080&#10;IP:Port:User:Pass" />
    </a-modal>

    <a-modal v-model:open="editModal" :title="t('proxies.edit')" @ok="handleEditProxy" :confirm-loading="editLoading"
      @cancel="editModal = false">
      <a-form layout="vertical">
        <a-form-item label="Type">
          <a-select v-model:value="editProxy.type">
            <a-select-option value="socks5">SOCKS5</a-select-option>
            <a-select-option value="http">HTTP</a-select-option>
            <a-select-option value="https">HTTPS</a-select-option>
          </a-select>
        </a-form-item>
        <div class="grid grid-cols-2 gap-3">
          <a-form-item label="Host">
            <a-input v-model:value="editProxy.host" />
          </a-form-item>
          <a-form-item label="Port">
            <a-input-number v-model:value="editProxy.port" :min="1" :max="65535" style="width: 100%" />
          </a-form-item>
        </div>
        <div class="grid grid-cols-2 gap-3">
          <a-form-item label="Username">
            <a-input v-model:value="editProxy.username" />
          </a-form-item>
          <a-form-item label="Password">
            <a-input-password v-model:value="editProxy.password" />
          </a-form-item>
        </div>
        <a-form-item :label="t('proxies.columns.rotation')">
          <a-input v-model:value="editProxy.proxy_rotation_url" placeholder="https://example.com/rotate" />
        </a-form-item>
      </a-form>
    </a-modal>
  </div>
</template>

<script setup>
import { ref, reactive, watch } from 'vue';
import { message } from 'ant-design-vue';
import { useTranslation } from 'i18next-vue';
import { useProxiesStore } from '../stores/proxies.js';
import { useAppStore } from '../stores/app.js';

const { t } = useTranslation();
const proxiesStore = useProxiesStore();
const appStore = useAppStore();

const addModal = ref(false);
const importModal = ref(false);
const importText = ref('');
const addLoading = ref(false);
const importLoading = ref(false);
const checkLoading = ref(null);
const newProxy = reactive({
  type: 'socks5', host: '', port: 1080, username: '', password: '',
});

const editModal = ref(false);
const editLoading = ref(false);
const editProxy = reactive({
  id: null, type: 'socks5', host: '', port: 1080, username: '', password: '', proxy_rotation_url: '',
});

const columns = [
  { title: t('proxies.columns.status'), key: 'status', width: 100 },
  { title: t('proxies.columns.type'), key: 'type', width: 80 },
  { title: t('proxies.columns.connection'), key: 'connection', width: 200 },
  { title: t('proxies.columns.rotation'), dataIndex: 'proxy_rotation_url', width: 150 },
  { title: t('proxies.columns.ping'), dataIndex: 'last_ip', width: 120 },
  { title: 'Actions', key: 'actions', width: 220 },
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
  addLoading.value = true;
  try {
    await proxiesStore.create({ ...newProxy });
    addModal.value = false;
    message.success('Прокси добавлен');
  } catch (err) {
    message.error(err.message || 'Ошибка добавления прокси');
  } finally {
    addLoading.value = false;
  }
}

function showEditModal(record) {
  editProxy.id = record.id;
  editProxy.type = record.type;
  editProxy.host = record.host;
  editProxy.port = record.port;
  editProxy.username = record.username || '';
  editProxy.password = record.password || '';
  editProxy.proxy_rotation_url = record.proxy_rotation_url || '';
  editModal.value = true;
}

async function handleEditProxy() {
  editLoading.value = true;
  try {
    await proxiesStore.update(editProxy.id, {
      type: editProxy.type,
      host: editProxy.host,
      port: editProxy.port,
      username: editProxy.username,
      password: editProxy.password,
      proxy_rotation_url: editProxy.proxy_rotation_url,
    });
    editModal.value = false;
    message.success('Прокси обновлен');
  } catch (err) {
    message.error(err.message || 'Ошибка обновления прокси');
  } finally {
    editLoading.value = false;
  }
}

async function handleImport() {
  importLoading.value = true;
  try {
    const result = await proxiesStore.importBulk(importText.value);
    importModal.value = false;
    message.success(`Импортировано прокси: ${result.count}`);
  } catch (err) {
    message.error(err.message || 'Ошибка импорта прокси');
  } finally {
    importLoading.value = false;
  }
}

async function checkProxy(id) {
  checkLoading.value = id;
  try {
    const result = await proxiesStore.check(id);
    if (result.ok) {
      message.success(`Прокси работает. IP: ${result.ip}`);
    } else {
      message.warning(`Прокси недоступен: ${result.error}`);
    }
    await proxiesStore.fetchAll();
  } catch (err) {
    message.error(err.message || 'Ошибка проверки прокси');
  } finally {
    checkLoading.value = null;
  }
}

function deleteUnused() {
  // TODO: implement delete unused proxies
}

watch(() => appStore.initialized, (ready) => {
  if (ready) proxiesStore.fetchAll();
}, { immediate: true });
</script>
