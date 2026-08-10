import type { Request, RequestHandler } from "express";
import { createHash } from "node:crypto";
import net from "node:net";
import { config } from "./config.js";
import { createLogger } from "./logger.js";
import { store } from "./store.js";

const log = createLogger({ service: "limits" });

type KeyFn = (req: Request) => string;

interface FixedWindowLimiterOptions {
  windowMs: number;
  max: number;
  namespace?: string;
  key?: KeyFn;
  message?: string;
}

interface Bucket {
  count: number;
  resetAt: number;
}

const sessionCookieName = "ras_session";

function readCookieValue(req: Request, name: string) {
  const header = req.headers.cookie;
  if (!header) return undefined;
  const cookies = header.split(";").map((item) => item.trim());
  const found = cookies.find((item) => item.startsWith(`${name}=`));
  return found ? decodeURIComponent(found.slice(name.length + 1)) : undefined;
}

function normalizeIp(value?: string | string[]) {
  if (!value || Array.isArray(value)) return undefined;
  let ip = value.trim();
  if (!ip) return undefined;
  if (ip.startsWith("[") && ip.includes("]")) {
    ip = ip.slice(1, ip.indexOf("]"));
  }
  if (ip.startsWith("::ffff:")) {
    ip = ip.slice(7);
  }
  const zoneIndex = ip.indexOf("%");
  if (zoneIndex >= 0) {
    ip = ip.slice(0, zoneIndex);
  }
  return net.isIP(ip) ? ip : undefined;
}

function isTrustedProxyAddress(value?: string) {
  const ip = normalizeIp(value);
  if (!ip) return false;
  if (ip === "::1" || ip === "127.0.0.1") return true;
  if (ip.includes(":")) {
    const lower = ip.toLowerCase();
    return lower.startsWith("fc") || lower.startsWith("fd") || lower.startsWith("fe80:");
  }
  const parts = ip.split(".").map((part) => Number(part));
  const [a, b] = parts;
  if (!Number.isInteger(a) || !Number.isInteger(b)) return false;
  return a === 10
    || (a === 172 && b >= 16 && b <= 31)
    || (a === 192 && b === 168)
    || (a === 100 && b >= 64 && b <= 127)
    || (a === 169 && b === 254);
}

function forwardedClientIp(req: Request) {
  const forwarded = req.headers["x-forwarded-for"];
  if (typeof forwarded !== "string" || !forwarded.trim()) return undefined;
  const candidates = forwarded
    .split(",")
    .map((part) => normalizeIp(part))
    .filter((ip): ip is string => Boolean(ip));

  for (let index = candidates.length - 1; index >= 0; index -= 1) {
    const candidate = candidates[index];
    if (!isTrustedProxyAddress(candidate)) return candidate;
  }
  return candidates[candidates.length - 1];
}

export function clientIpForRequest(req: Request) {
  const remote = normalizeIp(req.socket.remoteAddress) ?? normalizeIp(req.ip);
  if (config.trustProxyHeaders || isTrustedProxyAddress(remote)) {
    const forwarded = forwardedClientIp(req);
    if (forwarded) return forwarded;
  }
  return remote ?? normalizeIp(req.ip) ?? "unknown";
}

export function rateLimitIdentityForRequest(req: Request) {
  const sessionId = readCookieValue(req, sessionCookieName);
  if (sessionId) {
    const digest = createHash("sha256").update(sessionId).digest("hex").slice(0, 32);
    return `session:${digest}`;
  }
  return `ip:${clientIpForRequest(req)}`;
}

const defaultKey: KeyFn = (req) => {
  return rateLimitIdentityForRequest(req);
};

export function createFixedWindowLimiter(options: FixedWindowLimiterOptions): RequestHandler {
  const buckets = new Map<string, Bucket>();
  let lastCleanup = Date.now();

  return async (req, res, next) => {
    const nowMs = Date.now();
    const key = options.key?.(req) ?? defaultKey(req);
    const rateKey = options.namespace ? `${options.namespace}:${key}` : key;

    if (config.useSupabase && config.durableRateLimits) {
      try {
        const { count, resetAt } = await store.incrementRateLimit(rateKey, options.windowMs);
        const remaining = Math.max(0, options.max - count);
        res.setHeader("RateLimit-Limit", String(options.max));
        res.setHeader("RateLimit-Remaining", String(remaining));
        res.setHeader("RateLimit-Reset", String(Math.ceil(resetAt / 1000)));

        if (count > options.max) {
          res.setHeader("Retry-After", String(Math.ceil((resetAt - nowMs) / 1000)));
          res.status(429).json({ error: options.message ?? "Too many requests. Please slow down and try again." });
          return;
        }
        next();
        return;
      } catch (err) {
        log.warn("Durable rate limit failed, falling back to memory", { error: String(err) });
      }
    }

    // Memory-based fallback
    if (nowMs - lastCleanup > options.windowMs) {
      lastCleanup = nowMs;
      for (const [k, bucket] of buckets) {
        if (bucket.resetAt <= nowMs) buckets.delete(k);
      }
    }

    const existing = buckets.get(rateKey);
    const bucket = existing && existing.resetAt > nowMs
      ? existing
      : { count: 0, resetAt: nowMs + options.windowMs };

    bucket.count += 1;
    buckets.set(rateKey, bucket);

    const remaining = Math.max(0, options.max - bucket.count);
    res.setHeader("RateLimit-Limit", String(options.max));
    res.setHeader("RateLimit-Remaining", String(remaining));
    res.setHeader("RateLimit-Reset", String(Math.ceil(bucket.resetAt / 1000)));

    if (bucket.count > options.max) {
      res.setHeader("Retry-After", String(Math.ceil((bucket.resetAt - nowMs) / 1000)));
      res.status(429).json({ error: options.message ?? "Too many requests. Please slow down and try again." });
      return;
    }

    next();
  };
}

export class KeyedMutex {
  private tails = new Map<string, Promise<void>>();

  async run<T>(key: string, task: () => Promise<T>): Promise<T> {
    const previous = this.tails.get(key) ?? Promise.resolve();
    let release!: () => void;
    const current = new Promise<void>((resolve) => {
      release = resolve;
    });

    this.tails.set(key, previous.then(() => current, () => current));
    await previous.catch(() => undefined);

    try {
      return await task();
    } finally {
      release();
      if (this.tails.get(key) === current) {
        this.tails.delete(key);
      }
    }
  }
}
