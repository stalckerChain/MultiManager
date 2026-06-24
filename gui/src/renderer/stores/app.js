import { defineStore } from 'pinia';
import { ref } from 'vue';
import { setBaseURL, setAuthToken } from '../api/client.js';
import i18next from '../i18n/index.js';

export const useAppStore = defineStore('app', () => {
  const port = ref(3000);
  const token = ref('');
  const theme = ref('dark');
  const language = ref('en');
  const serverStatus = ref('disconnected');

  async function init() {
    if (window.electronAPI) {
      port.value = await window.electronAPI.getPort();
      token.value = await window.electronAPI.getToken();
    }
    setBaseURL(port.value);
    setAuthToken(token.value);
    serverStatus.value = 'connected';
  }

  function setTheme(newTheme) {
    theme.value = newTheme;
    document.documentElement.classList.remove('light', 'dark');
    if (newTheme === 'system') {
      const isDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
      document.documentElement.classList.add(isDark ? 'dark' : 'light');
    } else {
      document.documentElement.classList.add(newTheme);
    }
  }

  function setLanguage(lang) {
    language.value = lang;
    i18next.changeLanguage(lang);
  }

  return { port, token, theme, language, serverStatus, init, setTheme, setLanguage };
});
