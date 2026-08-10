import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../api";

interface ModelInfo {
  id: string;
  name: string;
  status: string;
  note: string;
}

interface ProviderInfo {
  id: string;
  name: string;
  reachable: boolean;
  latencyMs: number;
  error: string | null;
  models: ModelInfo[];
  credits?: {
    usedUsd?: number;
    limitUsd?: number;
    remainingUsd?: number;
    isUnlimited?: boolean;
    details: string;
  };
}

interface ProviderHealthResponse {
  timestamp: string;
  providers: ProviderInfo[];
}

function statusColor(status: string): string {
  switch (status) {
    case "healthy": return "var(--green, #22c55e)";
    case "degraded": return "var(--yellow, #eab308)";
    case "failing": return "var(--red, #ef4444)";
    default: return "var(--text-muted, #6b7280)";
  }
}

function statusIcon(status: string): string {
  switch (status) {
    case "healthy": return "\u2713";
    case "degraded": return "\u26A0";
    case "failing": return "\u2717";
    default: return "-";
  }
}

function statusLabel(status: string): string {
  switch (status) {
    case "healthy": return "Healthy";
    case "degraded": return "Degraded";
    case "failing": return "Failing";
    default: return "Unknown";
  }
}

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  if (diff < 1000) return "just now";
  if (diff < 60_000) return `${Math.floor(diff / 1000)}s ago`;
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  return `${Math.floor(diff / 86_400_000)}d ago`;
}

function formatMs(ms: number): string {
  if (!ms || ms < 0) return "";
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

export function AdminProviderHealth() {
  const [data, setData] = useState<ProviderHealthResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [now, setNow] = useState(Date.now());
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchHealth = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const res = await api.adminProviderHealth();
      setData(res);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load provider health");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchHealth();
    intervalRef.current = setInterval(() => setNow(Date.now()), 10_000);
    return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
  }, [fetchHealth]);

  const allHealthy = data?.providers.every(p => p.models.every(m => m.status === "healthy")) ?? false;
  const anyFailing = data?.providers.some(p => p.models.some(m => m.status === "failing")) ?? false;
  const overallStatus = allHealthy ? "healthy" : anyFailing ? "failing" : "degraded";

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "12px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
          <h3 style={{ margin: 0 }}>Provider Health Dashboard</h3>
          <span style={{
            display: "inline-flex", alignItems: "center", gap: "6px",
            padding: "4px 12px", borderRadius: "6px", fontSize: "13px", fontWeight: 600,
            background: overallStatus === "healthy" ? "rgba(34,197,94,0.15)" : overallStatus === "failing" ? "rgba(239,68,68,0.15)" : "rgba(234,179,8,0.15)",
            color: statusColor(overallStatus),
          }}>
            {statusIcon(overallStatus)} {statusLabel(overallStatus)}
          </span>
        </div>
        <button onClick={fetchHealth} disabled={loading} style={{
          padding: "6px 14px", borderRadius: "6px", border: "1px solid var(--border-color)",
          background: "var(--bg-secondary)", color: "var(--text-bright)", cursor: "pointer",
          fontSize: "13px", display: "flex", alignItems: "center", gap: "6px",
        }}>
          {loading ? "Refreshing..." : "Refresh Now"}
        </button>
      </div>

      {data?.timestamp && (
        <p style={{ color: "var(--text-muted)", fontSize: "13px", marginBottom: "16px" }}>
          Last ping: {relativeTime(data.timestamp)} - {new Date(data.timestamp).toLocaleString()}
        </p>
      )}

      {error && (
        <div style={{ color: "#ef4444", background: "rgba(239,68,68,0.1)", padding: "10px 14px", borderRadius: "6px", marginBottom: "16px", fontSize: "14px" }}>
          {error}
        </div>
      )}

      {loading && !data && (
        <p style={{ color: "var(--text-muted)", padding: "20px 0" }}>Pinging providers...</p>
      )}

      {data && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(400px, 1fr))", gap: "12px" }}>
          {data.providers.map(provider => {
            const latencyColor = provider.latencyMs > 3000 ? "#ef4444" : provider.latencyMs > 1000 ? "#eab308" : "#22c55e";
            return (
            <div key={provider.id} style={{
              background: "var(--bg-secondary)", border: "1px solid var(--border-color)",
              borderRadius: "8px", padding: "14px",
            }}>
              <div style={{
                display: "flex", alignItems: "center", justifyContent: "space-between",
                marginBottom: "10px",
              }}>
                <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                  <strong style={{ fontSize: "14px" }}>{provider.name}</strong>
                  {provider.latencyMs >= 0 && (
                    <span style={{
                      fontSize: "11px", padding: "1px 6px", borderRadius: "4px",
                      background: `${latencyColor}1a`, color: latencyColor,
                      fontFamily: "monospace",
                    }}>
                      {formatMs(provider.latencyMs)}
                    </span>
                  )}
                </div>
                <span style={{
                  fontSize: "12px", padding: "2px 8px", borderRadius: "4px",
                  background: provider.reachable ? "rgba(34,197,94,0.15)" : "rgba(239,68,68,0.15)",
                  color: provider.reachable ? "#22c55e" : "#ef4444",
                }}>
                  {provider.reachable ? "reachable" : "unreachable"}
                </span>
              </div>
              {provider.error && (
                <p style={{ color: "#f87171", fontSize: "12px", marginBottom: "8px" }}>
                  {provider.error}
                </p>
              )}
              {provider.credits && (
                <div style={{
                  fontSize: "12px",
                  color: "var(--text-muted)",
                  marginBottom: "10px",
                  background: "rgba(255,255,255,0.02)",
                  padding: "8px 12px",
                  borderRadius: "6px",
                  border: "1px solid var(--border-color)",
                  display: "flex",
                  flexDirection: "column",
                  gap: "6px",
                }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <span>
                      <strong style={{ color: "var(--text-bright)", marginRight: "6px" }}>Balance:</strong>
                      {provider.id === "google-vertex" ? (
                        <span>
                          Check trial in{" "}
                          <a 
                            href="https://console.cloud.google.com/billing" 
                            target="_blank" 
                            rel="noopener noreferrer" 
                            style={{ 
                              color: "#60a5fa", 
                              textDecoration: "underline",
                            }}
                          >
                            Google Cloud Console
                          </a>
                        </span>
                      ) : provider.id === "yunwu" && provider.credits.isUnlimited ? (
                        <span style={{ color: "var(--text-bright)", fontWeight: 500 }}>
                          Unlimited
                        </span>
                      ) : provider.id === "yunwu" && provider.credits.remainingUsd !== undefined ? (
                        <span style={{ color: "#22c55e", fontWeight: 600 }}>
                          ${provider.credits.remainingUsd.toFixed(2)} remaining
                        </span>
                      ) : (
                        <span>{provider.credits.details}</span>
                      )}
                    </span>
                    {provider.id === "yunwu" && provider.credits.usedUsd !== undefined && (
                      <span style={{ fontSize: "11px", color: "var(--text-muted)" }}>
                        Used: ${provider.credits.usedUsd.toFixed(2)}
                      </span>
                    )}
                  </div>
                  {provider.id === "yunwu" && provider.credits.isUnlimited && (
                    <div style={{ fontSize: "11px", color: "var(--text-muted)", borderTop: "1px solid rgba(255,255,255,0.05)", paddingTop: "4px" }}>
                      Token quota is unlimited. Check master balance in{" "}
                      <a
                        href="https://yunwu.ai"
                        target="_blank"
                        rel="noopener noreferrer"
                        style={{ color: "#60a5fa", textDecoration: "underline" }}
                      >
                        Yunwu Dashboard
                      </a>
                    </div>
                  )}
                </div>
              )}
              {provider.models.map(model => (
                <div key={provider.id + ":" + model.id}>
                  <div style={{
                    display: "flex", alignItems: "center", justifyContent: "space-between",
                    padding: "6px 0", fontSize: "13px",
                    borderBottom: "1px solid var(--border-color)",
                  }}>
                    <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                      <span style={{
                        display: "inline-block", width: "8px", height: "8px",
                        borderRadius: "50%", background: statusColor(model.status),
                      }} />
                      {model.name}
                      {model.status === "unknown" && (
                        <span style={{ color: "var(--text-muted)", fontSize: "11px" }}>(not tested)</span>
                      )}
                    </div>
                    <span style={{ fontSize: "12px", color: statusColor(model.status) }}>
                      {statusLabel(model.status)}
                    </span>
                  </div>
                  {model.note && (
                    <p style={{ color: "var(--text-muted)", fontSize: "12px", margin: "2px 0 4px 14px" }}>
                      {model.note}
                    </p>
                  )}
                </div>
              ))}
              {provider.models.length === 0 && (
                <p style={{ color: "var(--text-muted)", fontSize: "13px" }}>No models configured for this provider</p>
              )}
            </div>
          );})}
        </div>
      )}

      <p style={{ color: "var(--text-muted)", fontSize: "12px", marginTop: "20px" }}>
        Connectivity checks ping provider API endpoints only - no AI tokens consumed. Latency shown per provider badge.
        For full end-to-end completion tests, use Model Evaluations tab.
      </p>
    </div>
  );
}
