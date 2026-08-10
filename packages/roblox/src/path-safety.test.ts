import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { checkpointFile, rollbackCheckpoint } from "./checkpoints.js";
import { resolveWorkspacePath } from "./path-safety.js";

const roots: string[] = [];

function root(): string {
  const path = mkdtempSync(join(tmpdir(), "vectiscode-roblox-"));
  roots.push(path);
  return path;
}

afterEach(() => {
  for (const path of roots.splice(0)) rmSync(path, { recursive: true, force: true });
});

describe("workspace path safety", () => {
  it("rejects traversal outside the project root", () => {
    expect(() => resolveWorkspacePath(root(), "../secret.txt")).toThrow("escapes the project root");
  });

  it("restores a checkpoint only while the current content matches", () => {
    const cwd = root();
    mkdirSync(join(cwd, "src"));
    const path = join(cwd, "src", "game.lua");
    writeFileSync(path, "old", "utf8");
    const id = checkpointFile({ cwd, absolutePath: path, nextContent: "new", sessionId: "session", turnId: "turn" });
    writeFileSync(path, "new", "utf8");
    const result = rollbackCheckpoint(id, cwd);
    expect(result.restored.replaceAll("\\", "/")).toBe("src/game.lua");
  });

  it("reports a rollback conflict after a later edit", () => {
    const cwd = root();
    const path = join(cwd, "game.lua");
    writeFileSync(path, "old", "utf8");
    const id = checkpointFile({ cwd, absolutePath: path, nextContent: "new", sessionId: "session", turnId: "turn" });
    writeFileSync(path, "newer", "utf8");
    expect(() => rollbackCheckpoint(id, cwd)).toThrow("Rollback conflict");
  });
});
