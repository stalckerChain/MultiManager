<template>
  <a-form layout="vertical">
    <a-form-item :label="t('profiles.modal.walletEvmAddress')">
      <a-input v-model:value="model.wallet_evm_address" read-only>
        <template #suffix>
          <a-tooltip title="Copy">
            <copy-outlined @click="copy(model.wallet_evm_address)" />
          </a-tooltip>
        </template>
      </a-input>
    </a-form-item>
    <a-form-item :label="t('profiles.modal.walletSolAddress')">
      <a-input v-model:value="model.wallet_sol_address" read-only>
        <template #suffix>
          <a-tooltip title="Copy">
            <copy-outlined @click="copy(model.wallet_sol_address)" />
          </a-tooltip>
        </template>
      </a-input>
    </a-form-item>
    <a-form-item :label="t('profiles.modal.walletPassword')">
      <a-input-password v-model:value="model.wallet_password" :visibilityToggle="true" />
    </a-form-item>
  </a-form>
</template>

<script setup>
import { CopyOutlined } from '@ant-design/icons-vue';
import { message } from 'ant-design-vue';
import { useTranslation } from 'i18next-vue';

const { t } = useTranslation();

const props = defineProps({
  model: { type: Object, required: true },
});

function copy(text) {
  if (text) {
    navigator.clipboard.writeText(text);
    message.success('Copied');
  }
}
</script>