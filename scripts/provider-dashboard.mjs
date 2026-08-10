#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { performance } from "node:perf_hooks";

import { loadEnv } from "./load-env.mjs";

loadEnv();

const scriptPath = fileURLToPath(import.meta.url);
const root = resolve(dirname(scriptPath), "..");
const historyDir = resolve(root, ".provider-health");
const historyPath = resolve(historyDir, "history.json");
const outputPath = resolve(root, "provider-health.html");

const HISTORY_MAX = 50;

/* ------------------------------------------------------------------ */
/*  Provider definitions                                               */
/* ------------------------------------------------------------------ */

const PROVIDERS = [
  {
    id: "yunwu",
    name: "Yunwu API",
    docs: "Relays supported OpenAI-compatible models",
    connectivityUrl: "https://yunwu.ai/v1/models",
    authHeader: "Authorization",
    authPrefix: "Bearer ",
    envKey: "YUNWU_API_KEY",
    envKey2: "YUNWU_API_KEYS",
    models: [
      { id: "gpt-5.5",                name: "GPT-5.5",                status: "unknown", note: "" },
      { id: "qwen3.7-max",            name: "Qwen3.7 Max",            status: "unknown", note: "" },
      { id: "claude-opus-4-8",        name: "Claude Opus 4.8",        status: "unknown", note: "" },
      { id: "gemini-3.1-pro-preview", name: "Gemini 3.1 Pro Preview", status: "unknown", note: "" },
      { id: "gemini-3.5-flash",       name: "Gemini 3.5 Flash",       status: "unknown", note: "" },
      { id: "deepseek-v4-flash",      name: "DeepSeek V4 Flash",      status: "unknown", note: "" },
    ]
  },
  {
    id: "google-vertex",
    name: "Google Vertex AI",
    docs: "Direct Google Cloud Vertex AI API (Gemini models)",
    connectivityUrl: "ADC-based (gcloud auth application-default login)",
    authHeader: "Authorization",
    authPrefix: "Bearer ",
    envKey: "GOOGLE_CLOUD_PROJECT",
    customCheck: true,
    models: [
      { id: "gemini-3-flash-preview", name: "Gemini 3 Flash",   status: "unknown", note: "Vertex direct" },
      { id: "gemini-3.5-flash",       name: "Gemini 3.5 Flash", status: "unknown", note: "Vertex direct" },
      { id: "gemini-3.1-pro-preview", name: "Gemini 3.1 Pro",   status: "unknown", note: "Vertex direct" },
    ]
  },
  {
    id: "deepseek-official",
    name: "DeepSeek Official",
    docs: "Direct API",
    connectivityUrl: "https://api.deepseek.com/v1/models",
    authHeader: "Authorization",
    authPrefix: "Bearer ",
    envKey: "DEEPSEEK_API_KEY",
    models: [
      { id: "deepseek-v4-flash", name: "DeepSeek V4 Flash", status: "unknown", note: "" },
      { id: "deepseek-v4-pro",   name: "DeepSeek V4 Pro",   status: "unknown", note: "" },
    ]
  },
  {
    id: "mimo",
    name: "Xiaomi",
    docs: "Xiaomi API",
    connectivityUrl: "https://api.xiaomimimo.com/v1/models",
    authHeader: "api-key",
    authPrefix: "",
    envKey: "XIAOMI_API_KEY",
    models: [
      { id: "mimo-v2.5-pro", name: "MiMo V2.5 Pro", status: "unknown", note: "" },
    ]
  },
];

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function colorForStatus(status) {
  switch (status) {
    case "healthy": return "#22c55e";
    case "degraded": return "#eab308";
    case "failing": return "#ef4444";
    default: return "#6b7280";
  }
}

function iconForStatus(status) {
  switch (status) {
    case "healthy": return "&#10003;";
    case "degraded": return "&#9888;";
    case "failing": return "&#10007;";
    default: return "-";
  }
}

function labelForStatus(status) {
  switch (status) {
    case "healthy": return "Healthy";
    case "degraded": return "Degraded";
    case "failing": return "Failing";
    default: return "Unknown";
  }
}

function formatDuration(ms) {
  if (!ms) return "";
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}



async function checkConnectivity(provider) {
  if (provider.id === "google-vertex") {
    const projectId = process.env.GOOGLE_CLOUD_PROJECT;
    if (!projectId) return { reachable: false, latencyMs: 0, error: "No GOOGLE_CLOUD_PROJECT set" };
    const location = process.env.GOOGLE_CLOUD_LOCATION || "us-central1";
    const start = performance.now();
    try {
      const { GoogleAuth } = await import("google-auth-library");
      const auth = new GoogleAuth({ scopes: ["https://www.googleapis.com/auth/cloud-platform"] });
      const client = await auth.getClient();
      const tokenResponse = await client.getAccessToken();
      if (!tokenResponse.token) {
        throw new Error("Failed to obtain access token from ADC");
      }
      const host = location === "global" ? "aiplatform.googleapis.com" : `${location}-aiplatform.googleapis.com`;
      const model = location === "global" ? "gemini-3.5-flash" : "gemini-2.5-flash";
      const endpoint = `https://${host}/v1/projects/${projectId}/locations/${location}/publishers/google/models/${model}:generateContent`;
      const res = await fetch(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${tokenResponse.token}`
        },
        body: JSON.stringify({ contents: [{ role: "user", parts: [{ text: "hi" }] }] })
      });
      const latencyMs = Math.round(performance.now() - start);
      let error = null;
      if (!res.ok) {
        const bodyText = await res.text().catch(() => "");
        error = `HTTP ${res.status} - ${bodyText}`;
      }
      return { reachable: res.ok, latencyMs, error };
    } catch (err) {
      return { reachable: false, latencyMs: Math.round(performance.now() - start), error: err.message };
    }
  }

  if (!provider.connectivityUrl || !provider.envKey) {
    return { reachable: true, latencyMs: 0, error: null };
  }
  const apiKey = process.env[provider.envKey] || (provider.envKey2 ? process.env[provider.envKey2] : null);
  if (!apiKey) return { reachable: false, latencyMs: 0, error: `No ${provider.envKey} set` };

  const start = performance.now();
  try {
    const headers = {
      "Content-Type": "application/json",
    };
    if (provider.authHeader === "api-key") {
      headers["api-key"] = apiKey;
    } else {
      headers[provider.authHeader] = `${provider.authPrefix}${apiKey}`;
    }
    const res = await fetch(provider.connectivityUrl, {
      headers,
      signal: AbortSignal.timeout(10_000),
    });
    const latencyMs = Math.round(performance.now() - start);
    return { reachable: res.ok, latencyMs, error: res.ok ? null : `HTTP ${res.status}` };
  } catch (err) {
    return { reachable: false, latencyMs: Math.round(performance.now() - start), error: err.message };
  }
}

/* ------------------------------------------------------------------ */
/*  History                                                            */
/* ------------------------------------------------------------------ */

function loadHistory() {
  try {
    return JSON.parse(readFileSync(historyPath, "utf8"));
  } catch {
    return [];
  }
}

function saveHistory(history) {
  try { mkdirSync(historyDir, { recursive: true }); } catch {}
  writeFileSync(historyPath, JSON.stringify(history, null, 2), "utf8");
}

/* ------------------------------------------------------------------ */
/*  HTML generation                                                    */
/* ------------------------------------------------------------------ */

function renderProviderCard(p) {
  const connOk = p.connectivity.reachable;
  const badge = `<span class="reachable ${connOk ? "ok" : "fail"}">${connOk ? "API reachable" : "API unreachable"}${formatDuration(p.connectivity.latencyMs) ? " " + formatDuration(p.connectivity.latencyMs) : ""}</span>`;
  const connError = p.connectivity.error ? `<div class="note">&#9888; ${p.connectivity.error}</div>` : "";
  const models = p.models.map(m => {
    const note = m.note ? `<div class="note">${m.note}</div>` : "";
    return `<div class="model-item">
      <div class="model-status">
        <span class="dot" style="background:${colorForStatus(m.status)}"></span>
        ${m.name}
        ${m.status === "unknown" ? '<span class="model-unknown">(not tested)</span>' : ""}
      </div>
      <div class="model-label">${labelForStatus(m.status)}</div>
    </div>${note}`;
  }).join("");
  return `<div class="card">
    <div class="card-header">
      <h2>${p.name}</h2>
      ${badge}
    </div>
    ${connError}
    ${models}
  </div>`;
}

function renderDashboard(snapshot, history) {
  const allHealthy = snapshot.results.every(r => r.models.every(m => m.status === "healthy"));
  const anyFailing = snapshot.results.some(r => r.models.some(m => m.status === "failing"));
  const overallStatus = allHealthy ? "healthy" : anyFailing ? "failing" : "degraded";

  const bars = history.slice(-HISTORY_MAX).map(entry => {
    const worst = entry.results.some(r => r.models.some(m => m.status === "failing")) ? "failing"
                : entry.results.some(r => r.models.some(m => m.status === "degraded")) ? "degraded"
                : entry.results.some(r => r.models.some(m => m.status === "healthy")) ? "healthy"
                : "unknown";
    return `<div class="bar ${worst}" style="height:${worst === "failing" ? 40 : worst === "degraded" ? 25 : 15}px" title="${entry.timestamp}: ${worst}"></div>`;
  }).join("");

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>VectisCode Provider Health</title>
<style>
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, monospace;
    background: #0f172a; color: #e2e8f0; padding: 2rem; line-height: 1.5;
  }
  h1 { font-size: 1.5rem; }
  .subtitle { color: #94a3b8; font-size: 0.875rem; margin-top: 0.25rem; margin-bottom: 2rem; }
  .overall-banner {
    display: inline-flex; align-items: center; gap: 0.5rem;
    padding: 0.5rem 1rem; border-radius: 6px; font-weight: 600; margin-bottom: 1.5rem;
    background: ${overallStatus === "healthy" ? "#052e16" : overallStatus === "failing" ? "#450a0a" : "#422006"};
    color: ${overallStatus === "healthy" ? "#86efac" : overallStatus === "failing" ? "#fca5a5" : "#fde68a"};
  }
  .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(380px, 1fr)); gap: 1rem; margin-bottom: 2rem; }
  .card {
    background: #1e293b; border: 1px solid #334155; border-radius: 8px; padding: 1rem;
  }
  .card-header {
    display: flex; align-items: center; justify-content: space-between; margin-bottom: 0.75rem;
  }
  .card-header h2 { font-size: 1.125rem; }
  .reachable {
    font-size: 0.75rem; padding: 0.125rem 0.5rem; border-radius: 4px; white-space: nowrap;
    background: #334155; color: #94a3b8;
  }
  .reachable.ok { background: #052e16; color: #86efac; }
  .reachable.fail { background: #450a0a; color: #fca5a5; }
  .model-item {
    display: flex; align-items: center; justify-content: space-between;
    padding: 0.5rem 0; border-bottom: 1px solid #0f172a; font-size: 0.875rem;
  }
  .model-item:last-of-type { border-bottom: none; }
  .model-status { display: flex; align-items: center; gap: 0.375rem; }
  .model-status .dot { display: inline-block; width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0; }
  .model-unknown { color: #64748b; font-size: 0.75rem; margin-left: 0.25rem; }
  .model-label { font-size: 0.75rem; }
  .note { color: #94a3b8; font-size: 0.75rem; margin-top: 0.125rem; margin-bottom: 0.25rem; padding-left: 0; }
  .history-section { margin-top: 2rem; }
  .history-section h3 { font-size: 1rem; margin-bottom: 0.75rem; color: #94a3b8; }
  .history-chart { display: flex; align-items: flex-end; gap: 2px; height: 40px; }
  .history-chart .bar { width: 8px; border-radius: 2px 2px 0 0; transition: height 0.3s; flex-shrink: 0; }
  .bar.healthy { background: #22c55e; }
  .bar.degraded { background: #eab308; }
  .bar.failing { background: #ef4444; }
  .bar.unknown { background: #6b7280; }
  .legend { display: flex; gap: 1rem; margin-top: 0.75rem; font-size: 0.75rem; color: #94a3b8; }
  .legend span { display: flex; align-items: center; gap: 0.25rem; }
  .legend .swatch { display: inline-block; width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0; }
  .footer { margin-top: 2rem; color: #475569; font-size: 0.75rem; text-align: center; }
  .info-box {
    background: #1e293b; border: 1px solid #334155; border-radius: 6px; padding: 0.75rem; margin-bottom: 1rem;
    font-size: 0.875rem; color: #94a3b8; line-height: 1.6;
  }
  .info-box code { background: #0f172a; padding: 0.125rem 0.25rem; border-radius: 3px; }
</style>
</head>
<body>
  <h1>VectisCode Provider Health</h1>
  <p class="subtitle">Last checked: ${snapshot.timestamp}</p>
  <div class="overall-banner">
    ${iconForStatus(overallStatus)} Overall: ${labelForStatus(overallStatus)}
  </div>

  <div class="info-box">
    <strong>Connectivity:</strong> API endpoint pings (no AI completions). Models marked "unknown" need a real completion test.<br>
    For full end-to-end tests: <code>npm run smoke:models</code><br>
    To refresh this dashboard: <code>node scripts/provider-dashboard.mjs</code>
  </div>

  <div class="grid">
    ${snapshot.results.map(renderProviderCard).join("")}
  </div>

  ${history.length > 1 ? `
  <div class="history-section">
    <h3>Health History (last ${Math.min(history.length, HISTORY_MAX)} checks)</h3>
    <div class="history-chart">${bars}</div>
    <div class="legend">
      <span><span class="swatch" style="background:#22c55e"></span> All healthy</span>
      <span><span class="swatch" style="background:#eab308"></span> Degraded</span>
      <span><span class="swatch" style="background:#ef4444"></span> Failing</span>
    </div>
  </div>` : ""}

  <div class="footer">
    VectisCode &middot; Generated by scripts/provider-dashboard.mjs
  </div>
</body>
</html>`;
}

/* ------------------------------------------------------------------ */
/*  Main                                                              */
/* ------------------------------------------------------------------ */

async function main() {
  console.log("VectisCode Provider Health Dashboard");
  console.log("Checking provider connectivity...\n");



  const results = [];
  for (const provider of PROVIDERS) {
    process.stdout.write(`  ${provider.name}... `);
    const connectivity = await checkConnectivity(provider);
    console.log(connectivity.reachable ? "OK" : `FAIL (${connectivity.error})`);

    // Dynamically update model statuses based on connectivity results
    const status = connectivity.reachable ? "healthy" : "failing";
    provider.models.forEach(m => {
      if (!provider.customCheck) {
        m.status = status;
        m.note = connectivity.reachable
          ? (provider.id === "yunwu" ? "Yunwu route" : provider.id === "deepseek-official" ? "Direct API, no NVIDIA queue" : "")
          : (connectivity.error || "API unreachable");
      }
    });

    results.push({ name: provider.name, connectivity, models: provider.models });
  }

  const snapshot = {
    timestamp: new Date().toISOString().replace("T", " ").slice(0, 19),
    results,
  };

  const history = loadHistory();
  history.push(snapshot);
  while (history.length > HISTORY_MAX) history.shift();
  saveHistory(history);

  const html = renderDashboard(snapshot, history);
  writeFileSync(outputPath, html, "utf8");

  console.log(`\nDashboard written to provider-health.html`);
  console.log("Open in a browser to view provider status.");
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
