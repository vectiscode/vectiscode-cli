import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import { dataDirectory } from "./config.js";
import { isSqliteAvailable, sqliteSessionStore } from "./sqlite-store.js";
import type { AgentEvent, SessionRecord } from "./types.js";

export class SessionStore {
  private readonly sqlite: boolean;

  constructor(private readonly root?: string, options?: { sqlite?: boolean }) {
    this.sqlite = options?.sqlite ?? (root === undefined && isSqliteAvailable());
  }

  private sessionDirectory(sessionId: string): string {
    return join(this.resolveRoot, sessionId);
  }

  private get resolveRoot(): string {
    return this.root ?? join(dataDirectory(), "sessions");
  }

  private atomicJson(path: string, value: unknown): void {
    mkdirSync(dirname(path), { recursive: true });
    const temporaryPath = `${path}.${process.pid}.tmp`;
    writeFileSync(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
    renameSync(temporaryPath, path);
  }

  saveSession(session: SessionRecord): void {
    if (!this.sqlite) {
      const directory = this.sessionDirectory(session.id);
      mkdirSync(directory, { recursive: true });
      this.atomicJson(join(directory, "session.json"), session);
      return;
    }
    sqliteSessionStore.saveSession(session);
  }

  getSession(sessionId: string): SessionRecord | null {
    if (this.sqlite) {
      const found = sqliteSessionStore.getSession(sessionId);
      if (found) return found;
    }
    const path = join(this.sessionDirectory(sessionId), "session.json");
    if (!existsSync(path)) return null;
    return JSON.parse(readFileSync(path, "utf8")) as SessionRecord;
  }

  listSessions(): SessionRecord[] {
    if (this.sqlite) {
      const sqliteSessions = sqliteSessionStore.listSessions();
      if (sqliteSessions.length) return sqliteSessions;
    }
    if (!existsSync(this.resolveRoot)) return [];
    return readdirSync(this.resolveRoot, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => this.getSession(entry.name))
      .filter((session): session is SessionRecord => session !== null)
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
  }

  appendEvent(event: Omit<AgentEvent, "seq" | "version">): AgentEvent {
    if (this.sqlite) {
      try {
        return sqliteSessionStore.appendEvent(event);
      } catch {
        // fall through to JSONL if SQLite write fails
      }
    }
    const directory = this.sessionDirectory(event.sessionId);
    mkdirSync(directory, { recursive: true });
    const events = this.readEvents(event.sessionId);
    const record: AgentEvent = { ...event, version: 1, seq: (events.at(-1)?.seq ?? 0) + 1 };
    appendFileSync(join(directory, "events.jsonl"), `${JSON.stringify(record)}\n`, "utf8");
    return record;
  }

  readEvents(sessionId: string): AgentEvent[] {
    if (this.sqlite) {
      const sqliteEvents = sqliteSessionStore.readEvents(sessionId);
      if (sqliteEvents.length) return sqliteEvents;
    }
    const path = join(this.sessionDirectory(sessionId), "events.jsonl");
    if (!existsSync(path)) return [];
    return readFileSync(path, "utf8")
      .split(/\r?\n/)
      .filter(Boolean)
      .map((line) => JSON.parse(line) as AgentEvent);
  }

  resolveSession(prefix: string): SessionRecord | null {
    if (this.sqlite) {
      const sqlite = sqliteSessionStore.resolveSession(prefix);
      if (sqlite) return sqlite;
    }
    const matches = this.listSessions().filter((session) => session.id === prefix || session.id.startsWith(prefix));
    if (matches.length > 1) throw new Error(`Session prefix ${prefix} is ambiguous`);
    return matches[0] ?? null;
  }

  describeRoot(): string {
    return this.root ?? dataDirectory();
  }

  compactSession(sessionId: string): { kept: number; summarized: number } {
    if (this.sqlite) return sqliteSessionStore.compactSession(sessionId);
    return { kept: this.readEvents(sessionId).length, summarized: 0 };
  }

  importJsonlFile(filePath: string): { sessionId: string; count: number } {
    if (!existsSync(filePath)) throw new Error(`File not found: ${filePath}`);
    const content = readFileSync(filePath, "utf8");
    const lines = content.split(/\r?\n/).filter(Boolean);
    if (!lines.length) throw new Error("JSONL file is empty");

    const parsedEvents: AgentEvent[] = [];
    for (let i = 0; i < lines.length; i++) {
      try {
        const ev = JSON.parse(lines[i]) as AgentEvent;
        if (!ev.sessionId || !ev.type) throw new Error("Missing sessionId or type in event");
        parsedEvents.push(ev);
      } catch (err) {
        throw new Error(`Invalid JSONL at line ${i + 1}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
    const sessionId = parsedEvents[0].sessionId;
    const existing = this.getSession(sessionId);
    if (!existing) {
      this.saveSession({
        version: 1,
        id: sessionId,
        projectName: "imported",
        projectPath: process.cwd(),
        provider: "imported",
        model: "imported",
        permissionMode: "supervised",
        createdAt: parsedEvents[0].timestamp ?? new Date().toISOString(),
        updatedAt: parsedEvents[parsedEvents.length - 1].timestamp ?? new Date().toISOString()
      });
    }
    for (const ev of parsedEvents) {
      this.appendEvent(ev);
    }
    return { sessionId, count: parsedEvents.length };
  }
}

export const sessionStore = new SessionStore();
