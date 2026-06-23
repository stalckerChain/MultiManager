# MultiManager

用于 AI 代理的跨平台反检测浏览器 MVP，提供 REST API（AdsPower 替代方案）。

## 架构

- **核心引擎** — Node.js 后端，提供 REST API，作为后台服务运行
- **GUI** — Electron/Tauri 前端（开发中）

支持跨平台：Windows、macOS、Linux。

## 快速开始

```bash
# 安装依赖
npm install

# 开发模式
npm run dev

# 生产环境
npm start

# 指定 Token 启动
npm start -- --api-token=YOUR_SECRET_TOKEN
```

## 项目结构

```
MultiManager/
├── package.json              # 依赖和脚本
├── tsconfig.json             # TypeScript 配置
├── vitest.config.js          # 测试配置
├── src/
│   ├── index.js              # 入口文件
│   ├── core/
│   │   └── app.js            # Express 服务器及路由
│   ├── api/
│   │   ├── auth.js           # Bearer Token 认证
│   │   ├── profiles.js       # 配置文件 CRUD
│   │   ├── proxies.js        # 代理 CRUD + 检查
│   │   ├── cookies.js        # Cookie 导入/导出
│   │   ├── browser.js        # 浏览器管理
│   │   └── multi-control.js  # 窗口同步
│   ├── db/
│   │   ├── index.js          # SQLite 初始化
│   │   ├── schema.js         # 表和索引
│   │   └── queries.js        # CRUD 查询
│   ├── fingerprint/
│   │   └── index.js          # 指纹生成器
│   ├── proxy/
│   │   └── index.js          # 解析、检查、轮换
│   ├── cookie/
│   │   ├── index.js          # JSON/Netscape 解析
│   │   └── inject.js         # Cookie 注入
│   ├── typing/
│   │   └── index.js          # 类人输入
│   ├── multi-control/
│   │   └── index.js          # 窗口同步 (CDP)
│   ├── logger/
│   │   └── index.js          # Pino 日志
│   └── utils/
├── tests/
│   ├── unit/
│   └── integration/
└── docs/
    ├── API.md                # API 文档
    └── DATABASE.md           # 数据库架构
```

## 依赖

### 生产环境
- `better-sqlite3` — 原生 SQLite 驱动
- `express` — HTTP 服务器
- `pino` — 高性能日志
- `uuid` — UUID 生成
- `tree-kill` — 跨平台进程终止

### 开发环境
- `vitest` — 测试
- `eslint` — 代码检查
- `typescript` — 类型检查

## 配置

### 环境变量

| 变量 | 描述 | 默认值 |
|------|------|--------|
| `PORT` | API 服务器端口 | `3000` |
| `LOG_LEVEL` | 日志级别 | `info` |
| `NODE_ENV` | 运行模式 | `development` |

### 启动参数

| 参数 | 描述 |
|------|------|
| `--api-token=SECRET` | 授权令牌（未指定则自动生成） |

## 数据存储目录

| 平台 | 路径 |
|------|------|
| Windows | `%APPDATA%/CloakManager/` |
| macOS | `~/Library/Application Support/CloakManager/` |
| Linux | `~/.config/CloakManager/` |

内容：
- `app.db` — SQLite 数据库
- `logs/` — 配置文件日志
- `profiles/` — 浏览器数据

## 许可证

ISC
