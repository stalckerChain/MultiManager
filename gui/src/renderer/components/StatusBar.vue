<template>
  <footer class="h-8 border-t border-slate-700 flex items-center px-4 justify-between text-xs text-slate-400">
    <div class="flex items-center gap-3">
      <span :class="statusColor">{{ statusText }}</span>
      <span>Port: {{ appStore.port }}</span>
    </div>
    <div class="flex items-center gap-2">
      <span>API Token:</span>
      <a-button size="small" type="text" @click="toggleToken">
        <template #icon>
          <EyeInvisibleOutlined v-if="!showToken" />
          <EyeOutlined v-else />
        </template>
      </a-button>
      <span v-if="showToken" class="font-mono text-slate-300 select-all">{{ appStore.token }}</span>
      <a-button v-if="showToken" size="small" type="text" @click="copyToken">
        <template #icon><CopyOutlined /></template>
      </a-button>
    </div>
  </footer>
</template>

<script setup>
import { ref, computed } from 'vue';
import { EyeOutlined, EyeInvisibleOutlined, CopyOutlined } from '@ant-design/icons-vue';
import { useAppStore } from '../stores/app.js';

const appStore = useAppStore();
const showToken = ref(false);

const statusColor = computed(() =>
  appStore.serverStatus === 'connected' ? 'text-green-400' : 'text-red-400'
);

const statusText = computed(() =>
  appStore.serverStatus === 'connected' ? '● Connected' : '● Disconnected'
);

function toggleToken() {
  showToken.value = !showToken.value;
}

function copyToken() {
  navigator.clipboard.writeText(appStore.token);
}
</script>
