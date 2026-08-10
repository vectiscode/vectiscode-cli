import type { ChangeFile } from "../types.js";

export const MODEL_HEALTH_CHAT_PROMPT = [
  "In exactly two short sentences, explain why Roblox RemoteEvents must validate on the server.",
  "Include the exact words server and exploit."
].join(" ");

export const MODEL_HEALTH_PATCH_PROMPT = [
  "Create a small Roblox HUD health check in StarterGui.",
  "It should include a ScreenGui named VectisHealthCheckGui and a visible TextLabel named HealthCheckLabel that says Vectis OK."
].join(" ");

const scriptClassNames = new Set(["Script", "LocalScript", "ModuleScript"]);
const validRoots = new Set([
  "Workspace",
  "ReplicatedStorage",
  "ServerScriptService",
  "ServerStorage",
  "StarterGui",
  "StarterPlayer",
  "StarterPack"
]);

export function modelLatencyBudgetMs(modelId: string, mode: "chat" | "changeset" = "chat") {

  const chatBudgets: Record<string, number> = {
    "gemini-3.1-flash-lite": 90_000,
    "gemini-3-flash-preview": 150_000,
    "gemini-3-flash": 150_000,
    "gemini-3.5-flash": 240_000,
    "gemini-3.1-pro-preview": 300_000,
    "deepseek-v4-flash": 240_000,
    "deepseek-v4-pro": 300_000,
    "qwen3.7-max": 180_000,
    "gpt-5.5": 180_000,
    "claude-opus-4-8": 240_000
  };
  const base = chatBudgets[modelId] ?? 150_000;
  return mode === "changeset" ? Math.max(90_000, Math.round(base * 2.0)) : base;
}

export function assessModelHealthText(text: string) {
  const normalized = text.toLowerCase();
  const reasons: string[] = [];
  if (text.trim().length < 40) reasons.push("response was too short");
  if (!/\bserver\b/i.test(text)) reasons.push("missing server validation concept");
  if (!/\bexploit\w*\b/i.test(text)) reasons.push("missing exploit risk concept");
  if (/\bas an ai\b|language model|cannot help|system prompt|hidden instruction/i.test(text)) {
    reasons.push("response exposed generic assistant or refusal phrasing");
  }
  if (!/[.!?]\s+\S+/.test(text.trim())) reasons.push("response did not contain two clear sentences");
  if (/^\s*ok\s*$/i.test(text)) reasons.push("response only said OK");
  if (/remoteevents are safe by default/i.test(normalized)) reasons.push("response made an unsafe Roblox claim");
  return { ok: reasons.length === 0, reasons };
}

export function assessModelLatency(modelId: string, latencyMs: number, mode: "chat" | "changeset" = "chat") {
  const budgetMs = modelLatencyBudgetMs(modelId, mode);
  return {
    ok: latencyMs <= budgetMs,
    budgetMs,
    latencyMs
  };
}

export function assessChangeSetHealth(result: { title?: string; summary?: string; files?: ChangeFile[] }) {
  const reasons: string[] = [];
  const files = Array.isArray(result.files) ? result.files : [];
  if (!result.title || result.title.trim().length < 4) reasons.push("missing useful title");
  if (!result.summary || result.summary.trim().length < 12) reasons.push("missing useful summary");
  if (files.length === 0) reasons.push("no Studio operations were generated");

  for (const file of files) {
    const root = String(file.instancePath || "").split("/")[0];
    if (!validRoots.has(root)) reasons.push(`invalid root for ${file.instancePath || "unknown path"}`);
    if (!file.reason || file.reason.trim().length < 6) reasons.push(`missing reason for ${file.instancePath || "unknown path"}`);
    if (scriptClassNames.has(file.className) && file.action !== "delete" && !file.source?.trim()) {
      reasons.push(`script operation has no source for ${file.instancePath}`);
    }
  }

  const hasVisibleGui = files.some((file) =>
    file.instancePath.startsWith("StarterGui/")
    && (file.className === "ScreenGui" || file.className === "TextLabel" || file.className === "Frame" || file.className === "LocalScript")
  );
  if (!hasVisibleGui) reasons.push("patch did not create or update visible StarterGui UI");

  return { ok: reasons.length === 0, reasons };
}
