<template>
  <a-modal v-model:open="visible" title="Import Cookies" width="500px" @cancel="handleClose" @ok="handleImport"
    :confirm-loading="importing">
    <div v-if="!parsedCookies" class="cookie-drop-zone" :class="{ 'drag-over': isDragging }"
      @dragover.prevent="isDragging = true" @dragleave="isDragging = false"
      @drop.prevent="handleDrop" @click="openFileDialog">
      <input ref="fileInput" type="file" accept=".json,.txt" style="display: none" @change="handleFileSelect" />
      <CloudUploadOutlined class="text-4xl text-slate-400 mb-3" />
      <div class="text-lg font-medium mb-1">Drop cookie file here</div>
      <div class="text-sm text-slate-400">Supports JSON and Netscape TXT formats</div>
      <div class="text-xs text-slate-500 mt-2">or click to browse</div>
    </div>

    <div v-else>
      <a-alert type="success" class="mb-3">
        <template #message>
          Found {{ parsedCookies.length }} cookies for {{ uniqueDomains.length }} sites
        </template>
        <template #description>
          <div class="flex flex-wrap gap-1 mt-1">
            <a-tag v-for="domain in uniqueDomains.slice(0, 10)" :key="domain" size="small" color="blue">
              {{ domain }}
            </a-tag>
            <a-tag v-if="uniqueDomains.length > 10" size="small">+{{ uniqueDomains.length - 10 }} more</a-tag>
          </div>
        </template>
      </a-alert>

      <a-table :data-source="parsedCookies.slice(0, 10)" size="small" :pagination="false" :columns="columns"
        row-key="name" :scroll="{ y: 200 }">
        <template #bodyCell="{ column, record }">
          <template v-if="column.key === 'domain'">
            <span class="font-mono text-xs">{{ record.domain }}</span>
          </template>
          <template v-if="column.key === 'flags'">
            <a-space>
              <a-tag v-if="record.httpOnly" size="small" color="orange">HttpOnly</a-tag>
              <a-tag v-if="record.secure" size="small" color="green">Secure</a-tag>
            </a-space>
          </template>
        </template>
      </a-table>

      <div v-if="parsedCookies.length > 10" class="text-center text-xs text-slate-400 mt-2">
        Showing 10 of {{ parsedCookies.length }} cookies
      </div>
    </div>
  </a-modal>
</template>

<script setup>
import { ref, computed } from 'vue';
import { CloudUploadOutlined } from '@ant-design/icons-vue';
import client from '../api/client.js';

const props = defineProps({
  profileId: String,
});

const emit = defineEmits(['update:open', 'imported']);

const visible = defineModel('open', { type: Boolean });
const fileInput = ref(null);
const isDragging = ref(false);
const importing = ref(false);
const parsedCookies = ref(null);

const columns = [
  { title: 'Name', dataIndex: 'name', key: 'name', ellipsis: true },
  { title: 'Domain', key: 'domain', width: 150 },
  { title: 'Flags', key: 'flags', width: 120 },
];

const uniqueDomains = computed(() => {
  if (!parsedCookies.value) return [];
  return [...new Set(parsedCookies.value.map(c => c.domain))].sort();
});

function openFileDialog() {
  fileInput.value?.click();
}

function handleFileSelect(e) {
  const file = e.target.files[0];
  if (file) parseFile(file);
}

function handleDrop(e) {
  isDragging.value = false;
  const file = e.dataTransfer.files[0];
  if (file) parseFile(file);
}

async function parseFile(file) {
  const text = await file.text();
  const ext = file.name.split('.').pop().toLowerCase();

  try {
    if (ext === 'json') {
      parsedCookies.value = parseJsonCookies(text);
    } else if (ext === 'txt') {
      parsedCookies.value = parseNetscapeCookies(text);
    } else {
      // Try JSON first, then Netscape
      try {
        parsedCookies.value = parseJsonCookies(text);
      } catch {
        parsedCookies.value = parseNetscapeCookies(text);
      }
    }
  } catch (err) {
    console.error('Failed to parse cookies:', err);
    parsedCookies.value = [];
  }
}

function parseJsonCookies(text) {
  const data = JSON.parse(text);
  const cookies = Array.isArray(data) ? data : data.cookies || [];
  return cookies.map(c => ({
    name: c.name,
    value: c.value,
    domain: c.domain,
    path: c.path || '/',
    httpOnly: c.httpOnly || c.http_only || false,
    secure: c.secure || false,
    expires: c.expirationDate || c.expires || -1,
  }));
}

function parseNetscapeCookies(text) {
  const lines = text.split('\n').filter(l => l.trim() && !l.startsWith('#'));
  return lines.map(line => {
    const parts = line.split('\t');
    if (parts.length < 7) return null;
    return {
      domain: parts[0],
      httpOnly: parts[1] === 'TRUE',
      path: parts[2],
      secure: parts[3] === 'TRUE',
      expires: parseInt(parts[4]) || -1,
      name: parts[5],
      value: parts[6],
    };
  }).filter(Boolean);
}

async function handleImport() {
  if (!parsedCookies.value || !props.profileId) return;

  importing.value = true;
  try {
    const content = JSON.stringify(parsedCookies.value);
    await client.post(`/api/cookies/${props.profileId}/import`, {
      format: 'json',
      content,
    });
    emit('imported');
    handleClose();
  } finally {
    importing.value = false;
  }
}

function handleClose() {
  parsedCookies.value = null;
  isDragging.value = false;
  visible.value = false;
}
</script>

<style scoped>
.cookie-drop-zone {
  border: 2px dashed #334155;
  border-radius: 8px;
  padding: 40px;
  text-align: center;
  cursor: pointer;
  transition: all 0.2s;
}

.cookie-drop-zone:hover,
.cookie-drop-zone.drag-over {
  border-color: #3b82f6;
  background: rgba(59, 130, 246, 0.05);
}
</style>
