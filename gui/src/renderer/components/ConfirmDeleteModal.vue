<template>
  <a-modal
    :open="open"
    :title="title"
    :ok-text="t('confirmDelete.ok')"
    :cancel-text="t('common.cancel')"
    :ok-button-props="{ danger: true, disabled: !checked }"
    :confirm-loading="loading"
    :mask-closable="false"
    :closable="!loading"
    :keyboard="!loading"
    width="420"
    @ok="handleOk"
    @cancel="handleCancel"
  >
    <p>{{ message }}</p>
    <p v-if="count !== null && count !== undefined" class="mt-2 font-medium">
      {{ countText }}
    </p>
    <div v-if="$slots.default" class="max-h-[40vh] overflow-y-auto mt-2">
      <slot />
    </div>
    <a-checkbox v-model:checked="checked" class="mt-4">
      {{ t('confirmDelete.checkbox') }}
    </a-checkbox>
  </a-modal>
</template>

<script setup>
import { ref, computed, watch } from 'vue';
import { useTranslation } from 'i18next-vue';

const props = defineProps({
  open: Boolean,
  title: String,
  message: String,
  count: { type: Number, default: null },
  loading: Boolean,
});

const emit = defineEmits(['update:open', 'confirm', 'cancel']);

const { t } = useTranslation();

const checked = ref(false);

const countText = computed(() => {
  if (props.count === null || props.count === undefined) return '';
  return props.count === 1
    ? t('confirmDelete.countSingle')
    : t('confirmDelete.countMultiple', { count: props.count });
});

watch(() => props.open, (isOpen) => {
  if (isOpen) checked.value = false;
});

function handleCancel() {
  emit('cancel');
  emit('update:open', false);
}

function handleOk() {
  if (!checked.value || props.loading) return;
  emit('confirm');
}
</script>
