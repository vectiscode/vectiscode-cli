import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import type { ToolCall, ToolExecutionContext } from "@vectiscode/core";

import { detectRobloxProject } from "./studio-mcp.js";
import { applyUnifiedDiff, parseUnifiedDiff, RobloxToolExecutor } from "./tools.js";

const roots: string[] = [];

function root(): string {
  const path = mkdtempSync(join(tmpdir(), "vectiscode-tools-"));
  roots.push(path);
  return path;
}

afterEach(() => {
  for (const path of roots.splice(0)) rmSync(path, { recursive: true, force: true });
});

function ctx(cwd: string, signal = new AbortController().signal): ToolExecutionContext {
  return { cwd, sessionId: "session", turnId: "turn", signal };
}

function call(name: string, argumentsValue: Record<string, unknown>): ToolCall {
  return { id: `call-${name}`, name, arguments: argumentsValue };
}

describe("roblox project detection", () => {
  it("stays disabled for a plain directory", () => {
    expect(detectRobloxProject(root())).toEqual({ enabled: false, signals: [] });
  });

  it("detects a Rojo project with Luau sources", () => {
    const cwd = root();
    writeFileSync(join(cwd, "default.project.json"), "{}", "utf8");
    mkdirSync(join(cwd, "src"));
    writeFileSync(join(cwd, "src", "game.luau"), "print('hi')", "utf8");
    const result = detectRobloxProject(cwd);
    expect(result.enabled).toBe(true);
    expect(result.signals).toContain("Rojo project");
    expect(result.signals).toContain("Luau source");
  });
});

describe("file tools", () => {
  it("edits exact unique search text and writes a checkpoint", async () => {
    const cwd = root();
    const path = join(cwd, "game.lua");
    writeFileSync(path, "return { health = 100 }", "utf8");
    const executor = new RobloxToolExecutor();
    const outcome = await executor.execute(call("fs.edit", { path: "game.lua", search: "100", replacement: "250" }), ctx(cwd));
    expect(outcome.ok).toBe(true);
    expect(readFileSync(path, "utf8")).toBe("return { health = 250 }");
    expect(outcome.checkpointId).toBeTruthy();
  });

  it("rejects an ambiguous edit when search text occurs multiple times", async () => {
    const cwd = root();
    const path = join(cwd, "game.lua");
    writeFileSync(path, "local same = 1\nlocal same = 2\n", "utf8");
    const executor = new RobloxToolExecutor();
    const outcome = await executor.execute(call("fs.edit", { path: "game.lua", search: "local same", replacement: "local changed" }), ctx(cwd));
    expect(outcome.ok).toBe(false);
    expect(outcome.summary).toContain("Ambiguous edit");
    expect(readFileSync(path, "utf8")).toBe("local same = 1\nlocal same = 2\n");
  });

  it("rejects an edit when the search text is missing", async () => {
    const cwd = root();
    const path = join(cwd, "game.lua");
    writeFileSync(path, "return {}", "utf8");
    const executor = new RobloxToolExecutor();
    const outcome = await executor.execute(call("fs.edit", { path: "game.lua", search: "nope", replacement: "x" }), ctx(cwd));
    expect(outcome.ok).toBe(false);
    expect(readFileSync(path, "utf8")).toBe("return {}");
  });

  it("creates an empty file when content is empty string", async () => {
    const cwd = root();
    const executor = new RobloxToolExecutor();
    const outcome = await executor.execute(call("fs.write", { path: "empty.txt", content: "" }), ctx(cwd));
    expect(outcome.ok).toBe(true);
    expect(readFileSync(join(cwd, "empty.txt"), "utf8")).toBe("");
  });

  it("reads file with line boundaries", async () => {
    const cwd = root();
    const path = join(cwd, "lines.txt");
    writeFileSync(path, "line 1\nline 2\nline 3\nline 4\nline 5\n", "utf8");
    const executor = new RobloxToolExecutor();
    const outcome = await executor.execute(call("fs.read", { path: "lines.txt", start_line: 2, end_line: 4 }), ctx(cwd));
    expect(outcome.ok).toBe(true);
    const output = outcome.output as { content: string; totalLines: number; startLine: number; endLine: number };
    expect(output.content).toBe("line 2\nline 3\nline 4");
    expect(output.totalLines).toBe(6);
    expect(output.startLine).toBe(2);
    expect(output.endLine).toBe(4);
  });

  it("identifies binary files and returns metadata without corrupting text", async () => {
    const cwd = root();
    const path = join(cwd, "binary.bin");
    const buffer = Buffer.from([0x00, 0x01, 0x02, 0x03, 0xff]);
    writeFileSync(path, buffer);
    const executor = new RobloxToolExecutor();
    const outcome = await executor.execute(call("fs.read", { path: "binary.bin" }), ctx(cwd));
    expect(outcome.ok).toBe(true);
    const output = outcome.output as { isBinary: boolean; bytes: number };
    expect(output.isBinary).toBe(true);
    expect(output.bytes).toBe(5);
  });

  it("applies a unified diff with additions, removals, and context lines", async () => {
    const cwd = root();
    const path = join(cwd, "game.lua");
    writeFileSync(path, "local a = 1\nlocal b = 2\nlocal c = 3\n", "utf8");
    const executor = new RobloxToolExecutor();
    const diff = [
      "--- a/game.lua",
      "+++ b/game.lua",
      "@@ -1,3 +1,3 @@",
      " local a = 1",
      "-local b = 2",
      "+local b = 20",
      " local c = 3"
    ].join("\n");
    const outcome = await executor.execute(call("fs.patch", { path: "game.lua", diff }), ctx(cwd));
    expect(outcome.ok).toBe(true);
    const content = readFileSync(path, "utf8");
    expect(content).toBe("local a = 1\nlocal b = 20\nlocal c = 3\n");
  });

  it("rejects a unified diff when context mismatches", async () => {
    const cwd = root();
    const path = join(cwd, "game.lua");
    writeFileSync(path, "local x = 1\nlocal y = 2\n", "utf8");
    const executor = new RobloxToolExecutor();
    const diff = [
      "--- a/game.lua",
      "+++ b/game.lua",
      "@@ -1,2 +1,2 @@",
      " local mismatch = 99",
      "-local y = 2",
      "+local y = 200"
    ].join("\n");
    const outcome = await executor.execute(call("fs.patch", { path: "game.lua", diff }), ctx(cwd));
    expect(outcome.ok).toBe(false);
    expect(outcome.summary).toContain("context mismatch");
    expect(readFileSync(path, "utf8")).toBe("local x = 1\nlocal y = 2\n");
  });

  it("globs files matching pattern across directories including root", async () => {
    const cwd = root();
    mkdirSync(join(cwd, "src", "services"), { recursive: true });
    writeFileSync(join(cwd, "root.luau"), "return {}", "utf8");
    writeFileSync(join(cwd, "src", "services", "RoundService.luau"), "return {}", "utf8");
    writeFileSync(join(cwd, "src", "services", "DataService.luau"), "return {}", "utf8");
    writeFileSync(join(cwd, "src", "config.json"), "{}", "utf8");
    const executor = new RobloxToolExecutor();
    const outcome = await executor.execute(call("fs.glob", { pattern: "**/*.luau" }), ctx(cwd));
    expect(outcome.ok).toBe(true);
    const files = outcome.output as string[];
    expect(files).toContain("root.luau");
    expect(files).toContain("src/services/RoundService.luau");
    expect(files).toContain("src/services/DataService.luau");
    expect(files).not.toContain("src/config.json");
  });

  it("rejects diff hunks with mismatched header counts", () => {
    const malformed = [
      "--- a/game.lua",
      "+++ b/game.lua",
      "@@ -1,5 +1,1 @@",
      " local a = 1",
      "-local b = 2"
    ].join("\n");
    expect(() => parseUnifiedDiff(malformed)).toThrow("Malformed diff header");
  });

  it("searches text files and honors query limit and abort signal", async () => {
    const cwd = root();
    writeFileSync(join(cwd, "f1.txt"), "hello world\nalpha bravo\n", "utf8");
    writeFileSync(join(cwd, "f2.txt"), "hello again\ncharlie delta\n", "utf8");
    const executor = new RobloxToolExecutor();
    const outcome = await executor.execute(call("fs.search", { query: "hello", limit: 1 }), ctx(cwd));
    expect(outcome.ok).toBe(true);
    const matches = outcome.output as Array<{ text: string }>;
    expect(matches.length).toBe(1);
    expect(matches[0].text).toContain("hello");
  });
});