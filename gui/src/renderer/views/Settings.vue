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
  </div>
</template>

<script setup>
import { ref } from 'vue';
import { EyeOutlined, EyeInvisibleOutlined } from '@ant-design/icons-vue';
import { useI18n } from 'vue-i18next';
import { useAppStore } from '../stores/app.js';

const { t } = useI18n();
const appStore = useAppStore();
const showToken = ref(false);
const theme = ref(appStore.theme);
const language = ref(appStore.language);

function handleThemeChange() {
  appStore.setTheme(theme.value);
}

function handleLanguageChange() {
  appStore.setLanguage(language.value);
}

function copyToken() {
  navigator.clipboard.writeText(appStore.token);
}
</script>
