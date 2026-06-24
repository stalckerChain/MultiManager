<template>
  <div>
    <div class="flex items-center justify-between mb-4">
      <h1 class="text-xl font-bold">{{ t('extensions.title') }}</h1>
      <div class="flex items-center gap-2">
        <a-button type="primary" @click="addFromFolder">
          <FolderOpenOutlined /> Add from Folder
        </a-button>
        <input ref="folderInput" type="file" webkitdirectory style="display: none" @change="handleFolderSelect" />
      </div>
    </div>

    <div v-if="loading" class="text-center py-20">
      <a-spin />
    </div>

    <div v-else-if="extensions.length === 0" class="text-center text-slate-500 py-20">
      <ToolOutlined class="text-4xl mb-3" />
      <div>{{ t('extensions.empty') }}</div>
      <div class="text-sm mt-2">Add Chrome extensions by selecting a folder</div>
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
          <a-button size="small" type="text" danger @click="removeExtension(ext)">
            <DeleteOutlined />
          </a-button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue';
import { useI18n } from 'vue-i18next';
import { FolderOpenOutlined, ToolOutlined, DeleteOutlined } from '@ant-design/icons-vue';
import { message, Modal } from 'ant-design-vue';
import client from '../api/client.js';

const { t } = useI18n();

const extensions = ref([]);
const loading = ref(false);
const folderInput = ref(null);

async function fetchExtensions() {
  loading.value = true;
  try {
    const { data } = await client.get('/api/extensions');
    extensions.value = data;
  } finally {
    loading.value = false;
  }
}

function addFromFolder() {
  folderInput.value?.click();
}

async function handleFolderSelect(e) {
  const files = Array.from(e.target.files);
  if (files.length === 0) return;

  const manifestFile = files.find(f => f.name === 'manifest.json');
  if (!manifestFile) {
    message.error('Selected folder does not contain manifest.json');
    return;
  }

  try {
    const text = await manifestFile.text();
    const manifest = JSON.parse(text);
    const folderPath = files[0].webkitRelativePath.split('/')[0];

    await client.post('/api/extensions', {
      name: manifest.name || folderPath,
      path: `/tmp/ext_${Date.now()}`,
    });

    message.success(`Extension "${manifest.name}" added`);
    await fetchExtensions();
  } catch (err) {
    message.error(err.message || 'Failed to add extension');
  }

  e.target.value = '';
}

async function toggleExtension(ext) {
  try {
    await client.post(`/api/extensions/${ext.id}/toggle`);
  } catch {
    ext.enabled = !ext.enabled;
  }
}

function removeExtension(ext) {
  Modal.confirm({
    title: 'Remove Extension',
    content: `Remove "${ext.name}"?`,
    okType: 'danger',
    onOk: async () => {
      try {
        await client.delete(`/api/extensions/${ext.id}`);
        extensions.value = extensions.value.filter(e => e.id !== ext.id);
        message.success('Extension removed');
      } catch (err) {
        message.error(err.message);
      }
    },
  });
}

onMounted(() => fetchExtensions());
</script>

<style scoped>
.line-clamp-2 {
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
</style>
