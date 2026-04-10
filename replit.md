# ClaudeProxy on Replit

## 项目目标

在 Replit 上部署一个 Anthropic/OpenAI 统一 API 代理服务，同时提供一个 React 状态页面。
参考项目：https://github.com/ytf211/ClaudeProxy

---

## 架构概览

```
pnpm 单体仓库
├── artifacts/api-portal/     → React 前端 (kind=web, 路径: /)，可免费静态部署
└── artifacts/api-server/     → Express 后端 (kind=api，路径: /api, /v1)
```

- **前端**（api-portal）：纯 React + Vite 静态页面，黑色主题，展示服务状态、端点列表、模型列表、快速接入指南。
- **后端**（api-server）：Express 5 代理服务器，不对外提供任何 HTML，只处理 `/api/*` 和 `/v1/*`。
- **部署时**：前端静态构建后托管在 `/`，后端作为 API 服务运行。客户端发起的 `/api/healthz` 等请求由 Replit 路由代理到 api-server。

---

## 必需的 Secrets（在 Replit Secrets 中设置）

| Secret 名称 | 说明 |
|---|---|
| `PROXY_API_KEY` | 客户端访问密钥，任意字符串，自定义 |
| `AI_INTEGRATIONS_ANTHROPIC_API_KEY` | Anthropic 官方 API Key |
| `AI_INTEGRATIONS_OPENAI_API_KEY` | OpenAI 官方 API Key |

## 必需的环境变量（非敏感，可直接硬编码或设为 Env Var）

| 变量名 | 默认值 |
|---|---|
| `AI_INTEGRATIONS_ANTHROPIC_BASE_URL` | `https://api.anthropic.com` |
| `AI_INTEGRATIONS_OPENAI_BASE_URL` | `https://api.openai.com/v1` |

> 如果需要接入第三方中转站，把 BASE_URL 改成对应地址即可。

---

## API 端点完整文档

### `GET /api/healthz` — 健康检查（无需认证）
```json
{ "status": "ok", "timestamp": "..." }
```

### `GET /v1/models` — 模型列表（需认证）
返回 OpenAI list 格式，包含全部 Claude + OpenAI 模型。

### `POST /v1/messages` — Anthropic 原生格式（需认证）
透传 Anthropic Messages API，支持流式/非流式、工具调用、thinking blocks。
自动清理会触发上游错误的字段（`output_config`, `stream_options`, `reasoning_effort`, cache_control scope）。

### `POST /v1/chat/completions` — OpenAI 兼容格式（需认证）
支持所有 Claude 模型（自动转换消息格式/工具格式）和所有 OpenAI 模型（直传）。
支持流式/非流式、tool calling。

### 认证方式（所有 `/v1/*` 端点）
```
Authorization: Bearer <PROXY_API_KEY>
# 或
x-api-key: <PROXY_API_KEY>
```

---

## 可用模型列表

**Claude (Anthropic)**
- `claude-opus-4-6`
- `claude-sonnet-4-6`
- `claude-haiku-4-5`

**OpenAI**
- `gpt-5.2`, `gpt-5-mini`, `gpt-5-nano`
- `o4-mini`, `o3`

> 如需增减模型，编辑 `artifacts/api-server/src/routes/proxy.ts` 中的 `OPENAI_MODELS` / `ANTHROPIC_MODELS` 数组。

---

## 技术栈

- **Monorepo**: pnpm workspaces
- **Node.js**: 24
- **TypeScript**: 5.9
- **API 框架**: Express 5
- **前端**: React 18 + Vite 6 + Tailwind v4
- **AI SDK**: `@anthropic-ai/sdk`, `openai`
- **日志**: pino + pino-http
- **构建**: esbuild

---

## 目录结构（关键文件）

```
artifacts/
  api-server/
    src/
      app.ts                  ← Express 主文件（CORS + 路由挂载）
      index.ts                ← HTTP 服务器（keepAliveTimeout=65000，禁用超时）
      routes/
        index.ts              ← /api 路由入口（健康检查）
        health.ts             ← GET /api/healthz
        proxy.ts              ← 全部代理逻辑（核心文件）
      lib/
        logger.ts             ← pino logger + debugLog export
    .replit-artifact/
      artifact.toml           ← paths: ["/api", "/v1"]

  api-portal/
    src/
      App.tsx                 ← 全部 UI（内联样式，暗色主题）
      index.css               ← Tailwind v4 主题（但 App 用内联样式，影响不大）
      main.tsx                ← React 入口
    vite.config.ts            ← base: "/", server: { port: process.env.PORT }
    .replit-artifact/
      artifact.toml           ← kind=web, paths: ["/"]
```

---

## 关键实现细节（给未来的 Agent）

### 1. api-server artifact.toml
```toml
paths = ["/api", "/v1"]
```
不能包含 "/"，否则会和 api-portal 冲突。

### 2. api-portal artifact.toml
```toml
kind = "web"
paths = ["/"]
```
`kind=web` 才可以免费静态部署；`kind=api` 无法免费部署。

### 3. index.ts 超时配置
```ts
server.setTimeout(0);           // 禁用请求超时（流式响应需要）
server.keepAliveTimeout = 65000; // 长于 Replit 代理 60s
```

### 4. 前端健康检查
`App.tsx` 在加载时发起 `fetch("/api/healthz")`，路径 `/api/healthz` 由 Replit 路由代理到 api-server。

### 5. 模型路由逻辑
- `claude-*` → Anthropic SDK
- `gpt-*` 或 `o\d*` → OpenAI SDK
- `/v1/messages` 中如果 model 是 OpenAI → 转换为 chat/completions 并包装成 Anthropic 响应格式

---

## 本地开发命令

```bash
# 启动 API Server（开发模式）
pnpm --filter @workspace/api-server run dev

# 启动前端（开发模式）
pnpm --filter @workspace/api-portal run dev

# 构建 API Server
pnpm --filter @workspace/api-server run build

# 全量类型检查
pnpm run typecheck
```

---

## 客户端接入指南

### Claude Code
```bash
export ANTHROPIC_API_KEY=<你的 PROXY_API_KEY>
export ANTHROPIC_BASE_URL=https://<你的域名>.replit.app
unset ANTHROPIC_AUTH_TOKEN
claude
```

### Cursor / rikkahub / 其他 OpenAI 兼容客户端
```
Base URL : https://<你的域名>.replit.app/v1
API Key  : <你的 PROXY_API_KEY>
Model    : claude-sonnet-4-6
```

### cURL 测试
```bash
# 健康检查
curl https://<你的域名>.replit.app/api/healthz

# Anthropic 格式
curl -X POST https://<你的域名>.replit.app/v1/messages \
  -H "x-api-key: <你的 PROXY_API_KEY>" \
  -H "Content-Type: application/json" \
  -d '{"model":"claude-sonnet-4-6","max_tokens":256,"messages":[{"role":"user","content":"你好"}]}'

# OpenAI 格式
curl -X POST https://<你的域名>.replit.app/v1/chat/completions \
  -H "Authorization: Bearer <你的 PROXY_API_KEY>" \
  -H "Content-Type: application/json" \
  -d '{"model":"claude-sonnet-4-6","messages":[{"role":"user","content":"你好"}]}'
```

---

## 从 GitHub 全新部署步骤（给 Agent 读取）

1. **导入仓库** → Replit 自动识别 `.replit` / `pnpm-workspace.yaml`，创建项目
2. **设置 Secrets**（必须在部署前完成）：
   - `PROXY_API_KEY` = 任意自定义密钥
   - `AI_INTEGRATIONS_ANTHROPIC_API_KEY` = Anthropic API Key
   - `AI_INTEGRATIONS_OPENAI_API_KEY` = OpenAI API Key
3. **设置环境变量**（可选，有默认值）：
   - `AI_INTEGRATIONS_ANTHROPIC_BASE_URL` = `https://api.anthropic.com`
   - `AI_INTEGRATIONS_OPENAI_BASE_URL` = `https://api.openai.com/v1`
4. **启动 Workflows**：
   - `pnpm --filter @workspace/api-server run dev`（api-server）
   - `pnpm --filter @workspace/api-portal run dev`（api-portal）
5. **点击 Publish 部署**：api-portal (kind=web) 免费静态托管；api-server (kind=api) 作为后端服务
6. 部署完成后，把域名填入客户端配置即可使用

---

## 常见问题排查

| 问题 | 原因 | 解决 |
|---|---|---|
| 前端健康状态显示红色 | api-server 未运行 | 重启 api-server workflow |
| 401 Unauthorized | PROXY_API_KEY 不匹配 | 检查 Secret 值与客户端 key 是否一致 |
| 流式响应中断 | 超时设置不当 | 检查 index.ts 的 setTimeout(0) 和 keepAliveTimeout |
| 模型 not found | 模型名拼写错误 | 参考上方模型列表 |
| 前端空白 | PORT 未读取 | 确认 vite.config.ts 用了 process.env.PORT |
