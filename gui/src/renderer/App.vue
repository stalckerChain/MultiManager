<template>
  <a-config-provider :theme="antTheme">
    <div class="h-screen flex flex-col">
      <Layout>
        <router-view />
      </Layout>
    </div>
    <BrowserDownload />
  </a-config-provider>
</template>

<script setup>
import { computed, onMounted } from 'vue';
import { theme } from 'ant-design-vue';
import Layout from './components/Layout.vue';
import BrowserDownload from './components/BrowserDownload.vue';
import { useAppStore } from './stores/app.js';
import { useTheme } from './composables/useTheme.js';

const appStore = useAppStore();
const { initTheme } = useTheme();

const antTheme = computed(() => ({
  algorithm: appStore.theme === 'dark' ? theme.darkAlgorithm : theme.defaultAlgorithm,
}));

onMounted(async () => {
  await appStore.init();
  initTheme();
});
</script>
