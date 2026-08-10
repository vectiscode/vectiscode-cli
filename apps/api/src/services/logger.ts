import { config } from "./config.js";

export type LogLevel = "debug" | "info" | "warn" | "error";

const LEVEL_PRIORITY: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3
};

const REDACT_KEYS = new Set([
  "password", "token", "apikey", "api_key", "authorization",
  "cookie", "session", "secret", "stripe", "x-api-key", "x-auth-key"
]);

function redact(value: unknown, depth = 0): unknown {
  if (depth > 4) return "[truncated]";
  if (value === null || value === undefined) return value;
  if (typeof value === "string") return value.length > 500 ? `${value.slice(0, 500)}…` : value;
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (Array.isArray(value)) return value.slice(0, 20).map((v) => redact(v, depth + 1));
  if (typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = REDACT_KEYS.has(k.toLowerCase()) ? "[redacted]" : redact(v, depth + 1);
    }
    return out;
  }
  return String(value);
}

function safeJson(value: unknown): string {
  try {
    return JSON.stringify(redact(value));
  } catch {
    return String(value);
  }
}

const COLORS: Record<LogLevel, string> = {
  debug: "\x1b[90m",
  info: "\x1b[36m",
  warn: "\x1b[33m",
  error: "\x1b[31m"
};
const RESET = "\x1b[0m";

function minLogLevel(): LogLevel {
  const env = (process.env.LOG_LEVEL ?? "info").toLowerCase();
  return (["debug", "info", "warn", "error"].includes(env) ? env : "info") as LogLevel;
}

const globalMin = minLogLevel();

export interface Logger {
  debug: (msg: string, ctx?: Record<string, unknown>) => void;
  info: (msg: string, ctx?: Record<string, unknown>) => void;
  warn: (msg: string, ctx?: Record<string, unknown>) => void;
  error: (msg: string, ctx?: Record<string, unknown>) => void;
  child: (ctx: Record<string, unknown>) => Logger;
}

function emit(
  level: LogLevel,
  msg: string,
  context: Record<string, unknown>,
  requestId?: string
) {
  if (LEVEL_PRIORITY[level] < LEVEL_PRIORITY[globalMin]) return;

  const ts = new Date().toISOString();
  const ctx = Object.keys(context).length > 0 ? redact(context) : undefined;

  if (config.isProduction) {
    const entry: Record<string, unknown> = { level, ts, msg };
    if (requestId) entry.requestId = requestId;
    if (ctx) entry.ctx = ctx;
    const fn = level === "error" ? console.error : level === "warn" ? console.warn : console.log;
    fn(JSON.stringify(entry));
  } else {
    const color = COLORS[level] || "";
    const prefix = requestId ? `[${requestId}]` : "";
    const ctxStr = ctx ? ` ${safeJson(ctx)}` : "";
    const fn = level === "error" ? console.error : level === "warn" ? console.warn : console.log;
    fn(`${color}[${level}]${RESET} ${prefix} ${msg}${ctxStr}`);
  }
}

export function createLogger(context: Record<string, unknown> = {}): Logger {
  function log(level: LogLevel, msg: string, extra?: Record<string, unknown>) {
    const merged = { ...context, ...extra };
    emit(level, msg, merged);
  }

  return {
    debug: (msg, ctx) => log("debug", msg, ctx),
    info: (msg, ctx) => log("info", msg, ctx),
    warn: (msg, ctx) => log("warn", msg, ctx),
    error: (msg, ctx) => log("error", msg, ctx),
    child: (extra) => createLogger({ ...context, ...extra })
  };
}

export const logger = createLogger();
