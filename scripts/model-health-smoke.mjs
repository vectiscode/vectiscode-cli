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

function statusLabel(result) {
  if (!result.reachable) return "FAIL";
  if (!result.qualityOk) return "FAIL";
  if (!result.speedOk && result.speedRequired) return "FAIL";
  if (!result.speedOk) return "WARN";
  return "PASS";
}

function resultFailed(result) {
  const status = statusLabel(result);
  return status === "FAIL";
}

function speedRequiredFor(modelId, mode) {
  return true;
}

function withTimeout(promise, timeoutMs, label) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} did not finish within ${formatSeconds(timeoutMs)}`)), timeoutMs);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

if (!existsSync(distConfig)) {
  console.error("apps/api/dist is missing. Run npm run build before npm run smoke:models.");
  process.exit(1);
}

loadNvidiaSecretIfAvailable();

const { runtimeAiModels } = await import("../apps/api/dist/services/config.js");
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
const includePatch = hasFlag("--patch");
const strictSpeed = hasFlag("--strict-speed");
const jsonOutput = hasFlag("--json");
const providerTimeoutOverride = Number(argValue("--timeout-ms", "0"));
const workerMode = hasFlag("--worker");
const retries = Math.max(0, Number(argValue("--retries", "1")));

const dummyProject = {
  id: "smoke_project",
  organizationId: "smoke_org",
  name: "Model Health Smoke",
  template: "obby",
  description: "Temporary provider smoke project",
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString()
};

const fastPreferences = {
  thinkingGemini3Flash: "none",
  thinkingGemini35Flash: "low",
  thinkingGemini31FlashLite: "none",
  thinkingGemini31Pro: "low",
  thinkingDeepSeekV4Flash: "none",
  thinkingDeepSeekV4Pro: "none",
  thinkingGlm51: "none"
};

async function runChat(modelId) {
  const budgetMs = modelLatencyBudgetMs(modelId, "chat");
  const timeoutMs = providerTimeoutOverride || Math.max(60_000, budgetMs * 2);
  const started = performance.now();
  try {
    const response = await withTimeout(answerProjectQuestion({
      project: dummyProject,
      prompt: MODEL_HEALTH_CHAT_PROMPT,
      model: modelId,
      preferences: fastPreferences,
      providerTimeoutMs: timeoutMs
    }), timeoutMs, `${modelId} chat smoke`);
    const latencyMs = Math.round(performance.now() - started);
    const quality = assessModelHealthText(response.text);
    const latency = assessModelLatency(modelId, latencyMs, "chat");
    return {
      mode: "chat",
      modelId,
      reachable: true,
      qualityOk: quality.ok,
      speedOk: latency.ok,
      speedRequired: speedRequiredFor(modelId, "chat"),
      latencyMs,
      latencyBudgetMs: latency.budgetMs,
      issues: [...quality.reasons, ...(latency.ok ? [] : [`slower than ${formatSeconds(latency.budgetMs)} budget`])],
      sample: response.text.slice(0, 180)
    };
  } catch (error) {
    return {
      mode: "chat",
      modelId,
      reachable: false,
      qualityOk: false,
      speedOk: false,
      speedRequired: speedRequiredFor(modelId, "chat"),
      latencyMs: Math.round(performance.now() - started),
      latencyBudgetMs: budgetMs,
      issues: [error instanceof Error ? error.message : String(error)]
    };
  }
}

async function runPatch(modelId) {
  const budgetMs = modelLatencyBudgetMs(modelId, "changeset");
  const timeoutMs = providerTimeoutOverride || Math.max(120_000, budgetMs * 2);
  const started = performance.now();
  try {
    const response = await withTimeout(generateSafeChangeSet({
      project: dummyProject,
      prompt: MODEL_HEALTH_PATCH_PROMPT,
      model: modelId,
      preferences: fastPreferences,
      providerTimeoutMs: timeoutMs,
      maxRepairAttempts: 0
    }), timeoutMs, `${modelId} patch smoke`);
    const latencyMs = Math.round(performance.now() - started);
    const quality = assessChangeSetHealth(response);
    const latency = assessModelLatency(modelId, latencyMs, "changeset");
    return {
      mode: "changeset",
      modelId,
      reachable: true,
      qualityOk: quality.ok,
      speedOk: latency.ok,
      speedRequired: speedRequiredFor(modelId, "changeset"),
      latencyMs,
      latencyBudgetMs: latency.budgetMs,
      issues: [...quality.reasons, ...(latency.ok ? [] : [`slower than ${formatSeconds(latency.budgetMs)} budget`])],
      fileCount: response.files.length,
      sample: `${response.title}: ${response.summary}`.slice(0, 180)
    };
  } catch (error) {
    return {
      mode: "changeset",
      modelId,
      reachable: false,
      qualityOk: false,
      speedOk: false,
      speedRequired: speedRequiredFor(modelId, "changeset"),
      latencyMs: Math.round(performance.now() - started),
      latencyBudgetMs: budgetMs,
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

function runWorker(modelId, mode) {
  const budgetMs = modelLatencyBudgetMs(modelId, mode);
  const timeoutMs = providerTimeoutOverride || Math.max(mode === "chat" ? 60_000 : 120_000, budgetMs * 2);
  const args = [
    scriptPath,
    "--worker",
    `--model=${modelId}`,
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
      reachable: false,
      qualityOk: false,
      speedOk: false,
      speedRequired: true,
      latencyMs: Math.round(performance.now() - started),
      latencyBudgetMs: budgetMs,
      issues: [error?.killed ? "worker process timed out" : (error instanceof Error ? error.message : String(error))]
    };
  }
}

function runWorkerWithRetries(modelId, mode) {
  let lastResult;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    const result = runWorker(modelId, mode);
    result.attempts = attempt + 1;
    lastResult = result;
    if (statusLabel(result) === "PASS") return result;
  }
  return lastResult;
}

if (workerMode) {
  const modelId = argValue("--model");
  const mode = argValue("--mode", "chat");
  const result = mode === "changeset" ? await runPatch(modelId) : await runChat(modelId);
  console.log(JSON.stringify(result));
  process.exit(resultFailed(result) ? 1 : 0);
}

const results = [];
for (const modelId of requestedModels) {
  results.push(runWorkerWithRetries(modelId, "chat"));
  if (includePatch) {
    results.push(runWorkerWithRetries(modelId, "changeset"));
  }
}

if (jsonOutput) {
  console.log(JSON.stringify({ results }, null, 2));
} else {
  for (const result of results) {
    const label = statusLabel(result);
    const issueText = result.issues.length ? ` issues=${result.issues.join("; ")}` : "";
    const fileText = typeof result.fileCount === "number" ? ` files=${result.fileCount}` : "";
    const attemptText = result.attempts && result.attempts > 1 ? ` attempts=${result.attempts}` : "";
    console.log(`${label} ${result.mode} ${result.modelId} latency=${formatSeconds(result.latencyMs)} budget=${formatSeconds(result.latencyBudgetMs)}${fileText}${attemptText}${issueText}`);
  }
}

if (results.some(resultFailed)) {
  process.exitCode = 1;
}
