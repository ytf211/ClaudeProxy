import { useEffect, useState } from "react";

const MODELS = {
  anthropic: ["claude-opus-4-6", "claude-opus-4-5", "claude-opus-4-1", "claude-sonnet-4-6", "claude-sonnet-4-5", "claude-haiku-4-5"],
  openai: ["gpt-4.1", "gpt-4.1-mini", "gpt-4.1-nano", "gpt-4o", "gpt-4o-mini", "o4-mini", "o3", "o3-mini"],
};

const ENDPOINTS = [
  { method: "GET", path: "/api/healthz", desc: "健康检查" },
  { method: "GET", path: "/v1/models", desc: "模型列表" },
  { method: "POST", path: "/v1/messages", desc: "Anthropic 原生" },
  { method: "POST", path: "/v1/chat/completions", desc: "OpenAI 兼容" },
];

const TABS = ["Claude Code", "Cursor / OpenAI", "cURL 测试"] as const;
type Tab = (typeof TABS)[number];

const CODE: Record<Tab, string> = {
  "Claude Code": `# 在终端中设置环境变量
export ANTHROPIC_API_KEY=<你的 PROXY_API_KEY>
export ANTHROPIC_BASE_URL=https://<你的域名>.replit.app
unset ANTHROPIC_AUTH_TOKEN
claude`,
  "Cursor / OpenAI": `# Cursor / rikkahub / 其他 OpenAI 兼容客户端
Base URL : https://<你的域名>.replit.app/v1
API Key  : <你的 PROXY_API_KEY>
Model    : claude-sonnet-4-6`,
  "cURL 测试": `# 健康检查
curl https://<你的域名>.replit.app/api/healthz

# 发送消息（Anthropic 格式）
curl -X POST https://<你的域名>.replit.app/v1/messages \\
  -H "x-api-key: <你的 PROXY_API_KEY>" \\
  -H "Content-Type: application/json" \\
  -d '{"model":"claude-sonnet-4-6","max_tokens":256,"messages":[{"role":"user","content":"你好！"}]}'`,
};

export default function App() {
  const [activeTab, setActiveTab] = useState<Tab>("Claude Code");
  const [uptime, setUptime] = useState(0);
  const [healthy, setHealthy] = useState<boolean | null>(null);

  useEffect(() => {
    const start = Date.now();
    const t = setInterval(() => setUptime(Math.floor((Date.now() - start) / 1000)), 1000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    fetch("/api/healthz")
      .then((r) => r.ok ? setHealthy(true) : setHealthy(false))
      .catch(() => setHealthy(false));
  }, []);

  const fmtUptime = (s: number) => {
    const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
    return (h ? `${h}h ` : "") + (m ? `${m}m ` : "") + `${sec}s`;
  };

  return (
    <div style={{ fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif", background: "#0d0f14", color: "#e8eaf0", minHeight: "100vh", padding: "40px 20px 80px" }}>
      <div style={{ maxWidth: 860, margin: "0 auto" }}>

        {/* Header */}
        <div style={{ display: "flex", alignItems: "center", gap: 16, marginBottom: 48 }}>
          <div style={{ width: 48, height: 48, borderRadius: 12, background: "linear-gradient(135deg, #7c6ef2, #a78bfa)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 22, flexShrink: 0 }}>🔀</div>
          <div>
            <h1 style={{ fontSize: 22, fontWeight: 700, margin: 0, letterSpacing: "-0.3px" }}>Claude Proxy</h1>
            <p style={{ color: "#8b8fa8", fontSize: 14, margin: "3px 0 0" }}>Anthropic / OpenAI 统一代理服务</p>
          </div>
        </div>

        {/* Status Banner */}
        <div style={{ display: "flex", alignItems: "center", gap: 12, background: healthy === false ? "#3d1a1a" : "#1a3d2e", border: `1px solid ${healthy === false ? "#5c2a2a" : "#2a5c43"}`, borderRadius: 12, padding: "14px 20px", marginBottom: 32 }}>
          <div style={{ width: 10, height: 10, borderRadius: "50%", background: healthy === false ? "#f87171" : "#3ecf8e", flexShrink: 0, boxShadow: `0 0 8px ${healthy === false ? "#f87171" : "#3ecf8e"}`, animation: "pulse 2.5s ease-in-out infinite" }} />
          <div style={{ fontSize: 14, fontWeight: 500, color: healthy === false ? "#f87171" : "#3ecf8e" }}>
            {healthy === null ? "检查中…" : healthy ? "服务运行正常" : "服务异常"}
          </div>
          <div style={{ fontSize: 13, color: "#6ba88a", marginLeft: "auto" }}>运行时长 {fmtUptime(uptime)}</div>
        </div>

        {/* Cards Grid */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginBottom: 24 }}>

          {/* Endpoints */}
          <Card title="API 端点">
            {ENDPOINTS.map((e) => (
              <div key={e.path} style={{ display: "flex", alignItems: "baseline", gap: 10, marginBottom: 10 }}>
                <span style={{ fontSize: 11, fontWeight: 700, padding: "2px 7px", borderRadius: 5, flexShrink: 0, background: e.method === "GET" ? "#1a3a5c" : "#2a1f4a", color: e.method === "GET" ? "#60a5fa" : "#a78bfa" }}>{e.method}</span>
                <span style={{ fontFamily: "monospace", fontSize: 13 }}>{e.path}</span>
                <span style={{ fontSize: 12, color: "#8b8fa8", marginLeft: "auto", whiteSpace: "nowrap" }}>{e.desc}</span>
              </div>
            ))}
          </Card>

          {/* Models */}
          <Card title="可用模型">
            <div style={{ marginBottom: 14 }}>
              <div style={{ fontSize: 11, fontWeight: 600, color: "#8b8fa8", textTransform: "uppercase", letterSpacing: "0.5px", marginBottom: 8 }}>Claude · Anthropic</div>
              {MODELS.anthropic.map((m) => <ModelTag key={m} name={m} />)}
            </div>
            <div>
              <div style={{ fontSize: 11, fontWeight: 600, color: "#8b8fa8", textTransform: "uppercase", letterSpacing: "0.5px", marginBottom: 8 }}>OpenAI</div>
              {MODELS.openai.map((m) => <ModelTag key={m} name={m} />)}
            </div>
          </Card>

        </div>

        {/* Quick Start — full width */}
        <Card title="快速接入" fullWidth>
          {/* Tabs */}
          <div style={{ display: "flex", gap: 4, marginBottom: 12 }}>
            {TABS.map((t) => (
              <button key={t} onClick={() => setActiveTab(t)} style={{ background: activeTab === t ? "#3d3680" : "none", border: `1px solid ${activeTab === t ? "#7c6ef2" : "#252830"}`, color: activeTab === t ? "#c4b5fd" : "#8b8fa8", borderRadius: 7, padding: "5px 13px", fontSize: 12, cursor: "pointer" }}>{t}</button>
            ))}
          </div>
          <pre style={{ background: "#0a0b10", border: "1px solid #252830", borderRadius: 10, padding: 16, overflowX: "auto", fontFamily: "monospace", fontSize: 12.5, lineHeight: 1.7, color: "#cdd6f4", margin: 0, whiteSpace: "pre-wrap", wordBreak: "break-all" }}>
            {CODE[activeTab]}
          </pre>
          <div style={{ display: "flex", gap: 8, alignItems: "flex-start", marginTop: 14, fontSize: 13, color: "#8b8fa8" }}>
            <span>🔑</span>
            <span>所有 <strong style={{ color: "#e8eaf0" }}>/v1/*</strong> 接口需要认证：<strong style={{ color: "#e8eaf0" }}>Authorization: Bearer &lt;PROXY_API_KEY&gt;</strong> 或 <strong style={{ color: "#e8eaf0" }}>x-api-key: &lt;PROXY_API_KEY&gt;</strong></span>
          </div>
        </Card>

        {/* Footer */}
        <div style={{ marginTop: 48, textAlign: "center", fontSize: 12, color: "#8b8fa8" }}>
          基于 <a href="https://github.com/ytf211/ClaudeProxy" target="_blank" rel="noreferrer" style={{ color: "#7c6ef2", textDecoration: "none" }}>ClaudeProxy</a> 构建 · 运行于 Replit
        </div>

      </div>

      <style>{`
        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.5; }
        }
        * { box-sizing: border-box; margin: 0; padding: 0; }
        @media (max-width: 600px) {
          .grid { grid-template-columns: 1fr !important; }
        }
      `}</style>
    </div>
  );
}

function Card({ title, children, fullWidth }: { title: string; children: React.ReactNode; fullWidth?: boolean }) {
  return (
    <div style={{ background: "#161920", border: "1px solid #252830", borderRadius: 14, padding: 22, ...(fullWidth ? { gridColumn: "1 / -1" } : {}) }}>
      <h2 style={{ fontSize: 13, fontWeight: 600, color: "#8b8fa8", textTransform: "uppercase", letterSpacing: "0.6px", marginBottom: 16 }}>{title}</h2>
      {children}
    </div>
  );
}

function ModelTag({ name }: { name: string }) {
  return (
    <span style={{ display: "inline-block", fontFamily: "monospace", fontSize: 12, background: "#0a0b10", border: "1px solid #252830", borderRadius: 6, padding: "3px 9px", margin: "3px 4px 3px 0", color: "#c4b5fd" }}>{name}</span>
  );
}
