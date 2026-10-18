import { existsSync } from "node:fs";
import { projectName, sessionFor, type Request, type Session, type SourceData } from "./model.js";
import { cost } from "./prices.js";

/** Only session metadata and model usage are read from OpenCode's database. */
export async function readOpenCode(dbPath: string, since: number): Promise<SourceData> {
  const requests: Request[] = [];
  const sessions = new Map<string, Session>();
  if (!existsSync(dbPath)) return { requests, sessions };
  let sqlite: typeof import("node:sqlite");
  try {
    sqlite = await import("node:sqlite");
  } catch {
    // Older Node 22 versions do not have SQLite support.
    return { requests, sessions };
  }
  const db = new sqlite.DatabaseSync(dbPath, { readOnly: true });
  try {
    const rows = db.prepare(`
      SELECT m.id, m.session_id, m.type, m.time_created, m.data, s.parent_id, s.directory
      FROM session_message m JOIN session_v2 s ON s.id = m.session_id
      WHERE m.type IN ('assistant', 'compaction') AND m.time_created >= ?
      ORDER BY m.time_created, m.seq
    `).iterate(since);
    for (const row of rows) {
      let data;
      try {
        data = JSON.parse(String(row.data));
      } catch {
        continue; // A malformed message should not hide the rest of the history.
      }
      if (!data || typeof data !== "object") continue;
      const tokens = data.tokens ?? {};
      const time = Number(data.time?.created ?? row.time_created);
      if (!(time >= since)) continue;
      const id = String(row.session_id);
      const session = sessionFor(sessions, "opencode", id, projectName(row.directory ? String(row.directory) : undefined, "unknown"), time);
      const req: Request = {
        source: "opencode", id: String(row.id), session: id, thread: id, project: session.project, time,
        model: data.model?.id ?? "unknown",
        agent: row.parent_id ? data.agent || "helper" : "main",
        input: tokens.input ?? 0,
        cacheRead: tokens.cache?.read ?? 0,
        cacheWrite5m: tokens.cache?.write ?? 0,
        cacheWrite1h: 0,
        output: (tokens.output ?? 0) + (tokens.reasoning ?? 0),
        context: 0, cost: 0,
      };
      req.context = req.input + req.cacheRead + req.cacheWrite5m;
      req.cost = data.cost > 0 ? data.cost : cost(req);
      requests.push(req);
      if (row.type === "compaction") session.compactions.push({ time, tokens: req.context });
    }
  } finally {
    db.close();
  }
  requests.sort((a, b) => a.time - b.time);
  return { requests, sessions };
}
