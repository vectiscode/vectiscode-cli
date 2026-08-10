import { describe, expect, it } from "vitest";
import { buildProjectContextIndex } from "../services/contextIndex.js";

describe("project context index", () => {
  it("indexes ownership, symbols, services, remotes, UI ancestry, and world anchors deterministically", () => {
    const snapshot = {
      id: "snapshot_1",
      projectId: "project_1",
      studioSessionId: "session_1",
      createdAt: "2026-01-01T00:00:00.000Z",
      nodes: [
        { path: "ReplicatedStorage/Remotes/Purchase", className: "RemoteEvent" as const },
        { path: "ServerScriptService/Shop", className: "Script" as const, source: "local Players = game:GetService(\"Players\")\nlocal function buy() end\nlocal remote = game.ReplicatedStorage.Remotes:WaitForChild(\"Purchase\")" },
        { path: "StarterGui/ShopGui/Main", className: "Frame" as const },
        { path: "Workspace/ShopPad", className: "Part" as const }
      ]
    };
    const first = buildProjectContextIndex(snapshot);
    const second = buildProjectContextIndex(snapshot);
    expect(first.digest).toBe(second.digest);
    expect(first.entries.find((entry) => entry.path.endsWith("/Shop"))).toMatchObject({
      ownership: "server",
      symbols: ["buy"],
      services: ["Players"],
      remoteReferences: ["Purchase"]
    });
    expect(first.entries.find((entry) => entry.path.includes("ShopGui"))?.uiAncestry).toBe(true);
    expect(first.entries.find((entry) => entry.path === "Workspace/ShopPad")?.worldAnchor).toBe(true);
  });
});
