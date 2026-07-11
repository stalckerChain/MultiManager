# MultiManager v1.1.0

工业级跨平台反检测浏览器，配备图形界面和本地 REST API / WebSocket，支持自主 AI 代理（AdsPower 替代方案），基于 CloakBrowser C++ 内核构建。

## 架构与技术栈

项目采用单体仓库架构（全栈桌面应用）：

- **核心引擎（后端）：** Node.js、Express、SQLite（`better-sqlite3`）、Pino、WebSocket（`ws`）。以隐藏后台模式运行，管理数据库、网络指纹和 CloakBrowser 进程。
- **GUI（前端）：** Electron.js、Vue 3（Composition API）、Ant Design Vue、Tailwind CSS、Pinia、Vue Router、i18next。

### 跨平台系统集成：

- **Main / Renderer IPC：** 通过 `contextBridge` 实现安全的进程间通信，完全隔离（`contextIsolation: true`、`nodeIntegration: false`）。
- **动态端口分配：** 后端自动启动，自动扫描并预留 `3000–3100` 范围内的空闲端口，处理端口冲突（`EADDRINUSE` 错误）。
- **系统托盘：** 拦截窗口关闭事件，将界面隐藏到 Windows/macOS/Linux 系统托盘，确保 AI 代理在后台不间断运行。
- **自动更新：** 通过 `electron-updater` 实现应用后台更新，支持 `autoDownload` 和通知。
- **国际化（i18n）：** 通过 `i18next` 实现完整的热切换语言支持（English、Русский、简体中文）。
- **主题切换：** 通过 CSS 变量动态切换主题（深色/浅色/跟随系统）。
- **WebSocket：** 将 Core 引擎的配置文件状态和日志实时广播到 GUI。
> **PowerShell 调用：** 所有 PowerShell 调用（`Get-RunningWindows`、`Move-Window`、`Set-WindowFocus`、`FocusByPID`、`FindWindowByPid`）均使用 `spawn('powershell', ['-EncodedCommand', ...])` — 通过 Base64 UTF‑16LE 编码直接调用 PowerShell（不经过 `cmd.exe` / 临时文件 / stdin），绕过 Execution Policy、ASR 规则以及命令行长度限制（~8191 字符）。`getScreenSize` 也已从 `execAsync(powershell -Command)` 迁移到 `spawn` + `-EncodedCommand`。

---

## 项目结构

```
MultiManager/
├── package.json              # 单体仓库依赖和构建脚本
├── tsconfig.json             # TypeScript 配置
├── vitest.config.js          # Vitest 测试环境配置
├── src/                      # 后端（核心引擎）
│   ├── index.js              # 后端入口文件
│   ├── core/
│   │   ├── app.js            # Express.js 服务器初始化和路由
│   │   └── websocket.js      # WebSocket 服务器（实时事件）
│   ├── api/                  # REST API 端点
│   │   ├── auth.js           # Bearer Token 认证
│   │   ├── profiles.js       # 配置文件 CRUD
│   │   ├── proxies.js        # 代理 CRUD + 检查
│   │   ├── cookies.js        # Cookie 导入/导出
│   │   ├── browser.js        # CloakBrowser 启动/停止
│   │   ├── multi-control.js  # 窗口同步（CDP）
│   │   ├── window-arranger.js # 窗口定位（Grid/Cascade）
│   │   ├── extensions.js     # Chrome 扩展管理
│   │   ├── logs.js           # 配置文件和系统日志访问
│   │   ├── internal.js       # Internal API（按范围获取配置文件）
│   │   ├── settings.js       # 设置（加密模块，自动化）
│   │   └── tasks.js          # 调度任务
│   ├── db/                   # SQLite（WAL 模式初始化、表结构、CRUD）
│   │   ├── index.js
│   │   ├── schema.js         # 表、索引、触发器
│   │   └── queries.js        # CRUD 操作
│   ├── fingerprint/          # 指纹验证器（跨平台异常保护）
│   │   └── index.js
│   ├── proxy/                # 解析、GeoIP 检查（ipify）、移动代理轮换逻辑
│   │   └── index.js
│   ├── cookie/               # 会话注入和导出（JSON / Netscape TXT）
│   │   ├── index.js
│   │   └── inject.js         # 将 Cookie 注入隔离的配置文件目录
│   ├── typing/               # 类人输入模拟
│   │   └── index.js
│   ├── multi-control/        # 窗口同步器（通过 CDP 广播鼠标/键盘）
│   │   └── index.js
│   ├── crypto/               # AES-256-GCM 加密（keytar/PBKDF2）
│   ├── logger/               # 高性能 Pino 日志器（core.log + profile_[ID].log）
│   │   └── index.js
│   └── utils/
├── gui/                      # 前端（Electron + Vue 3 应用）
│   ├── package.json          # GUI 依赖
│   ├── vite.config.js        # Vite 配置
│   ├── tailwind.config.js    # Tailwind CSS 配置
│   ├── postcss.config.js     # PostCSS 插件
│   └── src/
│       ├── main/             # Electron 主进程
│       │   ├── index.js      # 窗口创建、IPC 处理、生命周期
│       │   ├── tray.js       # 系统托盘（上下文菜单）
│       │   ├── core-manager.js # Core 引擎 fork、动态端口分配
│       │   └── updater.js    # 通过 electron-updater 自动更新
│       ├── preload/          # 隔离的 IPC 上下文桥
│       │   └── index.js      # 暴露 electronAPI（getPort、getToken、quitApp、事件）
│       ├── shared/
│       │   └── errors.js     # 共享错误码
│       └── renderer/         # Vue 3 应用
│           ├── main.js       # Vue 入口文件
│           ├── App.vue       # 根组件
│           ├── router.js     # 路由（Hash Router）
│           ├── style.css     # 全局样式 + Tailwind
│           ├── i18n/         # 国际化
│           │   ├── index.js  # i18next 初始化
│           │   ├── en.json   # English
│           │   ├── ru.json   # Русский
│           │   └── zh.json   # 简体中文
│           ├── stores/       # Pinia 状态管理
│           │   ├── app.js    # 应用全局状态
│           │   ├── profiles.js # 配置文件状态
│           │   ├── proxies.js  # 代理状态
│           │   └── browser.js  # 浏览器状态
│           ├── views/        # 页面
│           │   ├── Profiles.vue
│           │   ├── Proxies.vue
│           │   ├── WindowArranger.vue
│           │   ├── Extensions.vue
│           │   ├── Settings.vue
│           │   ├── ProfileModal.vue
│           │   └── CookieImportModal.vue
│           ├── components/   # 可复用组件
│           │   ├── Layout.vue
│           │   ├── StatusBar.vue
│           │   ├── LogPanel.vue
│           │   ├── AccountsTab.vue
│           │   └── WalletsTab.vue
│           ├── composables/  # Vue Composables
│           └── api/          # Core 请求的 HTTP 客户端
└── tests/                    # Vitest（551 测试）
    ├── unit/                 # 24 个文件：auth、proxy、fingerprint、typing、crypto、tasks 等
    └── integration/          # 5 个文件：SQLite WAL、API、生命周期、代理、扩展
```

---

## 快速开始（开发）

```bash
# 安装后端和前端依赖
npm install

# 以开发模式运行完整应用（Electron GUI + Core 后台自动启动）
npm run dev

# 运行完整测试套件
npm test
```

### 手动 Core 启动参数（无 GUI）

```bash
npm start -- --api-token=YOUR_SECRET_TOKEN --port=3005
```

### 脚本说明

| 脚本 | 描述 |
|------|------|
| `npm run dev` | 启动后端并自动重启（`node --watch`） |
| `npm start` | 生产模式启动 Core 引擎 |
| `npm test` | 运行所有 Vitest 测试 |
| `npm run test:api` | 运行集成 API 测试 |
| `npm run test:all` | Vitest + API 测试 |
| `npm run lint` | ESLint 检查 `src/` |
| `npm run typecheck` | TypeScript 检查（不编译） |

---

## AI 代理集成（API 指南）

所有对本地服务器的请求必须包含授权头 `Authorization: Bearer <TOKEN>`。令牌在 Electron 启动时自动生成，可在 GUI 状态栏中复制。

### 1. 为 AI 启动浏览器配置文件

**请求：**
```
POST http://127.0.0.1:{PORT}/api/browser/{profile_id}/start
```

**引擎响应：**
成功验证代理和生成指纹后，Core 引擎启动 CloakBrowser 并返回 WebSocket 端点供 AI 代理自动化：
```json
{
  "status": "success",
  "profile_id": "8f3b201a-cb41-4c12-8671-50e50f3b4d11",
  "pid": 14208,
  "ws_endpoint": "ws://127.0.0.1:3000/devtools/browser/8f3b201a-cb41-4c12-8671-50e50f3b4d11"
}
```

### 2. AI 代理连接示例（Python / Playwright）

AI 代理读取 `ws_endpoint` 并立即接管会话控制：

```python
import asyncio
from playwright.async_api import async_playwright

async def run_ai_agent():
    ws_endpoint = "ws://127.0.0.1:3000/devtools/browser/8f3b201a-cb41-4c12-8671-50e50f3b4d11"

    async with async_playwright() as p:
        browser = await p.chromium.connect_over_cdp(ws_endpoint)
        context = browser.contexts[0]
        page = context.pages[0] if context.pages else await context.new_page()

        await page.goto("https://realsite.com")
        print(await page.title())

        await browser.close()

asyncio.run(run_ai_agent())
```

### 3. 类人输入方法（Human-like Typing API）

为绕过机器人检测（Cloudflare/Google），AI 代理通过特殊的 Core 引擎端点发送文本，模拟拼写错误和延迟：

```
POST http://127.0.0.1:{PORT}/api/multi-control/keyboard/type
```
```json
{
  "text": "MySecretPassword123"
}
```

### 4. 完整自动化周期（示例）

```python
import requests
import asyncio
from playwright.async_api import async_playwright

BASE = "http://127.0.0.1:3000"
TOKEN = "your-api-token"
HEADERS = {"Authorization": f"Bearer {TOKEN}"}

# 1. 创建配置文件
profile = requests.post(f"{BASE}/api/profiles", headers=HEADERS, json={
    "name": "AI Worker #1",
    "platform": "windows"
}).json()

# 2. 启动浏览器
start = requests.post(f"{BASE}/api/browser/{profile['id']}/start", headers=HEADERS).json()
ws = start["ws_endpoint"]

# 3. 通过 Playwright 连接并工作
async def work():
    async with async_playwright() as p:
        browser = await p.chromium.connect_over_cdp(ws)
        page = browser.contexts[0].pages[0]
        await page.goto("https://example.com")
        # ... 自动化操作
        await browser.close()

asyncio.run(work())

# 4. 停止
requests.post(f"{BASE}/api/browser/{profile['id']}/stop", headers=HEADERS)
```

---

## 数据存储目录（数据完整性）

所有隔离的用户数据存储在以下路径：

| 平台 | 路径 |
|------|------|
| Windows | `%APPDATA%/CloakManager/` |
| macOS | `~/Library/Application Support/CloakManager/` |
| Linux | `~/.config/CloakManager/` |

### 系统目录结构：

- `app.db` — WAL 模式的 SQLite 数据库。配置文件（30 列，AES-256-GCM）、代理、Cookie、任务（tasks/task_executions）、system_config。
- `profiles_data/` — 隔离的 Chromium 会话文件夹（每个账户的 `BrowserData/`：Cookies、LocalStorage、Cache）。
- `extensions/` — 已安装的 Chrome 扩展。
- `logs/core.log` — 通用系统日志（Pino JSON）。
- `logs/profile_[ID].log` — 各自动化会话的独立遥测日志。

---

## 测试

项目包含 27 个测试文件（524 测试）基于 **Vitest**：

| 测试 | 类型 | 描述 |
|------|------|------|
| `auth.test.js` | 单元 | Bearer Token 认证中间件 |
| `cookie.test.js` | 单元 | JSON/Netscape Cookie 解析 |
| `fingerprint.test.js` | 单元 | 指纹生成正确性 |
| `fingerprint-edge.test.js` | 单元 | 边界情况（跨平台异常） |
| `proxy.test.js` | 单元 | 代理字符串解析 |
| `proxy-checker.test.js` | 单元 | 通过 ipify 检查代理 |
| `typing.test.js` | 单元 | 类人输入模拟 |
| `multi-control.test.js` | 单元 | Multi-control 逻辑 |
| `multi-control-api.test.js` | 单元 | Multi-control API 路由 |
| `window-arranger.test.js` | 单元 | 窗口排列逻辑 |
| `window-filter.test.js` | 单元 | 窗口过滤工具 |
| `extensions.test.js` | 单元 | 扩展管理器测试 |
| `core-manager.test.js` | 单元 | 核心管理器生命周期 |
| `browser-shutdown.test.js` | 单元 | 浏览器关闭逻辑 |
| `app-store.test.js` | 单元 | 应用商店测试 |
| `api-client.test.js` | 单元 | API 客户端测试 |
| `race-condition.test.js` | 单元 | 竞态条件场景 |
| `database.test.js` | 集成 | SQLite CRUD 操作 |
| `wal-stress.test.js` | 集成 | WAL 模式压力测试 |
| `api-real.test.js` | 集成 | 完整 REST API 周期 |
| `profile-launch.test.js` | 集成 | CloakBrowser 启动和 PID 捕获 |
| `crypto.test.js` | 单元 | AES-256-GCM 加密/解密，keytar，PBKDF2，恢复密钥 |
| `internal-profiles.test.js` | 单元 | Internal API 配置文件范围端点 |
| `tasks.test.js` | 单元 | 任务 CRUD 和执行 API |

```bash
# 运行所有测试
npm test

# 详细输出
npx vitest run --reporter=verbose
```

---

## 许可证

ISC
