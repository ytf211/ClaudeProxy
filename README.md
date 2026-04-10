# ClaudeProxy

> Anthropic / OpenAI / Gemini 统一 API 代理，运行在 Replit 上，使用 Replit AI Credits，无需自备 API Key。
> 支持 Claude Code、Cursor、Open WebUI、RikkaHub 等所有兼容客户端。

[![Deploy on Replit](https://replit.com/badge/github/ytf211/ClaudeProxy)](https://replit.com/new/github/ytf211/ClaudeProxy)

---

## 功能

| 端点 | 说明 |
|---|---|
| `GET  /api/healthz` | 健康检查（无需认证），返回各 provider 可用状态 |
| `GET  /v1/models` | 可用模型列表 |
| `POST /v1/messages` | Anthropic 原生 Messages API |
| `POST /v1/chat/completions` | OpenAI / Gemini 兼容 Chat Completions |
| `POST /v1/responses` | OpenAI Responses API |
| `GET  /v1beta/models` | Gemini 模型列表（原生格式） |
| `POST /v1beta/models/{model}:generateContent` | Gemini 原生生成（含流式） |

**支持特性**：流式 / 非流式、Tool Calling（全部 provider）、Thinking Blocks、Prompt Caching、多模态

---

## 可用模型

| 提供商 | 模型 |
|---|---|
| Anthropic | `claude-opus-4-6` `claude-opus-4-5` `claude-opus-4-1` `claude-sonnet-4-6` `claude-sonnet-4-5` `claude-haiku-4-5` |
| OpenAI | `gpt-4.1` `gpt-4.1-mini` `gpt-4.1-nano` `gpt-4o` `gpt-4o-mini` `o4-mini` `o3` `o3-mini` |
| Gemini | `gemini-3.1-pro-preview` `gemini-3-flash-preview` `gemini-2.5-pro` `gemini-2.5-flash` |

> **注意**：`o4-mini` / `o3-mini` / `gemini-2.5-*` 为推理模型，建议 `max_tokens` ≥ 300。
> `claude-opus-4-1` 最大输出 token 为 32000，代理会自动截断超出部分。

---

## 部署到 Replit

点击上方 **Deploy on Replit** 按钮，或手动按以下步骤操作。

---

### 第一步：设置密钥（必须最先做）

在 Replit 左侧 **Secrets**（🔒）中创建两个变量：

| 变量名 | 说明 | 示例值 |
|---|---|---|
| `PROXY_API_KEY` | 客户端访问密钥，任意字符串 | `my-key-123` |
| `DEBUG_LOG` | 调试日志，正常使用填 `false` | `false` |

然后在左侧 **Integrations** 依次连接 **Anthropic**、**OpenAI**、**Gemini**，Replit 会自动注入 API Key。

---

### 第二步：安装依赖

```bash
pnpm install --frozen-lockfile
```

---

### 第三步：测试后端

启动 `API Server` workflow，等待就绪后：

```bash
# 健康检查（无需 key）
curl https://<你的域名>.replit.app/api/healthz

# Anthropic 测试
curl -X POST https://<你的域名>.replit.app/v1/messages \
  -H "x-api-key: <PROXY_API_KEY>" \
  -H "Content-Type: application/json" \
  -d '{"model":"claude-haiku-4-5","max_tokens":32,"messages":[{"role":"user","content":"Hi"}]}'

# OpenAI 测试
curl -X POST https://<你的域名>.replit.app/v1/chat/completions \
  -H "Authorization: Bearer <PROXY_API_KEY>" \
  -H "Content-Type: application/json" \
  -d '{"model":"gpt-4.1-mini","max_tokens":32,"messages":[{"role":"user","content":"Hi"}]}'

# Gemini 测试（/v1beta 原生）
curl -X POST https://<你的域名>.replit.app/v1beta/models/gemini-2.5-flash:generateContent \
  -H "x-goog-api-key: <PROXY_API_KEY>" \
  -H "Content-Type: application/json" \
  -d '{"contents":[{"role":"user","parts":[{"text":"Hi"}]}]}'

# Gemini 模型列表
curl https://<你的域名>.replit.app/v1beta/models \
  -H "x-goog-api-key: <PROXY_API_KEY>"
```

---

## 认证方式

```
x-api-key: <PROXY_API_KEY>            # Anthropic 风格（Claude Code 等）
Authorization: Bearer <PROXY_API_KEY>  # OpenAI / Gemini 风格（Cursor 等）
x-goog-api-key: <PROXY_API_KEY>       # Gemini 原生（/v1beta 端点）
```

---

## 客户端接入

### Claude Code

```bash
export ANTHROPIC_API_KEY=<PROXY_API_KEY>
export ANTHROPIC_BASE_URL=https://<你的域名>.replit.app
claude
```

### Cursor / Open WebUI

```
Base URL : https://<你的域名>.replit.app/v1
API Key  : <PROXY_API_KEY>
```

### RikkaHub（原生 Gemini）

```
Base URL : https://<你的域名>.replit.app
API Key  : <PROXY_API_KEY>
接口格式  : /v1beta
```

### Google GenAI SDK

```python
from google import genai
client = genai.Client(
    api_key="<PROXY_API_KEY>",
    http_options={"base_url": "https://<你的域名>.replit.app", "api_version": ""}
)
```

---

## 技术栈

- **Monorepo**: pnpm workspaces · Node.js 24
- **后端**: Express 5 + TypeScript 5 + esbuild
- **前端**: React 18 + Vite 6
- **AI SDK**: `@anthropic-ai/sdk` · `openai` · `@google/genai`

---

## 常见问题

| 现象 | 原因 | 解决 |
|---|---|---|
| 状态页红色 | 后端未运行 | 重启 `API Server` workflow |
| 401 Unauthorized | PROXY_API_KEY 不匹配 | 确认 Secret 值与请求中的 key 一致 |
| AI 调用 401/403 | AI 集成未连接 | 在 Integrations 连接对应 provider |
| 400 max_tokens 超限 | claude-opus-4-1 上限 32000 | 代理已自动截断，无需手动处理 |
| 模型 not found | 拼写错误 | 参考上方模型列表 |

---

## License

MIT
