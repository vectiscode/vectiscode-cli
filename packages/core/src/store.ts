import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";

import { dataDirectory } from "./config.js";
import type { AgentEvent, SessionRecord } from "./types.js";

export class SessionStore {
  constructor(private readonly root = join(dataDirectory(), "sessions")) {}

  private sessionDirectory(sessionId: string): string {
    return join(this.root, sessionId);
  }

  private atomicJson(path: string, value: unknown): void {
    mkdirSync(dirname(path), { recursive: true });
    const temporaryPath = `${path}.${process.pid}.tmp`;
    writeFileSync(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
    renameSync(temporaryPath, path);
  }

  saveSession(session: SessionRecord): void {
    const directory = this.sessionDirectory(session.id);
    mkdirSync(directory, { recursive: true });
    this.atomicJson(join(directory, "session.json"), session);
  }

  getSession(sessionId: string): SessionRecord | null {
    const path = join(this.sessionDirectory(sessionId), "session.json");
    if (!existsSync(path)) return null;
    return JSON.parse(readFileSync(path, "utf8")) as SessionRecord;
  }

  listSessions(): SessionRecord[] {
    if (!existsSync(this.root)) return [];
    return readdirSync(this.root, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => this.getSession(entry.name))
      .filter((session): session is SessionRecord => session !== null)
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
  }

  appendEvent(event: Omit<AgentEvent, "seq" | "version">): AgentEvent {
    const directory = this.sessionDirectory(event.sessionId);
    mkdirSync(directory, { recursive: true });
    const events = this.readEvents(event.sessionId);
    const record: AgentEvent = { ...event, version: 1, seq: (events.at(-1)?.seq ?? 0) + 1 };
    appendFileSync(join(directory, "events.jsonl"), `${JSON.stringify(record)}\n`, "utf8");
    return record;
  }

  readEvents(sessionId: string): AgentEvent[] {
    const path = join(this.sessionDirectory(sessionId), "events.jsonl");
    if (!existsSync(path)) return [];
    return readFileSync(path, "utf8")
      .split(/\r?\n/)
      .filter(Boolean)
      .map((line) => JSON.parse(line) as AgentEvent);
  }

  resolveSession(prefix: string): SessionRecord | null {
    const matches = this.listSessions().filter((session) => session.id === prefix || session.id.startsWith(prefix));
    if (matches.length > 1) throw new Error(`Session prefix ${prefix} is ambiguous`);
    return matches[0] ?? null;
  }

  describeRoot(): string {
    return basename(this.root) ? this.root : dataDirectory();
  }
}

export const sessionStore = new SessionStore();
