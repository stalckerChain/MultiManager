# План: Фаза ФД — MCP-сервер

## Контекст

**stAuto0** (`C:\Users\stalcker\AI\stAuto0`) — отдельный Python-проект с Playwright-автоматизацией Web3-квестов.
**MultiManager** (`C:\Users\stalcker\AI\mmanager\MultiManager`) — Node.js Core, управляющий прокси, браузерами, БД.

Текущее состояние MCP-сервера (`mcp_server/server.py`):
- 10 tools, работают через `FastMCP` (stdio-транспорт)
- **Используют legacy-режим:** читают `config/accounts.py` напрямую, запускают `BaseBrowser` без `mm_mode`
- Не имеют тестов
- Миграционные скрипты, ФА, ФБ, ФВ — завершены ✅

**Цель:** Перевести MCP-сервер на MultiManager API и добавить Recorder-режим + мультимодальный анализ.

---

## Шаг 1: Рефакторинг `mcp_server/server.py` — MM-режим

### 1.1. Замена источника аккаунтов

**Текущее:** `from config.accounts import accounts` — прямая загрузка статического tuple.

**Новое:**
- При старте сервера (лениво при первом вызове) проверять `MultiManagerClient.is_core_alive()`
- Если Core жив — получать список профилей через `get_all_profiles()`, кешировать в `_profiles_cache: dict[str, dict]` (ключ — `name` типа `auto_001`)
- Если Core мёртв — fallback на `config/accounts.py` (как сейчас)
- Функция `_resolve_account(account_name)` — возвращает `(account_dict, profile_id, mm_mode_flag)`

### 1.2. `browser_launch` — MM-маршрут

```python
@mcp.tool()
async def browser_launch(account_name: str, headless: bool = False) -> dict:
    account, profile_id, mm_mode = _resolve_account(account_name)
    if account_name in _browsers:
        return {"success": False, "message": f"Browser for '{account_name}' already running"}

    try:
        browser = BaseBrowser(account, headless=headless, mm_mode=mm_mode)
        await browser.launch()
        _browsers[account_name] = browser
        return {"success": True, "message": f"Browser launched for {account_name}",
                "page_url": browser.page.url if browser.page else None,
                "profile_id": profile_id, "mode": "mm" if mm_mode else "legacy"}
    except Exception as e:
        return {"success": False, "message": f"Launch failed: {e}"}
```

### 1.3. `browser_login_zerion` — делегирование

```python
@mcp.tool()
async def browser_login_zerion(account_name: str, password: str = None) -> dict:
    browser = _browsers.get(account_name)
    if not browser:
        return {"success": False, "message": f"No browser running for '{account_name}'"}
    try:
        await browser.login_zerion(password=password)
        return {"success": True, "message": "Zerion login completed"}
    except Exception as e:
        return {"success": False, "message": f"Zerion login failed: {e}"}
```

> `BaseBrowser.login_zerion()` уже содержит ветвление по `mm_mode` (строка 384-393 в browser.py).

### 1.4. `browser_close`

```python
@mcp.tool()
async def browser_close(account_name: str) -> dict:
    browser = _browsers.pop(account_name, None)
    if not browser:
        return {"success": False, "message": f"No browser running for '{account_name}'"}
    try:
        await browser.close()
        return {"success": True, "message": f"Browser closed for {account_name}"}
    except Exception as e:
        return {"success": False, "message": f"Close failed: {e}"}
```

> `BaseBrowser.close()` уже содержит ветвление по `mm_mode` (строка 345-358 в browser.py).

### 1.5. Остальные tools (navigate/click/fill/screenshot/get_content/wait_for/list_sessions)

Без изменений — работают через `BaseBrowser.page`, который уже подключён через CDP.

### 1.6. Новый tool: `browser_get_account_info`

```python
@mcp.tool()
async def browser_get_account_info(account_name: str) -> dict:
    """
    Возвращает данные аккаунта (email, evm, solana, proxy, timezone).

    Args:
        account_name: Имя аккаунта (например, 'auto_001')

    Returns:
        dict с ключами: success, account (dict), mode ("mm"|"legacy")
    """
    account, profile_id, mm_mode = _resolve_account(account_name)
    return {
        "success": True,
        "account": {
            "name": account.get("name"),
            "email": account.get("email"),
            "evm": account.get("evm"),
            "solana": account.get("solana"),
            "proxy": account.get("proxy"),
            "timezone": account.get("timezone"),
            "wallet_password": account.get("wallet_password"),
        },
        "profile_id": profile_id,
        "mode": "mm" if mm_mode else "legacy",
    }
```

---

## Шаг 2: Recorder-режим (`mcp_server/recorder.py`)

### 2.1. CDP-перехватчик событий (через DOM-события)

```python
"""ActionRecorder: запись действий пользователя/ИИ в браузере."""

import json
import logging
from pathlib import Path
from typing import Optional

logger = logging.getLogger(__name__)

PROJECTS_DIR = Path(__file__).resolve().parent.parent / "projects"


def _get_selector(element_info: dict) -> str:
    """Строит CSS-селектор из DOM-пути элемента."""
    tag = element_info.get("tag", "").lower()
    id_attr = element_info.get("id")
    classes = element_info.get("classes", [])
    nth = element_info.get("nth")
    nth_of_type = element_info.get("nthOfType")

    if id_attr:
        return f"#{id_attr}"
    selector = tag
    for cls in classes[:3]:
        selector += f".{cls}"
    if nth_of_type and nth_of_type > 1:
        selector += f":nth-of-type({nth_of_type})"
    elif nth and nth > 1:
        selector += f":nth-child({nth})"
    return selector


class ActionRecorder:
    def __init__(self, page):
        self._page = page
        self._actions: list[dict] = []
        self._recording = False

    async def start(self):
        """Включает запись: подписывается на DOM-события через expose_function."""
        if self._recording:
            return

        self._recording = True
        self._actions = []

        await self._page.expose_function("__recorder_onclick", self._on_dom_click)
        await self._page.expose_function("__recorder_oninput", self._on_dom_input)

        await self._page.evaluate("""
            function getElementInfo(el) {
                if (!el) return null;
                return {
                    tag: el.tagName || '',
                    id: el.id || null,
                    classes: Array.from(el.classList || []),
                    text: (el.innerText || '').trim().slice(0, 200),
                    name: el.getAttribute('name') || null,
                    type: el.getAttribute('type') || null,
                    placeholder: el.getAttribute('placeholder') || null,
                    href: el.getAttribute('href') || null,
                    nth: Array.from(el.parentNode?.children || []).indexOf(el) + 1,
                    nthOfType: Array.from(el.parentNode?.children || [])
                        .filter(c => c.tagName === el.tagName).indexOf(el) + 1,
                };
            }

            document.addEventListener('click', (e) => {
                setTimeout(() => {
                    window.__recording_onclick(JSON.stringify({
                        type: 'click',
                        element: getElementInfo(e.target),
                        url: location.href,
                        timestamp: Date.now(),
                    }));
                }, 100);
            }, true);

            document.addEventListener('change', (e) => {
                const el = e.target;
                if (el.tagName === 'SELECT' || el.tagName === 'INPUT') {
                    window.__recording_oninput(JSON.stringify({
                        type: el.tagName === 'SELECT' ? 'select' : 'change',
                        element: getElementInfo(el),
                        value: el.value?.slice(0, 500),
                        url: location.href,
                        timestamp: Date.now(),
                    }));
                }
            }, true);
        """)

    async def _on_dom_click(self, json_data: str):
        data = json.loads(json_data)
        data["selector"] = _get_selector(data.get("element", {}))
        self._actions.append(data)

    async def _on_dom_input(self, json_data: str):
        data = json.loads(json_data)
        data["selector"] = _get_selector(data.get("element", {}))
        self._actions.append(data)

    def stop(self) -> list[dict]:
        self._recording = False
        return self._actions.copy()

    def clear(self):
        self._actions = []
```

### 2.2. Компилятор действий → Python-класс

```python
def actions_to_project_class(actions: list[dict], project_name: str) -> str:
    """
    Компилирует список записанных действий в Python-код класса
    проекта, наследуемого от BaseProject.
    """

    if not actions:
        raise ValueError("No actions recorded")

    # Определяем стартовый URL
    start_url = actions[0].get("url", "about:blank")

    # Собираем тело _process()
    body_lines = []
    for i, action in enumerate(actions):
        action_type = action.get("type")
        selector = action.get("selector")
        value = action.get("value")
        text = action.get("element", {}).get("text", "")

        if action_type == "click":
            body_lines.append(f"        # [{i}] Click on '{text or selector}'")
            body_lines.append(f"        await self.page.wait_for_selector(\"{selector}\", timeout=10000)")
            body_lines.append(f"        await self.page.click(\"{selector}\")")
            body_lines.append("")

        elif action_type in ("change",):
            body_lines.append(f"        # [{i}] Fill '{selector}' with '{value}'")
            body_lines.append(f"        await self.page.wait_for_selector(\"{selector}\", timeout=10000)")
            body_lines.append(f"        await self.page.fill(\"{selector}\", \"{value}\")")
            body_lines.append("")

    class_name = project_name.capitalize() + "Project"

    code = f'''import logging
from projects.base import BaseProject

logger = logging.getLogger(__name__)


class {class_name}(BaseProject):
    """Auto-generated project: {project_name}"""

    def _get_page_name(self) -> str:
        return "{project_name}"

    def _get_start_url(self) -> str:
        return "{start_url}"

    def _get_max_attempts(self) -> int:
        return 1

    def _use_new_tab(self) -> bool:
        return False

    async def _login(self):
        pass

    async def _check_success(self) -> bool:
        return True

    async def _process(self):
{chr(10).join(body_lines)}
'''
    return code


def save_project_code(project_name: str, code: str) -> str:
    """Сохраняет сгенерированный код в projects/generated_{project_name}.py."""
    file_path = PROJECTS_DIR / f"generated_{project_name}.py"
    with open(file_path, "w", encoding="utf-8") as f:
        f.write(code)
    logger.info(f"Project class saved to {file_path}")
    return str(file_path)
```

### 2.3. Tools Recorder

```python
@mcp.tool()
async def recorder_start(account_name: str) -> dict:
    """Включает запись действий в браузере."""
    browser = _browsers.get(account_name)
    if not browser:
        return {"success": False, "message": f"No browser running for '{account_name}'"}
    from mcp_server.recorder import ActionRecorder
    if account_name not in _recorders:
        _recorders[account_name] = ActionRecorder(browser.page)
    await _recorders[account_name].start()
    return {"success": True, "message": f"Recording started for {account_name}"}


@mcp.tool()
async def recorder_stop(account_name: str) -> dict:
    """Выключает запись и возвращает список действий."""
    recorder = _recorders.pop(account_name, None)
    if not recorder:
        return {"success": False, "message": f"No recorder found for '{account_name}'"}
    actions = recorder.stop()
    return {"success": True, "actions": actions, "count": len(actions)}


@mcp.tool()
async def generate_project_class(session_name: str, project_name: str) -> dict:
    """
    Компилирует записанные действия в Python-класс проекта.

    Args:
        session_name: Имя сессии браузера (account_name)
        project_name: Имя нового проекта

    Returns:
        dict с ключами: success, message, code, file_path
    """
    recorder = _recorders.get(session_name)
    if not recorder:
        return {"success": False, "message": f"No recorder active for '{session_name}'"}
    actions = recorder.stop()
    if not actions:
        return {"success": False, "message": "No actions recorded"}
    try:
        code = actions_to_project_class(actions, project_name)
        file_path = save_project_code(project_name, code)
        return {"success": True, "message": f"Project '{project_name}' generated",
                "code": code, "file_path": file_path}
    except Exception as e:
        return {"success": False, "message": f"Generation failed: {e}"}
```

---

## Шаг 3: Мультимодальный анализ (`mcp_server/vision.py`)

### 3.1. Модуль VisionAnalyzer

```python
"""VisionAnalyzer: мультимодальный анализ скриншотов."""

import base64
import logging
import os
from typing import Optional

logger = logging.getLogger(__name__)


class VisionAnalyzer:
    """Анализирует скриншоты через мультимодальную модель (GPT-4o)."""

    def __init__(self, model: str = "gpt-4o", api_key: Optional[str] = None):
        self._model = model
        self._api_key = api_key or os.environ.get("OPENAI_API_KEY")
        if not self._api_key:
            logger.warning("OPENAI_API_KEY не задан. Vision-анализ будет недоступен.")

    async def analyze_screenshot(self, screenshot_b64: str, prompt: str) -> str:
        """Отправляет скриншот в мультимодальную модель и возвращает текстовый ответ."""
        if not self._api_key:
            return "Vision-анализ недоступен: не задан OPENAI_API_KEY"

        from openai import AsyncOpenAI

        client = AsyncOpenAI(api_key=self._api_key)
        response = await client.chat.completions.create(
            model=self._model,
            messages=[
                {
                    "role": "user",
                    "content": [
                        {"type": "text", "text": prompt},
                        {
                            "type": "image_url",
                            "image_url": {
                                "url": f"data:image/png;base64,{screenshot_b64}",
                                "detail": "high",
                            },
                        },
                    ],
                }
            ],
            max_tokens=2048,
        )
        return response.choices[0].message.content or ""

    async def describe_page(self, screenshot_b64: str) -> str:
        """Возвращает текстовое описание того, что видит на странице."""
        return await self.analyze(
            screenshot_b64,
            "Describe this web page in detail. What elements are visible? "
            "What is the page about? List all buttons, inputs, and links you see.",
        )

    async def solve_captcha(self, screenshot_b64: str) -> str:
        """Анализирует капчу и возвращает решение."""
        return await self.analyze(
            screenshot_b64,
            "This is a captcha. Solve it and return ONLY the answer text, nothing else.",
        )
```

### 3.2. Tool `browser_vision_analyze`

```python
_vision = None

def _get_vision():
    global _vision
    if _vision is None:
        from mcp_server.vision import VisionAnalyzer
        _vision = VisionAnalyzer()
    return _vision


@mcp.tool()
async def browser_vision_analyze(
    account_name: str,
    prompt: str,
) -> dict:
    """
    Делает скриншот и анализирует его через мультимодальную модель.

    Args:
        account_name: Имя аккаунта
        prompt: Вопрос/инструкция для модели

    Returns:
        dict с ключами: success, analysis (текст), screenshot (base64)
    """
    browser = _browsers.get(account_name)
    if not browser:
        return {"success": False, "message": f"No browser running for '{account_name}'"}

    try:
        import base64
        screenshot_bytes = await browser.page.screenshot()
        screenshot_b64 = base64.b64encode(screenshot_bytes).decode()

        vision = _get_vision()
        analysis = await vision.analyze(screenshot_b64, prompt)

        return {
            "success": True,
            "analysis": analysis,
            "screenshot": screenshot_b64,
        }
    except Exception as e:
        return {"success": False, "message": f"Vision analysis failed: {e}"}
```

---

## Шаг 4: Рефакторинг `mcp_server/client.py`

### 4.1. Изменения

- Добавить `MultiManagerClient`-детект и кеш профилей (как в `server.py`)
- `launch()` должен поддерживать MM-режим
- `_get_account()` → резолв через `_resolve_account()` (как в server.py)
- Добавить метод `get_account_info()`

```python
# Добавить в начало client.py:
import os
from Core.multimanager import MultiManagerClient

_mm_client = None
_profiles_cache: dict[str, dict] = {}
_use_mm = False


async def _init_mm_mode():
    global _mm_client, _use_mm, _profiles_cache
    if _mm_client is None:
        _mm_client = MultiManagerClient()
    if not _use_mm:
        _use_mm = await _mm_client.is_core_alive()
        if _use_mm:
            profiles = await _mm_client.get_all_profiles()
            for p in profiles:
                _profiles_cache[p["name"]] = p


def _get_account(name: str) -> tuple[dict, str | None, bool]:
    if _use_mm:
        raw = _profiles_cache.get(name)
        if not raw:
            raise ValueError(f"Account '{name}' not found in MultiManager")
        account = MultiManagerClient.normalize_account(raw)
        return account, raw.get("id"), True
    else:
        from config.accounts import accounts
        account = next((a for a in accounts if a["name"] == name), None)
        if not account:
            raise ValueError(f"Account '{name}' not found")
        return account, None, False
```

---

## Шаг 5: Тесты

### 5.1. `tests/test_mcp_server.py`

```python
"""Tests for MCP server module."""

import pytest
from unittest.mock import AsyncMock, patch, MagicMock


@pytest.mark.asyncio
async def test_browser_launch_mm_mode():
    """Проверка, что browser_launch вызывает start_browser в MM-режиме."""
    ...


@pytest.mark.asyncio
async def test_browser_launch_legacy():
    """Проверка fallback на config.accounts когда Core мёртв."""
    ...


@pytest.mark.asyncio
async def test_browser_close_mm():
    """Проверка закрытия через MultiManager."""
    ...


@pytest.mark.asyncio
async def test_zerion_login_mm():
    """Проверка делегирования zerion_login."""
    ...


@pytest.mark.asyncio
async def test_browser_get_account_info():
    """Проверка данных из кеша."""
    ...


def test_list_sessions():
    """Проверка состояния сессий."""
    ...
```

### 5.2. `tests/test_recorder.py`

```python
"""Tests for ActionRecorder."""

import pytest
from mcp_server.recorder import ActionRecorder, actions_to_project_class, _get_selector


@pytest.mark.asyncio
async def test_recorder_start_stop():
    """Запись + остановка; проверка структуры actions."""
    ...


def test_compile_to_project_class():
    """Проверка генерации Python-кода."""
    ...


def test_generate_project_tool():
    """Интеграционный тест toola генерации."""
    ...
```

### 5.3. `tests/test_vision.py`

```python
"""Tests for VisionAnalyzer."""

import pytest
from unittest.mock import AsyncMock, patch


@pytest.mark.asyncio
async def test_vision_analyze():
    """Мок API вызова, проверка форматирования запроса."""
    ...


@pytest.mark.asyncio
async def test_vision_solve_captcha():
    """Проверка детекта капчи."""
    ...
```

---

## Шаг 6: Обновление зависимостей

### 6.1. `requirements.txt`

Добавить:
```
openai>=1.0.0
```

### 6.2. `mcp_server/__init__.py`

Без изменений (пустой).

---

## Порядок выполнения (Roadmap)

| № | Шаг | Файлы | Зависимости | Статус |
|--:|------|-------|-----------|-------|
| 1 | Refactor `server.py` — MM-детект и резолв аккаунтов | `mcp_server/server.py` | MultiManager API (готов) | ✅ |
| 2 | browser_launch/close/login_zerion — MM-маршрут | `mcp_server/server.py` | Шаг 1 | ✅ |
| 3 | browser_get_account_info tool | `mcp_server/server.py` | Шаг 1 | ✅ |
| 4 | Recorder-модуль | `mcp_server/recorder.py` | — | ✅ |
| 5 | Tools recorder_start/stop + generate_project_class | `mcp_server/server.py` | Шаг 4 | ✅ |
| 6 | Vision-модуль | `mcp_server/vision.py` | OpenAI API ключ | ✅ |
| 7 | Tool browser_vision_analyze | `mcp_server/server.py` | Шаг 6 | ✅ |
| 8 | Refactor `client.py` — MM-поддержка | `mcp_server/client.py` | Шаги 1-2 | ✅ |
| 9 | Tests MCP | `tests/test_mcp_server.py` | Шаги 1-3 | ✅ |
| 10 | Tests Recorder | `tests/test_recorder.py` | Шаги 4-5 | ✅ |
| 11 | Tests Vision | `tests/test_vision.py` | Шаг 6 | ✅ |
| 12 | Update requirements.txt | `requirements.txt` | Шаг 6 | ✅ |

---

## Открытые вопросы (решены)

| # | Вопрос | Решение |
|---|--------|---------|
| Q1 | Recorder: CDP vs DOM-события? | DOM-события через `page.expose_function` — проще, надёжнее |
| Q2 | Vision: OpenAI vs Anthropic vs Ollama? | Начать с OpenAI GPT-4o — стабильно для мультимодальных задач |
| Q3 | client.py: синхронизировать или удалить? | Синхронизировать — `BrowserClient` юзается в скриптах |