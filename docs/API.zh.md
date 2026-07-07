# API 参考文档

用于反检测浏览器管理的 REST API。所有请求需要授权头。

## 认证

```http
Authorization: Bearer <token>
```

令牌在首次启动时生成，或通过 `--api-token=SECRET` 传入。

---

## 健康检查

### GET /health

检查服务器状态。

**响应：**
```json
{
  "status": "ok"
}
```

---

## 配置文件

### POST /api/profiles

创建新配置文件。指纹自动生成。

**请求体：**
```json
{
  "name": "我的配置",
  "platform": "windows",
  "proxy_id": 1,
  "extensions": ["ext1", "ext2"],
  "tags": ["tag1"],
  "notes": "备注",
  "timezone": "Asia/Bishkek",
  "email": "user@example.com",
  "email_password": "secret",
  "twitter_username": "my_twitter",
  "twitter_password": "tw_secret",
  "twitter_auth_token": "auth_token_123",
  "twitter_email": "tw@example.com",
  "discord_username": "my_discord",
  "discord_password": "dc_secret",
  "discord_token": "dc_token_456",
  "discord_email": "dc@example.com",
  "wallet_evm_address": "0x1234567890abcdef1234567890abcdef12345678",
  "wallet_sol_address": "AbCdEfGhIjKlMnOpQrStUvWxYz1234567890abcd",
  "wallet_password": "my_wallet_pass"
}
```

**必填字段：** `name`、`platform`（windows | macos | linux）

**响应 (201)：**
```json
{
  "id": "f81d4fae-7dec-11d0-a765-00a0c91e6bf6",
  "number": 1,
  "name": "我的配置",
  "proxy_id": 1,
  "fingerprint_seed": "a1b2c3d4-...",
  "platform": "windows",
  "user_agent": "Mozilla/5.0 ...",
  "screen_resolution": "1920x1080",
  "hardware_cores": 8,
  "hardware_memory": 16,
  "extensions": "[\"ext1\",\"ext2\"]",
  "tags": "[\"tag1\"]",
  "notes": "备注",
  "timezone": "Asia/Bishkek",
  "email": "user@example.com",
  "email_password": "secret",
  "twitter_username": "my_twitter",
  "twitter_password": "tw_secret",
  "twitter_auth_token": "auth_token_123",
  "twitter_email": "tw@example.com",
  "discord_username": "my_discord",
  "discord_password": "dc_secret",
  "discord_token": "dc_token_456",
  "discord_email": "dc@example.com",
  "wallet_evm_address": "0x1234567890abcdef1234567890abcdef12345678",
  "wallet_sol_address": "AbCdEfGhIjKlMnOpQrStUvWxYz1234567890abcd",
  "wallet_password": "my_wallet_pass",
  "status": "stopped",
  "created_at": "2024-01-01T00:00:00.000Z",
  "updated_at": "2024-01-01T00:00:00.000Z"
}
```

---

### GET /api/profiles

获取所有配置文件。

**响应 (200)：** 配置文件数组

---

### GET /api/profiles/:id

按 ID 获取配置文件。

**响应 (200)：** 配置文件
**响应 (404)：** `{ "error": "配置文件未找到" }`

---

### PUT /api/profiles/:id

更新配置文件。

**请求体：**
```json
{
  "name": "新名称",
  "proxy_id": 2,
  "extensions": ["new_ext"],
  "tags": ["new_tag"],
  "notes": "新备注",
  "timezone": "Europe/London",
  "email": "new@example.com",
  "email_password": "new_secret",
  "twitter_username": "new_twitter",
  "twitter_auth_token": "new_token",
  "discord_username": "new_discord",
  "wallet_evm_address": "0xabcdef1234567890abcdef1234567890abcdef12"
}
```

**响应 (200)：** 更新后的配置文件

---

### DELETE /api/profiles/:id

删除配置文件。无法删除正在运行的配置文件。

**响应 (204)：** 删除成功
**响应 (409)：** `{ "error": "无法删除正在运行的配置文件" }`

---

### POST /api/profiles/:id/regenerate

重新生成配置文件指纹。

**响应 (200)：** 新指纹的配置文件

---

### POST /api/profiles/batch

批量创建配置文件。所有操作在单个事务中执行（出错时自动回滚）。

**请求体：**
```json
{
  "accounts": [
    { "name": "Profile 1", "platform": "windows" },
    { "name": "Profile 2", "platform": "macos" }
  ]
}
```

**每个项目的必填字段：** `name`、`platform`

**响应 (201)：** 创建的配置文件数组
```json
[
  { "id": "...", "name": "Profile 1", "number": 1, ... },
  { "id": "...", "name": "Profile 2", "number": 2, ... }
]
```

**响应 (400)：** `{ "error": "项目 [0] 需要 name 和 platform" }`

---

## 代理

### POST /api/proxies

添加代理。

**请求体：**
```json
{
  "type": "socks5",
  "host": "proxy.example.com",
  "port": 1080,
  "username": "user",
  "password": "pass",
  "proxy_rotation_url": "https://api.proxy.com/rotate"
}
```

**必填字段：** `type`、`host`、`port`

**响应 (201)：** 创建的代理

---

### POST /api/proxies/import

批量导入代理。

**请求体：**
```json
{
  "text": "socks5://user:pass@host1:1080\nhttp://host2:8080"
}
```

**响应 (201)：**
```json
{
  "count": 2,
  "proxies": [...]
}
```

---

### GET /api/proxies

获取所有代理。

**响应 (200)：** 代理数组

---

### GET /api/proxies/:id

按 ID 获取代理。

---

### PUT /api/proxies/:id

更新代理。

**请求体：**
```json
{
  "host": "new-host.com",
  "port": 9090,
  "is_active": true
}
```

---

### DELETE /api/proxies/:id

删除代理。

---

### POST /api/proxies/:id/check

检查代理（如配置了轮换则自动轮换）。

**响应 (200)：**
```json
{
  "ok": true,
  "ip": "1.2.3.4"
}
```

**响应 (502)：**
```json
{
  "error": "轮换错误",
  "details": "Timeout"
}
```

---

## Cookie

### GET /api/cookies/:profileId

获取配置文件的 Cookie。

**响应 (200)：** Cookie 数组

---

### POST /api/cookies/:profileId/import

导入 Cookie。

**请求体：**
```json
{
  "format": "json",
  "content": "[{\"name\":\"session\",\"value\":\"abc123\",\"domain\":\".example.com\"}]"
}
```

**格式：** `json`、`netscape`

**响应 (200)：**
```json
{
  "count": 1
}
```

---

### GET /api/cookies/:profileId/export?format=json

导出 Cookie。

**参数：** `format`（json | netscape）

**响应 (200)：** Cookie 数组或 Netscape 格式文本

---

### DELETE /api/cookies/:profileId

删除配置文件的所有 Cookie。

---

## 浏览器管理

### POST /api/browser/:id/start

启动浏览器。如有绑定代理会自动检查。

**响应 (200)：**
```json
{
  "status": "success",
  "profile_id": "f81d4fae-...",
  "pid": 48210,
  "cdp_port": 9331,
  "ws_endpoint": "http://127.0.0.1:9331"
}
```

**响应 (412)：** 代理不可用
```json
{
  "error": "代理不可用",
  "details": "Connection refused"
}
```

**响应 (502)：** 代理轮换错误

---

### POST /api/browser/:id/stop

停止浏览器。5 秒内未终止则强制结束。

**响应 (200)：**
```json
{
  "status": "stopped"
}
```

---

### GET /api/browser/:id/status

获取浏览器状态。

**响应 (200)：**
```json
{
  "id": "f81d4fae-...",
  "status": "running",
  "pid": 48210
}
```

---

### POST /api/browser/:id/clean

清理配置文件缓存。仅对已停止的配置文件可用。

**响应 (200)：**
```json
{
  "status": "cleaned"
}
```

**响应 (409)：**
```json
{
  "error": "无法清理正在运行的配置文件缓存"
}
```

---

### GET /api/browser/profile-windows

获取配置文件到窗口的绑定列表。

**响应 (200)：**
```json
[
  {
    "profileId": "f81d4fae-...",
    "pid": 48210,
    "handle": "12345"
  }
]
```

---

### POST /api/browser/:id/type

通过 CDP 进行人机化文本输入。模拟真实输入，延迟 50–150 毫秒，3% 的拼写错误并用 Backspace 更正。

**请求体：**
```json
{
  "text": "你好，世界！"
}
```

**必填字段：** `text`

**响应 (200)：**
```json
{
  "status": "success"
}
```

**响应 (400)：** `{ "error": "text 字段为必填项" }`
**响应 (404)：** `{ "error": "配置文件未找到" }`
**响应 (409)：** `{ "error": "配置文件未运行" }`
**响应 (502)：** `{ "error": "CDP 端口未找到" }`

---

### POST /api/browser/:id/zerion-login

自动登录 Zerion 扩展（扩展 ID：`klghhnkeealcohjjanjjdaeeggmfmlpl`）。

**请求体：**
```json
{
  "password": "zerion_password"
}
```

**响应 (200)：**
```json
{
  "status": "success"
}
```

**响应 (404)：** `{ "error": "配置文件未找到" }`
**响应 (409)：** `{ "error": "配置文件未运行" }`
**响应 (502)：** `{ "error": "CDP 端口未找到" }`

---

## Multi-Control（窗口同步）— v0.13.0

通过 CDP（Chrome DevTools Protocol）将主窗口的操作广播到所有从窗口。

**架构：**
- **DOM 输入捕获**：通过 `SYNC_EVENT_SCRIPT` 在主页面注入 CDP 绑定 `Runtime.addBinding('__MM_SYNC_BIND__')`。DOM 事件（mousemove、mousedown、mouseup、wheel、keydown、keyup）+ `visibilitychange` → `window.__MM_SYNC_BIND__(JSON)` → `cdpManager.onEvent` → `inputCapture.injectFromCdp()` → `controller`
- **原生钩子（OS 级别）**：C++ 插件 `WH_KEYBOARD_LL` 在 OS 级别拦截所有按键，包括浏览器快捷键（Ctrl+T、Ctrl+W）。HTTP POST → `/api/multi-control/os-keyboard`
- **鼠标平滑**：MouseSmoother（ghost-cursor `path()`：三次贝塞尔曲线 + Fitts's Law + 过冲）+ `setTimeout` 调度循环 + 点击前 `flush()`
- **滚动**：分解为一系列 `wheel` 分发（SCROLL_STEP_PX=40，SCROLL_TICK_MS=16）
- **多标签页**：每 300ms HTTP `/json` 轮询检测原生打开的标签页。标签映射 1:N 通过 `Map<masterTargetId, Map<slaveId, slaveTargetId>>` + `tabIndex` 矩阵
- **焦点激活**：链式调用 `Target.activateTarget` → `Page.bringToFront` → `DOM.focus` → `body.focus()` 以在从窗口中设置 DOM 输入焦点
- **双重分发**：在 DOM 元素中输入时，按键会发送到从窗口两次（CDP + 原生钩子）

### GET /api/multi-control/status

获取 multi-control 状态。

**响应 (200)：**
```json
{
  "active": true,
  "masterId": "f81d4fae-...",
  "slaveCount": 3,
  "slaves": ["uuid-1", "uuid-2", "uuid-3"]
}
```

---

### POST /api/multi-control/start

启动 multi-control。设置主配置文件。

**请求体：**
```json
{
  "masterId": "f81d4fae-..."
}
```

**响应 (200)：**
```json
{
  "status": "active",
  "masterId": "f81d4fae-...",
  "mode": "cdp"
}
```

**响应 (412)：** `{ "error": "CDP 端口不可用" }`

---

### POST /api/multi-control/stop

停止 multi-control。断开所有从窗口。

**响应 (200)：**
```json
{
  "status": "stopped"
}
```

---

### POST /api/multi-control/slave/add

添加从配置文件。

**请求体：**
```json
{
  "profileId": "uuid-slave-1"
}
```

**响应 (200)：**
```json
{
  "status": "added",
  "profileId": "uuid-slave-1",
  "slaveCount": 1
}
```

**响应 (409)：** `{ "error": "Multi-control 未激活" }`

---

### POST /api/multi-control/slave/remove

移除从配置文件。

**请求体：**
```json
{
  "profileId": "uuid-slave-1"
}
```

**响应 (200)：**
```json
{
  "status": "removed",
  "profileId": "uuid-slave-1"
}
```

---

### POST /api/multi-control/window-position

设置从窗口位置。

**请求体：**
```json
{
  "profileId": "uuid-slave-1",
  "x": 100,
  "y": 100,
  "width": 800,
  "height": 600
}
```

**响应 (200)：**
```json
{
  "status": "ok"
}
```

---

### GET /api/multi-control/cdp-status

获取 CDP 连接状态。

**响应 (200)：**
```json
{
  "f81d4fae-...": true,
  "uuid-slave-1": true,
  "uuid-slave-2": true
}
```

---

### POST /api/multi-control/os-keyboard

从 OS 级别钩子（Electron 主进程，WH_KEYBOARD_LL C++ 插件）接收键盘事件。

在 OS 级别拦截所有按键，包括浏览器快捷键（Ctrl+T、Ctrl+W 等）和地址栏输入。

> **双重分发：** 在 DOM 元素中输入时，按键会发送到从窗口两次——一次通过 CDP SYNC_EVENT_SCRIPT，一次通过此端点。

**请求体：**
```json
{
  "type": "keyDown",
  "key": "l",
  "code": "KeyL",
  "windowsVirtualKeyCode": 76,
  "ctrlKey": true,
  "shiftKey": false,
  "altKey": false,
  "metaKey": false
}
```

**响应 (200)：**
```json
{
  "ok": true
}
```

---

### POST /api/multi-control/focus-windows

聚焦所有 multi-control 窗口（先从窗口，后主窗口）。

**响应 (200)：**
```json
{
  "focused": true
}
```

## Internal API

### GET /api/internal/profiles?range=001-010

按编号范围获取配置文件。返回解密后的密钥。

**参数：** `range` — 编号范围，格式为 `NNN-NNN`

**响应 (200)：** 包含解密密钥的配置文件数组

**响应 (400)：** `{ "error": "范围格式无效：001-010" }`

---

## 扩展

### GET /api/extensions

获取已安装扩展列表。

**响应 (200)：**
```json
[
  {
    "id": "my-extension",
    "name": "My Extension",
    "version": "1.0.0",
    "description": "扩展描述",
    "enabled": true,
    "path": "/path/to/extension"
  }
]
```

---

### POST /api/extensions

从磁盘目录安装扩展。

**请求体：**
```json
{
  "name": "my-extension",
  "path": "/path/to/unpacked/extension"
}
```

**响应 (201)：** 已安装的扩展

---

### DELETE /api/extensions/:id

删除扩展。

**响应 (204)：** 删除成功

---

### POST /api/extensions/:id/toggle

切换扩展启用状态。

**响应 (200)：**
```json
{
  "id": "my-extension",
  "enabled": true
}
```

---

### POST /api/extensions/from-store

通过 Chrome Web Store 链接或 ID 安装扩展。

**请求体：**
```json
{
  "url": "https://chrome.google.com/webstore/detail/extension-name/abcdefghijklmnopqrstuvwxyzabcdef"
}
```

扩展 ID 为 32 个 `[a-z]` 字符，自动从 URL 中提取。

**响应 (201)：** 已安装的扩展

---

### POST /api/extensions/from-zip

从 ZIP 或 CRX 存档安装扩展。

**请求体：**
```json
{
  "name": "my-extension",
  "zipPath": "/path/to/extension.zip"
}
```

如果存档包含单个根目录，则会自动剥离。支持 CRX v2 和 CRX v3 格式。

**响应 (201)：** 已安装的扩展

---

## 日志

### GET /api/logs

获取最近的系统日志条目（core.log）。

**参数：** `limit`（默认 100）

**响应 (200)：** 日志条目数组

---

### GET /api/logs/tail

获取系统日志最后 N 字节。

**参数：** `bytes`（默认 10240）

**响应 (200)：**
```json
{
  "content": "...",
  "size": 51200
}
```

---

### GET /api/logs/profile/:profileId

获取特定配置文件的日志。

**参数：** `limit`（默认 100）

**响应 (200)：** 日志条目数组

---

### GET /api/logs/files

获取所有日志文件列表。

**响应 (200)：**
```json
[
  {
    "name": "core.log",
    "size": 51200,
    "modified": "2024-01-01T00:00:00.000Z"
  }
]
```

---

## 任务

### GET /api/tasks

获取所有任务列表。

**响应 (200)：** 任务数组

---

### POST /api/tasks

创建任务。

**请求体：**
```json
{
  "name": "我的任务",
  "script_name": "script.sh",
  "schedule_type": "interval",
  "params": "{}",
  "is_active": 1
}
```

**必填字段：** `name`、`script_name`、`schedule_type`

**响应 (201)：** 已创建的任务

---

### GET /api/tasks/:id

按 ID 获取任务。

**响应 (200)：** 任务
**响应 (404)：** `{ "error": "任务未找到" }`

---

### PUT /api/tasks/:id

更新任务。

**响应 (200)：** 更新后的任务

---

### DELETE /api/tasks/:id

删除任务。

**响应 (204)：** 删除成功

---

### GET /api/tasks/:id/executions

获取任务执行历史。

**响应 (200)：** 执行记录数组

---

### POST /api/tasks/:id/run

手动运行任务。

**响应 (200)：**
```json
{
  "status": "running",
  "execution_id": 1
}
```

**响应 (404)：** `{ "error": "任务未找到" }`

---

## 窗口排列器

### GET /api/window-arranger/windows

获取当前屏幕上的窗口列表。

**响应 (200)：**
```json
[
  {
    "id": "12345",
    "name": "CloakBrowser - Profile 1",
    "x": 0,
    "y": 0,
    "width": 1920,
    "height": 1080
  }
]
```

---

### GET /api/window-arranger/windows/grouped

获取按配置文件分组的窗口。

**响应 (200)：**
```json
[
  {
    "profileId": "f81d4fae-...",
    "profileName": "我的配置",
    "profileNumber": 1,
    "windows": [
      {
        "id": "12345",
        "name": "CloakBrowser - Profile 1",
        "x": 0,
        "y": 0,
        "width": 1920,
        "height": 1080
      }
    ]
  }
]
```

---

### POST /api/window-arranger/grid

将所有窗口排列为网格（平铺模式）。

**响应 (200)：**
```json
{
  "arranged": 4,
  "cols": 2,
  "rows": 2,
  "screen": { "width": 1920, "height": 1080 }
}
```

---

### POST /api/window-arranger/grid/grouped

按配置文件分组排列窗口为网格。每组窗口放置在自己的屏幕区域中。

**响应 (200)：**
```json
{
  "arranged": 4,
  "groups": 2,
  "screen": { "width": 1920, "height": 1080 }
}
```

---

### POST /api/window-arranger/cascade

将窗口排列为层叠式（重叠，偏移 30px）。

**响应 (200)：**
```json
{
  "arranged": 4,
  "offset": 30
}
```

---

### POST /api/window-arranger/cascade/grouped

按配置文件分组层叠排列窗口。

**响应 (200)：**
```json
{
  "arranged": 4,
  "offset": 30
}
```

---

### POST /api/window-arranger/focus/:windowId

聚焦指定窗口。

**响应 (200)：**
```json
{
  "focused": "12345"
}
```

---

## 指纹生成器

### POST /api/fingerprint/generate

为指定平台生成随机指纹。不会创建配置文件。

**请求体：**
```json
{
  "platform": "macos"
}
```

**必填字段：** `platform`（windows | macos | linux）

**响应 (200)：**
```json
{
  "platform": "macos",
  "user_agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)...",
  "screen_resolution": "2560x1600",
  "hardware_cores": 10,
  "hardware_memory": 16,
  "color_depth": 24,
  "webgl_renderer": "Apple GPU",
  "fingerprint_seed": "a1b2c3d4-..."
}
```

---

## 设置

### GET /api/settings/crypto-status

获取加密模块状态（针对配置文件密钥字段的 AES-256-GCM 加密）。

**响应 (200)：**
```json
{
  "initialized": true,
  "hasMasterKey": true,
  "keySource": "keytar",
  "passwordMode": false,
  "encryptedFields": ["email_password", "twitter_password", "twitter_auth_token", "discord_password", "discord_token", "wallet_password"]
}
```

---

### POST /api/settings/set-master-password

设置主密码（启用 passwordMode）。至少 8 个字符。

**请求体：**
```json
{
  "password": "my_strong_password"
}
```

**响应 (200)：**
```json
{
  "status": "success",
  "passwordMode": true
}
```

**响应 (400)：** `{ "error": "密码至少需要 8 个字符" }`

---

### POST /api/settings/change-master-password

更改主密码。

**请求体：**
```json
{
  "old_password": "old_password",
  "new_password": "new_password"
}
```

**响应 (200)：**
```json
{
  "status": "success"
}
```

**响应 (400)：** `{ "error": "旧密码错误" }`

---

### GET /api/settings/recovery-key

获取恢复密钥（需要主密码）。

**响应 (200)：**
```json
{
  "recoveryKey": "recovery-key-here"
}
```

**响应 (400)：** `{ "error": "加密模块未初始化" }`

---

### GET /api/settings/automation

获取自动化设置（脚本和项目目录路径）。

**响应 (200)：**
```json
{
  "scripts_dir": "",
  "projects_dir": ""
}
```

---

### PUT /api/settings/automation

更新自动化设置。

**请求体：**
```json
{
  "scripts_dir": "/path/to/scripts",
  "projects_dir": "/path/to/projects"
}
```

**响应 (200)：** 更新后的设置

---

## 配置文件状态

| 状态 | 描述 |
|------|------|
| `stopped` | 已停止 |
| `starting` | 启动中 |
| `running` | 运行中 |

---

## 错误代码

| 代码 | 描述 |
|------|------|
| 200 | 成功 |
| 201 | 资源已创建 |
| 204 | 删除成功 |
| 400 | 请求错误 |
| 401 | 未授权 |
| 404 | 资源未找到 |
| 409 | 冲突（运行中的配置文件等） |
| 412 | 代理不可用 |
| 500 | 服务器内部错误 |
| 502 | 代理/轮换错误 / CDP 端口未找到 |
