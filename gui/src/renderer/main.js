import { createApp } from 'vue';
import { createPinia } from 'pinia';
import Antd from 'ant-design-vue';
import 'ant-design-vue/dist/reset.css';
import './style.css';
import App from './App.vue';
import router from './router.js';
import { i18nPlugin, i18next } from './i18n/index.js';
import { useAppStore } from './stores/app.js';

const app = createApp(App);
const pinia = createPinia();

app.use(pinia);
app.use(router);
app.use(Antd);
app.use(i18nPlugin, { i18next });

// Init app (port + token) before mounting to prevent 401 on first API call
const appStore = useAppStore();
appStore.init().then(() => {
  app.mount('#app');
}).catch((err) => {
  console.error('[MAIN] init failed:', err);
  app.mount('#app');
});
