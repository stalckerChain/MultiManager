# TASK: Tasks Manager GUI (Ф5)

> **Статус:** ❌ В работе
> **Фаза:** MultiManager Ф5
> **Основание:** TS.md §9.7 (экран Tasks Manager), §12 п.14
> **Бэкенд:** ✅ API `src/api/tasks.js` (CRUD + run + executions), ✅ таблицы `tasks`/`task_executions` в БД
> **Зависимости:** Ф4 ✅ (API endpoints)

---

## Контекст

Бэкенд полностью готов:
- `src/api/tasks.js` — `GET/POST/PUT/DELETE /api/tasks`, `GET /api/tasks/:id/executions`, `POST /api/tasks/:id/run`
- `src/db/queries.js` — `createTaskQueries(db)` с CRUD + `createExecution` + `getExecutions`
- Роутер смонтирован в `src/core/app.js` на `/api/tasks`
- Таблицы `tasks` и `task_executions` создаются в `src/db/schema.js`

**Нужно реализовать GUI-часть:** Pinia store, Vue-компонент, роутинг, навигация, i18n-ключи.

---

## 1. i18n — добавить ключи

### 1.1. `gui/src/renderer/i18n/en.json`

Добавить в объект `nav`:
```json
"tasks": "Tasks"
```

Добавить новый корневой объект `tasks`:
```json
"tasks": {
  "title": "Tasks Manager",
  "create": "Create Task",
  "edit": "Edit Task",
  "search": "Search tasks...",
  "runNow": "Run Now",
  "viewExecutions": "Executions",
  "confirmDelete": "Are you sure you want to delete this task?",
  "columns": {
    "name": "Name",
    "script": "Script",
    "schedule": "Schedule",
    "status": "Status",
    "lastRun": "Last Run",
    "actions": "Actions"
  },
  "scheduleTypes": {
    "once": "Once",
    "daily": "Daily",
    "weekly": "Weekly",
    "manual": "Manual",
    "archive": "Archive"
  },
  "form": {
    "name": "Task Name",
    "namePlaceholder": "Enter task name",
    "scriptName": "Script Name",
    "scriptNamePlaceholder": "e.g. concrete, paragraph",
    "scheduleType": "Schedule Type",
    "isActive": "Active",
    "params": "Parameters (JSON)",
    "paramsPlaceholder": "{\"referral_code\": \"abc\"}"
  },
  "executions": {
    "title": "Task Executions",
    "columns": {
      "profile": "Profile",
      "status": "Status",
      "exitCode": "Exit Code",
      "startedAt": "Started At",
      "logFile": "Log File"
    },
    "status": {
      "running": "Running",
      "success": "Success",
      "failed": "Failed"
    },
    "empty": "No executions yet",
    "noLog": "No log file"
  },
  "status": {
    "active": "Active",
    "inactive": "Inactive"
  },
  "notifications": {
    "created": "Task created successfully",
    "updated": "Task updated successfully",
    "deleted": "Task deleted successfully",
    "runStarted": "Task started successfully"
  }
}
```

### 1.2. `gui/src/renderer/i18n/ru.json`

```json
"nav": {
  "tasks": "Задачи"
},
"tasks": {
  "title": "Менеджер задач",
  "create": "Создать задачу",
  "edit": "Редактировать задачу",
  "search": "Поиск задач...",
  "runNow": "Запустить",
  "viewExecutions": "Выполнения",
  "confirmDelete": "Вы уверены, что хотите удалить эту задачу?",
  "columns": {
    "name": "Название",
    "script": "Скрипт",
    "schedule": "Расписание",
    "status": "Статус",
    "lastRun": "Последний запуск",
    "actions": "Действия"
  },
  "scheduleTypes": {
    "once": "Однократно",
    "daily": "Ежедневно",
    "weekly": "Еженедельно",
    "manual": "Вручную",
    "archive": "Архив"
  },
  "form": {
    "name": "Название задачи",
    "namePlaceholder": "Введите название задачи",
    "scriptName": "Имя скрипта",
    "scriptNamePlaceholder": "например: concrete, paragraph",
    "scheduleType": "Тип расписания",
    "isActive": "Активна",
    "params": "Параметры (JSON)",
    "paramsPlaceholder": "{\"referral_code\": \"abc\"}"
  },
  "executions": {
    "title": "Выполнения задачи",
    "columns": {
      "profile": "Профиль",
      "status": "Статус",
      "exitCode": "Код выхода",
      "startedAt": "Время запуска",
      "logFile": "Файл лога"
    },
    "status": {
      "running": "Выполняется",
      "success": "Успешно",
      "failed": "Ошибка"
    },
    "empty": "Нет выполнений",
    "noLog": "Нет файла лога"
  },
  "status": {
    "active": "Активна",
    "inactive": "Неактивна"
  },
  "notifications": {
    "created": "Задача создана",
    "updated": "Задача обновлена",
    "deleted": "Задача удалена",
    "runStarted": "Задача запущена"
  }
}
```

### 1.3. `gui/src/renderer/i18n/zh.json`

```json
"nav": {
  "tasks": "任务"
},
"tasks": {
  "title": "任务管理器",
  "create": "创建任务",
  "edit": "编辑任务",
  "search": "搜索任务...",
  "runNow": "立即运行",
  "viewExecutions": "执行记录",
  "confirmDelete": "确定要删除此任务吗？",
  "columns": {
    "name": "名称",
    "script": "脚本",
    "schedule": "计划",
    "status": "状态",
    "lastRun": "上次运行",
    "actions": "操作"
  },
  "scheduleTypes": {
    "once": "一次",
    "daily": "每日",
    "weekly": "每周",
    "manual": "手动",
    "archive": "归档"
  },
  "form": {
    "name": "任务名称",
    "namePlaceholder": "输入任务名称",
    "scriptName": "脚本名称",
    "scriptNamePlaceholder": "例如: concrete, paragraph",
    "scheduleType": "计划类型",
    "isActive": "启用",
    "params": "参数 (JSON)",
    "paramsPlaceholder": "{\"referral_code\": \"abc\"}"
  },
  "executions": {
    "title": "任务执行记录",
    "columns": {
      "profile": "配置文件",
      "status": "状态",
      "exitCode": "退出代码",
      "startedAt": "开始时间",
      "logFile": "日志文件"
    },
    "status": {
      "running": "运行中",
      "success": "成功",
      "failed": "失败"
    },
    "empty": "暂无执行记录",
    "noLog": "无日志文件"
  },
  "status": {
    "active": "启用",
    "inactive": "禁用"
  },
  "notifications": {
    "created": "任务创建成功",
    "updated": "任务更新成功",
    "deleted": "任务删除成功",
    "runStarted": "任务已启动"
  }
}
```

---

## 2. Pinia Store — `gui/src/renderer/stores/tasks.js`

Создать по паттерну `stores/proxies.js`:

```js
import { defineStore } from 'pinia';
import { ref } from 'vue';
import client from '../api/client.js';

export const useTasksStore = defineStore('tasks', () => {
  const tasks = ref([]);
  const loading = ref(false);

  async function fetchAll() {
    loading.value = true;
    try {
      const { data } = await client.get('/api/tasks');
      tasks.value = data;
    } finally {
      loading.value = false;
    }
  }

  async function create(task) {
    const { data } = await client.post('/api/tasks', task);
    tasks.value.push(data);
    return data;
  }

  async function update(id, updates) {
    const { data } = await client.put(`/api/tasks/${id}`, updates);
    const idx = tasks.value.findIndex(t => t.id === id);
    if (idx !== -1) tasks.value[idx] = data;
    return data;
  }

  async function remove(id) {
    await client.delete(`/api/tasks/${id}`);
    tasks.value = tasks.value.filter(t => t.id !== id);
  }

  async function run(id) {
    const { data } = await client.post(`/api/tasks/${id}/run`);
    return data;
  }

  async function getExecutions(id) {
    const { data } = await client.get(`/api/tasks/${id}/executions`);
    return data;
  }

  return { tasks, loading, fetchAll, create, update, remove, run, getExecutions };
});
```

---

## 3. Router — `gui/src/renderer/router.js`

Добавить импорт и маршрут:

```js
import Tasks from './views/Tasks.vue';

// в массив routes:
{ path: '/tasks', name: 'tasks', component: Tasks },
```

Итоговый массив routes:
```js
const routes = [
  { path: '/', redirect: '/profiles' },
  { path: '/profiles', name: 'profiles', component: Profiles },
  { path: '/proxies', name: 'proxies', component: Proxies },
  { path: '/tasks', name: 'tasks', component: Tasks },
  { path: '/arranger', name: 'arranger', component: WindowArranger },
  { path: '/extensions', name: 'extensions', component: Extensions },
  { path: '/settings', name: 'settings', component: Settings },
];
```

---

## 4. Навигация — `gui/src/renderer/components/Layout.vue`

Добавить пункт меню после `proxies` (до `arranger`):

```vue
<a-menu-item key="tasks">{{ t('nav.tasks') }}</a-menu-item>
```

Итоговый порядок в `<a-menu>`:
```vue
<a-menu-item key="profiles">{{ t('nav.profiles') }}</a-menu-item>
<a-menu-item key="proxies">{{ t('nav.proxies') }}</a-menu-item>
<a-menu-item key="tasks">{{ t('nav.tasks') }}</a-menu-item>
<a-menu-item key="arranger">Window Arranger</a-menu-item>
<a-menu-item key="extensions">{{ t('nav.extensions') }}</a-menu-item>
```

---

## 5. Основной экран — `gui/src/renderer/views/Tasks.vue`

Создать по паттерну `Profiles.vue`:

### 5.1. Template — структура

```vue
<template>
  <div>
    <!-- Header: title + toolbar -->
    <div class="flex items-center justify-between mb-4">
      <h1 class="text-xl font-bold">{{ t('tasks.title') }}</h1>
      <div class="flex items-center gap-2">
        <a-input-search v-model:value="search" :placeholder="t('tasks.search')" style="width: 250px" />
        <a-button type="primary" @click="showCreateModal">
          {{ t('tasks.create') }}
        </a-button>
      </div>
    </div>

    <!-- Main table -->
    <a-table :columns="columns" :data-source="filteredTasks" :loading="tasksStore.loading"
      row-key="id" :pagination="{ pageSize: 20, showSizeChanger: true }"
      size="small" :scroll="{ y: 'calc(100vh - 260px)' }">
      <template #bodyCell="{ column, record }">
        <!-- Name column -->
        <template v-if="column.key === 'name'">
          <span class="font-medium">{{ record.name }}</span>
        </template>

        <!-- Schedule column -->
        <template v-if="column.key === 'schedule'">
          <a-tag>{{ t(`tasks.scheduleTypes.${record.schedule_type}`) }}</a-tag>
          <span v-if="record.cron_expression" class="text-xs text-slate-400 ml-1">{{ record.cron_expression }}</span>
        </template>

        <!-- Status column -->
        <template v-if="column.key === 'status'">
          <a-badge :status="record.is_active ? 'success' : 'default'"
            :text="record.is_active ? t('tasks.status.active') : t('tasks.status.inactive')" />
        </template>

        <!-- Last run column -->
        <template v-if="column.key === 'lastRun'">
          <span class="text-slate-400">{{ record.updated_at || '—' }}</span>
        </template>

        <!-- Actions column -->
        <template v-if="column.key === 'actions'">
          <a-space>
            <a-button size="small" type="primary" @click="handleRun(record.id)">
              {{ t('tasks.runNow') }}
            </a-button>
            <a-button size="small" @click="showEditModal(record)">
              {{ t('common.edit') || 'Edit' }}
            </a-button>
            <a-button size="small" @click="showExecutions(record)">
              {{ t('tasks.viewExecutions') }}
            </a-button>
            <a-popconfirm :title="t('tasks.confirmDelete')" @confirm="handleDelete(record.id)">
              <a-button size="small" danger>{{ t('common.delete') }}</a-button>
            </a-popconfirm>
          </a-space>
        </template>
      </template>
    </a-table>

    <!-- Create/Edit Modal -->
    <a-modal v-model:open="modalOpen" :title="editingTask ? t('tasks.edit') : t('tasks.create')"
      @ok="handleSave" :confirm-loading="saveLoading">
      <a-form layout="vertical">
        <a-form-item :label="t('tasks.form.name')" required>
          <a-input v-model:value="form.name" :placeholder="t('tasks.form.namePlaceholder')" />
        </a-form-item>
        <a-form-item :label="t('tasks.form.scriptName')" required>
          <a-input v-model:value="form.script_name" :placeholder="t('tasks.form.scriptNamePlaceholder')" />
        </a-form-item>
        <a-form-item :label="t('tasks.form.scheduleType')" required>
          <a-select v-model:value="form.schedule_type">
            <a-select-option value="once">{{ t('tasks.scheduleTypes.once') }}</a-select-option>
            <a-select-option value="daily">{{ t('tasks.scheduleTypes.daily') }}</a-select-option>
            <a-select-option value="weekly">{{ t('tasks.scheduleTypes.weekly') }}</a-select-option>
            <a-select-option value="manual">{{ t('tasks.scheduleTypes.manual') }}</a-select-option>
            <a-select-option value="archive">{{ t('tasks.scheduleTypes.archive') }}</a-select-option>
          </a-select>
        </a-form-item>
        <a-form-item :label="t('tasks.form.params')">
          <a-textarea v-model:value="form.params" :placeholder="t('tasks.form.paramsPlaceholder')" :rows="3" />
        </a-form-item>
        <a-form-item :label="t('tasks.form.isActive')">
          <a-switch v-model:checked="form.is_active" />
        </a-form-item>
      </a-form>
    </a-modal>

    <!-- Executions Modal -->
    <a-modal v-model:open="executionsOpen" :title="t('tasks.executions.title')"
      :footer="null" width="800px">
      <a-table :data-source="executions" :loading="executionsLoading" row-key="id"
        size="small" :pagination="{ pageSize: 10 }">
        <a-table-column :title="t('tasks.executions.columns.profile')" data-index="profileName" key="profile" />
        <a-table-column :title="t('tasks.executions.columns.status')" key="status">
          <template #default="{ record }">
            <a-badge :status="executionStatusBadge(record.status)"
              :text="t(`tasks.executions.status.${record.status}`)" />
          </template>
        </a-table-column>
        <a-table-column :title="t('tasks.executions.columns.exitCode')" data-index="exit_code" key="exitCode">
          <template #default="{ record }">
            <span v-if="record.exit_code !== null && record.exit_code !== undefined">{{ record.exit_code }}</span>
            <span v-else class="text-slate-500">—</span>
          </template>
        </a-table-column>
        <a-table-column :title="t('tasks.executions.columns.startedAt')" data-index="last_run_at" key="startedAt" />
        <a-table-column :title="t('tasks.executions.columns.logFile')" key="logFile">
          <template #default="{ record }">
            <span v-if="record.log_file_path" class="text-xs text-slate-400">{{ record.log_file_path }}</span>
            <span v-else class="text-slate-500">{{ t('tasks.executions.noLog') }}</span>
          </template>
        </a-table-column>
      </a-table>
      <div v-if="executions.length === 0 && !executionsLoading" class="text-center text-slate-500 py-8">
        {{ t('tasks.executions.empty') }}
      </div>
    </a-modal>
  </div>
</template>
```

### 5.2. Script — логика

```js
<script setup>
import { ref, computed, reactive, watch } from 'vue';
import { useTranslation } from 'i18next-vue';
import { useTasksStore } from '../stores/tasks.js';
import { useAppStore } from '../stores/app.js';
import { message } from 'ant-design-vue';

const { t } = useTranslation();
const tasksStore = useTasksStore();
const appStore = useAppStore();

const search = ref('');
const modalOpen = ref(false);
const saveLoading = ref(false);
const editingTask = ref(null);
const executionsOpen = ref(false);
const executions = ref([]);
const executionsLoading = ref(false);

const form = reactive({
  name: '',
  script_name: '',
  schedule_type: 'manual',
  params: '',
  is_active: true,
});

const columns = [
  { title: t('tasks.columns.name'), key: 'name', width: 200 },
  { title: t('tasks.columns.script'), dataIndex: 'script_name', key: 'script', width: 120 },
  { title: t('tasks.columns.schedule'), key: 'schedule', width: 150 },
  { title: t('tasks.columns.status'), key: 'status', width: 100 },
  { title: t('tasks.columns.lastRun'), key: 'lastRun', width: 180 },
  { title: t('tasks.columns.actions'), key: 'actions', width: 320, fixed: 'right' },
];

const filteredTasks = computed(() => {
  if (!search.value) return tasksStore.tasks;
  const q = search.value.toLowerCase();
  return tasksStore.tasks.filter(t =>
    t.name.toLowerCase().includes(q) ||
    t.script_name.toLowerCase().includes(q) ||
    t.id.toLowerCase().includes(q)
  );
});

function executionStatusBadge(status) {
  return { running: 'processing', success: 'success', failed: 'error' }[status] || 'default';
}

function resetForm() {
  form.name = '';
  form.script_name = '';
  form.schedule_type = 'manual';
  form.params = '';
  form.is_active = true;
}

function showCreateModal() {
  editingTask.value = null;
  resetForm();
  modalOpen.value = true;
}

function showEditModal(task) {
  editingTask.value = task;
  form.name = task.name;
  form.script_name = task.script_name;
  form.schedule_type = task.schedule_type;
  form.params = typeof task.params === 'string' ? task.params : JSON.stringify(task.params || {}, null, 2);
  form.is_active = !!task.is_active;
  modalOpen.value = true;
}

async function handleSave() {
  if (!form.name || !form.script_name || !form.schedule_type) {
    message.error(t('common.error'));
    return;
  }

  saveLoading.value = true;
  try {
    let params = {};
    if (form.params) {
      try { params = JSON.parse(form.params); } catch { params = {}; }
    }

    const data = {
      name: form.name,
      script_name: form.script_name,
      schedule_type: form.schedule_type,
      params,
      is_active: form.is_active,
    };

    if (editingTask.value) {
      await tasksStore.update(editingTask.value.id, data);
      message.success(t('tasks.notifications.updated'));
    } else {
      await tasksStore.create(data);
      message.success(t('tasks.notifications.created'));
    }
    modalOpen.value = false;
  } catch (err) {
    message.error(err.message || t('common.error'));
  } finally {
    saveLoading.value = false;
  }
}

async function handleDelete(id) {
  try {
    await tasksStore.remove(id);
    message.success(t('tasks.notifications.deleted'));
  } catch (err) {
    message.error(err.message || t('common.error'));
  }
}

async function handleRun(id) {
  try {
    const result = await tasksStore.run(id);
    message.success(t('tasks.notifications.runStarted'));
  } catch (err) {
    message.error(err.message || t('common.error'));
  }
}

async function showExecutions(task) {
  executionsOpen.value = true;
  executionsLoading.value = true;
  executions.value = [];
  try {
    executions.value = await tasksStore.getExecutions(task.id);
  } finally {
    executionsLoading.value = false;
  }
}

watch(() => appStore.initialized, (ready) => {
  if (ready) {
    tasksStore.fetchAll().catch(() => {});
  }
}, { immediate: true });
</script>
```

### 5.3. Style — минимально

```vue
<style scoped>
</style>
```

---

## 6. Файловый манифест

| Файл | Действие |
|------|----------|
| `gui/src/renderer/i18n/en.json` | **ИЗМЕНИТЬ** — добавить `nav.tasks` + `tasks.*` |
| `gui/src/renderer/i18n/ru.json` | **ИЗМЕНИТЬ** — добавить `nav.tasks` + `tasks.*` |
| `gui/src/renderer/i18n/zh.json` | **ИЗМЕНИТЬ** — добавить `nav.tasks` + `tasks.*` |
| `gui/src/renderer/stores/tasks.js` | **НОВЫЙ** — Pinia store |
| `gui/src/renderer/router.js` | **ИЗМЕНИТЬ** — импорт + маршрут `/tasks` |
| `gui/src/renderer/components/Layout.vue` | **ИЗМЕНИТЬ** — пункт меню `tasks` |
| `gui/src/renderer/views/Tasks.vue` | **НОВЫЙ** — экран Tasks Manager |

---

## 7. Порядок реализации

| № | Шаг | Файл | Сложность |
|---|-----|------|-----------|
| 1 | i18n-ключи (en/ru/zh) | `i18n/*.json` | low |
| 2 | Pinia store | `stores/tasks.js` | low |
| 3 | Router + route | `router.js` | low |
| 4 | Nav-пункт в Layout | `Layout.vue` | low |
| 5 | Tasks.vue (шаблон + скрипт) | `views/Tasks.vue` | medium |

---

## 8. Не делаем в рамках этой задачи

- ❌ Встроенный терминал (Ф6) — просмотр логов будет потом
- ❌ Планировщик (cron-запуск) — только создание задач с расписанием
- ❌ WebSocket-обновления статуса выполнения
- ❌ Интеграция с Python-процессами (spawn уже есть в API)
