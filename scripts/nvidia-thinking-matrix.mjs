#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { performance } from "node:perf_hooks";

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
  return typeof ms === "number" ? `${(ms / 1000).toFixed(1)}s` : "n/a";
}

const modelMap = {
  "deepseek-v4-flash": "deepseek-ai/deepseek-v4-flash",
  "deepseek-v4-pro": "deepseek-ai/deepseek-v4-pro",
  "glm-5.1": "z-ai/glm-5.1"
};

function requestOptions(modelId, level) {
  const thinkingEnabled = level !== "none";
  if (!thinkingEnabled) return {};
  if (modelId === "deepseek-v4-flash" || modelId === "deepseek-v4-pro") {
    return { reasoning_effort: level === "max" ? "max" : "high" };
  }
  return { reasoning_effort: level };
}

async function readStream(response, timeoutMs, startedAt) {
  if (!response.body) return { content: "", reasoning: "", rawEvents: 0 };
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const elapsedMs = Math.max(0, performance.now() - startedAt);
  const deadline = Date.now() + Math.max(1, timeoutMs - elapsedMs);
  let pending = "";
  let content = "";
  let reasoning = "";
  let rawEvents = 0;
  let firstLineMs;
  let firstContentMs;
  let firstReasoningMs;

  while (Date.now() < deadline) {
    let timer;
    const remaining = Math.max(1, deadline - Date.now());
    const timeout = new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(`stream read timed out after ${formatSeconds(timeoutMs)}`)), remaining);
    });
    const chunk = await Promise.race([reader.read(), timeout]).finally(() => {
      if (timer) clearTimeout(timer);
    });
    if (chunk.done) break;

    pending += decoder.decode(chunk.value, { stream: true });
    const lines = pending.split(/\r?\n/);
    pending = lines.pop() ?? "";
    for (const line of lines) {
      const normalized = line.trim();
      if (!normalized.startsWith("data:")) continue;
      const payload = normalized.slice("data:".length).trim();
      if (!payload) continue;
      rawEvents += 1;
      if (typeof firstLineMs !== "number") firstLineMs = Math.round(performance.now() - startedAt);
      if (payload === "[DONE]") {
        return { content, reasoning, rawEvents, firstLineMs, firstContentMs, firstReasoningMs };
      }
      try {
        const parsed = JSON.parse(payload);
        const delta = parsed.choices?.[0]?.delta ?? {};
        const message = parsed.choices?.[0]?.message ?? {};
        const nextContent = String(delta.content ?? message.content ?? "");
        const nextReasoning = String(delta.reasoning_content ?? message.reasoning_content ?? "");
        if (nextContent) {
          content += nextContent;
          if (typeof firstContentMs !== "number") firstContentMs = Math.round(performance.now() - startedAt);
        }
        if (nextReasoning) {
          reasoning += nextReasoning;
          if (typeof firstReasoningMs !== "number") firstReasoningMs = Math.round(performance.now() - startedAt);
        }
        if (parsed.choices?.[0]?.finish_reason != null) {
          return { content, reasoning, rawEvents, firstLineMs, firstContentMs, firstReasoningMs };
        }
      } catch {
        content += payload;
        if (typeof firstContentMs !== "number") firstContentMs = Math.round(performance.now() - startedAt);
      }
    }
  }

  throw new Error(`stream did not finish within ${formatSeconds(timeoutMs)}`);
}

async function runProbe(modelId, level) {
  const apiKey = process.env.NVIDIA_API_KEY || process.env.NVIDIA_NIM_API_KEY || (process.env.NVIDIA_API_KEYS || "").split(",").map((key) => key.trim()).filter(Boolean)[0];
  const baseUrl = process.env.NVIDIA_NIM_BASE_URL || "https://integrate.api.nvidia.com/v1";
  const timeoutMs = Number(argValue("--timeout-ms", "300000"));
  const requestedMaxTokens = Number(argValue("--max-tokens", "160"));
  const thinkingMinTokens = modelId === "glm-5.1" ? requestedMaxTokens : 1200;
  const maxTokens = level === "none" ? requestedMaxTokens : Math.max(requestedMaxTokens, thinkingMinTokens);
  const started = performance.now();

  if (!apiKey) {
    return { modelId, level, ok: false, error: "missing NVIDIA API key" };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`${baseUrl.replace(/\/$/, "")}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "text/event-stream",
        Authorization: `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: modelMap[modelId],
        stream: true,
        ...(modelId === "deepseek-v4-flash" || modelId === "deepseek-v4-pro" ? {} : { temperature: 0.1 }),
        max_tokens: maxTokens,
        ...requestOptions(modelId, level),
        messages: [
          {
            role: "system",
            content: "You answer with two short sentences. Include the exact words server and exploit."
          },
          {
            role: "user",
            content: "Why must Roblox RemoteEvents validate on the server?"
          }
        ]
      }),
      signal: controller.signal
    });
    const headersMs = Math.round(performance.now() - started);

    if (!response.ok) {
      const text = await response.text().catch(() => "");
      return {
        modelId,
        level,
        ok: false,
        status: response.status,
        headersMs,
        error: text.slice(0, 500)
      };
    }

    const stream = await readStream(response, timeoutMs, started);
    const latencyMs = Math.round(performance.now() - started);
    const normalized = stream.content.toLowerCase();
    const qualityOk = /\bserver\b/.test(normalized) && /\bexploit\w*\b/.test(normalized) && stream.content.trim().length >= 40;
    return {
      modelId,
      level,
      ok: qualityOk,
      status: response.status,
      headersMs,
      firstLineMs: stream.firstLineMs,
      firstContentMs: stream.firstContentMs,
      firstReasoningMs: stream.firstReasoningMs,
      latencyMs,
      rawEvents: stream.rawEvents,
      contentChars: stream.content.length,
      reasoningChars: stream.reasoning.length,
      qualityOk,
      sample: stream.content.slice(0, 180)
    };
  } catch (error) {
    return {
      modelId,
      level,
      ok: false,
      latencyMs: Math.round(performance.now() - started),
      error: error instanceof Error ? error.message : String(error)
    };
  } finally {
    clearTimeout(timer);
  }
}

loadNvidiaSecretIfAvailable();

const models = (argValue("--models") || Object.keys(modelMap).join(",")).split(",").map((model) => model.trim()).filter(Boolean);
const levels = (argValue("--levels") || "none,low,medium,high").split(",").map((level) => level.trim()).filter(Boolean);
const jsonOutput = hasFlag("--json");
const singleProbe = hasFlag("--single");
const results = [];
let printedProgress = false;

function formatResult(result) {
  const label = result.ok ? "PASS" : "FAIL";
  const error = result.error ? ` error=${result.error.replace(/\s+/g, " ").slice(0, 220)}` : "";
  const status = result.status ? ` status=${result.status}` : "";
  const reasoning = typeof result.reasoningChars === "number" ? ` reasoning=${result.reasoningChars}` : "";
  return `${label} ${result.modelId} level=${result.level ?? "n/a"}${status} headers=${formatSeconds(result.headersMs)} firstContent=${formatSeconds(result.firstContentMs)} latency=${formatSeconds(result.latencyMs)} chars=${result.contentChars ?? 0}${reasoning}${error}`;
}

if (!singleProbe && models.length * levels.length > 1) {
  const timeoutMs = Number(argValue("--timeout-ms", "300000"));
  const maxTokens = argValue("--max-tokens", "160");
  for (const modelId of models) {
    for (const level of levels) {
      const child = spawnSync(process.execPath, [
        process.argv[1],
        "--single",
        "--json",
        `--models=${modelId}`,
        `--levels=${level}`,
        `--timeout-ms=${timeoutMs}`,
        `--max-tokens=${maxTokens}`
      ], {
        encoding: "utf8",
        env: process.env,
        timeout: timeoutMs + 10_000
      });

      if (child.error || child.status === null) {
        results.push({
          modelId,
          level,
          ok: false,
          latencyMs: timeoutMs,
          error: child.error?.message || "child probe exceeded hard process timeout"
        });
        continue;
      }

      try {
        const parsed = JSON.parse(child.stdout.trim());
        const parsedResults = parsed.results ?? [];
        results.push(...parsedResults);
        if (!jsonOutput) {
          for (const result of parsedResults) {
            console.log(formatResult(result));
            printedProgress = true;
          }
        }
      } catch {
        const result = {
          modelId,
          level,
          ok: false,
          error: (child.stderr || child.stdout || "child probe returned unparsable output").replace(/\s+/g, " ").slice(0, 500)
        };
        results.push(result);
        if (!jsonOutput) {
          console.log(formatResult(result));
          printedProgress = true;
        }
      }
    }
  }

  if (jsonOutput) {
    console.log(JSON.stringify({ results }, null, 2));
  } else if (!printedProgress) {
    for (const result of results) {
      console.log(formatResult(result));
    }
  }

  if (results.some((result) => !result.ok)) {
    process.exitCode = 1;
  }
  process.exit();
}

for (const modelId of models) {
  if (!modelMap[modelId]) {
    results.push({ modelId, ok: false, error: "unknown NVIDIA model alias" });
    continue;
  }
  for (const level of levels) {
    results.push(await runProbe(modelId, level));
  }
}

if (jsonOutput) {
  console.log(JSON.stringify({ results }, null, 2));
} else {
  for (const result of results) {
    console.log(formatResult(result));
  }
}

if (results.some((result) => !result.ok)) {
  process.exitCode = 1;
}
