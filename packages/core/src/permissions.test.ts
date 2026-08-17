import { describe, expect, it } from "vitest";

import { evaluatePermissions, wildcardMatch } from "./permissions.js";

describe("wildcardMatch", () => {
  it("matches exact and wildcard patterns", () => {
    expect(wildcardMatch("fs.read", "fs.read")).toBe(true);
    expect(wildcardMatch("fs.*", "fs.read")).toBe(true);
    expect(wildcardMatch("fs.*", "fs.write")).toBe(true);
    expect(wildcardMatch("*.read", "fs.read")).toBe(true);
    expect(wildcardMatch("fs.*", "other.read")).toBe(false);
  });

  it("matches path globs", () => {
    expect(wildcardMatch("src/*", "src/app.ts")).toBe(true);
    expect(wildcardMatch("src/**", "src/nested/app.ts")).toBe(true);
    expect(wildcardMatch("*.lua", "game.lua")).toBe(true);
  });
});

describe("evaluatePermissions", () => {
  it("allows read tools without asking", () => {
    const result = evaluatePermissions({ id: "1", name: "fs.read", arguments: { path: "a.lua" } }, { name: "fs.read", description: "", inputSchema: {}, risk: "read" }, [], "supervised", new Set());
    expect(result).toBe("allow");
  });

  it("denies write in plan mode when no rule overrides", () => {
    const result = evaluatePermissions({ id: "1", name: "fs.write", arguments: { path: "a.lua" } }, { name: "fs.write", description: "", inputSchema: {}, risk: "write" }, [], "plan", new Set());
    expect(result).toBe("deny");
  });

  it("respects explicit allow rule", () => {
    const result = evaluatePermissions({ id: "1", name: "fs.write", arguments: { path: "src/app.ts" } }, { name: "fs.write", description: "", inputSchema: {}, risk: "write" }, [{ pattern: "src/*", action: "allow", scope: "path" }], "supervised", new Set());
    expect(result).toBe("allow");
  });

  it("respects explicit deny rule", () => {
    const result = evaluatePermissions({ id: "1", name: "fs.write", arguments: { path: "secret.txt" } }, { name: "fs.write", description: "", inputSchema: {}, risk: "write" }, [{ pattern: "secret.txt", action: "deny", scope: "path" }], "auto", new Set());
    expect(result).toBe("deny");
  });

  it("honors session approval", () => {
    const call = { id: "1", name: "fs.write", arguments: { path: "a.lua" } };
    const key = `${call.name}:${JSON.stringify(call.arguments)}`;
    const result = evaluatePermissions(call, { name: "fs.write", description: "", inputSchema: {}, risk: "write" }, [], "supervised", new Set([key]));
    expect(result).toBe("allow");
  });
});
