#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { performance } from "node:perf_hooks";
import { fileURLToPath } from "node:url";

const scriptPath = fileURLToPath(import.meta.url);
const root = resolve(dirname(scriptPath), "..");
const distConfig = new URL("../apps/api/dist/services/config.js", import.meta.url);

function argValue(name, fallback = "") {
  const prefix = `${name}=`;
  const match = process.argv.slice(2).find((arg) => arg.startsWith(prefix));
  return match ? match.slice(prefix.length) : fallback;
}

function hasFlag(name) {
  return process.argv.includes(name);
}

function loadNvidiaSecretIfAvailable() {
  if (process.env.NVIDIA_API_KEY || process.env.NVIDIA_API_KEYS || process.env.NVIDIA_NIM_API_KEY) return;
  // Secrets are loaded from the local or Hugging Face environment only.
}

function formatSeconds(ms) {
  return `${(ms / 1000).toFixed(1)}s`;
}

function withTimeout(promise, timeoutMs, label) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} did not finish within ${formatSeconds(timeoutMs)}`)), timeoutMs);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

if (!existsSync(distConfig)) {
  console.error("apps/api/dist is missing. Run npm run build before npm run smoke:thinking.");
  process.exit(1);
}

loadNvidiaSecretIfAvailable();

const {
  getThinkingControlMode,
  getThinkingLevel,
  getThinkingMultiplier,
  runtimeAiModels
} = await import("../apps/api/dist/services/config.js");
const { answerProjectQuestion, generateSafeChangeSet } = await import("../apps/api/dist/services/aiProvider.js");
const {
  MODEL_HEALTH_CHAT_PROMPT,
  MODEL_HEALTH_PATCH_PROMPT,
  assessChangeSetHealth,
  assessModelHealthText,
  assessModelLatency,
  modelLatencyBudgetMs
} = await import("../apps/api/dist/services/modelHealth.js");

const availableModels = runtimeAiModels().filter((model) => model.status === "available").map((model) => model.id);
const requestedModels = argValue("--models")
  ? argValue("--models").split(",").map((model) => model.trim()).filter(Boolean)
  : availableModels;
const requestedLevels = argValue("--levels")
  ? argValue("--levels").split(",").map((level) => level.trim()).filter(Boolean)
  : null;
const includePatch = hasFlag("--patch");
const jsonOutput = hasFlag("--json");
const workerMode = hasFlag("--worker");
const strictSpeed = hasFlag("--strict-speed");
const providerTimeoutOverride = Number(argValue("--timeout-ms", "0"));

const dummyProject = {
  id: "thinking_matrix_project",
  organizationId: "thinking_matrix_org",
  name: "Thinking Matrix Smoke",
  template: "obby",
  description: "Temporary provider thinking smoke project",
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString()
};

const defaultPreferences = {
  thinkingGemini3Flash: "none",
  thinkingGemini35Flash: "low",
  thinkingGemini31FlashLite: "none",
  thinkingGemini31Pro: "low",
  thinkingDeepSeekV4Flash: "none",
  thinkingDeepSeekV4Pro: "none",
  thinkingGlm51: "none",
  thinkingGpt55: "medium",
  thinkingQwen: "high",
  thinkingOpus: "high",
  thinkingMiMoPro: "none"
};

function levelsFor(modelId) {
  if (requestedLevels) return requestedLevels;
  if (modelId === "deepseek-v4-flash" || modelId === "deepseek-v4-pro") return ["none", "high", "max"];
  if (modelId === "qwen3.7-max" || modelId === "mimo-v2.5-pro" || modelId === "glm-5.1") return ["none", "high"];
  if (modelId === "gemini-3.1-pro-preview") return ["low", "medium", "high"];
  if (modelId === "gpt-5.5") return ["none", "low", "medium", "high", "xhigh"];
  if (modelId === "claude-opus-4-8") return ["none", "low", "medium", "high", "xhigh", "max"];
  return ["none", "low", "medium", "high"];
}

function preferencesFor(modelId, level) {
  const preferences = { ...defaultPreferences };
  if (modelId === "gemini-3.5-flash") preferences.thinkingGemini35Flash = level;
  if (modelId === "gemini-3-flash-preview" || modelId === "gemini-3-flash") preferences.thinkingGemini3Flash = level;
  if (modelId === "gemini-3.1-pro-preview") preferences.thinkingGemini31Pro = level;
  if (modelId === "gemini-3.1-flash-lite") preferences.thinkingGemini31FlashLite = level;
  if (modelId === "deepseek-v4-flash") preferences.thinkingDeepSeekV4Flash = level;
  if (modelId === "deepseek-v4-pro") preferences.thinkingDeepSeekV4Pro = level;
  if (modelId === "glm-5.1") preferences.thinkingGlm51 = level;
  if (modelId === "gpt-5.5") preferences.thinkingGpt55 = level;
  if (modelId === "qwen3.7-max") preferences.thinkingQwen = level;
  if (modelId === "claude-opus-4-8") preferences.thinkingOpus = level;
  if (modelId === "mimo-v2.5-pro") preferences.thinkingMiMoPro = level;
  return preferences;
}

function timeoutFor(modelId, mode, multiplier) {
  if (providerTimeoutOverride) return providerTimeoutOverride;
  const budgetMs = modelLatencyBudgetMs(modelId, mode);
  const base = mode === "chat" ? 60_000 : 120_000;
  return Math.max(base, Math.round(budgetMs * Math.max(2, multiplier + 1)));
}

function statusFor(result) {
  if (!result.reachable) return "FAIL";
  if (!result.qualityOk) return "FAIL";
  if (strictSpeed && !result.speedOk) return "FAIL";
  if (!result.speedOk) return "WARN";
  return "PASS";
}

async function runChat(modelId, requestedLevel) {
  const preferences = preferencesFor(modelId, requestedLevel);
  const effectiveLevel = getThinkingLevel(modelId, preferences);
  const multiplier = getThinkingMultiplier(modelId, "chat", preferences);
  const budgetMs = modelLatencyBudgetMs(modelId, "chat");
  const timeoutMs = timeoutFor(modelId, "chat", multiplier);
  const started = performance.now();

  try {
    const response = await withTimeout(answerProjectQuestion({
      project: dummyProject,
      prompt: MODEL_HEALTH_CHAT_PROMPT,
      model: modelId,
      preferences,
      providerTimeoutMs: timeoutMs
    }), timeoutMs, `${modelId} ${requestedLevel} chat smoke`);
    const latencyMs = Math.round(performance.now() - started);
    const quality = assessModelHealthText(response.text);
    const latency = assessModelLatency(modelId, latencyMs, "chat");
    return {
      mode: "chat",
      modelId,
      requestedLevel,
      effectiveLevel,
      thinkingControlMode: getThinkingControlMode(modelId),
      thinkingMultiplier: multiplier,
      reachable: true,
      qualityOk: quality.ok,
      speedOk: latency.ok,
      latencyMs,
      latencyBudgetMs: budgetMs,
      timeoutMs,
      issues: [...quality.reasons, ...(latency.ok ? [] : [`slower than ${formatSeconds(budgetMs)} budget`])],
      sample: response.text.slice(0, 180)
    };
  } catch (error) {
    return {
      mode: "chat",
      modelId,
      requestedLevel,
      effectiveLevel,
      thinkingControlMode: getThinkingControlMode(modelId),
      thinkingMultiplier: multiplier,
      reachable: false,
      qualityOk: false,
      speedOk: false,
      latencyMs: Math.round(performance.now() - started),
      latencyBudgetMs: budgetMs,
      timeoutMs,
      issues: [error instanceof Error ? error.message : String(error)]
    };
  }
}

async function runPatch(modelId, requestedLevel) {
  const preferences = preferencesFor(modelId, requestedLevel);
  const effectiveLevel = getThinkingLevel(modelId, preferences);
  const multiplier = getThinkingMultiplier(modelId, "changeset", preferences);
  const budgetMs = modelLatencyBudgetMs(modelId, "changeset");
  const timeoutMs = timeoutFor(modelId, "changeset", multiplier);
  const started = performance.now();

  try {
    const response = await withTimeout(generateSafeChangeSet({
      project: dummyProject,
      prompt: MODEL_HEALTH_PATCH_PROMPT,
      model: modelId,
      preferences,
      providerTimeoutMs: timeoutMs,
      maxRepairAttempts: 0
    }), timeoutMs, `${modelId} ${requestedLevel} patch smoke`);
    const latencyMs = Math.round(performance.now() - started);
    const quality = assessChangeSetHealth(response);
    const latency = assessModelLatency(modelId, latencyMs, "changeset");
    return {
      mode: "changeset",
      modelId,
      requestedLevel,
      effectiveLevel,
      thinkingControlMode: getThinkingControlMode(modelId),
      thinkingMultiplier: multiplier,
      reachable: true,
      qualityOk: quality.ok,
      speedOk: latency.ok,
      latencyMs,
      latencyBudgetMs: budgetMs,
      timeoutMs,
      issues: [...quality.reasons, ...(latency.ok ? [] : [`slower than ${formatSeconds(budgetMs)} budget`])],
      fileCount: response.files.length,
      sample: `${response.title}: ${response.summary}`.slice(0, 180)
    };
  } catch (error) {
    return {
      mode: "changeset",
      modelId,
      requestedLevel,
      effectiveLevel,
      thinkingControlMode: getThinkingControlMode(modelId),
      thinkingMultiplier: multiplier,
      reachable: false,
      qualityOk: false,
      speedOk: false,
      latencyMs: Math.round(performance.now() - started),
      latencyBudgetMs: budgetMs,
      timeoutMs,
      issues: [error instanceof Error ? error.message : String(error)]
    };
  }
}

function parseWorkerOutput(output) {
  const lines = String(output || "").trim().split(/\r?\n/).filter(Boolean);
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    try {
      return JSON.parse(lines[i]);
    } catch {
      // Keep scanning in case a provider wrote logs before the JSON result.
    }
  }
  return undefined;
}

function runWorker(modelId, requestedLevel, mode) {
  const preferences = preferencesFor(modelId, requestedLevel);
  const multiplier = getThinkingMultiplier(modelId, mode, preferences);
  const timeoutMs = timeoutFor(modelId, mode, multiplier);
  const args = [
    scriptPath,
    "--worker",
    `--model=${modelId}`,
    `--level=${requestedLevel}`,
    `--mode=${mode}`,
    ...(strictSpeed ? ["--strict-speed"] : []),
    ...(providerTimeoutOverride ? [`--timeout-ms=${providerTimeoutOverride}`] : [])
  ];
  const started = performance.now();
  try {
    const output = execFileSync(process.execPath, args, {
      cwd: root,
      env: process.env,
      encoding: "utf8",
      timeout: timeoutMs + 10_000,
      stdio: ["ignore", "pipe", "pipe"]
    });
    return parseWorkerOutput(output);
  } catch (error) {
    const parsed = parseWorkerOutput(error?.stdout);
    if (parsed) return parsed;
    return {
      mode,
      modelId,
      requestedLevel,
      effectiveLevel: getThinkingLevel(modelId, preferences),
      thinkingControlMode: getThinkingControlMode(modelId),
      thinkingMultiplier: multiplier,
      reachable: false,
      qualityOk: false,
      speedOk: false,
      latencyMs: Math.round(performance.now() - started),
      latencyBudgetMs: modelLatencyBudgetMs(modelId, mode),
      timeoutMs,
      issues: [error?.killed ? "worker process timed out" : (error instanceof Error ? error.message : String(error))]
    };
  }
}

if (workerMode) {
  const modelId = argValue("--model");
  const requestedLevel = argValue("--level", "none");
  const mode = argValue("--mode", "chat");
  const result = mode === "changeset" ? await runPatch(modelId, requestedLevel) : await runChat(modelId, requestedLevel);
  console.log(JSON.stringify(result));
  process.exit(statusFor(result) === "FAIL" ? 1 : 0);
}

const results = [];
for (const modelId of requestedModels) {
  for (const level of levelsFor(modelId)) {
    results.push(runWorker(modelId, level, "chat"));
    if (includePatch) {
      results.push(runWorker(modelId, level, "changeset"));
    }
  }
}

if (jsonOutput) {
  console.log(JSON.stringify({ results }, null, 2));
} else {
  for (const result of results) {
    const status = statusFor(result);
    const issues = result.issues.length ? ` issues=${result.issues.join("; ")}` : "";
    const files = typeof result.fileCount === "number" ? ` files=${result.fileCount}` : "";
    console.log(`${status} ${result.mode} ${result.modelId} requested=${result.requestedLevel} effective=${result.effectiveLevel} control=${result.thinkingControlMode} multiplier=${result.thinkingMultiplier} latency=${formatSeconds(result.latencyMs)} budget=${formatSeconds(result.latencyBudgetMs)} timeout=${formatSeconds(result.timeoutMs)}${files}${issues}`);
  }
}

if (results.some((result) => statusFor(result) === "FAIL")) {
  process.exitCode = 1;
}
