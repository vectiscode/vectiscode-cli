import { createHash } from "node:crypto";
import type { ProjectContextIndex, ProjectSnapshot } from "../types.js";

function uniqueMatches(source: string, pattern: RegExp, group = 1) {
  return Array.from(new Set(Array.from(source.matchAll(pattern), (match) => match[group]).filter(Boolean))).slice(0, 80);
}

export function buildProjectContextIndex(snapshot: ProjectSnapshot): ProjectContextIndex {
  const childCounts = new Map<string, number>();
  for (const node of snapshot.nodes) {
    const parentPath = node.path.includes("/") ? node.path.slice(0, node.path.lastIndexOf("/")) : "";
    if (parentPath) childCounts.set(parentPath, (childCounts.get(parentPath) ?? 0) + 1);
  }
  const digest = createHash("sha256")
    .update(JSON.stringify(snapshot.nodes.map((node) => [node.path, node.className, node.source?.length ?? 0])))
    .digest("hex");
  return {
    id: `context_index_${digest.slice(0, 24)}`,
    projectId: snapshot.projectId,
    snapshotId: snapshot.id,
    digest,
    entries: snapshot.nodes.map((node) => {
      const source = node.source ?? "";
      const segments = node.path.split("/");
      return {
        path: node.path,
        className: node.className,
        parentPath: segments.length > 1 ? segments.slice(0, -1).join("/") : undefined,
        childCount: childCounts.get(node.path) ?? 0,
        symbols: uniqueMatches(source, /\b(?:local\s+)?(?:function|type)\s+([A-Za-z_][A-Za-z0-9_]*)/g),
        services: uniqueMatches(source, /GetService\(["']([^"']+)["']\)/g),
        remoteReferences: uniqueMatches(source, /(?:WaitForChild|FindFirstChild)\(["']([^"']+)["']\)/g),
        requires: uniqueMatches(source, /require\(([^)]+)\)/g),
        ownership: node.path.startsWith("ServerScriptService") || node.className === "Script"
          ? "server"
          : node.path.startsWith("StarterPlayer") || node.path.startsWith("StarterGui") || node.className === "LocalScript"
            ? "client"
            : "shared",
        uiAncestry: segments.some((segment) => /gui|ui|hud|menu|screen/i.test(segment)),
        worldAnchor: node.path.startsWith("Workspace/") && /Part|Model|SpawnLocation|Attachment/.test(node.className)
      };
    }),
    createdAt: new Date().toISOString()
  };
}
