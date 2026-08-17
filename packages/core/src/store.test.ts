import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { SessionStore } from "./store.js";
import type { AgentEvent } from "./types.js";

const dirs: string[] = [];

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "vectiscode-store-"));
  dirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const d of dirs.splice(0)) {
    try { rmSync(d, { recursive: true, force: true }); } catch { /* ignore */ }
  }
});

describe("SessionStore", () => {
  it("saves and retrieves sessions", () => {
    const store = new SessionStore(tempDir(), { sqlite: false });
    store.saveSession({
      version: 1,
      id: "sess-12345",
      projectName: "TestPlace",
      projectPath: "/tmp/place",
      provider: "openai",
      model: "gpt-4o",
      permissionMode: "supervised",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    });

    const loaded = store.getSession("sess-12345");
    expect(loaded).toBeTruthy();
    expect(loaded?.projectName).toBe("TestPlace");
  });

  it("appends and reads events in sequence", () => {
    const store = new SessionStore(tempDir(), { sqlite: false });
    store.appendEvent({
      sessionId: "sess-events",
      type: "turn.started",
      timestamp: new Date().toISOString(),
      payload: { prompt: "Build a game" }
    });
    store.appendEvent({
      sessionId: "sess-events",
      type: "turn.completed",
      timestamp: new Date().toISOString(),
      payload: { text: "Done" }
    });

    const events = store.readEvents("sess-events");
    expect(events.length).toBe(2);
    expect(events[0].seq).toBe(1);
    expect(events[1].seq).toBe(2);
    expect(events[0].payload.prompt).toBe("Build a game");
  });

  it("imports JSONL files and creates the session record", () => {
    const root = tempDir();
    const store = new SessionStore(root, { sqlite: false });
    const jsonlPath = join(root, "export.jsonl");
    const rawEvents: AgentEvent[] = [
      {
        version: 1,
        seq: 1,
        sessionId: "sess-imported-99",
        type: "turn.started",
        timestamp: "2026-08-17T20:00:00.000Z",
        payload: { prompt: "Import me" }
      },
      {
        version: 1,
        seq: 2,
        sessionId: "sess-imported-99",
        type: "turn.completed",
        timestamp: "2026-08-17T20:00:05.000Z",
        payload: { text: "Imported result" }
      }
    ];
    writeFileSync(jsonlPath, rawEvents.map((e) => JSON.stringify(e)).join("\n") + "\n", "utf8");

    const result = store.importJsonlFile(jsonlPath);
    expect(result.sessionId).toBe("sess-imported-99");
    expect(result.count).toBe(2);

    const session = store.getSession("sess-imported-99");
    expect(session).toBeTruthy();
    expect(store.readEvents("sess-imported-99").length).toBe(2);
  });
});
