<template>
  <a-modal :open="open" :title="proxy ? t('proxies.edit') : t('proxies.add')" @ok="handleOk" @cancel="handleCancel"
    :confirm-loading="loading" :width="480">
    <a-form layout="vertical" v-if="form">
      <div v-if="proxy" class="flex items-center gap-3 mb-4">
        <a-badge :status="form.is_active ? 'success' : 'error'"
          :text="form.is_active ? 'Active' : 'Inactive'" />
        <a-button size="small" :loading="checkLoading" @click="handleCheck">
          Check
        </a-button>
      </div>
      <a-form-item label="Type">
        <a-select v-model:value="form.type">
          <a-select-option value="socks5">SOCKS5</a-select-option>
          <a-select-option value="http">HTTP</a-select-option>
          <a-select-option value="https">HTTPS</a-select-option>
        </a-select>
      </a-form-item>
      <div class="grid grid-cols-2 gap-3">
        <a-form-item label="Host">
          <a-input v-model:value="form.host" />
        </a-form-item>
        <a-form-item label="Port">
          <a-input-number v-model:value="form.port" :min="1" :max="65535" style="width: 100%" />
        </a-form-item>
      </div>
      <div class="grid grid-cols-2 gap-3">
        <a-form-item label="Username">
          <a-input v-model:value="form.username" />
        </a-form-item>
        <a-form-item label="Password">
          <a-input-password v-model:value="form.password" />
        </a-form-item>
      </div>
      <a-form-item :label="t('proxies.columns.rotation')">
        <a-input v-model:value="form.proxy_rotation_url" placeholder="https://example.com/rotate" />
      </a-form-item>
    </a-form>
  </a-modal>
</template>

<script setup>
import { ref, reactive, watch } from 'vue';
import { message } from 'ant-design-vue';
import { useTranslation } from 'i18next-vue';
import { useProxiesStore } from '../stores/proxies.js';

const props = defineProps({
  open: Boolean,
  proxy: { type: Object, default: null },
});

const emit = defineEmits(['update:open', 'save']);

const { t } = useTranslation();
const proxiesStore = useProxiesStore();

const loading = ref(false);
const checkLoading = ref(false);
const form = ref(null);

watch(() => props.open, (val) => {
  if (val && props.proxy) {
    form.value = {
      id: props.proxy.id,
      type: props.proxy.type || 'socks5',
      host: props.proxy.host || '',
      port: props.proxy.port || 1080,
      username: props.proxy.username || '',
      password: props.proxy.password || '',
      proxy_rotation_url: props.proxy.proxy_rotation_url || '',
      is_active: props.proxy.is_active,
    };
  } else if (val) {
    form.value = { id: null, type: 'socks5', host: '', port: 1080, username: '', password: '', proxy_rotation_url: '', is_active: 0 };
  }
});

function handleCancel() {
  emit('update:open', false);
}

async function handleOk() {
  if (!form.value) return;
  loading.value = true;
  try {
    if (form.value.id) {
      const updated = await proxiesStore.update(form.value.id, {
        type: form.value.type,
        host: form.value.host,
        port: form.value.port,
        username: form.value.username || null,
        password: form.value.password || null,
        proxy_rotation_url: form.value.proxy_rotation_url || null,
      });
      emit('save', updated);
    } else {
      const created = await proxiesStore.create({
        type: form.value.type,
        host: form.value.host,
        port: form.value.port,
        username: form.value.username || null,
        password: form.value.password || null,
        proxy_rotation_url: form.value.proxy_rotation_url || null,
      });
      emit('save', created);
    }
    emit('update:open', false);
  } catch (err) {
    message.error(err.message || 'Ошибка сохранения прокси');
  } finally {
    loading.value = false;
  }
}

async function handleCheck() {
  if (!form.value?.id) return;
  checkLoading.value = true;
  try {
    const result = await proxiesStore.check(form.value.id);
    if (result.ok) {
      message.success(`Прокси работает. IP: ${result.ip}`);
    } else {
      message.warning(`Прокси недоступен: ${result.error}`);
    }
    await proxiesStore.fetchAll();
    const updated = proxiesStore.proxies.find(p => p.id === form.value.id);
    if (updated) form.value.is_active = updated.is_active;
  } catch (err) {
    message.error(err.message || 'Ошибка проверки прокси');
  } finally {
    checkLoading.value = false;
  }
}
</script>
