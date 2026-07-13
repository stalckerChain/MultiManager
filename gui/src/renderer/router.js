import { createRouter, createWebHashHistory } from 'vue-router';
import Profiles from './views/Profiles.vue';
import Proxies from './views/Proxies.vue';
import Tasks from './views/Tasks.vue';
import WindowArranger from './views/WindowArranger.vue';
import Extensions from './views/Extensions.vue';
import Settings from './views/Settings.vue';
import AutomationMatrix from './views/AutomationMatrix.vue';
import AutomationRuns from './views/AutomationRuns.vue';
import AutomationHistory from './views/AutomationHistory.vue';

const routes = [
  { path: '/', redirect: '/profiles' },
  { path: '/profiles', name: 'profiles', component: Profiles },
  { path: '/proxies', name: 'proxies', component: Proxies },
  { path: '/tasks', name: 'tasks', component: Tasks },
  { path: '/arranger', name: 'arranger', component: WindowArranger },
  { path: '/extensions', name: 'extensions', component: Extensions },
  { path: '/settings', name: 'settings', component: Settings },
  { path: '/automation/matrix', name: 'automation-matrix', component: AutomationMatrix },
  { path: '/automation/runs', name: 'automation-runs', component: AutomationRuns },
  { path: '/automation/history', name: 'automation-history', component: AutomationHistory },
];

const router = createRouter({
  history: createWebHashHistory(),
  routes,
});

export default router;
