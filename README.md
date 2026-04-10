# ClaudeProxy on Replit

> Anthropic / OpenAI 统一 API 代理服务，支持 Claude Code、Cursor 等所有兼容客户端。
> 基于 [ytf211/ClaudeProxy](https://github.com/ytf211/ClaudeProxy)，针对 Replit 完整适配。

---

## 一键部署到 Replit

[![Deploy on Replit](https://replit.com/badge/github/YOUR_GITHUB_USERNAME/YOUR_REPO_NAME)](https://replit.com/new/github/YOUR_GITHUB_USERNAME/YOUR_REPO_NAME)

> 将上方链接中的 `YOUR_GITHUB_USERNAME` 和 `YOUR_REPO_NAME` 替换为你的 GitHub 用户名和仓库名。

---

## 功能

- `GET  /api/healthz` — 健康检查
- `GET  /v1/models` — 可用模型列表
- `POST /v1/messages` — **Anthropic 原生** Messages API（流式 / 非流式）
- `POST /v1/chat/completions` — **OpenAI 兼容** Chat Completions（流式 / 非流式）
- 自动路由：`claude-*` 模型走 Anthropic，`gpt-*` / `o*` 走 OpenAI
- 支持 Tool Calling、Thinking Blocks、System Prompt
- React 状态页面（黑色主题），实时显示服务健康状态

---

## 部署步骤

### 1. 导入到 Replit

点击上方 "Deploy on Replit" 按钮，或在 Replit 中选择 **Import from GitHub** 并填入本仓库地址。

### 2. 设置 Secrets

在 Replit 项目的 **Secrets** 页面（🔒 图标）中添加以下三个 Secret：

| Secret 名称 | 说明 |
|---|---|
| `PROXY_API_KEY` | 自定义访问密钥，任意字符串 |
| `AI_INTEGRATIONS_ANTHROPIC_API_KEY` | 你的 Anthropic API Key |
| `AI_INTEGRATIONS_OPENAI_API_KEY` | 你的 OpenAI API Key |

可选（有默认值，接入第三方中转站时修改）：

| 变量名 | 默认值 |
|---|---|
| `AI_INTEGRATIONS_ANTHROPIC_BASE_URL` | `https://api.anthropic.com` |
| `AI_INTEGRATIONS_OPENAI_BASE_URL` | `https://api.openai.com/v1` |

### 3. 发布

点击右上角 **Publish** → **Deploy** 即可。

---

## 客户端接入

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

### cURL 快速测试

```bash
# 健康检查
curl https://<你的域名>.replit.app/api/healthz

# 发送消息（Anthropic 格式）
curl -X POST https://<你的域名>.replit.app/v1/messages \
  -H "x-api-key: <你的 PROXY_API_KEY>" \
  -H "Content-Type: application/json" \
  -d '{"model":"claude-sonnet-4-6","max_tokens":256,"messages":[{"role":"user","content":"你好！"}]}'

# OpenAI 格式
curl -X POST https://<你的域名>.replit.app/v1/chat/completions \
  -H "Authorization: Bearer <你的 PROXY_API_KEY>" \
  -H "Content-Type: application/json" \
  -d '{"model":"claude-sonnet-4-6","messages":[{"role":"user","content":"你好！"}]}'
```

---

## 可用模型

| 提供商 | 模型 |
|---|---|
| Anthropic | `claude-opus-4-6` · `claude-sonnet-4-6` · `claude-haiku-4-5` |
| OpenAI | `gpt-5.2` · `gpt-5-mini` · `gpt-5-nano` · `o4-mini` · `o3` |

---

## 技术栈

- **Monorepo**: pnpm workspaces
- **后端**: Express 5 + TypeScript
- **前端**: React 18 + Vite 6 + Tailwind v4
- **AI SDK**: `@anthropic-ai/sdk` + `openai`

---

## License

MIT
