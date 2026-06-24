import i18next from 'i18next';
import I18NextVue from 'i18next-vue';
import en from './en.json';
import ru from './ru.json';
import zh from './zh.json';

i18next.init({
  resources: {
    en: { translation: en },
    ru: { translation: ru },
    zh: { translation: zh },
  },
  lng: 'en',
  fallbackLng: 'en',
  interpolation: {
    escapeValue: false,
  },
});

export const i18nPlugin = I18NextVue;
export { i18next };
export default i18next;
