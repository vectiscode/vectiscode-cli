import { limitDeltas, severalAccounts, WEIGHTS } from "./codex.js";
import type { LimitSample, Request, Session, SourceData } from "./model.js";
import { costParts, readPrice } from "./prices.js";

export type Level = "high" | "medium" | "low" | "ok";

export interface Finding {
  id: "long-chats" | "always-on" | "tool-results" | "cache-breaks" | "helpers";
  level: Level;
  title: string;
  action: string;
  /** The share of usage the finding is about, 0 to 1. */
  share: number;
  facts: string[];
  fix: string;
}

export interface Report {
  since: number;
  claude?: {
    units: number;
    requests: number;
    chats: number;
    split: { read: number; write: number; output: number; input: number };
    agents: { name: string; share: number }[];
    projects: { name: string; share: number }[];
  };
  codex?: {
    turns: number;
    chats: number;
    severalAccounts: boolean;
    /** Estimated from the token counts with WEIGHTS. */
    split: { read: number; input: number; output: number };
    limits: { limit: string; windowMinutes: number; used: number; resetsAt: number; plan?: string }[];
    topChats: { project: string; start: number; points: number }[];
  };
  opencode?: {
    requests: number;
    chats: number;
    models: { name: string; share: number }[];
    units: number;
    split?: { read: number; write: number; output: number; input: number };
  };
  findings: Finding[];
}

type CodexData = SourceData & { limits: LimitSample[] };

const WEEK = 10_080;
const LONG = 150_000;
const VERY_LONG = 300_000;

export function analyze(claude: SourceData | undefined, codex: CodexData | undefined, since: number, now = Date.now(), opencode?: SourceData): Report {
  const report: Report = { since, findings: [] };
  const weekly = codex ? turnPoints(codex.limits, since) : new Map<string, number>();

  if (claude?.requests.length) {
    const reqs = claude.requests;
    const total = sum(reqs, (r) => r.cost) || 1;
    const parts = reqs.map(costParts);
    report.claude = {
      units: total,
      requests: reqs.length,
      chats: new Set(reqs.filter((r) => r.agent === "main").map((r) => r.session)).size,
      split: {
        read: sum(parts, (p) => p.read) / total,
        write: sum(parts, (p) => p.write) / total,
        output: sum(parts, (p) => p.output) / total,
        input: sum(parts, (p) => p.input) / total,
      },
      agents: shares(reqs, (r) => r.agent, total),
      projects: shares(reqs, (r) => r.project, total).slice(0, 4),
    };
  }

  if (codex?.requests.length) {
    const latest = new Map<string, LimitSample>();
    for (const s of codex.limits) latest.set(`${s.limit}:${s.windowMinutes}`, s);
    const bySession = new Map<string, number>();
    for (const r of codex.requests) bySession.set(r.session, (bySession.get(r.session) ?? 0) + (weekly.get(r.id) ?? 0));
    report.codex = {
      turns: codex.requests.length,
      chats: new Set(codex.requests.map((r) => r.session)).size,
      severalAccounts: severalAccounts(codex.limits, WEEK),
      split: codexSplit(codex.requests),
      limits: [...latest.values()].map((s) => ({
        limit: s.limit,
        windowMinutes: s.windowMinutes,
        used: s.resetsAt <= now ? 0 : s.used,
        resetsAt: s.resetsAt,
        plan: s.plan,
      })),
      topChats: [...bySession]
        .filter(([, points]) => points > 0)
        .map(([id, points]) => ({ project: codex.sessions.get(id)?.project ?? "unknown", start: codex.sessions.get(id)?.start ?? 0, points }))
        .sort((a, b) => b.points - a.points)
        .slice(0, 3),
    };
  }

  if (opencode?.requests.length) {
    const reqs = opencode.requests;
    const models = new Map<string, number>();
    for (const r of reqs) models.set(r.model, (models.get(r.model) ?? 0) + 1);
    const parts = reqs.map((r) => {
      const p = costParts(r);
      const total = p.read + p.write + p.output + p.input;
      const scale = total ? r.cost / total : 0;
      return { read: p.read * scale, write: p.write * scale, output: p.output * scale, input: p.input * scale };
    });
    const priced = sum(parts, (p) => p.read + p.write + p.output + p.input);
    report.opencode = {
      requests: reqs.length,
      chats: new Set(reqs.map((r) => r.session)).size,
      models: [...models].map(([name, n]) => ({ name, share: n / reqs.length })).sort((a, b) => b.share - a.share).slice(0, 4),
      units: sum(reqs, (r) => r.cost),
      split: priced ? {
        read: sum(parts, (p) => p.read) / priced, write: sum(parts, (p) => p.write) / priced,
        output: sum(parts, (p) => p.output) / priced, input: sum(parts, (p) => p.input) / priced,
      } : undefined,
    };
  }

  const checks = [longChats(claude, codex, weekly, opencode), alwaysOn(claude, codex, opencode), toolResults(claude), cacheBreaks(claude), helpers(claude)];
  const order: Level[] = ["high", "medium", "low", "ok"];
  report.findings = checks
    .filter((f): f is Finding => f !== null)
    .sort((a, b) => order.indexOf(a.level) - order.indexOf(b.level) || b.share - a.share);
  return report;
}

function longChats(claude: SourceData | undefined, codex: CodexData | undefined, weekly: Map<string, number>, opencode?: SourceData): Finding | null {
  const facts: string[] = [];
  let share = 0;
  const claudeTotal = sum(claude?.requests ?? [], (r) => r.cost);

  if (claude && claudeTotal > 0) {
    const main = claude.requests.filter((r) => r.agent === "main");
    const over = sum(main.filter((r) => r.context > LONG), (r) => r.cost) / claudeTotal;
    const overVery = sum(main.filter((r) => r.context > VERY_LONG), (r) => r.cost) / claudeTotal;
    const fresh = freshChats(main, LONG);
    share = Math.max(0, fresh.saved) / claudeTotal;
    facts.push(`${pct(over)} of your Claude usage ran in chats past ${k(LONG)} tokens of context, ${pct(overVery)} past ${k(VERY_LONG)}.`);
    if (fresh.restarts) {
      facts.push(
        fresh.saved > 0
          ? `Starting a fresh chat at ${k(LONG)} would have saved about ${units(fresh.saved)} units, ${pct(share)} of your Claude usage, after paying about ${fresh.setup.toFixed(2)} units to set up each of ${fresh.restarts} more ${plural(fresh.restarts, "chat")}.`
          : `Starting fresh chats at ${k(LONG)} would not have saved anything: setting up ${fresh.restarts} more ${plural(fresh.restarts, "chat")} at about ${fresh.setup.toFixed(2)} units each costs as much as the shorter chats save.`,
      );
    }
    const chats = chatStats(main, claude.sessions);
    const veryLong = chats.filter((c) => c.peak > VERY_LONG);
    if (veryLong.length) {
      const compactions = sum(veryLong, (c) => c.compactions);
      facts.push(`${veryLong.length} ${plural(veryLong.length, "chat")} grew past ${k(VERY_LONG)}${compactions ? ` and ${plural(compactions, "was", "were")} compacted ${compactions} ${plural(compactions, "time")}` : ""}.`);
    }
    for (const c of chats.slice(0, 3)) {
      facts.push(`  ${c.project}, ${day(c.start)}: ${units(c.cost)} units, peaked at ${k(c.peak)}${c.compactions ? `, ${c.compactions} ${plural(c.compactions, "compaction")}` : ""}.`);
    }
  }

  let codexOver = 0;
  if (codex?.requests.length) {
    const points = sum(codex.requests, (r) => weekly.get(r.id) ?? 0);
    if (points > 0) {
      codexOver = sum(codex.requests.filter((r) => r.context > LONG), (r) => weekly.get(r.id) ?? 0) / points;
      facts.push(`Codex: ${pct(codexOver)} of the weekly limit you used went to turns past ${k(LONG)} tokens of context.`);
    } else {
      const input = sum(codex.requests, (r) => r.context) || 1;
      codexOver = sum(codex.requests.filter((r) => r.context > LONG), (r) => r.context) / input;
      facts.push(`Codex: ${pct(codexOver)} of the tokens you sent were in turns past ${k(LONG)} tokens of context.`);
    }
  }

  if (opencode?.requests.length) {
    const input = sum(opencode.requests, (r) => r.context) || 1;
    const over = sum(opencode.requests.filter((r) => r.context > LONG), (r) => r.context) / input;
    const compactions = sum([...opencode.sessions.values()], (s) => s.compactions.filter((c) => c.time >= opencode.requests[0]!.time && c.time <= opencode.requests.at(-1)!.time).length);
    facts.push(`OpenCode: ${pct(over)} of the tokens it read were in requests past ${k(LONG)} tokens of context, and chats were compacted ${compactions} ${plural(compactions, "time")}.`);
  }

  if (!facts.length) return null;
  // Without Claude Code there is nothing to simulate, so Codex is graded on how much ran in long chats.
  const hasClaude = claudeTotal > 0;
  if (!hasClaude) share = codexOver;
  const level = hasClaude ? grade(share, 0.08, 0.04, 0.015) : grade(share, 0.5, 0.25, 0.1);
  const title = hasClaude
    ? `Long chats: fresh chats at ${k(LONG)} would have saved ${pct(share)} of your Claude usage`
    : `Long chats: ${pct(share)} of your Codex usage went to turns past ${k(LONG)} tokens of context`;
  const fixes = [
    hasClaude &&
      "Every step re-reads the whole chat, so each 100k of chat makes every later step cost more. In Claude Code, start a fresh chat from a short handoff note once a chat passes about 150k. Much sooner doesn't pay, because each new chat has to load its setup again.",
    codex?.requests.length &&
      "Codex charges nothing extra to cache a chat, so a new Codex chat costs about as much as one small step in a 170k chat: start fresh there sooner.",
    "Fresh chats also keep the detail that compaction throws away.",
  ];
  return {
    id: "long-chats",
    action: hasClaude ? "Start a fresh chat from a short handoff note at about 150k" : codex?.requests.length ? "Start fresh Codex chats sooner" : "Start fresh OpenCode chats sooner",
    level,
    title: level === "ok" ? "Chat length" : title,
    share,
    facts,
    fix: fixes.filter(Boolean).join(" "),
  };
}

/**
 * What starting a fresh chat at `limit` would have saved: each step reads less, minus the cost of setting up the
 * extra chats (the median first request of a chat here), starting from a 5k handoff note.
 */
function freshChats(main: Request[], limit: number) {
  const chats = new Map<string, Request[]>();
  for (const r of main) chats.get(r.session)?.push(r) ?? chats.set(r.session, [r]);
  const normal = [...chats.values()].filter((c) => c.length >= 3);
  const setup = median(normal.map((c) => c[0]!.cost));
  // Forks and resumed chats start big; a fresh chat starts from the usual setup.
  const base = median(normal.map((c) => c[0]!.context));
  let saved = 0;
  let restarts = 0;
  for (const reqs of chats.values()) {
    let context = reqs[0]!.context;
    for (let i = 0; i < reqs.length; i++) {
      const r = reqs[i]!;
      if (i) context += Math.max(0, r.context - reqs[i - 1]!.context);
      if (context > limit) {
        context = Math.min(reqs[0]!.context, base) + HANDOFF;
        saved -= setup;
        restarts++;
      }
      saved += (r.context - context) * readPrice(r.model);
    }
  }
  return { saved, restarts, setup };
}

const HANDOFF = 5_000;

function alwaysOn(claude: SourceData | undefined, codex: CodexData | undefined, opencode?: SourceData): Finding | null {
  const facts: string[] = [];
  let share = 0;
  const claudeTotal = sum(claude?.requests ?? [], (r) => r.cost);

  if (claude && claudeTotal > 0) {
    const firsts = firstContexts(claude.requests.filter((r) => r.agent === "main"));
    if (firsts.size) {
      const floor = sum(
        claude.requests.filter((r) => r.agent === "main" && firsts.has(r.session)),
        (r) => Math.min(r.context, firsts.get(r.session)!) * readPrice(r.model),
      );
      share = floor / claudeTotal;
      facts.push(`A new Claude Code chat starts at about ${k(median([...firsts.values()]))} tokens (median of ${firsts.size} ${plural(firsts.size, "chat")}), and most of that goes out again with every request.`);
      facts.push(`Re-sending it cost ${units(floor)} units, ${pct(share)} of your Claude usage.`);
    }
    // The logs give characters, not tokens, for each part, so these are estimates; the rest is what isn't itemized.
    const logged = [...claude.sessions.values()].filter((s) => s.setup?.has("tools") && firsts.has(s.id)).sort((a, b) => b.end - a.end);
    const latest = logged[0];
    if (latest) {
      const first = firsts.get(latest.id)!;
      const parts = new Map<string, number>();
      for (const [part, chars] of latest.setup!) {
        const name = SETUP_PARTS[part] ?? "other";
        parts.set(name, (parts.get(name) ?? 0) + chars / (part === "tools" ? JSON_CHARS : TEXT_CHARS));
      }
      const rest = first - sum([...parts.values()], (t) => t);
      if (rest > 0) parts.set("not itemized", rest);
      const top = [...parts].filter(([, tokens]) => tokens >= 500).sort((a, b) => b[1] - a[1]);
      facts.push(`Where it comes from in your latest chat (${k(first)}): ${top.map(([name, tokens]) => `${name} ${k(tokens)}`).join(", ")}.`);
      const withTools = [...claude.sessions.values()].filter((s) => s.tools);
      const unused = unusedTools(withTools, 1 / JSON_CHARS);
      if (unused.length) {
        const list = unused.slice(0, 5).map((t) => `${t.name} (${k(t.tokens)})`).join(", ");
        facts.push(`Never called in the ${withTools.length} ${plural(withTools.length, "chat")} that logged their tools: ${list}${unused.length > 5 ? ` and ${unused.length - 5} more` : ""}, about ${k(sum(unused, (t) => t.tokens))} per request.`);
      }
    }
  }

  if (codex?.requests.length) {
    const firsts = firstContexts(codex.requests);
    if (firsts.size) facts.push(`A new Codex chat starts at about ${k(median([...firsts.values()]))} tokens.`);
  }

  if (opencode?.requests.length) {
    const firsts = firstContexts(opencode.requests.filter((r) => r.agent === "main"));
    if (firsts.size) facts.push(`A new OpenCode chat starts at about ${k(median([...firsts.values()]))} tokens.`);
  }

  if (!facts.length) return null;
  const level = grade(share, 0.2, 0.1, 0.03);
  return {
    id: "always-on",
    action: "Turn off MCP servers and tools a project doesn't use",
    level,
    title: level === "ok" ? "Always-on context" : `Always-on context: ${pct(share)} of your Claude usage is re-sending the same setup`,
    share,
    facts,
    fix: "The system prompt, every tool definition, MCP servers, skills and CLAUDE.md files go out with every single request. Turn off MCP servers and plugins a project doesn't use, deny unused built-in tools with permissions.deny in settings.json, and keep instruction files short.",
  };
}

function cacheBreaks(claude: SourceData | undefined): Finding | null {
  const total = sum(claude?.requests ?? [], (r) => r.cost);
  if (!claude || total <= 0) return null;
  const cold: { r: Request; gap: number; written: number; cost: number }[] = [];
  const last = new Map<string, Request>();
  for (const r of claude.requests) {
    const prev = last.get(r.thread);
    last.set(r.thread, r);
    if (!prev) continue;
    const ttl = r.cacheWrite1h > 0 ? 3_600_000 : 300_000;
    const written = r.cacheWrite5m + r.cacheWrite1h;
    const gap = r.time - prev.time;
    if (gap > ttl && written > 20_000) cold.push({ r, gap, written, cost: costParts(r).write });
  }
  const spent = sum(cold, (c) => c.cost);
  const share = spent / total;
  const level = grade(share, 0.1, 0.04, 0.01);
  const facts = [
    `${cold.length} ${plural(cold.length, "time")} a chat was picked up after its cache had expired, so the whole chat was written to the cache again.`,
    `That cost ${units(spent)} units, ${pct(share)} of your Claude usage.`,
  ];
  const big = cold.sort((a, b) => b.written - a.written)[0];
  if (big) facts.push(`Biggest: ${big.r.project} on ${day(big.r.time)}, ${k(big.written)} tokens rewritten after a ${duration(big.gap)} break.`);
  return {
    id: "cache-breaks",
    action: "Before a long break, run /compact or continue in a fresh chat",
    level,
    title: level === "ok" ? "Cache after breaks" : `Coming back to big chats after a break cost ${pct(share)} of your Claude usage`,
    share,
    facts,
    fix: "The cache keeps a chat for about an hour (5 minutes for some requests). After that, the next step pays to write the whole chat again. Before a long break, finish the step and continue in a fresh chat afterwards, or run /compact first so the rewrite is small.",
  };
}

function helpers(claude: SourceData | undefined): Finding | null {
  const total = sum(claude?.requests ?? [], (r) => r.cost);
  if (!claude || total <= 0) return null;
  const types = shares(claude.requests.filter((r) => r.agent !== "main"), (r) => r.agent, total);
  const share = sum(types, (t) => t.share);
  if (!types.length) return null;
  const level = grade(share, 0.4, 0.25, 0.15);
  return {
    id: "helpers",
    action: "Give helpers a cheaper model and cap how many a workflow starts",
    level,
    title: level === "ok" ? "Helpers and subagents" : `Helpers and subagents: ${pct(share)} of your Claude usage`,
    share,
    facts: [`By type: ${types.slice(0, 5).map((t) => `${t.name} ${pct(t.share)}`).join(", ")}.`],
    fix: "Each helper starts its own context with its own tools and instructions. Keep the types that save main-chat work, give them a cheaper model where the result holds up, and cap how many a single workflow can start.",
  };
}

/**
 * What tool results cost: each one is written to the cache once and then re-read by every later step of its chat,
 * until a compaction. A request's cache write is what was added since the step before: that step's output and the
 * results of the tools it called.
 */
function toolResults(claude: SourceData | undefined): Finding | null {
  const total = sum(claude?.requests ?? [], (r) => r.cost);
  if (!claude || total <= 0) return null;
  const threads = new Map<string, Request[]>();
  for (const r of claude.requests) if (r.calls) threads.get(r.thread)?.push(r) ?? threads.set(r.thread, [r]);
  const byTool = new Map<string, number>();
  let biggest: { tool: string; tokens: number; later: number; r: Request } | undefined;
  for (const reqs of threads.values()) {
    const first = reqs[0]!;
    const cuts = first.thread === first.session ? (claude.sessions.get(first.session)?.compactions ?? []).map((c) => c.time).sort((a, b) => a - b) : [];
    // How many later steps of the same stretch (up to the next compaction) re-read what each step added.
    const stretch = reqs.map((r) => cuts.filter((t) => t <= r.time).length);
    const later = reqs.map(() => 0);
    for (let i = reqs.length - 2; i >= 0; i--) if (stretch[i] === stretch[i + 1]) later[i] = later[i + 1]! + 1;
    for (let i = 1; i < reqs.length; i++) {
      const prev = reqs[i - 1]!;
      const r = reqs[i]!;
      const written = r.cacheWrite5m + r.cacheWrite1h;
      // No tools: a message from you. A cold cache or a compaction: the write is the whole chat, not new results.
      if (!prev.calls!.length || !written || r.cacheRead < prev.context / 2) continue;
      const tokens = Math.max(0, written - prev.output);
      const cost = (tokens / written) * costParts(r).write + tokens * readPrice(r.model) * later[i]!;
      for (const name of prev.calls!) byTool.set(toolName(name), (byTool.get(toolName(name)) ?? 0) + cost / prev.calls!.length);
      const one = new Set(prev.calls).size === 1;
      if (one && (!biggest || tokens > biggest.tokens)) biggest = { tool: toolName(prev.calls![0]!), tokens, later: later[i]!, r };
    }
  }
  const tools = [...byTool].sort((a, b) => b[1] - a[1]);
  const share = sum(tools, ([, c]) => c) / total;
  if (!tools.length) return null;
  const level = grade(share, 0.3, 0.15, 0.05);
  const facts = [
    `Tool results took ${pct(share)} of your Claude usage: each one is written to the cache, then re-read by every later step of the chat.`,
    `By tool: ${tools.slice(0, 5).map(([name, c]) => `${name} ${pct(c / total)}`).join(", ")}.`,
  ];
  if (biggest) facts.push(`Biggest single result: ${biggest.tool}, ${k(biggest.tokens)} tokens in ${biggest.r.project} on ${day(biggest.r.time)}, re-read by ${biggest.later} later ${plural(biggest.later, "step")}.`);
  return {
    id: "tool-results",
    action: "Keep tool results small: read files in slices, keep logs short",
    level,
    title: level === "ok" ? "Tool results" : `Tool results: ${pct(share)} of your Claude usage went to what tools returned`,
    share,
    facts,
    fix: "Read files in slices or search them instead of opening them whole, keep command output short (the tail, counts, errors only), take screenshots only when something has to be judged by eye, and let a helper read big files and report back a summary.",
  };
}

/** mcp__server__tool reads better as "tool (server)". */
const toolName = (name: string) => name.replace(/^mcp__(.+?)__(.+)$/, "$2 ($1)");

function codexSplit(reqs: Request[]) {
  const read = sum(reqs, (r) => r.cacheRead * WEIGHTS.cacheRead);
  const input = sum(reqs, (r) => (r.input + r.cacheWrite5m) * WEIGHTS.input);
  const output = sum(reqs, (r) => r.output * WEIGHTS.output);
  const total = read + input + output || 1;
  return { read: read / total, input: input / total, output: output / total };
}

/** Points of the weekly Codex limit each turn used. */
export function turnPoints(limits: LimitSample[], since: number): Map<string, number> {
  const out = new Map<string, number>();
  for (const [s, d] of limitDeltas(limits, WEEK, since)) if (s.turn && s.limit === "codex") out.set(s.turn, (out.get(s.turn) ?? 0) + d);
  return out;
}

function chatStats(main: Request[], sessions: Map<string, Session>) {
  const chats = new Map<string, { project: string; start: number; cost: number; peak: number; compactions: number }>();
  for (const r of main) {
    const c = chats.get(r.session) ?? { project: r.project, start: r.time, cost: 0, peak: 0, compactions: sessions.get(r.session)?.compactions.length ?? 0 };
    c.cost += r.cost;
    c.peak = Math.max(c.peak, r.context);
    chats.set(r.session, c);
  }
  return [...chats.values()].sort((a, b) => b.cost - a.cost);
}

/** Context of the first request of each chat with at least three requests. */
export function firstContexts(reqs: Request[]): Map<string, number> {
  const count = new Map<string, number>();
  const first = new Map<string, number>();
  for (const r of reqs) {
    count.set(r.session, (count.get(r.session) ?? 0) + 1);
    if (!first.has(r.session)) first.set(r.session, r.context);
  }
  for (const [id, n] of count) if (n < 3) first.delete(id);
  return first;
}

function unusedTools(sessions: Session[], perChar: number) {
  const called = new Set(sessions.flatMap((s) => [...s.toolsCalled]));
  const tools = new Map<string, number>();
  for (const s of sessions) for (const t of s.tools!) if (!called.has(t.name)) tools.set(t.name, Math.max(tools.get(t.name) ?? 0, t.chars * perChar));
  return [...tools].map(([name, tokens]) => ({ name, tokens })).sort((a, b) => b.tokens - a.tokens);
}

// Rough characters per token: prose, and JSON tool schemas.
const TEXT_CHARS = 3.5;
const JSON_CHARS = 3;

const SETUP_PARTS: Record<string, string> = {
  tools: "tool definitions",
  system: "system prompt",
  instructions: "CLAUDE.md and rules",
  skill_listing: "skills list",
  invoked_skills: "skills in use",
  deferred_tools_delta: "deferred tool list",
  deferred_tools_record: "deferred tool list",
  agent_listing_delta: "subagent list",
  mcp_instructions_delta: "MCP instructions",
  file: "attached files",
  "first-message": "your first message",
};

function shares(reqs: Request[], key: (r: Request) => string, total: number) {
  const m = new Map<string, number>();
  for (const r of reqs) m.set(key(r), (m.get(key(r)) ?? 0) + r.cost);
  return [...m].map(([name, c]) => ({ name, share: c / total })).sort((a, b) => b.share - a.share);
}

function grade(share: number, high: number, medium: number, low: number): Level {
  return share >= high ? "high" : share >= medium ? "medium" : share >= low ? "low" : "ok";
}

export function sum<T>(xs: T[], f: (x: T) => number): number {
  let s = 0;
  for (const x of xs) s += f(x);
  return s;
}

export function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)] ?? 0;
}

const plural = (n: number, one: string, many = `${one}s`) => (n === 1 ? one : many);
export const pct = (x: number) => (x > 0 && x < 0.005 ? "<1%" : `${Math.round(x * 100)}%`);
export const k = (n: number) => (n < 1000 ? String(Math.round(n)) : `${Math.round(n / 1000)}k`);
export const units = (x: number) => (x >= 100 ? x.toFixed(0) : x.toFixed(1));
export const day = (t: number) => new Date(t).toLocaleDateString("en-US", { month: "short", day: "numeric" });

function duration(ms: number): string {
  const h = Math.floor(ms / 3_600_000);
  if (h >= 48) return `${Math.round(h / 24)}-day`;
  if (h >= 1) return `${h}-hour`;
  return `${Math.round(ms / 60_000)}-minute`;
}
