<template>
  <a-form layout="vertical">
    <a-form-item :label="t('profiles.modal.email')">
      <a-input v-model:value="model.email" />
    </a-form-item>
    <a-form-item :label="t('profiles.modal.emailPassword')">
      <a-input-password v-model:value="model.email_password" :visibilityToggle="true" />
    </a-form-item>

    <a-divider>{{ t('profiles.modal.twitterUsername') }}</a-divider>
    <div class="grid grid-cols-2 gap-3">
      <a-form-item :label="t('profiles.modal.twitterUsername')">
        <a-input v-model:value="model.twitter_username" />
      </a-form-item>
      <a-form-item :label="t('profiles.modal.twitterEmail')">
        <a-input v-model:value="model.twitter_email" />
      </a-form-item>
    </div>
    <div class="grid grid-cols-2 gap-3">
      <a-form-item :label="t('profiles.modal.twitterPassword')">
        <a-input-password v-model:value="model.twitter_password" :visibilityToggle="true" />
      </a-form-item>
      <a-form-item :label="t('profiles.modal.twitterAuthToken')">
        <a-input-password v-model:value="model.twitter_auth_token" :visibilityToggle="true" />
      </a-form-item>
    </div>

    <a-divider>Discord</a-divider>
    <div class="grid grid-cols-2 gap-3">
      <a-form-item :label="t('profiles.modal.discordUsername')">
        <a-input v-model:value="model.discord_username" />
      </a-form-item>
      <a-form-item :label="t('profiles.modal.discordEmail')">
        <a-input v-model:value="model.discord_email" />
      </a-form-item>
    </div>
    <div class="grid grid-cols-2 gap-3">
      <a-form-item :label="t('profiles.modal.discordPassword')">
        <a-input-password v-model:value="model.discord_password" :visibilityToggle="true" />
      </a-form-item>
      <a-form-item :label="t('profiles.modal.discordToken')">
        <a-input-password v-model:value="model.discord_token" :visibilityToggle="true" />
      </a-form-item>
    </div>
  </a-form>
</template>

<script setup>
import { useTranslation } from 'i18next-vue';

const { t } = useTranslation();

const props = defineProps({
  model: { type: Object, required: true },
});
</script>