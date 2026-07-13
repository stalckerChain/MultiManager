<template>
  <div>
    <h1 class="text-xl font-bold mb-6">{{ t('settings.title') }}</h1>

    <a-card :title="t('settings.server')" class="mb-4 max-w-lg">
      <a-descriptions :column="1" bordered size="small">
        <a-descriptions-item :label="t('settings.port')">
          <span class="font-mono">{{ appStore.port }}</span>
        </a-descriptions-item>
        <a-descriptions-item :label="t('settings.token')">
          <div class="flex items-center gap-2">
            <span class="font-mono select-all">{{ showToken ? appStore.token : '••••••••' }}</span>
            <a-button size="small" type="text" @click="showToken = !showToken">
              <EyeInvisibleOutlined v-if="showToken" />
              <EyeOutlined v-else />
            </a-button>
            <a-button size="small" type="text" @click="copyToken">Copy</a-button>
          </div>
        </a-descriptions-item>
      </a-descriptions>
    </a-card>

    <a-card :title="t('settings.theme')" class="mb-4 max-w-lg">
      <a-radio-group v-model:value="theme" button-style="solid" @change="handleThemeChange">
        <a-radio-button value="dark">{{ t('settings.themes.dark') }}</a-radio-button>
        <a-radio-button value="light">{{ t('settings.themes.light') }}</a-radio-button>
        <a-radio-button value="system">{{ t('settings.themes.system') }}</a-radio-button>
      </a-radio-group>
    </a-card>

    <a-card :title="t('settings.language')" class="mb-4 max-w-lg">
      <a-radio-group v-model:value="language" button-style="solid" @change="handleLanguageChange">
        <a-radio-button value="en">English</a-radio-button>
        <a-radio-button value="ru">Русский</a-radio-button>
        <a-radio-button value="zh">中文</a-radio-button>
      </a-radio-group>
    </a-card>

    <a-card :title="t('settings.security')" class="mb-4 max-w-lg">
      <a-descriptions :column="1" bordered size="small">
        <a-descriptions-item :label="t('settings.keyStorage')">
          <a-tag :color="cryptoStatus.source === 'keytar' ? 'green' : 'orange'">
            {{ cryptoStatus.source === 'keytar' ? t('settings.keyStorageKeytar') : t('settings.keyStorageConfig') }}
          </a-tag>
        </a-descriptions-item>
        <a-descriptions-item :label="t('settings.masterPassword')">
          <div class="flex items-center gap-2">
            <a-tag :color="cryptoStatus.hasPassword ? 'green' : 'default'">
              {{ cryptoStatus.hasPassword ? t('settings.masterPasswordEnabled') : t('settings.masterPasswordDisabled') }}
            </a-tag>
          </div>
        </a-descriptions-item>
      </a-descriptions>

      <div class="mt-4 flex flex-wrap gap-2">
        <a-button v-if="!cryptoStatus.hasPassword" type="primary" @click="showSetPassword = true">
          {{ t('settings.setPassword') }}
        </a-button>
        <a-button v-else @click="showChangePassword = true">
          {{ t('settings.changePassword') }}
        </a-button>
        <a-button @click="showRecoveryKey = !showRecoveryKey">
          {{ t('settings.recoveryKeyShow') }}
        </a-button>
      </div>

      <div v-if="showRecoveryKey && recoveryKeyValue" class="mt-3 p-3 bg-yellow-50 dark:bg-yellow-900/20 rounded text-sm">
        <p class="text-yellow-700 dark:text-yellow-300 mb-2 font-semibold">⚠ {{ t('settings.recoveryKeyWarning') }}</p>
        <code class="block p-2 bg-white dark:bg-gray-800 rounded font-mono text-xs break-all select-all">{{ recoveryKeyValue }}</code>
      </div>
    </a-card>

    <a-card :title="t('settings.automation')" class="mb-4 max-w-lg">
      <a-form layout="vertical">
        <a-form-item :label="t('settings.stAuto0Path')">
          <div class="flex gap-2">
            <a-input v-model:value="automation.stAuto0Path" :placeholder="t('settings.stAuto0PathPlaceholder')" class="flex-1" />
            <a-button @click="browseStAuto0">
              <FolderOpenOutlined />
            </a-button>
          </div>
        </a-form-item>
        <a-form-item :label="t('settings.pythonPath')">
          <div class="flex gap-2">
            <a-input v-model:value="automation.pythonPath" :placeholder="t('settings.pythonPathPlaceholder')" class="flex-1" />
            <a-button @click="browsePython">
              <FolderOpenOutlined />
            </a-button>
          </div>
        </a-form-item>
        <a-form-item :label="t('settings.parallelLimit')" :help="t('settings.parallelLimitHelp')">
          <a-input-number v-model:value="automation.parallelLimit" :min="1" :max="20" class="w-full" />
        </a-form-item>
        <a-form-item v-if="automation.availableProjects && automation.availableProjects.length > 0" :label="t('settings.availableProjects')">
          <div class="flex flex-wrap gap-1">
            <a-tag v-for="proj in automation.availableProjects" :key="proj">{{ proj }}</a-tag>
          </div>
        </a-form-item>
        <div class="flex gap-2">
          <a-button type="primary" :loading="savingAutomation" @click="saveAutomationSettings">
            {{ t('settings.saveAutomation') }}
          </a-button>
          <a-button :loading="syncingProjects" @click="handleSyncProjects">
            {{ t('settings.syncProjects') }}
          </a-button>
        </div>
      </a-form>
    </a-card>

    <a-modal v-model:open="showSetPassword" :title="t('settings.setPassword')" @ok="setPassword" :confirm-loading="settingPassword">
      <a-input-password v-model:value="newPwd" :placeholder="t('settings.newPassword')" class="mb-3" />
      <a-input-password v-model:value="confirmPwd" :placeholder="t('settings.confirmPassword')" />
    </a-modal>

    <a-modal v-model:open="showChangePassword" :title="t('settings.changePassword')" @ok="changePassword" :confirm-loading="changingPassword">
      <a-input-password v-model:value="currentPwd" :placeholder="t('settings.currentPassword')" class="mb-3" />
      <a-input-password v-model:value="newPwd" :placeholder="t('settings.newPassword')" class="mb-3" />
      <a-input-password v-model:value="confirmPwd" :placeholder="t('settings.confirmPassword')" />
    </a-modal>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue';
import { EyeOutlined, EyeInvisibleOutlined, FolderOpenOutlined } from '@ant-design/icons-vue';
import { useTranslation } from 'i18next-vue';
import { useAppStore } from '../stores/app.js';
import { useAutomationStore } from '../stores/automation.js';
import client from '../api/client.js';
import { message } from 'ant-design-vue';

const { t } = useTranslation();
const appStore = useAppStore();

const showToken = ref(false);
const theme = ref(appStore.theme);
const language = ref(appStore.language);

const cryptoStatus = ref({ source: 'system_config', hasPassword: false });
const recoveryKeyValue = ref('');
const showRecoveryKey = ref(false);

const showSetPassword = ref(false);
const showChangePassword = ref(false);
const newPwd = ref('');
const confirmPwd = ref('');
const currentPwd = ref('');
const settingPassword = ref(false);
const changingPassword = ref(false);

const automation = ref({
  stAuto0Path: '',
  pythonPath: '',
  parallelLimit: 2,
  availableProjects: [],
});
const savingAutomation = ref(false);
const syncingProjects = ref(false);

function handleThemeChange() {
  appStore.setTheme(theme.value);
}

function handleLanguageChange() {
  appStore.setLanguage(language.value);
}

function copyToken() {
  navigator.clipboard.writeText(appStore.token);
}

async function fetchCryptoStatus() {
  try {
    const { data } = await client.get('/api/settings/crypto-status');
    cryptoStatus.value = data;
  } catch {
    cryptoStatus.value = { source: 'system_config', hasPassword: false };
  }
}

async function fetchRecoveryKey() {
  try {
    const { data } = await client.get('/api/settings/recovery-key');
    recoveryKeyValue.value = data.recovery_key || '';
  } catch {
    recoveryKeyValue.value = '';
  }
}

async function fetchAutomation() {
  try {
    const { data } = await client.get('/api/settings/automation');
    automation.value = data;
  } catch {
  }
}

async function setPassword() {
  if (newPwd.value !== confirmPwd.value) {
    message.error(t('settings.passwordMismatch'));
    return;
  }
  settingPassword.value = true;
  try {
    await client.post('/api/settings/set-master-password', { password: newPwd.value });
    message.success(t('settings.passwordSetSuccess'));
    showSetPassword.value = false;
    newPwd.value = '';
    confirmPwd.value = '';
    await fetchCryptoStatus();
  } catch (err) {
    message.error(err.message);
  } finally {
    settingPassword.value = false;
  }
}

async function changePassword() {
  if (newPwd.value !== confirmPwd.value) {
    message.error(t('settings.passwordMismatch'));
    return;
  }
  changingPassword.value = true;
  try {
    await client.post('/api/settings/change-master-password', {
      currentPassword: currentPwd.value,
      newPassword: newPwd.value,
    });
    message.success(t('settings.passwordSetSuccess'));
    showChangePassword.value = false;
    currentPwd.value = '';
    newPwd.value = '';
    confirmPwd.value = '';
    await fetchCryptoStatus();
  } catch (err) {
    message.error(err.message);
  } finally {
    changingPassword.value = false;
  }
}

async function saveAutomationSettings() {
  savingAutomation.value = true;
  try {
    await client.put('/api/settings/automation', {
      stAuto0Path: automation.value.stAuto0Path,
      pythonPath: automation.value.pythonPath,
      parallelLimit: automation.value.parallelLimit,
    });
    message.success(t('settings.automationSaved'));
  } catch (err) {
    message.error(err.message);
  } finally {
    savingAutomation.value = false;
  }
}

async function handleSyncProjects() {
  syncingProjects.value = true;
  try {
    const autoStore = useAutomationStore();
    const result = await autoStore.syncProjects();
    message.success(t('settings.syncProjectsResult', { added: result.added || 0, removed: result.removed || 0 }));
    await fetchAutomation();
  } catch (err) {
    message.error(err.message || t('common.error'));
  } finally {
    syncingProjects.value = false;
  }
}

async function browseStAuto0() {
  if (!window.electronAPI?.selectFolder) return;
  const dir = await window.electronAPI.selectFolder();
  if (dir) {
    automation.value.stAuto0Path = dir;
  }
}

async function browsePython() {
  if (!window.electronAPI?.selectFile) return;
  const file = await window.electronAPI.selectFile([{ name: 'Python', extensions: ['exe', 'bat', 'cmd'] }]);
  if (file) {
    automation.value.pythonPath = file;
  }
}

onMounted(() => {
  fetchCryptoStatus();
  fetchRecoveryKey();
  fetchAutomation();
});
</script>