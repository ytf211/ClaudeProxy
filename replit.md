# ClaudeProxy — Replit 部署文档

> **Replit Agent 必读**：本文件是首要参考文档。全新部署时请严格按照下方「部署顺序」逐步执行，不得跳步。

---

## 部署顺序（全新导入时按此顺序执行）

### 第一步：创建必要变量（最先做，其他步骤依赖它）

在 Replit **Secrets** 页面（左侧 🔒 图标）创建以下两个变量：

| 变量名 | 说明 | 示例值 |
|---|---|---|
| `PROXY_API_KEY` | 客户端访问密钥，任意字符串，自定义 | `my-secret-key-123` |
| `DEBUG_LOG` | 调试日志开关 | `false`（生产环境保持 false） |

> 在左侧 **Integrations** 连接 **Anthropic**、**OpenAI**、**Gemini**，Replit 会自动注入 API Key。
> **重要**：不要在 `.replit` 文件的 `[userenv]` 里填写 token 或密钥——该文件不应包含任何敏感信息。

---

### 第二步：拉取项目依赖

打开 Shell，执行：

```bash
pnpm install --frozen-lockfile
```

> 项目使用 Node.js 24 + pnpm（已在 `.replit` 中声明），Replit 会自动准备环境。

---

### 第三步：搭建并测试后端

**启动后端 workflow**（`artifacts/api-server: API Server`）：

```bash
pnpm --filter @workspace/api-server run dev
```

**等待后端就绪后，测试健康端点**：

```bash
curl http://localhost:8080/api/healthz
# 期望返回: {"status":"ok","startedAt":...,"providers":{"anthropic":{"available":true},...}}
```

**测试 API 调用**（需要 PROXY_API_KEY）：

```bash
# Anthropic
curl -X POST http://localhost:8080/v1/messages \
  -H "x-api-key: $PROXY_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"model":"claude-haiku-4-5","max_tokens":32,"messages":[{"role":"user","content":"Hi"}]}'

# Gemini
curl -X POST http://localhost:8080/v1/chat/completions \
  -H "Authorization: Bearer $PROXY_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"model":"gemini-2.5-flash","max_tokens":100,"messages":[{"role":"user","content":"Hi"}]}'
```

后端测试通过后再进行下一步。

---

### 第四步：搭建前端

**启动前端 workflow**（`artifacts/api-portal: web`）：

```bash
pnpm --filter @workspace/api-portal run dev
```

前端启动后访问根路径 `/`，状态页应显示绿色「运行正常」以及 Anthropic / OpenAI / Gemini 三个 provider 的可用状态。

---

### 第五步：完整验证

运行检测脚本：

```bash
PROXY_API_KEY=$PROXY_API_KEY bash scripts/check-deploy.sh http://localhost:8080
```

全部通过后点击 Replit 右上角 **Publish → Deploy** 发布。

---

## 架构概览

```
pnpm 单体仓库
├── artifacts/api-server/     → Express 5 后端 (kind=api)
│   ├── 路由路径: /api, /v1, /v1beta
│   └── 端口: 8080
└── artifacts/api-portal/     → React + Vite 前端 (kind=web)
    ├── 路由路径: /
    └── 端口: 24927
```

Replit 代理按路径前缀分发请求：`/api/*`、`/v1/*`、`/v1beta/*` → api-server，其余 → api-portal。

---

## 变量说明

### 必须手动创建（Secrets）

| 变量 | 说明 |
|---|---|
| `PROXY_API_KEY` | 客户端请求时携带的访问密钥 |
| `DEBUG_LOG` | `true`/`false`，开启后输出请求元数据日志（不含消息内容） |

### 由 Replit AI 集成自动注入

| 变量 | 说明 |
|---|---|
| `AI_INTEGRATIONS_ANTHROPIC_API_KEY` | Anthropic API Key，由 Replit AI Credits 管理 |
| `AI_INTEGRATIONS_ANTHROPIC_BASE_URL` | Anthropic 代理端点 |
| `AI_INTEGRATIONS_OPENAI_API_KEY` | OpenAI API Key，由 Replit AI Credits 管理 |
| `AI_INTEGRATIONS_OPENAI_BASE_URL` | OpenAI 代理端点 |
| `AI_INTEGRATIONS_GEMINI_API_KEY` | Gemini API Key（dummy 值，由代理管理） |
| `AI_INTEGRATIONS_GEMINI_BASE_URL` | Gemini 代理端点 |

---

## API 端点

| 方法 | 路径 | 认证 | 说明 |
|---|---|---|---|
| GET | `/api/healthz` | 无 | 健康检查，返回 `{status, startedAt, providers}` |
| GET | `/v1/models` | 需要 | 模型列表（x-api-key → 仅 Claude；Bearer → 全部） |
| POST | `/v1/messages` | 需要 | Anthropic 原生格式（流式/非流式） |
| POST | `/v1/chat/completions` | 需要 | OpenAI / Gemini 兼容格式（流式/非流式） |
| POST | `/v1/responses` | 需要 | OpenAI Responses API |
| POST | `/v1beta/models/{model}:generateContent` | 需要 | Gemini 原生 REST 透传 |
| POST | `/v1beta/models/{model}:streamGenerateContent` | 需要 | Gemini 原生流式透传 |

### 认证方式

```
x-api-key: <PROXY_API_KEY>            # Anthropic 风格（Claude Code 等）
Authorization: Bearer <PROXY_API_KEY>  # OpenAI / Gemini 风格（Cursor 等）
x-goog-api-key: <PROXY_API_KEY>       # Gemini 原生 SDK（/v1beta 端点）
```

---

## 可用模型（已验证全部通过基本/流式/工具调用测试）

**Anthropic**：`claude-opus-4-6` · `claude-opus-4-5` · `claude-opus-4-1` · `claude-sonnet-4-6` · `claude-sonnet-4-5` · `claude-haiku-4-5`

**OpenAI**：`gpt-4.1` · `gpt-4.1-mini` · `gpt-4.1-nano` · `gpt-4o` · `gpt-4o-mini` · `o4-mini` · `o3` · `o3-mini`

**Gemini**：`gemini-3.1-pro-preview` · `gemini-3-flash-preview` · `gemini-2.5-pro` · `gemini-2.5-flash`

路由规则：
- `claude-*` → Anthropic SDK（`/v1/messages`）
- `gpt-*` / `o\d*` → OpenAI SDK（`/v1/chat/completions`）
- `gemini-*` → Gemini REST 直连（`/v1/chat/completions`，格式自动转换）

> **注意**：`o4-mini` / `o3-mini` / `gemini-2.5-*` 为推理/思考模型，建议 `max_tokens` ≥ 300。

---

## 目录结构（关键文件）

```
artifacts/
  api-server/src/
    app.ts             ← Express 主文件（CORS + 路由挂载，含 /v1beta）
    index.ts           ← HTTP 服务器（keepAliveTimeout=65s，禁用请求超时，启动时跑 provider 健康检查）
    routes/
      health.ts        ← GET /api/healthz（返回 status + startedAt + providers）
      proxy.ts         ← 全部代理逻辑（Anthropic/OpenAI/Gemini 格式转换、工具调用）
      v1beta.ts        ← /v1beta/* Gemini 原生透传（fetch 直连后端）
    lib/
      logger.ts        ← pino logger（受 DEBUG_LOG 控制）
  api-portal/src/
    App.tsx            ← 状态页 UI（显示三个 provider 可用状态）

scripts/
  check-deploy.sh      ← 部署健康检测（见第五步）
  post-merge.sh        ← pnpm install（合并后自动运行）
```

---

## 高级特性

- **Thinking Blocks**：`thinking: {type:"adaptive"}` 或 `{type:"enabled", budget_tokens:N}`
- **Prompt Caching**：`cache_control: {type:"ephemeral"}` 在所有端点透传
- **流式响应**：所有端点均支持 `stream: true`
- **Tool Calling**：Anthropic、OpenAI、Gemini 三个 provider 均支持，格式自动转换
- **Provider 健康检查**：服务器启动时并发检测三个 provider，结果通过 `/api/healthz` 暴露

---

## 关键实现细节

### keepAliveTimeout
```ts
server.setTimeout(0);            // 禁用请求超时（流式响应必需）
server.keepAliveTimeout = 65000; // 必须长于 Replit 代理的 60s，防止 502
```

### Gemini 工具调用
Gemini SDK 通过 Replit 代理时不支持 function calling，改为直接 REST fetch：
- 非流式：`POST {GEMINI_BASE_URL}/models/{model}:generateContent`
- 流式：`POST {GEMINI_BASE_URL}/models/{model}:streamGenerateContent?alt=sse`
- OAI tools 格式自动转为 Gemini `functionDeclarations`，响应自动转回 OAI `tool_calls`

### Gemini SDK（/v1beta 端点）
必须设置 `apiVersion: ""` 否则 SDK 会在 URL 前加 `/v1beta/`：
```ts
new GoogleGenAI({ apiKey, httpOptions: { apiVersion: "", baseUrl: GEMINI_BASE_URL } })
```

### artifact.toml 路径
- api-server: `paths = ["/api", "/v1", "/v1beta"]`
- api-portal: `paths = ["/"]`，`kind = "web"`

### 前端 uptime
`/api/healthz` 返回 `startedAt`（服务器启动时的 Unix 秒），前端每秒计算差值，页面刷新不影响计时。

---

## 常见问题

| 现象 | 原因 | 解决 |
|---|---|---|
| 状态页红色 | api-server 未运行 | 重启 `API Server` workflow |
| Provider 显示「不可用」 | AI 集成未连接 | 在 Integrations 连接对应 provider |
| 401 Unauthorized | PROXY_API_KEY 不匹配 | 确认 Secret 值与请求中的 key 一致 |
| 流式响应中断 | 超时配置 | 确认 `keepAliveTimeout=65000` 和 `setTimeout(0)` |
| 模型 not found | 拼写错误 | 参考上方模型列表 |
| Gemini 内容为空 | 推理 token 耗尽 | 增大 `max_tokens`（建议 ≥ 300） |
| 前端空白 | PORT 未读取 | 确认 vite.config.ts 使用 `process.env.PORT` |
