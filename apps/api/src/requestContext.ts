import { randomUUID } from "node:crypto";
import type { Request, Response, NextFunction } from "express";

declare module "express-serve-static-core" {
  interface Request {
    id: string;
    startedAt: number;
    log: RequestLogger;
  }
}

const SAFE_ID = /^[A-Za-z0-9._-]{1,128}$/;

export type LogLevel = "info" | "warn" | "error" | "debug";

export interface RequestLogger {
  info: (...args: unknown[]) => void;
  warn: (...args: unknown[]) => void;
  error: (...args: unknown[]) => void;
  debug: (...args: unknown[]) => void;
  child: (extra: Record<string, unknown>) => RequestLogger;
}

const FORMATS: Record<LogLevel, (msg: string) => string> = {
  info: (m) => `\x1b[36m[info ]\x1b[0m ${m}`,
  warn: (m) => `\x1b[33m[warn ]\x1b[0m ${m}`,
  error: (m) => `\x1b[31m[error]\x1b[0m ${m}`,
  debug: (m) => `\x1b[90m[debug]\x1b[0m ${m}`
};

const LEVEL_CONSOLE: Record<LogLevel, "log" | "warn" | "error"> = {
  info: "log",
  warn: "warn",
  error: "error",
  debug: "log"
};

const REDACT_KEYS = new Set([
  "password",
  "token",
  "apikey",
  "api_key",
  "authorization",
  "cookie",
  "session",
  "secret",
  "stripe",
  "x-api-key",
  "x-auth-key"
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

function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(redact(value));
  } catch {
    return String(value);
  }
}

export function redactUrlForLog(input: string) {
  const redactQuery = (rawQuery: string) => {
    const params = new URLSearchParams(rawQuery);
    for (const key of [...params.keys()]) {
      if (/(token|secret|key|password|authorization|cookie|signature)/i.test(key)) {
        params.set(key, "[redacted]");
      }
    }
    const serialized = params.toString();
    return serialized ? `?${serialized}` : "";
  };

  try {
    const parsed = new URL(input, "https://vectis.local");
    return `${parsed.pathname}${redactQuery(parsed.searchParams.toString())}`;
  } catch {
    const [path, rawQuery = ""] = input.split("?", 2);
    return rawQuery ? `${path}${redactQuery(rawQuery)}` : input;
  }
}

function makeLogger(
  requestId: string,
  context: Record<string, unknown>,
  level: LogLevel = "info"
): RequestLogger {
  const emit = (lvl: LogLevel) => (...args: unknown[]) => {
    if (lvl === "debug" && process.env.LOG_LEVEL !== "debug") return;
    const line = [requestId, ...args.map((a) => (typeof a === "string" ? a : safeStringify(a)))].join(" ");
    const fn = LEVEL_CONSOLE[lvl] || "log";
    const formatted = FORMATS[lvl] ? FORMATS[lvl](line) : line;
    const ctxStr = Object.keys(context).length ? ` ${safeStringify(context)}` : "";
    (console[fn] as (...a: unknown[]) => void)(formatted + ctxStr);
  };
  return {
    info: emit("info"),
    warn: emit("warn"),
    error: emit("error"),
    debug: emit("debug"),
    child: (extra) => makeLogger(requestId, { ...context, ...extra }, level)
  };
}

export function requestContext() {
  return (req: Request, res: Response, next: NextFunction) => {
    const incoming = req.header("x-request-id") || req.header("x-correlation-id");
    const requestId = incoming && SAFE_ID.test(incoming) ? incoming : randomUUID();
    req.id = requestId;
    req.startedAt = Date.now();
    req.log = makeLogger(requestId, { method: req.method, path: req.path });
    res.setHeader("x-request-id", requestId);
    next();
  };
}

export function accessLog() {
  return (req: Request, res: Response, next: NextFunction) => {
    if (req.path === "/health") {
      next();
      return;
    }
    const start = req.startedAt || Date.now();
    res.on("finish", () => {
      const ms = Date.now() - start;
      const level: LogLevel = res.statusCode >= 500 ? "error" : res.statusCode >= 400 ? "warn" : "info";
      const msg = `${req.method} ${redactUrlForLog(req.originalUrl || req.url)} -> ${res.statusCode} ${ms}ms`;
      req.log?.[level](msg);
    });
    next();
  };
}
