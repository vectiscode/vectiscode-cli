import { basename, join } from "node:path";
import { jsonlFiles, readLines } from "./files.js";
import { projectName, sessionFor, type LimitSample, type Request, type Session, type SourceData } from "./model.js";

const NEEDLES = ['"session_meta"', '"turn_context"', '"token_count"'];
const keep = (line: string) => NEEDLES.some((n) => line.includes(n));
const JITTER = 3 * 3_600_000;

/** Reads Codex's logs: <root>/sessions/YYYY/MM/DD/rollout-*.jsonl. */
export async function readCodex(root: string, since: number): Promise<SourceData & { limits: LimitSample[] }> {
  const requests: Request[] = [];
  const sessions = new Map<string, Session>();
  const limits: LimitSample[] = [];
  const seen = new Set<string>();

  for (const file of jsonlFiles(join(root, "sessions"), since)) {
    let id = basename(file, ".jsonl");
    let project = "unknown";
    let model = "unknown";
    let lastTotal = -1;

    for await (const r of readLines(file, keep)) {
      const p = r.payload ?? {};
      if (r.type === "session_meta") {
        id = p.id ?? p.session_id ?? id;
        project = projectName(p.cwd, project);
        continue;
      }
      if (r.type === "turn_context") {
        model = p.model ?? model;
        continue;
      }
      const time = Date.parse(r.timestamp);
      if (p.type !== "token_count" || !(time >= since)) continue;
      const session = sessionFor(sessions, "codex", id, project, time);

      let turn: string | undefined;
      const total = p.info?.total_token_usage?.total_tokens;
      const last = p.info?.last_token_usage;
      // The running total repeats when nothing new was sent, and resumed chats copy earlier events.
      if (last && total !== lastTotal && !seen.has(`${id}:${total}`)) {
        seen.add(`${id}:${total}`);
        turn = `${id}:${total}`;
        const input = last.input_tokens ?? 0;
        const cached = Math.min(input, last.cached_input_tokens ?? 0);
        requests.push({
          source: "codex",
          id: turn,
          session: id,
          thread: id,
          project: session.project,
          time,
          model,
          agent: "main",
          input: input - cached,
          cacheRead: cached,
          cacheWrite5m: last.cache_write_input_tokens ?? 0,
          cacheWrite1h: 0,
          output: last.output_tokens ?? 0,
          context: input,
          cost: 0,
        });
      }
      lastTotal = total ?? lastTotal;

      const rl = p.rate_limits;
      for (const w of [rl?.primary, rl?.secondary]) {
        if (!w || typeof w.used_percent !== "number") continue;
        limits.push({
          time,
          session: id,
          turn,
          limit: rl.limit_id ?? "codex",
          windowMinutes: w.window_minutes,
          used: w.used_percent,
          resetsAt: w.resets_at * 1000,
          plan: rl.plan_type ?? undefined,
        });
      }
    }
  }

  requests.sort((a, b) => a.time - b.time);
  limits.sort((a, b) => a.time - b.time);
  return { requests, sessions, limits };
}

/**
 * How many percentage points of a limit window each turn used. A window is known by its reset time: people who
 * switch between ChatGPT accounts have several running at once, and parallel chats report the same window with
 * reset times up to an hour apart, sometimes with an older, lower reading. So each window counts up from its peak.
 */
export function limitDeltas(limits: LimitSample[], windowMinutes: number, since: number): Map<LimitSample, number> {
  const deltas = new Map<LimitSample, number>();
  const windows = new Map<string, { resetsAt: number; peak: number }[]>();
  for (const s of limits) {
    if (s.windowMinutes !== windowMinutes) continue;
    const list = windows.get(s.limit) ?? [];
    windows.set(s.limit, list);
    let w = list.find((x) => Math.abs(x.resetsAt - s.resetsAt) <= JITTER);
    if (!w) {
      // A window that started before the logs being read began already has usage nobody here can place.
      w = { resetsAt: s.resetsAt, peak: s.resetsAt - windowMinutes * 60_000 < since ? s.used : 0 };
      list.push(w);
    }
    deltas.set(s, Math.max(0, s.used - w.peak));
    w.peak = Math.max(w.peak, s.used);
  }
  return deltas;
}

/** How many different windows of this length were still open at `now`. */
export function openWindows(limits: LimitSample[], windowMinutes: number, now: number): number {
  const open: number[] = [];
  for (const s of limits) {
    if (s.windowMinutes === windowMinutes && s.limit === "codex" && s.resetsAt > now && !open.some((r) => Math.abs(r - s.resetsAt) <= JITTER)) open.push(s.resetsAt);
  }
  return open.length;
}
