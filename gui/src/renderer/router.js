import { createRouter, createWebHashHistory } from 'vue-router';
import Profiles from './views/Profiles.vue';
import Proxies from './views/Proxies.vue';
import Extensions from './views/Extensions.vue';
import Settings from './views/Settings.vue';

const routes = [
  { path: '/', redirect: '/profiles' },
  { path: '/profiles', name: 'profiles', component: Profiles },
  { path: '/proxies', name: 'proxies', component: Proxies },
  { path: '/extensions', name: 'extensions', component: Extensions },
  { path: '/settings', name: 'settings', component: Settings },
];

const router = createRouter({
  history: createWebHashHistory(),
  routes,
});

export default router;
