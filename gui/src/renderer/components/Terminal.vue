<template>
  <div class="bg-slate-900 border-t border-slate-700 flex flex-col" :style="{ height: expanded ? '300px' : '32px' }">
    <div class="h-8 flex items-center justify-between px-3 cursor-pointer select-none border-b border-slate-700"
      @click="expanded = !expanded">
      <div class="flex items-center gap-2">
        <span class="font-medium text-sm" :class="isRunning ? 'text-green-400' : ''">Terminal</span>
        <a-tag v-if="isRunning" color="green" size="small">LIVE</a-tag>
        <a-tag v-else color="default" size="small">STOPPED</a-tag>
      </div>
      <div class="flex items-center gap-2">
        <a-input v-model:value="filePath" size="small" placeholder="Path to log file"
          style="width: 400px" class="font-mono text-xs" @click.stop />
        <a-button size="small" type="primary" @click.stop="toggleTail">
          {{ isRunning ? 'Stop' : 'Tail' }}
        </a-button>
        <span class="text-xs text-slate-500">{{ expanded ? '▼' : '▶' }}</span>
      </div>
    </div>

    <div v-show="expanded" ref="terminalContainer" class="flex-1 overflow-hidden bg-black"></div>
  </div>
</template>

<script setup>
import { ref, onMounted, onUnmounted, watch, nextTick } from 'vue';
import { useAppStore } from '../stores/app.js';

const appStore = useAppStore();
const expanded = ref(false);
const terminalContainer = ref(null);
const filePath = ref('');
const isRunning = ref(false);

let terminal = null;
let fitAddon = null;
let disposePtyData = null;
let disposePtyError = null;

async function toggleTail() {
  if (isRunning.value) {
    await stopTail();
  } else {
    await startTail();
  }
}

async function startTail() {
  if (!filePath.value) return;

  const api = window.electronAPI;
  if (!api) return;

  const result = await api.ptyStart(filePath.value);
  if (result.success) {
    isRunning.value = true;
  }
}

async function stopTail() {
  const api = window.electronAPI;
  if (!api) return;

  await api.ptyStop();
  isRunning.value = false;
}

function writeToTerminal(data) {
  if (terminal && !terminal._disposed) {
    try {
      terminal.write(data);
    } catch (e) {
      // terminal disposed
    }
  }
}

async function initTerminal() {
  if (!terminalContainer.value) return;

  const { Terminal } = await import('xterm');
  const { FitAddon } = await import('xterm-addon-fit');

  terminal = new Terminal({
    cursorBlink: true,
    cursorStyle: 'block',
    fontSize: 12,
    fontFamily: 'Consolas, "Courier New", monospace',
    theme: {
      background: '#000000',
      foreground: '#f0f0f0',
      cursor: '#f0f0f0',
      selectionBackground: '#404040',
      black: '#2e3436',
      red: '#cc0000',
      green: '#4e9a06',
      yellow: '#c4a000',
      blue: '#3465a4',
      magenta: '#75507b',
      cyan: '#06989a',
      white: '#d3d7cf',
    },
    allowProposedApi: true,
    cols: 80,
    rows: 15,
  });

  fitAddon = new FitAddon();
  terminal.loadAddon(fitAddon);

  terminal.open(terminalContainer.value);

  try {
    fitAddon.fit();
  } catch (e) {}

  const api = window.electronAPI;
  if (api) {
    disposePtyData = api.onPtyData(writeToTerminal);
    disposePtyError = (error) => {
      writeToTerminal(`\r\n\x1b[31mError: ${error}\x1b[0m\r\n`);
    };
  }
}

function disposeTerminal() {
  if (disposePtyData) {
    disposePtyData();
    disposePtyData = null;
  }
  if (terminal) {
    terminal.dispose();
    terminal = null;
    fitAddon = null;
  }
}

watch(expanded, async (val) => {
  if (val) {
    await nextTick();
    if (fitAddon) {
      try { fitAddon.fit(); } catch (e) {}
    }
  }
});

watch(() => appStore.initialized, async (ready) => {
  if (ready) {
    await nextTick();
    if (expanded.value) {
      await initTerminal();
    }
  }
});

onMounted(async () => {
  await initTerminal();
});

onUnmounted(async () => {
  await stopTail();
  disposeTerminal();
});
</script>

<style>
.xterm {
  height: 100%;
  padding: 4px;
}
.xterm-viewport {
  scrollbar-width: thin;
}
</style>
