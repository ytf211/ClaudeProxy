# ClaudeProxy — Replit 部署文档

版本 2.0 · pnpm 单体仓库 · Node.js 24 · TypeScript 5

---

## 架构概览

```
pnpm 单体仓库
├── artifacts/api-server/     → Express 5 后端 (kind=api)
│   ├── paths: ["/api", "/v1"]
│   └── port: 8080
└── artifacts/api-portal/     → React + Vite 前端 (kind=web)
    ├── paths: ["/"]
    └── port: 24927
```

**路由规则**：Replit 代理按路径前缀分发，`/api/*` 和 `/v1/*` → api-server，其余 → api-portal（静态）。

---

## 必要 Secrets

| 变量 | 来源 | 说明 |
|---|---|---|
| `PROXY_API_KEY` | 用户手动创建 | 客户端访问密钥，任意字符串 |
| `AI_INTEGRATIONS_ANTHROPIC_API_KEY` | Replit AI 集成自动注入 | Anthropic API Key（由 AI Credits 管理） |
| `AI_INTEGRATIONS_OPENAI_API_KEY` | Replit AI 集成自动注入 | OpenAI API Key（由 AI Credits 管理） |

## 自动填写的环境变量（已在 .replit 中预设）

| 变量 | 默认值 |
|---|---|
| `DEBUG_LOG` | `false` |

---

## 从 GitHub 全新部署步骤

1. **导入仓库**：在 Replit 选择 Import from GitHub → `https://github.com/ytf211/ClaudeProxy`
2. **连接 AI 集成**：左侧 Integrations → 添加 Anthropic + OpenAI（自动生成 API Key）
3. **创建 PROXY_API_KEY**：Secrets → 新建，名称 `PROXY_API_KEY`，值自定义
4. **启动 Workflows**（Replit 通常自动识别）：
   - `artifacts/api-server: API Server` → `pnpm --filter @workspace/api-server run dev`
   - `artifacts/api-portal: web` → `pnpm --filter @workspace/api-portal run dev`
5. **验证**：`curl https://<domain>.replit.app/api/healthz` 返回 `{"status":"ok",...}`
6. **部署**：点击 Publish → Deploy

完整检测脚本：
```bash
PROXY_API_KEY=<你的密钥> bash scripts/check-deploy.sh https://<domain>.replit.app
```

---

## API 端点

| 方法 | 路径 | 认证 | 说明 |
|---|---|---|---|
| GET | `/api/healthz` | 无 | 健康检查，返回 `{status, startedAt}` |
| GET | `/v1/models` | 需要 | 模型列表（x-api-key → 仅 Claude；Bearer → 全部） |
| POST | `/v1/messages` | 需要 | Anthropic 原生格式（流式/非流式） |
| POST | `/v1/chat/completions` | 需要 | OpenAI 兼容格式（流式/非流式） |
| POST | `/v1/responses` | 需要 | OpenAI Responses API |

### 认证方式

```
x-api-key: <PROXY_API_KEY>           # Anthropic 风格
Authorization: Bearer <PROXY_API_KEY> # OpenAI 风格
```

---

## 可用模型

**Claude (Anthropic)**：`claude-opus-4-6` · `claude-opus-4-5` · `claude-opus-4-1` · `claude-sonnet-4-6` · `claude-sonnet-4-5` · `claude-haiku-4-5`

**OpenAI**：`gpt-4.1` · `gpt-4.1-mini` · `gpt-4.1-nano` · `gpt-4o` · `gpt-4o-mini` · `o4-mini` · `o3` · `o3-mini`

模型路由：`claude-*` → Anthropic SDK；`gpt-*` / `o\d*` → OpenAI SDK。

---

## 支持的高级特性

- **Thinking Blocks**：`thinking: {type:"adaptive"}` 或 `{type:"enabled",budget_tokens:N}`；自动注入 `interleaved-thinking-2025-05-14` beta header
- **Prompt Caching**：`cache_control: {type:"ephemeral"}` 在所有端点透传
- **Streaming**：三个端点均支持 `stream: true`
- **Tool Calling**：Anthropic 和 OpenAI 格式均支持，Claude 端自动转换
- **Sampling 参数**：`temperature` `top_p` `top_k` `stop_sequences` 等完整透传

---

## 目录结构（关键文件）

```
artifacts/
  api-server/src/
    app.ts             ← Express 主文件（CORS + 路由挂载）
    index.ts           ← HTTP 服务器（keepAliveTimeout=65s，禁用请求超时）
    routes/
      health.ts        ← GET /api/healthz（返回 status + startedAt）
      proxy.ts         ← 全部代理逻辑（核心，~650行）
    lib/
      logger.ts        ← pino logger + debugLog（受 DEBUG_LOG 控制）
  api-portal/src/
    App.tsx            ← 状态页 UI（内联样式，暗色主题）

scripts/
  check-deploy.sh      ← 部署健康检测脚本
  post-merge.sh        ← pnpm install（task merge 后自动运行）
```

---

## 开发命令

```bash
# 启动后端
pnpm --filter @workspace/api-server run dev

# 启动前端
pnpm --filter @workspace/api-portal run dev

# 构建后端
pnpm --filter @workspace/api-server run build

# 全量类型检查
pnpm run typecheck

# 部署检测
PROXY_API_KEY=<key> bash scripts/check-deploy.sh http://localhost:8080
```

---

## 关键实现细节（给 Agent）

### artifact.toml 路径冲突
- api-server: `paths = ["/api", "/v1"]` — 不能含 `/`，否则与 api-portal 冲突
- api-portal: `paths = ["/"]`，`kind = "web"`（静态免费部署）

### 流式响应超时
```ts
server.setTimeout(0);            // 禁用请求超时
server.keepAliveTimeout = 65000; // 长于 Replit 代理 60s 的 keepalive
```

### 前端 uptime 计算
`GET /api/healthz` 返回后端启动时的 Unix 时间戳 `startedAt`，前端每秒计算 `Date.now()/1000 - startedAt`，不受页面刷新影响。

### OpenAI 模型直传
`/v1/messages` 收到 OpenAI 模型时，自动转为 `chat/completions` 并将响应包装成 Anthropic 格式返回，保持接口一致。

### 调试日志
`DEBUG_LOG=true` 或 `DEBUG_LOG=1` 开启详细日志（记录请求头、格式信息，**不记录消息文本**）。生产环境不应开启。

---

## 常见问题

| 现象 | 原因 | 解决 |
|---|---|---|
| 状态页红色 | api-server 未运行 | 重启 `API Server` workflow |
| 401 Unauthorized | Key 不匹配 | 检查 PROXY_API_KEY 与请求中的 key |
| 流式中断 | 超时设置 | 检查 `setTimeout(0)` 和 `keepAliveTimeout` |
| 模型 not found | 拼写错误 | 参考上方模型列表 |
| 前端空白 | PORT 未读取 | 确认 vite.config.ts 用了 `process.env.PORT` |
| AI 调用 401/403 | AI 集成未连接 | 在 Integrations 连接 Anthropic / OpenAI |
