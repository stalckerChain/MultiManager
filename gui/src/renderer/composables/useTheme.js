import { watch } from 'vue';
import { useAppStore } from '../stores/app.js';

export function useTheme() {
  const appStore = useAppStore();

  function applyTheme(theme) {
    document.documentElement.classList.remove('light', 'dark');
    if (theme === 'system') {
      const isDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
      document.documentElement.classList.add(isDark ? 'dark' : 'light');
    } else {
      document.documentElement.classList.add(theme);
    }
  }

  function initTheme() {
    applyTheme(appStore.theme);
    watch(() => appStore.theme, applyTheme);

    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
      if (appStore.theme === 'system') {
        applyTheme('system');
      }
    });
  }

  return { initTheme };
}
