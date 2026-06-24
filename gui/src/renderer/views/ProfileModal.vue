<template>
  <a-modal :open="open" :title="profile ? 'Edit Profile' : t('profiles.create')" width="600px"
    @cancel="handleCancel" @ok="handleOk">
    <a-tabs v-model:activeKey="activeTab">
      <a-tab-pane key="basic" :tab="t('profiles.modal.basic')">
        <a-form layout="vertical">
          <a-form-item :label="t('profiles.modal.name')">
            <a-input v-model:value="form.name" />
          </a-form-item>
          <a-form-item :label="t('profiles.modal.tags')">
            <a-select v-model:value="form.tags" mode="tags" />
          </a-form-item>
          <a-form-item :label="t('profiles.modal.platform')">
            <a-radio-group v-model:value="form.platform">
              <a-radio-button value="windows">Windows</a-radio-button>
              <a-radio-button value="macos">macOS</a-radio-button>
              <a-radio-button value="linux">Linux</a-radio-button>
            </a-radio-group>
          </a-form-item>
          <a-button type="dashed" block @click="generateFingerprint">
            {{ t('profiles.modal.generate') }}
          </a-button>
          <a-divider />
          <div class="grid grid-cols-2 gap-3">
            <a-form-item label="User-Agent">
              <a-textarea v-model:value="form.user_agent" :rows="2" disabled />
            </a-form-item>
            <a-form-item :label="t('profiles.modal.platform')">
              <a-input v-model:value="form.screen_resolution" disabled />
            </a-form-item>
          </div>
        </a-form>
      </a-tab-pane>

      <a-tab-pane key="proxy" :tab="t('profiles.modal.proxy')">
        <a-form layout="vertical">
          <a-form-item :label="t('profiles.modal.selectProxy')">
            <a-select v-model:value="form.proxy_id" :placeholder="t('profiles.modal.noProxy')" allow-clear>
              <a-select-option v-for="p in proxiesStore.proxies" :key="p.id" :value="p.id">
                {{ p.type }}://{{ p.host }}:{{ p.port }}
              </a-select-option>
            </a-select>
          </a-form-item>
        </a-form>
      </a-tab-pane>

      <a-tab-pane key="advanced" :tab="t('profiles.modal.advanced')">
        <a-form layout="vertical">
          <a-form-item :label="t('profiles.modal.notes')">
            <a-textarea v-model:value="form.notes" :rows="4" />
          </a-form-item>
        </a-form>
      </a-tab-pane>
    </a-tabs>
  </a-modal>
</template>

<script setup>
import { ref, watch, reactive } from 'vue';
import { useTranslation } from 'i18next-vue';
import { useProxiesStore } from '../stores/proxies.js';
import client from '../api/client.js';

const { t } = useTranslation();
const proxiesStore = useProxiesStore();

const props = defineProps({
  open: Boolean,
  profile: Object,
});

const emit = defineEmits(['update:open', 'save']);

const activeTab = ref('basic');
const form = reactive({
  name: '',
  tags: [],
  platform: 'windows',
  proxy_id: null,
  notes: '',
  user_agent: '',
  screen_resolution: '',
});

watch(() => props.profile, (p) => {
  if (p) {
    Object.assign(form, {
      name: p.name,
      tags: tryParse(p.tags),
      platform: p.platform,
      proxy_id: p.proxy_id,
      notes: p.notes || '',
      user_agent: p.user_agent,
      screen_resolution: p.screen_resolution,
    });
  } else {
    Object.assign(form, {
      name: '', tags: [], platform: 'windows', proxy_id: null,
      notes: '', user_agent: '', screen_resolution: '',
    });
  }
}, { immediate: true });

function tryParse(json) {
  try { return JSON.parse(json); } catch { return []; }
}

async function generateFingerprint() {
  const { data } = await client.post('/api/profiles', {
    name: form.name || 'Generated',
    platform: form.platform,
  });
  form.user_agent = data.user_agent;
  form.screen_resolution = data.screen_resolution;
}

function handleCancel() {
  emit('update:open', false);
}

function handleOk() {
  emit('save', { ...form });
}
</script>
