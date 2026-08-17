import { existsSync, mkdirSync, readFileSync, readdirSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

import { dataDirectory } from "./config.js";
import type { AgentEvent, SessionRecord } from "./types.js";

type DatabaseSyncType = {
  exec: (sql: string) => void;
  prepare: (sql: string) => { run: (...args: unknown[]) => unknown; get: (...args: unknown[]) => unknown; all: (...args: unknown[]) => unknown[] };
  close: () => void;
};

let database: DatabaseSyncType | null = null;
let sqliteAvailable = false;

function getDatabasePath(): string {
  return join(dataDirectory(), "sessions.db");
}

function tryInitSqlite(): DatabaseSyncType | null {
  if (database) return database;
  try {
    const req = createRequire(import.meta.url);
    let DatabaseClass: (new (path: string) => DatabaseSyncType) | undefined;

    try {
      const nodeSqlite = req("node:sqlite") as { DatabaseSync?: new (path: string) => DatabaseSyncType };
      if (nodeSqlite?.DatabaseSync) {
        DatabaseClass = nodeSqlite.DatabaseSync;
      }
    } catch {
      // node:sqlite not present
    }

    if (!DatabaseClass) return null;

    const path = getDatabasePath();
    mkdirSync(dirname(path), { recursive: true });
    const db = new DatabaseClass(path);
    db.exec("PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000;");
    db.exec(`
      CREATE TABLE IF NOT EXISTS sessions (
        id TEXT PRIMARY KEY,
        data TEXT NOT NULL,
        updatedAt TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        sessionId TEXT NOT NULL,
        seq INTEGER NOT NULL,
        type TEXT NOT NULL,
        timestamp TEXT NOT NULL,
        turnId TEXT,
        payload TEXT NOT NULL,
        UNIQUE(sessionId, seq)
      );
      CREATE INDEX IF NOT EXISTS idx_events_session ON events(sessionId, seq);
    `);
    sqliteAvailable = true;
    database = db;
    return db;
  } catch {
    return null;
  }
}

function getDatabase(): DatabaseSyncType | null {
  if (sqliteAvailable && database) return database;
  return tryInitSqlite();
}

export function isSqliteAvailable(): boolean {
  return Boolean(getDatabase());
}

export class SqliteSessionStore {
  private get db(): DatabaseSyncType | null {
    return getDatabase();
  }

  saveSession(session: SessionRecord): void {
    const db = this.db;
    if (!db) return;
    db.prepare("INSERT INTO sessions (id, data, updatedAt) VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET data = excluded.data, updatedAt = excluded.updatedAt").run(session.id, JSON.stringify(session), session.updatedAt);
  }

  getSession(sessionId: string): SessionRecord | null {
    const db = this.db;
    if (!db) return null;
    const row = db.prepare("SELECT data FROM sessions WHERE id = ?").get(sessionId) as { data?: string } | undefined;
    if (!row?.data) return null;
    try {
      return JSON.parse(row.data) as SessionRecord;
    } catch {
      return null;
    }
  }

  listSessions(): SessionRecord[] {
    const db = this.db;
    if (!db) return [];
    const rows = db.prepare("SELECT data FROM sessions ORDER BY updatedAt DESC").all() as Array<{ data: string }>;
    return rows.map((row) => {
      try { return JSON.parse(row.data) as SessionRecord; } catch { return null; }
    }).filter((value): value is SessionRecord => value !== null);
  }

  appendEvent(event: Omit<AgentEvent, "seq" | "version">): AgentEvent {
    const db = this.db;
    if (!db) throw new Error("SQLite unavailable");
    const current = db.prepare("SELECT MAX(seq) as maxSeq FROM events WHERE sessionId = ?").get(event.sessionId) as { maxSeq?: number | null } | undefined;
    const seq = (current?.maxSeq ?? 0) + 1;
    const record: AgentEvent = { ...event, version: 1, seq };
    db.prepare("INSERT INTO events (sessionId, seq, type, timestamp, turnId, payload) VALUES (?, ?, ?, ?, ?, ?)").run(record.sessionId, record.seq, record.type, record.timestamp, record.turnId ?? null, JSON.stringify(record.payload));
    return record;
  }

  readEvents(sessionId: string): AgentEvent[] {
    const db = this.db;
    if (!db) return [];
    const rows = db.prepare("SELECT seq, type, timestamp, turnId, payload FROM events WHERE sessionId = ? ORDER BY seq ASC").all(sessionId) as Array<{ seq: number; type: string; timestamp: string; turnId: string | null; payload: string }>;
    return rows.map((row) => ({
      version: 1 as const,
      seq: row.seq,
      type: row.type as AgentEvent["type"],
      timestamp: row.timestamp,
      sessionId,
      turnId: row.turnId ?? undefined,
      payload: JSON.parse(row.payload) as Record<string, unknown>
    }));
  }

  resolveSession(prefix: string): SessionRecord | null {
    const db = this.db;
    if (!db) return null;
    const row = db.prepare("SELECT data FROM sessions WHERE id = ?").get(prefix) as { data?: string } | undefined;
    if (row?.data) {
      try { return JSON.parse(row.data) as SessionRecord; } catch { /* fall through */ }
    }
    const like = `${prefix}%`;
    const rows = db.prepare("SELECT data FROM sessions WHERE id LIKE ?").all(like) as Array<{ data: string }>;
    if (rows.length === 1) {
      try { return JSON.parse(rows[0].data) as SessionRecord; } catch { return null; }
    }
    if (rows.length > 1) throw new Error(`Session prefix ${prefix} is ambiguous`);
    return null;
  }

  importLegacyJsonl(root: string): number {
    const db = this.db;
    if (!db) return 0;
    if (!existsSync(root)) return 0;
    let imported = 0;
    for (const entry of readdirSync(root, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const sessionPath = join(root, entry.name, "session.json");
      const eventsPath = join(root, entry.name, "events.jsonl");
      if (!existsSync(sessionPath) || !existsSync(eventsPath)) continue;
      try {
        const session = JSON.parse(readFileSync(sessionPath, "utf8")) as SessionRecord;
        const existing = this.getSession(session.id);
        if (existing) continue;
        this.saveSession(session);
        const lines = readFileSync(eventsPath, "utf8").split(/\r?\n/).filter(Boolean);
        for (const line of lines) {
          try {
            const event = JSON.parse(line) as AgentEvent;
            db.prepare("INSERT OR IGNORE INTO events (sessionId, seq, type, timestamp, turnId, payload) VALUES (?, ?, ?, ?, ?, ?)").run(event.sessionId, event.seq, event.type, event.timestamp, event.turnId ?? null, JSON.stringify(event.payload));
            imported += 1;
          } catch {
            // mark legacy incomplete rather than invent events
          }
        }
      } catch {
        continue;
      }
    }
    return imported;
  }

  compactSession(sessionId: string, keepTurns = 20): { kept: number; summarized: number } {
    const events = this.readEvents(sessionId);
    if (events.length <= keepTurns * 2) return { kept: events.length, summarized: 0 };
    const toSummarize = events.slice(0, events.length - keepTurns * 2);
    const kept = events.length - toSummarize.length;
    return { kept, summarized: toSummarize.length };
  }
}

export const sqliteSessionStore = new SqliteSessionStore();
