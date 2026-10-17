import { basename } from "node:path";

export type Source = "claude" | "codex";

/** One model call, normalized across tools. Token counts are what the provider reported. */
export interface Request {
  source: Source;
  id: string;
  session: string;
  /** The conversation that owns the cache: the main chat, or one helper's own file. */
  thread: string;
  project: string;
  time: number;
  model: string;
  /** "main", or the helper type ("scout", "workflow", ...). */
  agent: string;
  input: number;
  cacheRead: number;
  cacheWrite5m: number;
  cacheWrite1h: number;
  output: number;
  /** Every token the model read for this request. */
  context: number;
  /** API-equivalent USD. 0 when the model has no known price (Codex uses its real limit % instead). */
  cost: number;
}

export interface Session {
  source: Source;
  id: string;
  project: string;
  start: number;
  end: number;
  compactions: { time: number; tokens: number }[];
  toolsCalled: Set<string>;
  /** Characters of each part of the chat's first request (system prompt, tools, CLAUDE.md, ...), when logged. */
  setup?: Map<string, number>;
  /** Characters of each tool definition sent with requests, when logged. */
  tools?: { name: string; chars: number }[];
}

/** A reading of a Codex rate-limit window, taken right after a turn. */
export interface LimitSample {
  time: number;
  session: string;
  turn?: string;
  limit: string;
  windowMinutes: number;
  used: number;
  resetsAt: number;
  plan?: string;
}

export interface SourceData {
  requests: Request[];
  sessions: Map<string, Session>;
}

export function projectName(cwd: string | undefined, fallback: string): string {
  if (!cwd) return fallback;
  return basename(cwd.replace(/[\\/]\.claude[\\/]worktrees[\\/].*$/, "").replace(/[\\/]+$/, "")) || fallback;
}

export function sessionFor(sessions: Map<string, Session>, source: Source, id: string, project: string, time: number): Session {
  let s = sessions.get(id);
  if (!s) {
    s = { source, id, project, start: time, end: time, compactions: [], toolsCalled: new Set() };
    sessions.set(id, s);
  }
  if (time < s.start) s.start = time;
  if (time > s.end) s.end = time;
  return s;
}
