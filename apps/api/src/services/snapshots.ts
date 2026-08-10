import { createHash } from "node:crypto";
import type { ProjectSnapshot, SnapshotNode } from "../types.js";

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => [key, stableValue(entry)])
  );
}

function stableNode(node: SnapshotNode) {
  return {
    path: node.path,
    className: node.className,
    source: node.source ?? "",
    properties: stableValue(node.properties ?? {})
  };
}

export function snapshotFingerprint(snapshot?: ProjectSnapshot) {
  if (!snapshot) return undefined;
  const nodes = snapshot.nodes
    .map(stableNode)
    .sort((left, right) => left.path.localeCompare(right.path) || left.className.localeCompare(right.className));
  return createHash("sha256").update(JSON.stringify(nodes)).digest("hex");
}
