import { useEffect, useState } from "react";

const MODELS = {
  anthropic: ["claude-opus-4-6", "claude-opus-4-5", "claude-opus-4-1", "claude-sonnet-4-6", "claude-sonnet-4-5", "claude-haiku-4-5"],
  openai: ["gpt-4.1", "gpt-4.1-mini", "gpt-4.1-nano", "gpt-4o", "gpt-4o-mini", "o4-mini", "o3", "o3-mini"],
};

const ENDPOINTS = [
  { method: "GET",  path: "/v1/models",           desc: "模型列表" },
  { method: "POST", path: "/v1/messages",          desc: "Anthropic 原生" },
  { method: "POST", path: "/v1/chat/completions",  desc: "OpenAI 兼容" },
  { method: "POST", path: "/v1/responses",         desc: "Responses API" },
];

function fmtUptime(s: number) {
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m ${s % 60}s`;
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60);
  return `${h}h ${m}m`;
}

export default function App() {
  const [healthy, setHealthy] = useState<boolean | null>(null);
  const [uptime, setUptime] = useState<number>(0);

  useEffect(() => {
    let interval: ReturnType<typeof setInterval>;

    function poll() {
      fetch("/api/healthz")
        .then((r) => r.ok ? r.json() : Promise.reject())
        .then((data: { status: string; startedAt: number }) => {
          setHealthy(true);
          const tick = () => setUptime(Math.floor(Date.now() / 1000) - data.startedAt);
          tick();
          clearInterval(interval);
          interval = setInterval(tick, 1000);
        })
        .catch(() => setHealthy(false));
    }

    poll();
    const pollInterval = setInterval(poll, 30000);
    return () => { clearInterval(interval); clearInterval(pollInterval); };
  }, []);

  const dot = healthy === null ? "#6b7280" : healthy ? "#3ecf8e" : "#f87171";
  const statusText = healthy === null ? "检查中…" : healthy ? "运行正常" : "服务异常";

  return (
    <div style={{ fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif", background: "#0d0f14", color: "#e8eaf0", minHeight: "100vh", padding: "40px 20px 60px" }}>
      <div style={{ maxWidth: 720, margin: "0 auto" }}>

        {/* Header */}
        <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 36 }}>
          <div style={{ width: 40, height: 40, borderRadius: 10, background: "linear-gradient(135deg, #7c6ef2, #a78bfa)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 18, flexShrink: 0 }}>🔀</div>
          <div>
            <h1 style={{ fontSize: 20, fontWeight: 700, margin: 0 }}>Claude Proxy</h1>
            <p style={{ color: "#6b7280", fontSize: 13, margin: "2px 0 0" }}>Anthropic / OpenAI 统一代理</p>
          </div>
        </div>

        {/* Status */}
        <div style={{ display: "flex", alignItems: "center", gap: 10, background: "#161920", border: "1px solid #252830", borderRadius: 10, padding: "12px 16px", marginBottom: 20 }}>
          <div style={{ width: 8, height: 8, borderRadius: "50%", background: dot, flexShrink: 0, boxShadow: `0 0 6px ${dot}`, animation: "pulse 2.5s ease-in-out infinite" }} />
          <span style={{ fontSize: 14, fontWeight: 500, color: dot }}>{statusText}</span>
          {healthy && uptime > 0 && (
            <span style={{ fontSize: 13, color: "#6b7280", marginLeft: "auto" }}>已运行 {fmtUptime(uptime)}</span>
          )}
        </div>

        {/* Grid */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>

          <Card title="API 端点">
            {ENDPOINTS.map((e) => (
              <div key={e.path} style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 9 }}>
                <span style={{ fontSize: 10, fontWeight: 700, padding: "2px 6px", borderRadius: 4, flexShrink: 0, background: e.method === "GET" ? "#1a3a5c" : "#2a1f4a", color: e.method === "GET" ? "#60a5fa" : "#a78bfa" }}>{e.method}</span>
                <span style={{ fontFamily: "monospace", fontSize: 12, color: "#c4b5fd" }}>{e.path}</span>
                <span style={{ fontSize: 11, color: "#6b7280", marginLeft: "auto", whiteSpace: "nowrap" }}>{e.desc}</span>
              </div>
            ))}
          </Card>

          <Card title="可用模型">
            <div style={{ marginBottom: 12 }}>
              <div style={{ fontSize: 10, fontWeight: 600, color: "#6b7280", textTransform: "uppercase", letterSpacing: "0.5px", marginBottom: 7 }}>Claude</div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
                {MODELS.anthropic.map((m) => <Tag key={m} label={m} />)}
              </div>
            </div>
            <div>
              <div style={{ fontSize: 10, fontWeight: 600, color: "#6b7280", textTransform: "uppercase", letterSpacing: "0.5px", marginBottom: 7 }}>OpenAI</div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
                {MODELS.openai.map((m) => <Tag key={m} label={m} />)}
              </div>
            </div>
          </Card>

        </div>

      </div>

      <style>{`
        @keyframes pulse { 0%,100%{opacity:1} 50%{opacity:.4} }
        *{box-sizing:border-box;margin:0;padding:0}
        @media(max-width:560px){div[style*="grid-template-columns"]{grid-template-columns:1fr!important}}
      `}</style>
    </div>
  );
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ background: "#161920", border: "1px solid #252830", borderRadius: 12, padding: 18 }}>
      <h2 style={{ fontSize: 11, fontWeight: 600, color: "#6b7280", textTransform: "uppercase", letterSpacing: "0.6px", marginBottom: 14 }}>{title}</h2>
      {children}
    </div>
  );
}

function Tag({ label }: { label: string }) {
  return (
    <span style={{ fontFamily: "monospace", fontSize: 11, background: "#0a0b10", border: "1px solid #252830", borderRadius: 5, padding: "2px 7px", color: "#a78bfa" }}>{label}</span>
  );
}
