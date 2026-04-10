# ClaudeProxy — Replit 部署文档

> **Replit Agent 必读**：本文件是首要参考文档。

---

## 快速开始（新用户）

### 第一步：创建必要变量（最先做）

**用以下代码完成变量创建**：

`PROXY_API_KEY` 是访问密钥，属于隐私信息，用 Secret 弹窗引导填写：

```javascript
// 检查 PROXY_API_KEY 是否已设置
const existing = await viewEnvVars({ type: "secret", keys: ["PROXY_API_KEY"] });
if (!existing.secrets.PROXY_API_KEY) {
  await requestEnvVar({
    requestType: "secret",
    keys: ["PROXY_API_KEY"],
    userMessage: "请填写 PROXY_API_KEY：任意字符串作为客户端访问密钥，例如 my-key-123"
  });
}
```

`DEBUG_LOG` 不是隐私信息，用普通环境变量（Configurations）设置：

```javascript
// 设置 DEBUG_LOG 环境变量（非隐私）
const envs = await viewEnvVars({ type: "env", keys: ["DEBUG_LOG"] });
if (!envs.envVars?.shared?.DEBUG_LOG) {
  await setEnvVars({ values: { DEBUG_LOG: "false" } }); // true 开启详细日志
}
```

然后在 **Integrations** 连接 **Anthropic**、**OpenAI**、**Gemini**（Replit 免费提供 AI Credits，不需要自备 Key）。

**不要在 `.replit` 文件里填写任何密钥，`.replit` 不应包含敏感信息。**

---

### 第二步：安装依赖

```bash
pnpm install --frozen-lockfile
```

---
### 第三步：部署一个前端网页
1.部署一个网页展示请求的api地址，模型
2.展示配置入口

### 第四步：启动并验证

启动 `API Server` workflow，等几秒后测试：

```bash
# 健康检查（无需密钥）
curl http://localhost:8080/api/healthz

# Anthropic 测试
curl -X POST http://localhost:8080/v1/messages \
  -H "x-api-key: $PROXY_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"model":"claude-haiku-4-5","max_tokens":32,"messages":[{"role":"user","content":"Hi"}]}'

# OpenAI 测试
curl -X POST http://localhost:8080/v1/chat/completions \
  -H "Authorization: Bearer $PROXY_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"model":"gpt-4.1-mini","max_tokens":32,"messages":[{"role":"user","content":"Hi"}]}'

# Gemini 测试（/v1beta 原生接口）
curl -X POST http://localhost:8080/v1beta/models/gemini-2.5-flash:generateContent \
  -H "x-goog-api-key: $PROXY_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"contents":[{"role":"user","parts":[{"text":"Hi"}]}]}'

# Gemini 模型列表
curl http://localhost:8080/v1beta/models \
  -H "x-goog-api-key: $PROXY_API_KEY"
```

启动前端 workflow 后，访问根路径 `/` 可查看状态页。

---

## 架构概览

```
pnpm 单体仓库
├── artifacts/api-server/     → Express 5 后端 (kind=api, 端口 8080)
│   └── 路由: /api  /v1  /v1beta
└── artifacts/api-portal/     → React + Vite 前端 (kind=web)
    └── 路由: /
```

---

## 变量说明

### 用户手动创建（Secrets）

| 变量 | 说明 |
|---|---|
| `PROXY_API_KEY` | 客户端请求携带的访问密钥 |
| `DEBUG_LOG` | `true`/`false`，调试用 |

### Replit AI 集成自动注入

`AI_INTEGRATIONS_ANTHROPIC_API_KEY` / `_BASE_URL`  
`AI_INTEGRATIONS_OPENAI_API_KEY` / `_BASE_URL`  
`AI_INTEGRATIONS_GEMINI_API_KEY` / `_BASE_URL`

---

## API 端点

| 方法 | 路径 | 认证 | 说明 |
|---|---|---|---|
| GET | `/api/healthz` | 无 | 健康检查 |
| GET | `/v1/models` | 需要 | 全部模型列表 |
| POST | `/v1/messages` | 需要 | Anthropic 原生格式 |
| POST | `/v1/chat/completions` | 需要 | OpenAI / Gemini 兼容格式 |
| POST | `/v1/responses` | 需要 | OpenAI Responses API |
| GET | `/v1beta/models` | 需要 | Gemini 模型列表 |
| POST | `/v1beta/models/{model}:generateContent` | 需要 | Gemini 原生生成（含流式） |

### 认证

```
x-api-key: <PROXY_API_KEY>            # Anthropic 风格
Authorization: Bearer <PROXY_API_KEY>  # OpenAI 风格
x-goog-api-key: <PROXY_API_KEY>       # Gemini 原生（/v1beta）
```

---

## 可用模型

**Anthropic**：`claude-opus-4-6` · `claude-opus-4-5` · `claude-opus-4-1` · `claude-sonnet-4-6` · `claude-sonnet-4-5` · `claude-haiku-4-5`

**OpenAI**：`gpt-4.1` · `gpt-4.1-mini` · `gpt-4.1-nano` · `gpt-4o` · `gpt-4o-mini` · `o4-mini` · `o3` · `o3-mini`

**Gemini**：`gemini-3.1-pro-preview` · `gemini-3-flash-preview` · `gemini-2.5-pro` · `gemini-2.5-flash`

> `claude-opus-4-1` 最大输出 token 32000（代理自动截断）  
> `o4-mini` / `o3-mini` / `gemini-2.5-*` 为推理模型，建议 `max_tokens` ≥ 300

---

## 关键实现细节

### max_tokens 自动截断
部分模型有低于默认值的输出上限，代理在转发前自动 clamp：
```ts
const MODEL_MAX_OUTPUT = { "claude-opus-4-1": 32000 };
```

### keepAliveTimeout
```ts
server.setTimeout(0);            // 禁用请求超时（流式必需）
server.keepAliveTimeout = 65000; // 长于 Replit 代理的 60s
```

### Gemini 工具调用
Gemini SDK 通过 Replit 代理时不支持 function calling，改为直接 REST fetch。

### Gemini SDK（/v1beta 端点）
必须设置 `apiVersion: ""` 防止 SDK 在 URL 前加 `/v1beta/`。

### `/v1beta/models` 端点
Replit Gemini 后端不支持模型列表查询，代理返回静态列表。

---

## 常见问题

| 现象 | 原因 | 解决 |
|---|---|---|
| 状态页红色 | api-server 未运行 | 重启 `API Server` workflow |
| Provider 显示「不可用」 | AI 集成未连接 | Integrations 连接对应 provider |
| 401 | PROXY_API_KEY 不匹配 | 确认 Secret 值 |
| 400 max_tokens 超限 | claude-opus-4-1 上限 32000 | 代理自动截断，无需处理 |
| 前端空白 | PORT 未读取 | vite.config.ts 用 `process.env.PORT` |
