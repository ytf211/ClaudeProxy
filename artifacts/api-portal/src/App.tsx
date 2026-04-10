import { useEffect, useState } from "react";

const MODELS = {
  anthropic: ["claude-opus-4-6", "claude-opus-4-5", "claude-opus-4-1", "claude-sonnet-4-6", "claude-sonnet-4-5", "claude-haiku-4-5"],
  openai:    ["gpt-4.1", "gpt-4.1-mini", "gpt-4.1-nano", "gpt-4o", "gpt-4o-mini", "o4-mini", "o3", "o3-mini"],
  gemini:    ["gemini-3.1-pro-preview", "gemini-3-pro-preview", "gemini-3-flash-preview", "gemini-2.5-pro", "gemini-2.5-flash"],
};

const ENDPOINTS = [
  { method: "GET",  path: "/v1/models",                         desc: "模型列表",          group: "oai" },
  { method: "POST", path: "/v1/messages",                       desc: "Anthropic 原生",    group: "oai" },
  { method: "POST", path: "/v1/chat/completions",               desc: "OpenAI / Gemini",   group: "oai" },
  { method: "POST", path: "/v1/responses",                      desc: "Responses API",     group: "oai" },
  { method: "POST", path: "/v1beta/models/{model}:generateContent",       desc: "Gemini 原生",       group: "beta" },
  { method: "POST", path: "/v1beta/models/{model}:streamGenerateContent", desc: "Gemini 流式",       group: "beta" },
];

interface ProviderStatus { available: boolean; checkedAt: number; error?: string }
interface HealthData { status: string; startedAt: number; providers: Record<string, ProviderStatus> }

function fmtUptime(s: number) {
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m ${s % 60}s`;
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60);
  return `${h}h ${m}m`;
}

export default function App() {
  const [healthy, setHealthy] = useState<boolean | null>(null);
  const [uptime, setUptime] = useState<number>(0);
  const [providers, setProviders] = useState<Record<string, ProviderStatus>>({});

  useEffect(() => {
    let tickInterval: ReturnType<typeof setInterval>;

    function poll() {
      fetch("/api/healthz")
        .then((r) => r.ok ? r.json() : Promise.reject())
        .then((data: HealthData) => {
          setHealthy(true);
          setProviders(data.providers ?? {});
          const tick = () => setUptime(Math.floor(Date.now() / 1000) - data.startedAt);
          tick();
          clearInterval(tickInterval);
          tickInterval = setInterval(tick, 1000);
        })
        .catch(() => setHealthy(false));
    }

    poll();
    const pollInterval = setInterval(poll, 30000);
    return () => { clearInterval(tickInterval); clearInterval(pollInterval); };
  }, []);

  const dot = healthy === null ? "#6b7280" : healthy ? "#3ecf8e" : "#f87171";
  const statusText = healthy === null ? "检查中…" : healthy ? "运行正常" : "服务异常";

  return (
    <div style={{ fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif", background: "#0d0f14", color: "#e8eaf0", minHeight: "100vh", padding: "40px 20px 60px" }}>
      <div style={{ maxWidth: 760, margin: "0 auto" }}>

        {/* Header */}
        <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 28 }}>
          <div style={{ width: 40, height: 40, borderRadius: 10, background: "linear-gradient(135deg, #7c6ef2, #a78bfa)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 18, flexShrink: 0 }}>🔀</div>
          <div>
            <h1 style={{ fontSize: 20, fontWeight: 700, margin: 0 }}>Claude Proxy</h1>
            <p style={{ color: "#6b7280", fontSize: 13, margin: "2px 0 0" }}>Anthropic / OpenAI / Gemini 统一代理</p>
          </div>
        </div>

        {/* Server status bar */}
        <div style={{ display: "flex", alignItems: "center", gap: 10, background: "#161920", border: "1px solid #252830", borderRadius: 10, padding: "11px 16px", marginBottom: 12 }}>
          <Dot color={dot} pulse />
          <span style={{ fontSize: 14, fontWeight: 500, color: dot }}>{statusText}</span>
          {healthy && uptime > 0 && (
            <span style={{ fontSize: 13, color: "#6b7280", marginLeft: "auto" }}>已运行 {fmtUptime(uptime)}</span>
          )}
        </div>

        {/* Provider status row */}
        {healthy && (
          <div style={{ display: "flex", gap: 8, marginBottom: 20 }}>
            {[
              { key: "anthropic", label: "Anthropic", color: "#e06c55" },
              { key: "openai",    label: "OpenAI",    color: "#74c7a5" },
              { key: "gemini",    label: "Gemini",    color: "#4285f4" },
            ].map(({ key, label, color }) => {
              const p = providers[key];
              const avail = p?.checkedAt ? p.available : null;
              const c = avail === null ? "#6b7280" : avail ? "#3ecf8e" : "#f87171";
              const txt = avail === null ? "检测中" : avail ? "可用" : "不可用";
              return (
                <div key={key} style={{ flex: 1, display: "flex", alignItems: "center", gap: 7, background: "#161920", border: "1px solid #252830", borderRadius: 8, padding: "8px 12px" }}>
                  <span style={{ width: 8, height: 8, borderRadius: "50%", background: color, flexShrink: 0, display: "inline-block" }} />
                  <span style={{ fontSize: 12, fontWeight: 600, color: "#a0a6b1" }}>{label}</span>
                  <span style={{ fontSize: 11, color: c, marginLeft: "auto" }}>{txt}</span>
                </div>
              );
            })}
          </div>
        )}

        {/* Grid */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>

          <Card title="API 端点">
            {[
              { label: "/v1  OpenAI 兼容",   group: "oai"  },
              { label: "/v1beta  Gemini 原生", group: "beta" },
            ].map(({ label, group }, gi) => (
              <div key={group} style={{ marginBottom: gi === 0 ? 12 : 0 }}>
                <div style={{ fontSize: 9, fontWeight: 600, color: "#4b5563", textTransform: "uppercase", letterSpacing: "0.4px", marginBottom: 6 }}>{label}</div>
                {ENDPOINTS.filter(e => e.group === group).map((e) => (
                  <div key={e.path} style={{ display: "flex", alignItems: "flex-start", gap: 7, marginBottom: 7 }}>
                    <span style={{ fontSize: 9, fontWeight: 700, padding: "2px 5px", borderRadius: 4, flexShrink: 0, marginTop: 1, background: e.method === "GET" ? "#1a3a5c" : "#2a1f4a", color: e.method === "GET" ? "#60a5fa" : "#a78bfa" }}>{e.method}</span>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontFamily: "monospace", fontSize: 10, color: "#c4b5fd", wordBreak: "break-all" }}>{e.path}</div>
                      <div style={{ fontSize: 10, color: "#6b7280", marginTop: 1 }}>{e.desc}</div>
                    </div>
                  </div>
                ))}
              </div>
            ))}
          </Card>

          <Card title="可用模型">
            {([
              { key: "anthropic" as const, label: "Claude", color: "#e06c55" },
              { key: "openai"    as const, label: "OpenAI", color: "#74c7a5" },
              { key: "gemini"    as const, label: "Gemini", color: "#4285f4" },
            ]).map(({ key, label, color }, i) => (
              <div key={key} style={{ marginBottom: i < 2 ? 12 : 0 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 5, marginBottom: 6 }}>
                  <span style={{ width: 6, height: 6, borderRadius: "50%", background: color, display: "inline-block" }} />
                  <span style={{ fontSize: 10, fontWeight: 600, color: "#6b7280", textTransform: "uppercase", letterSpacing: "0.5px" }}>{label}</span>
                </div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
                  {MODELS[key].map((m) => <Tag key={m} label={m} />)}
                </div>
              </div>
            ))}
          </Card>

        </div>
      </div>

      <style>{`
        @keyframes pulse { 0%,100%{opacity:1} 50%{opacity:.4} }
        *{box-sizing:border-box;margin:0;padding:0}
        @media(max-width:580px){div[style*="grid-template-columns"]{grid-template-columns:1fr!important}}
      `}</style>
    </div>
  );
}

function Dot({ color, pulse }: { color: string; pulse?: boolean }) {
  return (
    <div style={{ width: 8, height: 8, borderRadius: "50%", background: color, flexShrink: 0, boxShadow: `0 0 6px ${color}`, animation: pulse ? "pulse 2.5s ease-in-out infinite" : undefined }} />
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
