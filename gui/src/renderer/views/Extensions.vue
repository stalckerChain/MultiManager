<template>
  <div>
    <div class="flex items-center justify-between mb-4">
      <h1 class="text-xl font-bold">{{ t('extensions.title') }}</h1>
      <a-button type="primary" @click="addExtension">{{ t('extensions.add') }}</a-button>
    </div>

    <div v-if="extensions.length === 0" class="text-center text-slate-500 py-20">
      {{ t('extensions.empty') }}
    </div>

    <div v-else class="grid grid-cols-4 gap-4">
      <div v-for="ext in extensions" :key="ext.id"
        class="bg-slate-800 rounded-lg p-4 border border-slate-700 hover:border-slate-500 transition">
        <div class="flex items-center gap-3 mb-3">
          <div class="w-10 h-10 rounded bg-blue-500/20 flex items-center justify-center text-blue-400 font-bold">
            {{ ext.name[0] }}
          </div>
          <div>
            <div class="font-medium">{{ ext.name }}</div>
            <div class="text-xs text-slate-400">v{{ ext.version }}</div>
          </div>
        </div>
        <div class="flex items-center justify-between">
          <a-switch v-model:checked="ext.enabled" @change="toggleExtension(ext)" />
          <a-button size="small" type="text" danger @click="removeExtension(ext.id)">Remove</a-button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref } from 'vue';
import { useI18n } from 'vue-i18next';

const { t } = useI18n();
const extensions = ref([]);

function addExtension() {
  // TODO: open file picker for .zip or folder
}

function toggleExtension(ext) {
  // TODO: toggle extension state
}

function removeExtension(id) {
  extensions.value = extensions.value.filter(e => e.id !== id);
}
</script>
