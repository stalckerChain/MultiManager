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
  "notes": "备注"
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
  "notes": "新备注"
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
  "ws_endpoint": "ws://127.0.0.1:3000/devtools/browser/f81d4fae-..."
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

## Multi-Control（窗口同步）

通过 CDP 将主窗口的操作广播到所有从窗口。鼠标坐标限制为 25ms 节流。

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

---

### POST /api/multi-control/stop

停止 multi-control。断开所有从窗口。

---

### POST /api/multi-control/slave/add

添加从配置文件。

**请求体：**
```json
{
  "profileId": "uuid-slave-1"
}
```

---

### POST /api/multi-control/slave/remove

移除从配置文件。

**请求体：**
```json
{
  "profileId": "uuid-slave-1"
}
```

---

### POST /api/multi-control/mouse/move

广播鼠标移动（缓冲，25ms 节流）。

**请求体：**
```json
{
  "x": 500,
  "y": 300
}
```

---

### POST /api/multi-control/mouse/click

广播点击（mousePressed + mouseReleased）。

**请求体：**
```json
{
  "x": 500,
  "y": 300,
  "button": "left",
  "clickCount": 1
}
```

---

### POST /api/multi-control/mouse/scroll

广播滚动。

**请求体：**
```json
{
  "x": 500,
  "y": 300,
  "deltaX": 0,
  "deltaY": -100
}
```

---

### POST /api/multi-control/keyboard/type

向所有从窗口广播文本。

**请求体：**
```json
{
  "text": "Hello, world!"
}
```

---

### POST /api/multi-control/keyboard/key

广播按键（keyDown + keyUp）。

**请求体：**
```json
{
  "key": "Enter",
  "code": "Enter",
  "windowsVirtualKeyCode": 13,
  "nativeVirtualKeyCode": 13
}
```

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
| 502 | 代理/轮换错误 |
