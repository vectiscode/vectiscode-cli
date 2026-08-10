import { createHash, randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";

import { dataDirectory } from "@vectiscode/core";

import { resolveWorkspacePath } from "./path-safety.js";

interface FileCheckpoint {
  version: 1;
  id: string;
  sessionId: string;
  turnId: string;
  projectRoot: string;
  relativePath: string;
  previousContent?: string;
  previousHash?: string;
  expectedCurrentHash: string;
  createdAt: string;
}

function hash(content: string): string {
  return createHash("sha256").update(content).digest("hex");
}

function checkpointPath(id: string): string {
  return join(dataDirectory(), "checkpoints", `${id}.json`);
}

function saveCheckpoint(checkpoint: FileCheckpoint): void {
  const path = checkpointPath(checkpoint.id);
  mkdirSync(dirname(path), { recursive: true });
  const temporaryPath = `${path}.${process.pid}.tmp`;
  writeFileSync(temporaryPath, `${JSON.stringify(checkpoint, null, 2)}\n`, "utf8");
  renameSync(temporaryPath, path);
}

export function checkpointFile(options: {
  cwd: string;
  absolutePath: string;
  nextContent: string;
  sessionId: string;
  turnId: string;
}): string {
  const previousContent = existsSync(options.absolutePath) ? readFileSync(options.absolutePath, "utf8") : undefined;
  const checkpoint: FileCheckpoint = {
    version: 1,
    id: randomUUID(),
    sessionId: options.sessionId,
    turnId: options.turnId,
    projectRoot: options.cwd,
    relativePath: relative(options.cwd, options.absolutePath),
    previousContent,
    previousHash: previousContent === undefined ? undefined : hash(previousContent),
    expectedCurrentHash: hash(options.nextContent),
    createdAt: new Date().toISOString()
  };
  saveCheckpoint(checkpoint);
  return checkpoint.id;
}

export function rollbackCheckpoint(id: string, cwd: string): { restored: string; checkpointId: string } {
  const path = checkpointPath(id);
  if (!existsSync(path)) throw new Error(`Checkpoint not found: ${id}`);
  const checkpoint = JSON.parse(readFileSync(path, "utf8")) as FileCheckpoint;
  const absolutePath = resolveWorkspacePath(cwd, checkpoint.relativePath);
  if (checkpoint.projectRoot !== cwd) throw new Error("Checkpoint belongs to a different project root");
  const currentContent = existsSync(absolutePath) ? readFileSync(absolutePath, "utf8") : undefined;
  if (currentContent === undefined || hash(currentContent) !== checkpoint.expectedCurrentHash) {
    throw new Error(`Rollback conflict for ${checkpoint.relativePath}. The file changed after this checkpoint.`);
  }
  if (checkpoint.previousContent === undefined) {
    unlinkSync(absolutePath);
  } else {
    mkdirSync(dirname(absolutePath), { recursive: true });
    writeFileSync(absolutePath, checkpoint.previousContent, "utf8");
  }
  return { restored: checkpoint.relativePath, checkpointId: id };
}
