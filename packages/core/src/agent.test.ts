import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";
import { FakeProvider, FakeToolExecutor, fakeUsage } from "@vectiscode/testkit";

import { runAgent } from "./agent.js";
import { SessionStore } from "./store.js";

const temporaryDirectories: string[] = [];

function temporaryDirectory(): string {
  const path = mkdtempSync(join(tmpdir(), "vectiscode-core-"));
  temporaryDirectories.push(path);
  return path;
}

afterEach(() => {
  for (const path of temporaryDirectories.splice(0)) rmSync(path, { recursive: true, force: true });
});

describe("runAgent", () => {
  it("returns tool results to the provider before completing", async () => {
    const provider = new FakeProvider([
      { text: "", toolCalls: [{ id: "call-1", name: "fake.read", arguments: { path: "game.lua" } }], usage: fakeUsage() },
      { text: "Verified the project.", toolCalls: [], usage: fakeUsage() }
    ]);
    const tools = new FakeToolExecutor();
    const cwd = temporaryDirectory();
    const result = await runAgent({ prompt: "Inspect it", cwd, provider, model: "fake-model", tools, store: new SessionStore(join(cwd, "sessions")) });

    expect(result.text).toBe("Verified the project.");
    expect(tools.calls).toHaveLength(1);
    expect(provider.requests).toHaveLength(2);
    expect(provider.requests[1].messages.at(-1)).toMatchObject({ role: "tool", toolCallId: "call-1" });
  });

  it("denies writes in plan mode", async () => {
    const provider = new FakeProvider([
      { text: "", toolCalls: [{ id: "call-1", name: "fake.write", arguments: {} }], usage: fakeUsage() },
      { text: "Write was denied.", toolCalls: [], usage: fakeUsage() }
    ]);
    const tools = new FakeToolExecutor([{ name: "fake.write", description: "write", inputSchema: {}, risk: "write" }]);
    const cwd = temporaryDirectory();
    const result = await runAgent({ prompt: "Change it", cwd, provider, model: "fake-model", tools, permissionMode: "plan", store: new SessionStore(join(cwd, "sessions")) });

    expect(result.text).toBe("Write was denied.");
    expect(tools.calls).toHaveLength(0);
  });

  it("blocks repeated identical tool calls", async () => {
    const repeated = { text: "", toolCalls: [{ id: "call", name: "fake.read", arguments: { path: "same" } }], usage: fakeUsage() };
    const provider = new FakeProvider([repeated, repeated, repeated]);
    const cwd = temporaryDirectory();
    await expect(runAgent({ prompt: "Loop", cwd, provider, model: "fake-model", tools: new FakeToolExecutor(), store: new SessionStore(join(cwd, "sessions")) })).rejects.toThrow("Repeated tool call blocked");
  });
});
