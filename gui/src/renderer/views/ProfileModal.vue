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
          <a-form-item :label="t('profiles.modal.timezone')">
            <a-select v-model:value="form.timezone">
              <a-select-option value="Asia/Bishkek">Asia/Bishkek</a-select-option>
              <a-select-option value="Asia/Tokyo">Asia/Tokyo</a-select-option>
              <a-select-option value="Europe/Berlin">Europe/Berlin</a-select-option>
              <a-select-option value="Europe/London">Europe/London</a-select-option>
              <a-select-option value="America/New_York">America/New_York</a-select-option>
              <a-select-option value="UTC">UTC</a-select-option>
            </a-select>
          </a-form-item>
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

      <a-tab-pane key="accounts" :tab="t('profiles.modal.accounts')">
        <AccountsTab :model="form" />
      </a-tab-pane>

      <a-tab-pane key="wallets" :tab="t('profiles.modal.wallets')">
        <WalletsTab :model="form" />
      </a-tab-pane>

      <a-tab-pane key="advanced" :tab="`${t('profiles.modal.advanced')}${form.extensions.length ? ' (' + form.extensions.length + ')' : ''}`">
        <a-form layout="vertical">
          <a-form-item :label="t('profiles.modal.extensions')">
            <template #extra>
              <span class="text-xs text-slate-400">Check extensions to load in this profile's browser</span>
            </template>
            <div v-if="extensionsLoading" class="text-sm text-slate-400">Loading...</div>
            <div v-else-if="allExtensions.length === 0" class="text-sm text-slate-400">No extensions available. Add them in Extensions manager.</div>
            <a-checkbox-group v-else v-model:value="form.extensions">
              <div class="flex flex-col gap-2">
                <div v-for="ext in allExtensions" :key="ext.id" class="flex items-center gap-2">
                  <a-checkbox :value="ext.id" :disabled="!ext.enabled" />
                  <span class="text-sm" :class="{ 'text-slate-500': !ext.enabled }">
                    {{ ext.name }}
                    <span class="text-xs text-slate-500">v{{ ext.version }}</span>
                    <span v-if="!ext.enabled" class="text-xs text-yellow-500">(disabled)</span>
                  </span>
                </div>
              </div>
            </a-checkbox-group>
          </a-form-item>
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
import AccountsTab from '../components/AccountsTab.vue';
import WalletsTab from '../components/WalletsTab.vue';

const { t } = useTranslation();
const proxiesStore = useProxiesStore();

const props = defineProps({
  open: Boolean,
  profile: Object,
});

const emit = defineEmits(['update:open', 'save']);

const activeTab = ref('basic');
const allExtensions = ref([]);
const extensionsLoading = ref(false);
const form = reactive({
  name: '',
  tags: [],
  platform: 'windows',
  proxy_id: null,
  extensions: [],
  notes: '',
  user_agent: '',
  screen_resolution: '',
  timezone: 'Asia/Bishkek',
  email: '',
  email_password: '',
  twitter_username: '',
  twitter_password: '',
  twitter_auth_token: '',
  twitter_email: '',
  discord_username: '',
  discord_password: '',
  discord_token: '',
  discord_email: '',
  wallet_evm_address: '',
  wallet_sol_address: '',
  wallet_password: 'asdfj*KK',
});

async function fetchExtensions() {
  extensionsLoading.value = true;
  try {
    const { data } = await client.get('/api/extensions');
    allExtensions.value = data;
  } catch {
    allExtensions.value = [];
  } finally {
    extensionsLoading.value = false;
  }
}

watch(() => props.open, (isOpen) => {
  if (isOpen) fetchExtensions();
});

watch(() => props.profile, (p) => {
  if (p) {
    Object.assign(form, {
      name: p.name,
      tags: tryParse(p.tags),
      platform: p.platform,
      proxy_id: p.proxy_id,
      extensions: tryParse(p.extensions),
      notes: p.notes || '',
      user_agent: p.user_agent,
      screen_resolution: p.screen_resolution,
      timezone: p.timezone || 'Asia/Bishkek',
      email: p.email || '',
      email_password: p.email_password || '',
      twitter_username: p.twitter_username || '',
      twitter_password: p.twitter_password || '',
      twitter_auth_token: p.twitter_auth_token || '',
      twitter_email: p.twitter_email || '',
      discord_username: p.discord_username || '',
      discord_password: p.discord_password || '',
      discord_token: p.discord_token || '',
      discord_email: p.discord_email || '',
      wallet_evm_address: p.wallet_evm_address || '',
      wallet_sol_address: p.wallet_sol_address || '',
      wallet_password: p.wallet_password || 'asdfj*KK',
    });
  } else {
    Object.assign(form, {
      name: '', tags: [], platform: 'windows', proxy_id: null,
      extensions: [], notes: '', user_agent: '', screen_resolution: '',
      timezone: 'Asia/Bishkek',
      email: '', email_password: '',
      twitter_username: '', twitter_password: '', twitter_auth_token: '', twitter_email: '',
      discord_username: '', discord_password: '', discord_token: '', discord_email: '',
      wallet_evm_address: '', wallet_sol_address: '', wallet_password: 'asdfj*KK',
    });
  }
}, { immediate: true });

function tryParse(json) {
  try { return JSON.parse(json); } catch { return []; }
}

async function generateFingerprint() {
  const { data } = await client.post('/api/fingerprint/generate', {
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
