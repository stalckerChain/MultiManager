<template>
  <div>
    <div class="flex items-center justify-between mb-4">
      <h1 class="text-xl font-bold">{{ t('extensions.title') }}</h1>
      <div class="flex items-center gap-2">
        <a-dropdown>
          <a-button type="primary">
            <PlusOutlined /> {{ t('extensions.add') }}
            <DownOutlined />
          </a-button>
          <template #overlay>
            <a-menu>
              <a-menu-item @click="addFromFolder">
                <FolderOpenOutlined /> {{ t('extensions.fromFolder') }}
              </a-menu-item>
              <a-menu-item @click="addFromZip">
                <FileZipOutlined /> {{ t('extensions.fromZip') }}
              </a-menu-item>
              <a-menu-item @click="showStoreModal = true">
                <GlobalOutlined /> {{ t('extensions.fromStore') }}
              </a-menu-item>
            </a-menu>
          </template>
        </a-dropdown>
      </div>
    </div>

    <a-modal v-model:open="showStoreModal" :title="t('extensions.storeModalTitle')" @ok="installFromStore" :confirm-loading="storeInstalling">
      <a-input v-model:value="storeUrl" :placeholder="t('extensions.storePlaceholder')" />
    </a-modal>

    <a-modal v-model:open="assignDialogVisible" title="Assign Extension" @ok="confirmAssign" :confirm-loading="assignLoading" ok-text="Assign to all profiles" cancel-text="Manual only">
      <p>Extension installed successfully.</p>
      <p class="text-sm text-slate-400 mt-1">Assign it to all existing profiles, or manage manually per-profile later?</p>
    </a-modal>

    <div v-if="loading" class="text-center py-20">
      <a-spin />
    </div>

    <div v-else-if="extensions.length === 0" class="text-center text-slate-500 py-20">
      <ToolOutlined class="text-4xl mb-3" />
      <div>{{ t('extensions.empty') }}</div>
      <div class="text-sm mt-2">Add Chrome extensions from folder, ZIP, or Chrome Web Store</div>
    </div>

    <div v-else class="grid grid-cols-4 gap-4">
      <div v-for="ext in extensions" :key="ext.id"
        class="bg-slate-800 rounded-lg p-4 border border-slate-700 hover:border-slate-500 transition">
        <div class="flex items-center gap-3 mb-3">
          <div class="w-12 h-12 rounded-lg bg-blue-500/20 flex items-center justify-center text-blue-400 font-bold text-lg">
            {{ ext.name[0]?.toUpperCase() || 'E' }}
          </div>
          <div class="flex-1 min-w-0">
            <div class="font-medium truncate">{{ ext.name }}</div>
            <div class="text-xs text-slate-400">v{{ ext.version }}</div>
          </div>
        </div>

        <div v-if="ext.description" class="text-xs text-slate-400 mb-3 line-clamp-2">
          {{ ext.description }}
        </div>

        <div class="flex items-center justify-between">
          <a-switch v-model:checked="ext.enabled" @change="toggleExtension(ext)" />
          <div class="flex items-center gap-1">
            <a-popconfirm :title="t('extensions.assignAllConfirm')" @confirm="assignExtension(ext)">
              <a-button size="small" type="link" class="text-xs text-blue-400 hover:text-blue-300">
                {{ t('extensions.assignAll') }}
              </a-button>
            </a-popconfirm>
            <a-popconfirm title="Remove this extension?" @confirm="removeExtension(ext)">
              <a-button size="small" type="text" danger>
                <DeleteOutlined />
              </a-button>
            </a-popconfirm>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, watch } from 'vue';
import { useTranslation } from 'i18next-vue';
import { PlusOutlined, DownOutlined, FolderOpenOutlined, FileZipOutlined, GlobalOutlined, ToolOutlined, DeleteOutlined } from '@ant-design/icons-vue';
import { message } from 'ant-design-vue';
import client from '../api/client.js';
import { useAppStore } from '../stores/app.js';

const { t } = useTranslation();
const appStore = useAppStore();

const extensions = ref([]);
const loading = ref(false);
const showStoreModal = ref(false);
const storeUrl = ref('');
const storeInstalling = ref(false);
const assignDialogVisible = ref(false);
const assignLoading = ref(false);
const lastInstalledId = ref('');

function showAssignDialog(extId) {
  lastInstalledId.value = extId;
  assignDialogVisible.value = true;
}

async function confirmAssign() {
  assignLoading.value = true;
  try {
    const { data } = await client.post(`/api/extensions/${lastInstalledId.value}/assign-all`);
    message.success(`Assigned to ${data.assigned} profile(s)`);
    assignDialogVisible.value = false;
  } catch (err) {
    message.error(err.message || 'Failed to assign');
  } finally {
    assignLoading.value = false;
  }
}

async function fetchExtensions() {
  loading.value = true;
  try {
    const { data } = await client.get('/api/extensions');
    extensions.value = data;
  } finally {
    loading.value = false;
  }
}

async function addFromFolder() {
  let folderPath;
  if (window.electronAPI) {
    folderPath = await window.electronAPI.invoke('dialog:select-folder');
  } else {
    message.error('Folder selection is only available in Electron');
    return;
  }
  if (!folderPath) return;

  try {
    const { data } = await client.post('/api/extensions', {
      name: folderPath.split(/[\\/]/).pop(),
      path: folderPath,
    });
    message.success('Extension added');
    await fetchExtensions();
    showAssignDialog(data.id);
  } catch (err) {
    message.error(err.message || 'Failed to add extension');
  }
}

async function addFromZip() {
  let zipPath;
  if (window.electronAPI) {
    zipPath = await window.electronAPI.invoke('dialog:select-zip');
  } else {
    message.error('File selection is only available in Electron');
    return;
  }
  if (!zipPath) return;

  try {
    const { data } = await client.post('/api/extensions/from-zip', {
      name: zipPath.split(/[\\/]/).pop().replace(/\.(zip|crx)$/i, ''),
      zipPath,
    });
    message.success('Extension installed from archive');
    await fetchExtensions();
    showAssignDialog(data.id);
  } catch (err) {
    message.error(err.message || 'Failed to install extension');
  }
}

async function installFromStore() {
  if (!storeUrl.value.trim()) {
    message.error('Please enter a Chrome Web Store URL or Extension ID');
    return;
  }

  storeInstalling.value = true;
  try {
    const { data } = await client.post('/api/extensions/from-store', { url: storeUrl.value.trim() });
    message.success('Extension installed from Chrome Web Store');
    showStoreModal.value = false;
    storeUrl.value = '';
    await fetchExtensions();
    showAssignDialog(data.id);
  } catch (err) {
    message.error(err.message || 'Failed to install extension');
  } finally {
    storeInstalling.value = false;
  }
}

async function toggleExtension(ext) {
  try {
    await client.post(`/api/extensions/${ext.id}/toggle`);
  } catch {
    ext.enabled = !ext.enabled;
  }
}

async function assignExtension(ext) {
  const hide = message.loading('Assigning...', 0);
  try {
    const { data } = await client.post(`/api/extensions/${ext.id}/assign-all`);
    hide();
    message.success(t('extensions.assignAllSuccess', { count: data.assigned }));
  } catch (err) {
    hide();
    message.error(err.message || 'Failed to assign');
  }
}

async function removeExtension(ext) {
  try {
    await client.delete(`/api/extensions/${ext.id}`);
    extensions.value = extensions.value.filter(e => e.id !== ext.id);
    message.success('Extension removed');
  } catch (err) {
    message.error(err.message);
  }
}

watch(() => appStore.initialized, (ready) => {
  if (ready) fetchExtensions();
}, { immediate: true });
</script>

<style scoped>
.line-clamp-2 {
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
</style>
