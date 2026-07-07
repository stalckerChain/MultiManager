import { createRouter, createWebHashHistory } from 'vue-router';
import Profiles from './views/Profiles.vue';
import Proxies from './views/Proxies.vue';
import Tasks from './views/Tasks.vue';
import WindowArranger from './views/WindowArranger.vue';
import Extensions from './views/Extensions.vue';
import Settings from './views/Settings.vue';

const routes = [
  { path: '/', redirect: '/profiles' },
  { path: '/profiles', name: 'profiles', component: Profiles },
  { path: '/proxies', name: 'proxies', component: Proxies },
  { path: '/tasks', name: 'tasks', component: Tasks },
  { path: '/arranger', name: 'arranger', component: WindowArranger },
  { path: '/extensions', name: 'extensions', component: Extensions },
  { path: '/settings', name: 'settings', component: Settings },
];

const router = createRouter({
  history: createWebHashHistory(),
  routes,
});

export default router;
