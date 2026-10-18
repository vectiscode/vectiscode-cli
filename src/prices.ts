import type { Request } from "./model.js";

/** USD per million tokens: input, output, cache read, 5-minute cache write, 1-hour cache write. */
type Price = [number, number, number, number, number];

// API list prices, used to weigh tokens against each other. Subscriptions are not billed this way.
// The 5.5 rates reconcile with the cost records Claude Code writes into its own logs.
const CLAUDE: Record<string, Price> = {
  "opus-5-5": [4, 20, 0.2, 5, 8],
  "sonnet-5-5": [2, 10, 0.2, 2.5, 4],
  "haiku-5-5": [0.1, 0.5, 0.01, 0.125, 0.2],
  "opus-4-6": [5, 25, 0.5, 6.25, 10],
  "opus-4-5": [5, 25, 0.5, 6.25, 10],
  "opus-4-1": [15, 75, 1.5, 18.75, 30],
  "opus-4": [15, 75, 1.5, 18.75, 30],
  "sonnet-4-5": [3, 15, 0.3, 3.75, 6],
  "sonnet-4": [3, 15, 0.3, 3.75, 6],
  "haiku-4-5": [1, 5, 0.1, 1.25, 2],
  "3-7-sonnet": [3, 15, 0.3, 3.75, 6],
  "3-5-sonnet": [3, 15, 0.3, 3.75, 6],
  "3-5-haiku": [0.8, 4, 0.08, 1, 1.6],
};

// Unknown versions fall back to the newest price of their family.
const FAMILY: Record<string, Price> = { opus: CLAUDE["opus-5-5"]!, sonnet: CLAUDE["sonnet-5-5"]!, haiku: CLAUDE["haiku-5-5"]! };

export function priceOf(model: string): Price | undefined {
  const id = model.replace(/^.*claude-/, "").replace(/\[.*\]$/, "").replace(/-\d{8}(-v\d+(:\d+)?)?$/, "");
  return CLAUDE[id] ?? Object.entries(FAMILY).find(([family]) => id.includes(family))?.[1];
}

/** What Claude Code itself recorded for one model in one chat. */
export interface CostRecord {
  model: string;
  input: number;
  output: number;
  read: number;
  write: number;
  searches: number;
  usd: number;
}

const scale = new Map<string, number>();

/** Scales each model's prices to match the costs Claude Code recorded, so the numbers keep up when prices change. */
export function calibrate(records: CostRecord[]): void {
  const sums = new Map<string, { real: number; table: number }>();
  for (const c of records) {
    const p = priceOf(c.model);
    if (!p) continue;
    const s = sums.get(c.model) ?? { real: 0, table: 0 };
    s.real += c.usd - c.searches * 0.01;
    s.table += (c.input * p[0] + c.output * p[1] + c.read * p[2] + c.write * p[4]) / 1e6;
    sums.set(c.model, s);
  }
  for (const [model, s] of sums) if (s.table > 1) scale.set(model, Math.min(5, Math.max(0.2, s.real / s.table)));
}

/** API-equivalent USD of each part of a request. */
export function costParts(r: Request) {
  const p = priceOf(r.model);
  if (!p || r.source === "codex") return { input: 0, output: 0, read: 0, write: 0 };
  const f = (scale.get(r.model) ?? 1) / 1e6;
  return {
    input: r.input * p[0] * f,
    output: r.output * p[1] * f,
    read: r.cacheRead * p[2] * f,
    write: (r.cacheWrite5m * p[3] + r.cacheWrite1h * p[4]) * f,
  };
}

export function cost(r: Request): number {
  const c = costParts(r);
  return c.input + c.output + c.read + c.write;
}

/** USD per token of reading context from the cache. */
export function readPrice(model: string): number {
  return ((priceOf(model)?.[2] ?? 0) * (scale.get(model) ?? 1)) / 1e6;
}
