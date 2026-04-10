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

**支持特性**：流式 / 非流式、Tool Calling、Thinking Blocks、Prompt Caching、多模态

---

## 可用模型

| 提供商 | 模型 |
|---|---|
| Anthropic | `claude-opus-4-6` `claude-opus-4-5` `claude-opus-4-1` `claude-sonnet-4-6` `claude-sonnet-4-5` `claude-haiku-4-5` |
| OpenAI | `gpt-4.1` `gpt-4.1-mini` `gpt-4.1-nano` `gpt-4o` `gpt-4o-mini` `o4-mini` `o3` `o3-mini` |

---

## 部署到 Replit

点击上方 **Deploy on Replit** 按钮，或手动按以下步骤操作。

---

### 第一步：创建必要变量（最先做）

导入项目后，在 Replit 左侧 **Secrets**（🔒）中创建：

| 变量名 | 说明 |
|---|---|
| `PROXY_API_KEY` | 自定义访问密钥，任意字符串，例如 `my-key-123` |
| `DEBUG_LOG` | 填写 `false`（正常使用）；填 `true` 可开启详细日志 |

然后在左侧 **Integrations** 依次连接 **Anthropic** 和 **OpenAI**，Replit 会自动注入 API Key，无需自备。

---

### 第二步：安装依赖

在 Shell 中执行：

```bash
pnpm install --frozen-lockfile
```

> 项目已声明 Node.js 24，Replit 会自动准备运行环境，无需手动安装。

---

### 第三步：启动并测试后端

启动后端 workflow（`API Server`），等待就绪后验证：

```bash
# 健康检查（无需 key）
curl http://localhost:8080/api/healthz
# → {"status":"ok","startedAt":...}

# API 调用测试
curl -X POST http://localhost:8080/v1/messages \
  -H "x-api-key: <你的 PROXY_API_KEY>" \
  -H "Content-Type: application/json" \
  -d '{"model":"claude-haiku-4-5","max_tokens":32,"messages":[{"role":"user","content":"Hi"}]}'
# → {"type":"message","role":"assistant",...}
```

**后端测试通过后再继续。**

---

### 第四步：启动前端

启动前端 workflow（`web`），访问根路径，状态页应显示绿色「运行正常」。

---

### 第五步：完整验证后发布

```bash
PROXY_API_KEY=<你的密钥> bash scripts/check-deploy.sh http://localhost:8080
```

全部通过后点击右上角 **Publish → Deploy** 获得永久域名。

---

## 认证方式

```
x-api-key: <PROXY_API_KEY>            # Anthropic 风格（Claude Code 等）
Authorization: Bearer <PROXY_API_KEY>  # OpenAI 风格（Cursor 等）
```

使用 `x-api-key` 时 `/v1/models` 只返回 Claude 模型；使用 `Bearer` 时返回全部模型。

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

- **Monorepo**: pnpm workspaces · Node.js 24
- **后端**: Express 5 + TypeScript 5 + esbuild
- **前端**: React 18 + Vite 6
- **AI SDK**: `@anthropic-ai/sdk` + `openai`
- **日志**: pino

---

## 常见问题

| 现象 | 原因 | 解决 |
|---|---|---|
| 状态页红色 | 后端未运行 | 重启 `API Server` workflow |
| 401 Unauthorized | PROXY_API_KEY 不匹配 | 确认 Secret 值与请求中的 key 一致 |
| AI 调用 401/403 | AI 集成未连接 | 在 Integrations 连接 Anthropic / OpenAI |
| 流式响应中断 | 代理超时 | 已内置 keepAliveTimeout=65s，通常无需处理 |
| 模型 not found | 拼写错误 | 参考上方模型列表 |

---

## License

MIT
