<template>
  <div v-if="visible" class="fixed inset-0 bg-black bg-opacity-70 flex items-center justify-center z-50">
    <div class="bg-slate-800 rounded-lg p-6 w-96 shadow-2xl border border-slate-700">
      <div class="flex items-center gap-3 mb-4">
        <div class="w-10 h-10 bg-blue-500 rounded-lg flex items-center justify-center">
          <span class="text-white text-xl font-bold">C</span>
        </div>
        <div>
          <h3 class="text-white font-semibold">CloakBrowser</h3>
          <p class="text-slate-400 text-sm">{{ statusText }}</p>
        </div>
      </div>

      <div v-if="status === 'installing'" class="mb-4">
        <div class="flex items-center gap-2 text-slate-400 text-sm">
          <svg class="animate-spin h-4 w-4" viewBox="0 0 24 24">
            <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4" fill="none"></circle>
            <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
          </svg>
          <span>Загрузка и установка Chromium...</span>
        </div>
        <p class="text-xs text-slate-500 mt-2">首次运行需要下载 ~200MB</p>
      </div>

      <div v-if="status === 'missing'" class="mb-4">
        <p class="text-yellow-400 text-sm mb-3">
          CloakBrowser не установлен. Нажмите "Установить" для загрузки.
        </p>
      </div>

      <div v-if="status === 'ready'" class="text-green-400 text-sm flex items-center gap-2 mb-4">
        <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"></path>
        </svg>
        <span>Готов к работе</span>
      </div>

      <div v-if="status === 'error'" class="mb-4">
        <p class="text-red-400 text-sm">{{ error }}</p>
      </div>

      <div class="flex gap-2">
        <button
          v-if="status === 'missing' || status === 'error'"
          @click="install"
          :disabled="status === 'installing'"
          class="flex-1 px-4 py-2 bg-blue-600 hover:bg-blue-500 disabled:bg-slate-600 text-white text-sm rounded transition-colors"
        >
          {{ status === 'installing' ? 'Установка...' : 'Установить' }}
        </button>
        <button
          @click="visible = false"
          class="flex-1 px-4 py-2 bg-slate-700 hover:bg-slate-600 text-white text-sm rounded transition-colors"
        >
          {{ status === 'ready' ? 'Закрыть' : 'Пропустить' }}
        </button>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted, computed } from 'vue';

const visible = ref(false);
const status = ref('checking');
const error = ref('');

const statusText = computed(() => {
  switch (status.value) {
    case 'checking': return 'Проверка...';
    case 'ready': return 'Установлен';
    case 'missing': return 'Не найден';
    case 'installing': return 'Установка...';
    case 'error': return 'Ошибка';
    default: return '';
  }
});

async function check() {
  if (!window.electronAPI) return;
  try {
    const result = await window.electronAPI.invoke('browser:check');
    if (result.installed) {
      status.value = 'ready';
      visible.value = false;
    } else {
      status.value = 'missing';
      visible.value = true;
    }
  } catch (e) {
    status.value = 'missing';
    visible.value = true;
  }
}

async function install() {
  status.value = 'installing';
  error.value = '';

  window.electronAPI.onBrowserInstallComplete((data) => {
    if (data.success) {
      status.value = 'ready';
      setTimeout(() => { visible.value = false; }, 1500);
    } else {
      status.value = 'error';
      error.value = data.error || 'Установка не удалась';
    }
  });

  try {
    await window.electronAPI.invoke('browser:install');
  } catch (e) {
    status.value = 'error';
    error.value = e.message || 'Установка не удалась';
  }
}

onMounted(() => check());
</script>
