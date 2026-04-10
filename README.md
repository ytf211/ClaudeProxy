# ClaudeProxy

> Anthropic / OpenAI 统一 API 代理，运行在 Replit 上，使用 Replit AI Credits，无需自备 API Key。
> 支持 Claude Code、Cursor、Open WebUI 等所有兼容客户端。

[![Deploy on Replit](https://replit.com/badge/github/ytf211/ClaudeProxy)](https://replit.com/new/github/ytf211/ClaudeProxy)

---

## 功能

| 端点 | 说明 |
|---|---|
| `GET  /api/healthz` | 健康检查（无需认证） |
| `GET  /v1/models` | 可用模型列表 |
| `POST /v1/messages` | Anthropic 原生 Messages API |
| `POST /v1/chat/completions` | OpenAI 兼容 Chat Completions |
| `POST /v1/responses` | OpenAI Responses API |

**支持特性**：流式 / 非流式、Tool Calling、Thinking Blocks、Prompt Caching、System Prompt、多模态

---

## 可用模型

| 提供商 | 模型 ID |
|---|---|
| Anthropic | `claude-opus-4-6` `claude-opus-4-5` `claude-opus-4-1` `claude-sonnet-4-6` `claude-sonnet-4-5` `claude-haiku-4-5` |
| OpenAI | `gpt-4.1` `gpt-4.1-mini` `gpt-4.1-nano` `gpt-4o` `gpt-4o-mini` `o4-mini` `o3` `o3-mini` |

---

## 一键部署到 Replit

### 步骤 1 — 导入项目

点击上方 **Deploy on Replit** 按钮，或在 Replit 中选择 **Import from GitHub** 并填入：

```
https://github.com/ytf211/ClaudeProxy
```

### 步骤 2 — 连接 AI 集成（自动获取 API Key）

在 Replit 项目左侧工具栏找到 **Integrations**，依次连接：

- **Anthropic** — 连接后自动注入 `AI_INTEGRATIONS_ANTHROPIC_API_KEY`
- **OpenAI** — 连接后自动注入 `AI_INTEGRATIONS_OPENAI_API_KEY`

> 这两个 Key 由 Replit AI Credits 管理，不需要你提供。

### 步骤 3 — 设置访问密钥（唯一需要手动创建的 Secret）

在 Replit 项目 **Secrets** 页面（🔒）添加：

| Secret 名称 | 说明 |
|---|---|
| `PROXY_API_KEY` | 自定义访问密钥，任意字符串，例如 `my-secret-key` |

### 步骤 4 — 启动服务

Replit 会自动识别 workflows，点击 **Run** 或手动启动：

- `artifacts/api-server: API Server`
- `artifacts/api-portal: web`

### 步骤 5 — 验证部署

```bash
# 健康检查（无需 Key）
curl https://<你的域名>.replit.app/api/healthz
# 期望返回: {"status":"ok","startedAt":...}

# 发送消息测试
curl -X POST https://<你的域名>.replit.app/v1/messages \
  -H "x-api-key: <你的 PROXY_API_KEY>" \
  -H "Content-Type: application/json" \
  -d '{"model":"claude-haiku-4-5","max_tokens":64,"messages":[{"role":"user","content":"Hi"}]}'
```

### 步骤 6 — 发布

点击 Replit 右上角 **Publish** → **Deploy** 即可获得永久域名。

---

## 认证方式

```
# Anthropic 风格（Claude Code 等）
x-api-key: <PROXY_API_KEY>

# OpenAI 风格（Cursor、Open WebUI 等）
Authorization: Bearer <PROXY_API_KEY>
```

使用 `x-api-key` 时，`/v1/models` 只返回 Claude 模型；使用 `Bearer` 时返回全部模型。

---

## 客户端接入

### Claude Code

```bash
export ANTHROPIC_API_KEY=<你的 PROXY_API_KEY>
export ANTHROPIC_BASE_URL=https://<你的域名>.replit.app
unset ANTHROPIC_AUTH_TOKEN
claude
```

### Cursor / Open WebUI / 其他 OpenAI 兼容客户端

```
Base URL : https://<你的域名>.replit.app/v1
API Key  : <你的 PROXY_API_KEY>
Model    : claude-sonnet-4-6
```

---

## 技术栈

- **Monorepo**: pnpm workspaces (Node.js 24)
- **后端**: Express 5 + TypeScript 5 + esbuild
- **前端**: React 18 + Vite 6（状态页）
- **AI SDK**: `@anthropic-ai/sdk` + `openai`
- **日志**: pino

---

## 常见问题

| 现象 | 原因 | 解决 |
|---|---|---|
| 状态页显示红色 | api-server 未运行 | 重启 `API Server` workflow |
| 401 Unauthorized | PROXY_API_KEY 不匹配 | 确认 Secret 值与请求中的 key 一致 |
| 流式响应中断 | 代理超时 | 已内置 `keepAliveTimeout=65s`，通常无需处理 |
| 模型 not found | 模型名拼写错误 | 参考上方模型列表 |
| 前端空白 | 端口配置 | 确认 vite.config.ts 读取了 `process.env.PORT` |

---

## License

MIT
