import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  resolve: {
    alias: {
      pinia: path.resolve(__dirname, 'gui/node_modules/pinia'),
      vue: path.resolve(__dirname, 'gui/node_modules/vue'),
      '@vue/devtools-api': path.resolve(__dirname, 'gui/node_modules/@vue/devtools-api'),
      i18next: path.resolve(__dirname, 'gui/node_modules/i18next'),
      'i18next-vue': path.resolve(__dirname, 'gui/node_modules/i18next-vue'),
      axios: path.resolve(__dirname, 'gui/node_modules/axios'),
    },
  },
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/**/*.test.js'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
    },
  },
});
