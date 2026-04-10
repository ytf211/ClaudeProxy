import { Router, type IRouter } from "express";

const router: IRouter = Router();

const HTML = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Claude Proxy — 状态</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

    :root {
      --bg: #0d0f14;
      --surface: #161920;
      --border: #252830;
      --accent: #7c6ef2;
      --accent-dim: #3d3680;
      --green: #3ecf8e;
      --green-dim: #1a3d2e;
      --text: #e8eaf0;
      --muted: #8b8fa8;
      --code-bg: #0a0b10;
    }

    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif;
      background: var(--bg);
      color: var(--text);
      min-height: 100vh;
      padding: 40px 20px 80px;
    }

    .container { max-width: 860px; margin: 0 auto; }

    /* Header */
    .header { display: flex; align-items: center; gap: 16px; margin-bottom: 48px; }
    .logo {
      width: 48px; height: 48px; border-radius: 12px;
      background: linear-gradient(135deg, var(--accent), #a78bfa);
      display: flex; align-items: center; justify-content: center;
      font-size: 22px; flex-shrink: 0;
    }
    .header-text h1 { font-size: 22px; font-weight: 700; letter-spacing: -0.3px; }
    .header-text p { color: var(--muted); font-size: 14px; margin-top: 3px; }

    /* Status banner */
    .status-banner {
      display: flex; align-items: center; gap: 12px;
      background: var(--green-dim); border: 1px solid #2a5c43;
      border-radius: 12px; padding: 14px 20px; margin-bottom: 32px;
    }
    .dot {
      width: 10px; height: 10px; border-radius: 50%;
      background: var(--green); flex-shrink: 0;
      box-shadow: 0 0 8px var(--green);
      animation: pulse 2.5s ease-in-out infinite;
    }
    @keyframes pulse {
      0%, 100% { opacity: 1; box-shadow: 0 0 8px var(--green); }
      50%       { opacity: 0.6; box-shadow: 0 0 3px var(--green); }
    }
    .status-text { font-size: 14px; font-weight: 500; color: var(--green); }
    .status-sub  { font-size: 13px; color: #6ba88a; margin-left: auto; }

    /* Cards grid */
    .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; margin-bottom: 24px; }
    @media (max-width: 640px) { .grid { grid-template-columns: 1fr; } }

    .card {
      background: var(--surface); border: 1px solid var(--border);
      border-radius: 14px; padding: 22px;
    }
    .card h2 { font-size: 13px; font-weight: 600; color: var(--muted); text-transform: uppercase; letter-spacing: 0.6px; margin-bottom: 16px; }

    /* Endpoint table */
    .endpoint { display: flex; align-items: baseline; gap: 10px; margin-bottom: 10px; }
    .endpoint:last-child { margin-bottom: 0; }
    .method {
      font-size: 11px; font-weight: 700; letter-spacing: 0.5px;
      padding: 2px 7px; border-radius: 5px; flex-shrink: 0;
    }
    .method.get  { background: #1a3a5c; color: #60a5fa; }
    .method.post { background: #2a1f4a; color: #a78bfa; }
    .path { font-family: "SF Mono", "Fira Code", monospace; font-size: 13px; color: var(--text); }
    .desc { font-size: 12px; color: var(--muted); margin-left: auto; white-space: nowrap; }

    /* Model list */
    .model-group { margin-bottom: 14px; }
    .model-group:last-child { margin-bottom: 0; }
    .model-group-label { font-size: 11px; font-weight: 600; color: var(--muted); text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 8px; }
    .model-tag {
      display: inline-block; font-family: "SF Mono", "Fira Code", monospace;
      font-size: 12px; background: var(--code-bg); border: 1px solid var(--border);
      border-radius: 6px; padding: 3px 9px; margin: 3px 4px 3px 0; color: #c4b5fd;
    }

    /* Full-width card */
    .card.full { grid-column: 1 / -1; }

    /* Code block */
    .code-tabs { display: flex; gap: 4px; margin-bottom: 12px; }
    .tab-btn {
      background: none; border: 1px solid var(--border); color: var(--muted);
      border-radius: 7px; padding: 5px 13px; font-size: 12px; cursor: pointer; transition: all .15s;
    }
    .tab-btn.active { background: var(--accent-dim); border-color: var(--accent); color: #c4b5fd; }
    .code-block { display: none; }
    .code-block.active { display: block; }
    pre {
      background: var(--code-bg); border: 1px solid var(--border);
      border-radius: 10px; padding: 16px; overflow-x: auto;
      font-family: "SF Mono", "Fira Code", monospace; font-size: 12.5px; line-height: 1.7;
      color: #cdd6f4;
    }
    .kw  { color: #cba6f7; }
    .str { color: #a6e3a1; }
    .cm  { color: #6c7086; }
    .var { color: #89b4fa; }

    /* Auth hint */
    .auth-hint { display: flex; gap: 8px; align-items: flex-start; margin-top: 14px; font-size: 13px; color: var(--muted); }
    .auth-hint b { color: var(--text); }

    /* Footer */
    .footer { margin-top: 48px; text-align: center; font-size: 12px; color: var(--muted); }
    .footer a { color: var(--accent); text-decoration: none; }
    .footer a:hover { text-decoration: underline; }
  </style>
</head>
<body>
<div class="container">

  <div class="header">
    <div class="logo">🔀</div>
    <div class="header-text">
      <h1>Claude Proxy</h1>
      <p>Anthropic / OpenAI 统一代理服务</p>
    </div>
  </div>

  <div class="status-banner">
    <div class="dot"></div>
    <div class="status-text">服务运行正常</div>
    <div class="status-sub" id="uptime">正在加载…</div>
  </div>

  <div class="grid">

    <!-- Endpoints -->
    <div class="card">
      <h2>API 端点</h2>
      <div class="endpoint">
        <span class="method get">GET</span>
        <span class="path">/api/healthz</span>
        <span class="desc">健康检查</span>
      </div>
      <div class="endpoint">
        <span class="method get">GET</span>
        <span class="path">/v1/models</span>
        <span class="desc">模型列表</span>
      </div>
      <div class="endpoint">
        <span class="method post">POST</span>
        <span class="path">/v1/messages</span>
        <span class="desc">Anthropic 原生</span>
      </div>
      <div class="endpoint">
        <span class="method post">POST</span>
        <span class="path">/v1/chat/completions</span>
        <span class="desc">OpenAI 兼容</span>
      </div>
    </div>

    <!-- Models -->
    <div class="card">
      <h2>可用模型</h2>
      <div class="model-group">
        <div class="model-group-label">Claude · Anthropic</div>
        <span class="model-tag">claude-opus-4-6</span>
        <span class="model-tag">claude-sonnet-4-6</span>
        <span class="model-tag">claude-haiku-4-5</span>
      </div>
      <div class="model-group">
        <div class="model-group-label">OpenAI</div>
        <span class="model-tag">gpt-5.2</span>
        <span class="model-tag">gpt-5-mini</span>
        <span class="model-tag">gpt-5-nano</span>
        <span class="model-tag">o4-mini</span>
        <span class="model-tag">o3</span>
      </div>
    </div>

    <!-- Quick start -->
    <div class="card full">
      <h2>快速接入</h2>
      <div class="code-tabs">
        <button class="tab-btn active" onclick="switchTab('claude-code')">Claude Code</button>
        <button class="tab-btn" onclick="switchTab('cursor')">Cursor / OpenAI</button>
        <button class="tab-btn" onclick="switchTab('curl')">cURL 测试</button>
      </div>

      <div class="code-block active" id="tab-claude-code">
<pre><span class="cm"># 在终端中设置环境变量</span>
<span class="kw">export</span> <span class="var">ANTHROPIC_API_KEY</span>=<span class="str">&lt;你的 PROXY_API_KEY&gt;</span>
<span class="kw">export</span> <span class="var">ANTHROPIC_BASE_URL</span>=<span class="str">https://&lt;你的域名&gt;.replit.app</span>
<span class="kw">unset</span> ANTHROPIC_AUTH_TOKEN
claude</pre>
      </div>

      <div class="code-block" id="tab-cursor">
<pre><span class="cm"># Cursor / rikkahub / 其他 OpenAI 兼容客户端</span>
Base URL : <span class="str">https://&lt;你的域名&gt;.replit.app/v1</span>
API Key  : <span class="str">&lt;你的 PROXY_API_KEY&gt;</span>
Model    : <span class="str">claude-sonnet-4-6</span></pre>
      </div>

      <div class="code-block" id="tab-curl">
<pre><span class="cm"># 健康检查</span>
curl https://&lt;你的域名&gt;.replit.app/api/healthz

<span class="cm"># 发送消息（Anthropic 格式）</span>
curl -X POST https://&lt;你的域名&gt;.replit.app/v1/messages \
  -H <span class="str">"x-api-key: &lt;你的 PROXY_API_KEY&gt;"</span> \
  -H <span class="str">"Content-Type: application/json"</span> \
  -d <span class="str">'{"model":"claude-sonnet-4-6","max_tokens":256,"messages":[{"role":"user","content":"你好！"}]}'</span></pre>
      </div>

      <div class="auth-hint">
        <span>🔑</span>
        <span>所有 <b>/v1/*</b> 接口需要认证：<b>Authorization: Bearer &lt;PROXY_API_KEY&gt;</b> 或 <b>x-api-key: &lt;PROXY_API_KEY&gt;</b></span>
      </div>
    </div>

  </div>

  <div class="footer">
    基于 <a href="https://github.com/ytf211/ClaudeProxy" target="_blank">ClaudeProxy</a> 构建 · 运行于 Replit
  </div>

</div>

<script>
  function switchTab(name) {
    document.querySelectorAll('.tab-btn').forEach((b, i) => {
      const tabs = ['claude-code', 'cursor', 'curl'];
      b.classList.toggle('active', tabs[i] === name);
    });
    document.querySelectorAll('.code-block').forEach(el => {
      el.classList.toggle('active', el.id === 'tab-' + name);
    });
  }

  // Show relative uptime via health check
  const start = Date.now();
  function tick() {
    const s = Math.floor((Date.now() - start) / 1000);
    const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
    document.getElementById('uptime').textContent =
      '运行时长 ' + (h ? h + 'h ' : '') + (m ? m + 'm ' : '') + sec + 's';
  }
  tick();
  setInterval(tick, 1000);
</script>
</body>
</html>`;

router.get("/", (_req, res) => {
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.send(HTML);
});

export default router;
