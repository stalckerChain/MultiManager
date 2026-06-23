<template>
  <div class="h-screen flex flex-col bg-slate-900 text-white">
    <header class="h-12 border-b border-slate-700 flex items-center px-4 justify-between drag-region">
      <div class="flex items-center gap-3 no-drag">
        <span class="font-bold text-blue-400">MultiManager</span>
        <a-menu mode="horizontal" :selected-keys="selectedKeys" theme="dark" class="border-none bg-transparent"
          @click="handleMenuClick">
          <a-menu-item key="profiles">{{ t('nav.profiles') }}</a-menu-item>
          <a-menu-item key="proxies">{{ t('nav.proxies') }}</a-menu-item>
          <a-menu-item key="extensions">{{ t('nav.extensions') }}</a-menu-item>
        </a-menu>
      </div>
      <div class="flex items-center gap-3 no-drag">
        <a-dropdown>
          <a-button size="small" ghost>{{ languageLabel }}</a-button>
          <template #overlay>
            <a-menu @click="handleLanguageChange">
              <a-menu-item key="en">English</a-menu-item>
              <a-menu-item key="ru">Русский</a-menu-item>
              <a-menu-item key="zh">中文</a-menu-item>
            </a-menu>
          </template>
        </a-dropdown>
        <span :class="connected ? 'text-green-400' : 'text-red-400'" class="text-xs">
          {{ connected ? '● WS' : '○ WS' }}
        </span>
        <a-dropdown>
          <a-button size="small" ghost>{{ t(`settings.themes.${appStore.theme}`) }}</a-button>
          <template #overlay>
            <a-menu @click="handleThemeChange">
              <a-menu-item key="dark">{{ t('settings.themes.dark') }}</a-menu-item>
              <a-menu-item key="light">{{ t('settings.themes.light') }}</a-menu-item>
              <a-menu-item key="system">{{ t('settings.themes.system') }}</a-menu-item>
            </a-menu>
          </template>
        </a-dropdown>
        <a-button size="small" @click="$router.push('settings')">
          {{ t('nav.settings') }}
        </a-button>
      </div>
    </header>

    <main class="flex-1 overflow-auto p-4">
      <slot />
    </main>

    <StatusBar />
  </div>
</template>

<script setup>
import { computed } from 'vue';
import { useRouter, useRoute } from 'vue-router';
import { useI18n } from 'vue-i18next';
import { useAppStore } from '../stores/app.js';
import { useWebSocket } from '../composables/useWebSocket.js';
import StatusBar from './StatusBar.vue';

const { t } = useI18n();
const router = useRouter();
const route = useRoute();
const appStore = useAppStore();
const { connected } = useWebSocket();

const selectedKeys = computed(() => [route.name]);

const languageLabel = computed(() => {
  const labels = { en: 'EN', ru: 'RU', zh: '中文' };
  return labels[appStore.language] || 'EN';
});

function handleMenuClick({ key }) {
  router.push(`/${key}`);
}

function handleLanguageChange({ key }) {
  appStore.setLanguage(key);
}

function handleThemeChange({ key }) {
  appStore.setTheme(key);
}
</script>

<style scoped>
.drag-region {
  -webkit-app-region: drag;
}
.no-drag {
  -webkit-app-region: no-drag;
}
</style>
