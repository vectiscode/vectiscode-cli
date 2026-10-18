import { day, firstContexts, k, median, pct, sum, turnPoints, units } from "./checks.js";
import type { LimitSample, Request, SourceData } from "./model.js";
import { bold, dim, green, red } from "./report.js";

const LONG = 150_000;
const HOUR = 3_600_000;

export interface Period {
  from: number;
  to: number;
  claude?: {
    requests: number;
    hours: number;
    units: number;
    perHour: number;
    perRequest: number;
    context: number;
    past150k: number;
    chatStart: number;
    compactionsPerChat: number;
  };
  codex?: { turns: number; hours: number; points: number; perHour: number; per100Turns: number; context: number };
  opencode?: { context: number; past150k: number };
}

export interface Comparison {
  before: Period;
  after: Period;
}

/** The same habits measured before and after a date: per active hour and per request, so periods of any length compare. */
export function compare(claude: SourceData | undefined, codex: (SourceData & { limits: LimitSample[] }) | undefined, date: number, from: number, now = Date.now(), opencode?: SourceData): Comparison {
  const weekly = codex ? turnPoints(codex.limits, from) : new Map<string, number>();
  const period = (a: number, b: number): Period => {
    const p: Period = { from: a, to: b };
    const inside = (r: Request) => r.time >= a && r.time < b;
    const reqs = claude?.requests.filter(inside) ?? [];
    if (reqs.length) {
      const total = sum(reqs, (r) => r.cost);
      const main = reqs.filter((r) => r.agent === "main");
      const chats = new Set(main.map((r) => r.session));
      const compactions = sum([...chats], (id) => claude!.sessions.get(id)?.compactions.filter((c) => c.time >= a && c.time < b).length ?? 0);
      p.claude = {
        requests: reqs.length,
        hours: activeHours(reqs),
        units: total,
        perHour: total / activeHours(reqs),
        perRequest: total / reqs.length,
        context: sum(main, (r) => r.context) / (main.length || 1),
        past150k: sum(main.filter((r) => r.context > LONG), (r) => r.cost) / (total || 1),
        chatStart: median([...firstContexts(main).values()]),
        compactionsPerChat: compactions / (chats.size || 1),
      };
    }
    const turns = codex?.requests.filter(inside) ?? [];
    if (turns.length) {
      const points = sum(turns, (r) => weekly.get(r.id) ?? 0);
      p.codex = {
        turns: turns.length,
        hours: activeHours(turns),
        points,
        perHour: points / activeHours(turns),
        per100Turns: (100 * points) / turns.length,
        context: sum(turns, (r) => r.context) / turns.length,
      };
    }
    const open = opencode?.requests.filter(inside) ?? [];
    if (open.length) {
      const input = sum(open, (r) => r.context);
      p.opencode = {
        context: input / open.length,
        past150k: sum(open.filter((r) => r.context > LONG), (r) => r.context) / (input || 1),
      };
    }
    return p;
  };
  return { before: period(from, date), after: period(date, now) };
}

/** Clock hours with at least one request. */
export function activeHours(reqs: Request[]): number {
  return new Set(reqs.map((r) => Math.floor(r.time / HOUR))).size;
}

export function renderComparison({ before, after }: Comparison): string {
  const length = (p: Period) => {
    const d = (p.to - p.from) / 86_400_000;
    return d >= 2 ? `${Math.round(d)} days` : `${Math.round(d * 24)} hours`;
  };
  const out = ["", `${bold("vectiscode")} ${dim(`compare · ${length(before)} before ${day(after.from)} vs ${length(after)} since`)}`, ""];
  const head = (label: string) => out.push(`${bold(label.padEnd(30))}${dim("before".padStart(10))}${dim("after".padStart(10))}`);
  const line = (...args: Parameters<typeof comparisonRow>) => out.push(comparisonRow(...args));

  const b = before.claude, a = after.claude;
  if (b && a) {
    head("Claude Code");
    line("units per request", b.perRequest, a.perRequest, (x) => x.toFixed(3));
    line("units per active hour", b.perHour, a.perHour, (x) => units(x));
    line("average context", b.context, a.context, k);
    line("usage past 150k context", b.past150k, a.past150k, pct, false);
    line("new chats start at", b.chatStart, a.chatStart, k);
    line("compactions per chat", b.compactionsPerChat, a.compactionsPerChat, (x) => x.toFixed(1), false);
    out.push(dim(`  ${b.hours} active hours before, ${a.hours} after`), "");
  } else if (b || a) out.push(dim(`Claude Code: no requests ${b ? "since" : "before"} ${day(after.from)} to compare with.`), "");

  const cb = before.codex, ca = after.codex;
  if (cb && ca) {
    head("Codex");
    line("weekly % per active hour", cb.perHour, ca.perHour, (x) => x.toFixed(1));
    line("weekly % per 100 turns", cb.per100Turns, ca.per100Turns, (x) => x.toFixed(1));
    line("average context", cb.context, ca.context, k);
    out.push(dim(`  ${cb.hours} active hours before, ${ca.hours} after`), "");
  } else if (cb || ca) out.push(dim(`Codex: no turns ${cb ? "since" : "before"} ${day(after.from)} to compare with.`), "");

  const ob = before.opencode, oa = after.opencode;
  if (ob && oa) {
    head("OpenCode");
    line("average context", ob.context, oa.context, k);
    line("usage past 150k context", ob.past150k, oa.past150k, pct, false);
    out.push("");
  } else if (ob || oa) out.push(dim(`OpenCode: no requests ${ob ? "since" : "before"} ${day(after.from)} to compare with.`), "");

  if (!b && !a && !cb && !ca && !ob && !oa) out.push("No Claude Code, Codex or OpenCode logs found around that date.", "");
  else if ((b && a && a.hours < 3) || (cb && ca && ca.hours < 3)) out.push(dim("Only a few active hours since the date, so these numbers will still move."), "");
  return out.join("\n");
}

/** Lower is better for every row, so a fall is green. */
export function comparisonRow(label: string, b: number, a: number, show: (x: number) => string, change = true): string {
  const delta = b > 0 ? a / b - 1 : 0;
  const text = change && b > 0 && Math.abs(delta) >= 0.005 ? `${delta > 0 ? "+" : "−"}${Math.round(Math.abs(delta) * 100)}%` : "";
  return `  ${label.padEnd(28)}${show(b).padStart(10)}${show(a).padStart(10)}  ${delta < 0 ? green(text) : red(text)}`;
}

export function recentChanges({ before, after }: Comparison): string[] {
  const rows: string[] = [];
  const b = before.claude, a = after.claude;
  if (b && a) {
    rows.push(comparisonRow("units per request", b.perRequest, a.perRequest, (x) => x.toFixed(3)));
    rows.push(comparisonRow("average context", b.context, a.context, k));
    rows.push(comparisonRow("usage past 150k context", b.past150k, a.past150k, pct, false));
  }
  const cb = before.codex, ca = after.codex;
  if (cb && ca) {
    rows.push(comparisonRow("Codex weekly % per 100 turns", cb.per100Turns, ca.per100Turns, (x) => x.toFixed(1)));
    if (!b || !a) rows.push(comparisonRow("Codex average context", cb.context, ca.context, k));
  }
  const ob = before.opencode, oa = after.opencode;
  if (ob && oa) {
    rows.push(comparisonRow("OpenCode average context", ob.context, oa.context, k));
    rows.push(comparisonRow("OpenCode usage past 150k", ob.past150k, oa.past150k, pct, false));
  }
  return rows;
}
