# TASK: Human-like движения курсора в слейвах (ghost-cursor `path()` + плавный скролл)

> Контекст: реализация раздела 4.4 ТЗ (Multi-Control). Сейчас курсор в слейвах **телепортируется**
> между точками из-за трёх уровней троттла (25 мс SYNC_EVENT_SCRIPT → 16 мс InputCapture →
> 25 мс MultiController) и отсутствия интерполяции. Скролл диспатчится одним `mouseWheel` с полной
> дельтой — без сглаживания. Цель: плавная человекоподобная траектория + плавная прокрутка.

---

## Решение (по итогам обсуждения)

**ГИБРИД: наш `MouseSmoother` loop + математика из `ghost-cursor.path()`.**

Почему гибрид, а не «только Ghost-Cursor» или «только самопис»:

- Проект работает на **голом CDP через WebSocket** (`src/multi-control/cdp-manager.js:1` — `const WebSocket = require('ws')`). Puppeteer/Playwright в `package.json` отсутствуют.
- Высокоуровневый API Ghost-Cursor (`GhostCursor.click`, `scrollIntoView`, `scroll`) требует Puppeteer/Playwright `page` object — недоступно без рерайта половины архитектуры Multi-Control.
- Низкоуровневый экспорт **`path(start, end, options)`** — чистая синхронная функция, возвращает массив точек `{x, y}` (или `{x, y, timestamp}` с `useTimestamps:true`). Идеальный «движок математики»:
  - кубическая Безье
  - **Fitts's Law** для числа точек (учитывает расстояние и «размер цели»)
  - корректный **"one-side-of-line"** Безье (контрольные точки с одной стороны — иначе кривые «wonky»)
  - зрелый **overshoot** для дальних дистанций
  - встроенный spread/noise (`spreadOverride`)
- Наш `MouseSmoother` сохраняет полный контроль над диспатчем:
  - setTimeout-цепочка точек через CDP
  - **`flush()` перед кликом** — гарантия точной позиции
  - пересчёт пути из текущей позиции при новой цели (не рвёт анимацию)

Итог:
- **Курсор**: `path()` из ghost-cursor генерирует массив точек → наш loop диспатчит их в CDP слейва
  с задержкой. Отдельный самописный jitter убираем (он уже встроен в `path()` через spread).
- **Скролл**: самопис разбивка wheel-дельты на серию мелких `mouseWheel` dispatch'ей (~16 мс).
  (ghost-cursor `scroll()` требует Puppeteer page — не подходит.)
- **Точность кликов**: перед `mousePressed`/`mouseReleased` — `flush()` (дослать финальную точку).

### Новая зависимость
- `ghost-cursor` (~50KB, dep: только `debug`). Добавить в `package.json` dependencies.

### Что было сделано до смены подхода (откатить/переделать)
- ⚠️ `src/multi-control/mouse-smoothing.js` уже создан с **самописными** `cubicBezier`/`easeInOutCubic`/
  `controlPoint1/2`/`jitter`/`MouseSmoother`. **Переписать** под `path()` из ghost-cursor (Этап 1.1).

---

## ЭТАП 0. Подготовка

- [ ] 0.1. `npm install ghost-cursor` — добавить зависимость
- [ ] 0.2. Проверить, что `const { path } = require('ghost-cursor')` импортируется (path — синхронная функция)
- [x] 0.3. TASK.md обновлён под гибридный план v2

---

## ЭТАП 1. Переписать `src/multi-control/mouse-smoothing.js`

### Экспорт

Только класс `MouseSmoother`. Математические функции (`cubicBezier`, `controlPoint1/2`,
`easeInOutCubic`, `jitter`) **удаляем** — их заменяет `path()`.

### Класс `MouseSmoother` (per-slave)

```js
const { path } = require('ghost-cursor');

class MouseSmoother {
  constructor({
    dispatch,                  // (x, y) => void — отправить точку в CDP слейва
    stepInterval = 8,          // мс между точками (≈125 Гц), если useTimestamps=false
    moveSpeed = 1.5,           // ghost-cursor moveSpeed (меньше = быстрее)
    useTimestamps = true,      // path() вернёт {x,y,timestamp}; интервалы брать из timestamp
  })

  setCurrent(x, y)             // запоминает текущую позицию курсора слейва
  setTarget(x, y)              // новая цель. Пересчёт пути из ТЕКУЩЕЙ позиции.
  flush()                      // немедленно дослать финальную точку + остановить loop.
  stop()                       // полная очистка.
}
```

### Внутренняя логика `setTarget(x, y)`

1. `from = { ...this.current }` (текущая промежуточная позиция или последняя известная)
2. `this._target = { x, y }`
3. `this._points = path(from, this._target, { moveSpeed, useTimestamps })` — массив точек ghost-cursor
4. **Гарантировать финальную точку**: ghost-cursor `path()` иногда не включает точно `end` из-за
   overshoot — принудительно пушим `{ ...this._target, timestamp: last+stepInterval }` в конец массива
5. Очистить старый таймер, запустить `_tick()`

### `_tick()` (loop)

- Если `_pointIndex >= points.length` → остановиться, `current = target`, сброс
- Иначе взять `points[_pointIndex]`, dispatch `(point.x, point.y)`, `current = point`, `_pointIndex++`
- Запланировать следующий tick:
  - При `useTimestamps: true` → `delay = points[i+1].timestamp - point.timestamp` (clamp [4, 50] мс)
  - Иначе → константный `stepInterval`

### `flush()`

Если есть активная анимация и `_target`:
- dispatch точно `_target` (без jitter, точно в цель)
- `current = _target`
- очистить таймер, сбросить состояние
Иначе no-op.

### `stop()`

Очистить таймер, сбросить `_points`/`_target`/`_pointIndex`.

### Jitter

**Не добавляем свой** — ghost-cursor `path()` уже включает spread/noise. Опционально можно
пробросить `spreadOverride` позже, но в MVP — дефолт.

---

## ЭТАП 2. Интеграция в `MultiController` (`src/multi-control/index.js`)

- Импорт: `const { MouseSmoother } = require('./mouse-smoothing');`
- Конструктор: добавить `this.smoothers = new Map();` (slaveId → MouseSmoother)
- **Удалить**: `MOUSE_THROTTLE_MS` (стр. 3), `mouseBuffer` (9), `throttleTimer` (10), старый
  throttle-код в `onMouseMoved` (247–266)
- `addSlave(profileId)`: после `_loadSlavePosition` создать smoother:
  ```js
  const smoother = new MouseSmoother({
    dispatch: (x, y) => this._dispatchSlaveMove(profileId, x, y),
  });
  this.smoothers.set(profileId, smoother);
  ```
- Добавить метод `_dispatchSlaveMove(slaveId, x, y)`: resolve session через `_getSlaveSession`,
  вызвать `dispatchMouseEventToSession(slaveId, sessionId, 'mouseMoved', {x, y})`, с fallback на
  `dispatchMouseEvent(slaveId, 'mouseMoved', {x, y})` если session нет
- `removeSlave(profileId)`: `smoother.stop()` + `this.smoothers.delete(profileId)`
- `stop()`: для каждого smoother вызвать `.stop()`, очистить Map
- `onMouseMoved(params)`: для каждого слейва:
  ```js
  const coords = this._toSlaveCoords(params.x, params.y, slaveId);
  const smoother = this.smoothers.get(slaveId);
  if (smoother) smoother.setTarget(coords.x, coords.y);
  ```
- `onMousePressed(params)` / `onMouseReleased(params)`: **перед** `_broadcastMouse` — для каждого
  слейва `smoother.flush()`, затем обычный broadcast. Гарантия позиции перед mousePressed.
- `scrollTo(params)` — самопис разбивка (Этап 3)
- `_toSlaveCoords` — БЕЗ ИЗМЕНЕНИЙ

---

## ЭТАП 3. Плавный скролл (самопис разбивка)

В `src/multi-control/index.js`:

```js
const SCROLL_STEP_PX = 40;
const SCROLL_TICK_MS = 16;

async scrollTo(params) {
  if (!this.active || !this.cdp) return;
  const totalY = params.deltaY || 0;
  const totalX = params.deltaX || 0;
  const steps = Math.max(1, Math.ceil(Math.max(Math.abs(totalY), Math.abs(totalX)) / SCROLL_STEP_PX));
  const stepY = totalY / steps;
  const stepX = totalX / steps;

  for (const [id] of this.slaves) {
    this._runScrollSequence(id, steps, stepX, stepY); // fire-and-forget per slave
  }
}

_runScrollSequence(slaveId, steps, stepX, stepY) {
  let i = 0;
  const fire = () => {
    if (i++ >= steps || !this.active) return;
    const session = this._getSlaveSession(slaveId);
    const wheelParams = { x: 0, y: 0, deltaX: stepX, deltaY: stepY };
    if (session) {
      this.cdp.dispatchMouseEventToSession(slaveId, session.sessionId, 'mouseWheel', wheelParams);
    } else {
      this.cdp.dispatchMouseEvent(slaveId, 'mouseWheel', wheelParams);
    }
    if (i < steps) setTimeout(fire, SCROLL_TICK_MS);
  };
  fire();
}
```

---

## ЭТАП 4. Уменьшить троттлы

### 4.1. `src/os-input/input-capture.js`

Удалить дублирующий throttle 16 мс в `_onMouseMove` (стр. 64–77): теперь `_onMouseMove` сразу
эмиттит `mouseMove`, сохраняя только `lastMousePos`. Удалить `throttleTimer` поле. Обновить `stop()`.

### 4.2. `src/multi-control/cdp-manager.js`

В `SYNC_EVENT_SCRIPT` (стр. 20) уменьшить `THROTTLE = 25` → `THROTTLE = 16`.
Master шлёт ~60 Гц, smoother в слейвах превратит в плавную кривую.

---

## ЭТАП 5. Тесты

### 5.1. `tests/unit/mouse-smoothing.test.js` (новый)

Mock `ghost-cursor`:
```js
vi.mock('ghost-cursor', () => ({
  path: vi.fn((from, to) => [
    { x: from.x, y: from.y, timestamp: 0 },
    { x: (from.x+to.x)/2, y: (from.y+to.y)/2, timestamp: 8 },
    { x: to.x, y: to.y, timestamp: 16 },
  ]),
}));
```

Тесты:
- `MouseSmoother.setTarget` → dispatch'ит все точки из `path()`, финальная = target
- `setTarget` во время активной анимации → `path()` вызывается из текущей позиции, не старой
- `flush()` → dispatch'ит точно target немедленно, последующие tick'и не вызываются
- `stop()` → таймер очищен, dispatch больше не вызывается
- ghost-cursor `path()` вызывается с правильными опциями (`moveSpeed`, `useTimestamps`)
- `useTimestamps: false` → интервал = stepInterval

### 5.2. `tests/unit/multi-control.test.js` (обновить)

- В `createMockCdp()` убедиться что есть `dispatchMouseEventToSession` (vi.fn())
- Обновить `throttling мыши` (177–199): теперь `onMouseMoved` триггерит smoother → проверять
  несколько dispatch'ей через `dispatchMouseEventToSession` (с моком `path()`)
- **Новый тест: flush перед кликом** — после `onMouseMoved`, до завершения интерполяции,
  `onMousePressed` вызывает dispatch финальной точки перед mousePressed
- **Новый тест: scroll разбивается** — `scrollTo({deltaY: 200})` → несколько dispatch'ей с дельтой
  ≤ SCROLL_STEP_PX
- **Новый тест: smoother.stop() в removeSlave** — после removeSlave smoother больше не dispatch'ит

### 5.3. `tests/unit/os-input.test.js` (обновить)

Тест `throttles mouseMove` (122–134): переписать — теперь mouseMove эмиттится немедленно без задержки.

### 5.4. Прогнать `npx vitest run` — все тесты должны быть зелёные.

---

## ЭТАП 6. Документация

### 6.1. `docs/MULTI-CONTROL.md`

- Обновить «Текущая версия» до v0.13.0.
- Новый раздел в истории:
  ```
  ### v0.13.0 — Human-like движения: ghost-cursor path() + плавный скролл
  - Курсор в слейвах движется по человеческой траектории (ghost-cursor path(): кубическая
    Безье + Fitts's Law + overshoot) вместо телепортации между точками
  - Наш MouseSmoother loop диспатчит точки в CDP слейва, flush() перед mousePressed гарантирует
    точность клика
  - Скролл разбивается на серию мелких wheel-dispatch'ей (SCROLL_STEP_PX=40, SCROLL_TICK_MS=16)
  - Удалён дублирующий throttle в InputCapture, THROTTLE master-page уменьшен 25→16 мс
  - Новая зависимость: ghost-cursor
  ```
- Обновить «Структуру файлов»: добавить `src/multi-control/mouse-smoothing.js`
- Новый пункт «Архитектурные решения» (№ 15): «Гибрид: наш MouseSmoother loop + математика
  ghost-cursor `path()` — high-level API GhostCursor требует Puppeteer/Playwright page, что
  недоступно на голом CDP. `path()` — чистая функция, идеально для обёртки».

---

## ПРОГРЕСС РЕАЛИЗАЦИИ

- [x] **0.1** `npm install ghost-cursor`
- [x] **0.2** Импорт `path` проверен (path type: function, 52 точки для 200px, формат {x,y})
- [x] **0.3** TASK.md обновлён под гибридный план v2
- [x] **1** Переписан `src/multi-control/mouse-smoothing.js` под `path()` (удалена самописная математика)
- [x] **5.1** Тесты `mouse-smoothing.test.js` (с моком ghost-cursor)
- [x] **2** Интегрирован smoother в `MultiController` (index.js)
- [x] **3** `scrollTo` разбивка wheel-дельты
- [x] **4.1** Убран throttle в `input-capture.js`
- [x] **4.2** `THROTTLE = 16` в `cdp-manager.js`
- [x] **5.2** Обновлён `tests/unit/multi-control.test.js`
- [x] **5.3** Обновлён `tests/unit/os-input.test.js`
- [x] **5.4** Весь тест-набор зелёный (463/463)
- [x] **6.1** Обновлён `docs/MULTI-CONTROL.md` (v0.13.0)

---

## РИСКИ И КОМПРОМИССЫ

- **Новая зависимость** `ghost-cursor` (~50KB, dep: `debug`). В проекте философия минимальных deps,
  но ghost-cursor — зрелая боевая библиотека с десятками тысяч загрузок.
- **path() API stability**: ghost-cursor исторически завязан на Puppeteer, но `path()` сейчас выделен
  как низкоуровневый стабильный экспорт. Риск будущего мажорного break — митигация: точные тесты с
  моком, фиксирующие контракт.
- **Точность кликов**: гибридный flush гарантирует позицию перед mousePressed — UI-взаимодействие
  сохранено.
- **CPU**: число точек на движение теперь определяет Fitts's Law внутри `path()` (~10–50 точек на
  движение). При ~125 Гц диспатча это сопоставимо с первоначальным планом самописа.

## ЧТО НЕ МЕНЯЕТСЯ

- `_toSlaveCoords` (координатный пересчёт master→slave со смещением окон и scroll)
- Tab mapping / tabIndex / focus sync / `activateAndFocusTarget`
- Клавиатурный ввод и `humanType`
- Сам `Input.dispatchMouseEvent` CDP-вызов — меняется только характер вызовов
- `dispatchMouseEventToSession` / `dispatchMouseEvent` в `cdp-manager.js` — без изменений
