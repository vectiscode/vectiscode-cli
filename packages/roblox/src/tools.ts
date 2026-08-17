import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";

import type { ToolCall, ToolDefinition, ToolExecutionContext, ToolExecutor, ToolReceipt } from "@vectiscode/core";

import { checkpointFile } from "./checkpoints.js";
import { resolveWorkspacePath } from "./path-safety.js";
import { detectRobloxProject, studioMcp, type StudioMcpClient } from "./studio-mcp.js";

function stringArgument(call: ToolCall, name: string): string {
  const value = call.arguments[name];
  if (typeof value !== "string") throw new Error(`${call.name} requires a ${name} string`);
  return value;
}

function receipt(call: ToolCall, risk: ToolDefinition["risk"], startedAt: string, options: Omit<ToolReceipt, "toolCallId" | "toolName" | "risk" | "startedAt" | "completedAt">): ToolReceipt {
  return { toolCallId: call.id, toolName: call.name, risk, startedAt, completedAt: new Date().toISOString(), ...options };
}

interface Hunk {
  oldStart: number;
  oldCount: number;
  newStart: number;
  newCount: number;
  lines: string[];
}

export function parseUnifiedDiff(diffText: string): Hunk[] {
  const lines = diffText.split(/\r?\n/);
  const hunks: Hunk[] = [];
  let currentHunk: Hunk | null = null;

  for (const line of lines) {
    const hunkMatch = line.match(/^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/);
    if (hunkMatch) {
      if (currentHunk) hunks.push(currentHunk);
      currentHunk = {
        oldStart: parseInt(hunkMatch[1], 10),
        oldCount: hunkMatch[2] !== undefined ? parseInt(hunkMatch[2], 10) : 1,
        newStart: parseInt(hunkMatch[3], 10),
        newCount: hunkMatch[4] !== undefined ? parseInt(hunkMatch[4], 10) : 1,
        lines: []
      };
      continue;
    }
    if (currentHunk) {
      if (line.startsWith("+") || line.startsWith("-") || line.startsWith(" ") || line === "") {
        currentHunk.lines.push(line);
      }
    }
  }
  if (currentHunk) hunks.push(currentHunk);
  return hunks;
}

export function applyUnifiedDiff(originalContent: string, diffText: string): string {
  const isCRLF = originalContent.includes("\r\n");
  const fileLines = originalContent.split(/\r?\n/);
  const hasTrailingNewline = originalContent.endsWith("\n");
  if (hasTrailingNewline && fileLines[fileLines.length - 1] === "") {
    fileLines.pop();
  }

  const hunks = parseUnifiedDiff(diffText);
  if (hunks.length === 0) {
    throw new Error("No valid diff hunks found in patch");
  }

  let lineOffset = 0;

  for (const hunk of hunks) {
    const targetIndex = hunk.oldStart - 1 + lineOffset;
    let matchedIndex = -1;
    const searchRadii = [0, 1, -1, 2, -2, 3, -3, 4, -4, 5, -5];

    for (const radius of searchRadii) {
      const testIndex = targetIndex + radius;
      if (testIndex < 0 || testIndex > fileLines.length) continue;

      let matches = true;
      let oldLineIdx = 0;
      for (const hunkLine of hunk.lines) {
        if (hunkLine.startsWith("-") || hunkLine.startsWith(" ")) {
          const expected = hunkLine.slice(1);
          const actual = fileLines[testIndex + oldLineIdx];
          if (actual === undefined || actual !== expected) {
            matches = false;
            break;
          }
          oldLineIdx++;
        }
      }
      if (matches) {
        matchedIndex = testIndex;
        break;
      }
    }

    if (matchedIndex === -1) {
      throw new Error(`Failed to apply diff hunk starting at line ${hunk.oldStart}: context mismatch`);
    }

    const newHunkLines: string[] = [];
    let oldLinesConsumed = 0;

    for (const hunkLine of hunk.lines) {
      if (hunkLine.startsWith(" ")) {
        newHunkLines.push(hunkLine.slice(1));
        oldLinesConsumed++;
      } else if (hunkLine.startsWith("-")) {
        oldLinesConsumed++;
      } else if (hunkLine.startsWith("+")) {
        newHunkLines.push(hunkLine.slice(1));
      }
    }

    fileLines.splice(matchedIndex, oldLinesConsumed, ...newHunkLines);
    lineOffset += newHunkLines.length - oldLinesConsumed;
  }

  const joiner = isCRLF ? "\r\n" : "\n";
  let result = fileLines.join(joiner);
  if (hasTrailingNewline) {
    result += joiner;
  }
  return result;
}

function matchSimpleGlob(filePath: string, pattern: string): boolean {
  const normalizedPath = filePath.replace(/\\/g, "/");
  const normalizedPattern = pattern.replace(/\\/g, "/");
  const regexPattern = normalizedPattern
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*\*/g, "___DOUBLESTAR___")
    .replace(/\*/g, "[^/]*")
    .replace(/___DOUBLESTAR___/g, ".*")
    .replace(/\?/g, "[^/]");
  const regex = new RegExp(`^${regexPattern}$`, "i");
  return regex.test(normalizedPath) || regex.test(normalizedPath.split("/").pop() ?? "");
}

function globFiles(root: string, baseDir: string, pattern: string, limit = 200): string[] {
  const results: string[] = [];
  const startDir = resolveWorkspacePath(root, baseDir);
  if (!existsSync(startDir)) return [];

  const visit = (currentDir: string): void => {
    if (results.length >= limit) return;
    const entries = readdirSync(currentDir, { withFileTypes: true });
    for (const entry of entries) {
      if (results.length >= limit) break;
      if (entry.name === "node_modules" || entry.name === ".git" || entry.name === "dist" || entry.name === ".vectiscode") continue;
      const fullPath = join(currentDir, entry.name);
      const relToRoot = relative(root, fullPath).replace(/\\/g, "/");
      const relToBase = relative(startDir, fullPath).replace(/\\/g, "/");

      if (entry.isDirectory()) {
        visit(fullPath);
      } else if (entry.isFile()) {
        if (matchSimpleGlob(relToRoot, pattern) || matchSimpleGlob(relToBase, pattern) || matchSimpleGlob(entry.name, pattern)) {
          results.push(relToRoot);
        }
      }
    }
  };

  visit(startDir);
  return results;
}

function searchFiles(root: string, query: string, limit: number, signal?: AbortSignal): Array<{ path: string; line: number; text: string }> {
  const matches: Array<{ path: string; line: number; text: string }> = [];
  const lowerQuery = query.toLowerCase();

  const visit = (directory: string): void => {
    if (signal?.aborted || matches.length >= limit) return;
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      if (signal?.aborted || matches.length >= limit) break;
      if (entry.name === "node_modules" || entry.name === ".git" || entry.name === "dist" || entry.name === ".vectiscode") continue;
      const path = resolveWorkspacePath(root, relative(root, join(directory, entry.name)));
      if (entry.isDirectory()) {
        visit(path);
      } else if (entry.isFile()) {
        const stats = statSync(path);
        if (stats.size > 1_000_000) continue;
        let content: string;
        try {
          const buffer = readFileSync(path);
          if (buffer.includes(0)) continue;
          content = buffer.toString("utf8");
        } catch {
          continue;
        }
        const lines = content.split(/\r?\n/);
        for (let i = 0; i < lines.length; i++) {
          if (signal?.aborted || matches.length >= limit) break;
          const line = lines[i];
          if (line.toLowerCase().includes(lowerQuery)) {
            matches.push({ path: relative(root, path).replace(/\\/g, "/"), line: i + 1, text: line.trim().slice(0, 300) });
          }
        }
      }
    }
  };

  visit(root);
  return matches;
}

function writeAtomic(path: string, content: string): void {
  mkdirSync(dirname(path), { recursive: true });
  const tempPath = `${path}.${Date.now()}.${Math.random().toString(36).slice(2, 8)}.tmp`;
  try {
    writeFileSync(tempPath, content, "utf8");
    renameSync(tempPath, path);
  } catch (error) {
    if (existsSync(tempPath)) {
      try { unlinkSync(tempPath); } catch {}
    }
    writeFileSync(path, content, "utf8");
  }
}

export class RobloxToolExecutor implements ToolExecutor {
  constructor(private readonly mcp: StudioMcpClient = studioMcp) {}

  async definitions(): Promise<ToolDefinition[]> {
    const localTools: ToolDefinition[] = [
      {
        name: "fs.read",
        description: "Read a UTF-8 file inside the current project with optional line bounds",
        inputSchema: {
          type: "object",
          properties: {
            path: { type: "string" },
            start_line: { type: "number", description: "1-based starting line index" },
            end_line: { type: "number", description: "1-based ending line index" }
          },
          required: ["path"]
        },
        risk: "read"
      },
      {
        name: "fs.search",
        description: "Search text files inside the current project",
        inputSchema: {
          type: "object",
          properties: {
            query: { type: "string" },
            limit: { type: "number" }
          },
          required: ["query"]
        },
        risk: "read"
      },
      {
        name: "fs.write",
        description: "Write a UTF-8 file inside the current project with a rollback checkpoint",
        inputSchema: {
          type: "object",
          properties: {
            path: { type: "string" },
            content: { type: "string" }
          },
          required: ["path", "content"]
        },
        risk: "write"
      },
      {
        name: "fs.edit",
        description: "Edit a portion of a file identified by unique exact search text",
        inputSchema: {
          type: "object",
          properties: {
            path: { type: "string" },
            search: { type: "string" },
            replacement: { type: "string" }
          },
          required: ["path", "search", "replacement"]
        },
        risk: "write"
      },
      {
        name: "fs.patch",
        description: "Apply a unified diff inside the current project with context verification",
        inputSchema: {
          type: "object",
          properties: {
            path: { type: "string" },
            diff: { type: "string" }
          },
          required: ["path", "diff"]
        },
        risk: "write"
      },
      {
        name: "fs.glob",
        description: "List files matching a glob pattern",
        inputSchema: {
          type: "object",
          properties: {
            pattern: { type: "string" },
            base: { type: "string" }
          },
          required: ["pattern"]
        },
        risk: "read"
      },
      {
        name: "fs.list",
        description: "List directory entries",
        inputSchema: {
          type: "object",
          properties: {
            path: { type: "string" }
          },
          required: ["path"]
        },
        risk: "read"
      }
    ];

    const project = detectRobloxProject(process.cwd());
    if (project.enabled) {
      localTools.push({
        name: "roblox.detect",
        description: `Roblox project detected: ${project.signals.join(", ")}`,
        inputSchema: { type: "object", properties: {} },
        risk: "read"
      });
    }

    try {
      if (!this.mcp.status().connected) await this.mcp.connect();
      return [...localTools, ...this.mcp.definitions()];
    } catch {
      return localTools;
    }
  }

  async execute(call: ToolCall, context: ToolExecutionContext): Promise<ToolReceipt> {
    const startedAt = new Date().toISOString();
    try {
      if (call.name === "fs.read") {
        const requested = stringArgument(call, "path");
        const path = resolveWorkspacePath(context.cwd, requested);
        if (!existsSync(path)) throw new Error(`File not found: ${requested}`);

        const stats = statSync(path);
        const buffer = readFileSync(path);
        const isBinary = buffer.includes(0);
        if (isBinary) {
          return receipt(call, "read", startedAt, {
            ok: true,
            summary: `Read ${requested} (binary file, ${stats.size} bytes)`,
            output: { path: requested, isBinary: true, bytes: stats.size }
          });
        }

        const fullContent = buffer.toString("utf8");
        const lines = fullContent.split(/\r?\n/);
        const startLine = typeof call.arguments.start_line === "number" ? Math.max(1, Math.floor(call.arguments.start_line)) : 1;
        const endLine = typeof call.arguments.end_line === "number" ? Math.min(lines.length, Math.floor(call.arguments.end_line)) : lines.length;

        const slice = lines.slice(startLine - 1, endLine);
        const outputContent = slice.join("\n");
        const isTruncated = slice.length < lines.length || Buffer.byteLength(outputContent) > 50_000;

        return receipt(call, "read", startedAt, {
          ok: true,
          summary: `Read ${requested} (${startLine}-${endLine} of ${lines.length} lines)`,
          output: {
            path: requested,
            content: outputContent.slice(0, 50_000),
            totalLines: lines.length,
            startLine,
            endLine,
            truncated: isTruncated
          }
        });
      }

      if (call.name === "fs.search") {
        const query = stringArgument(call, "query");
        const limitValue = call.arguments.limit;
        const limit = typeof limitValue === "number" ? Math.max(1, Math.min(200, Math.floor(limitValue))) : 50;
        const matches = searchFiles(context.cwd, query, limit, context.signal);
        return receipt(call, "read", startedAt, {
          ok: true,
          summary: `Found ${matches.length} matches for "${query}"`,
          output: matches
        });
      }

      if (call.name === "fs.write") {
        const requested = stringArgument(call, "path");
        const content = typeof call.arguments.content === "string" ? call.arguments.content : "";
        const path = resolveWorkspacePath(context.cwd, requested);
        const checkpointId = checkpointFile({
          cwd: context.cwd,
          absolutePath: path,
          nextContent: content,
          sessionId: context.sessionId,
          turnId: context.turnId
        });
        writeAtomic(path, content);
        return receipt(call, "write", startedAt, {
          ok: true,
          summary: `Wrote ${requested} (${Buffer.byteLength(content)} bytes)`,
          output: { path: requested, bytes: Buffer.byteLength(content) },
          checkpointId
        });
      }

      if (call.name === "fs.edit") {
        const requested = stringArgument(call, "path");
        const search = stringArgument(call, "search");
        const replacement = typeof call.arguments.replacement === "string" ? call.arguments.replacement : "";
        const path = resolveWorkspacePath(context.cwd, requested);
        if (!existsSync(path)) throw new Error(`File not found: ${requested}`);

        const original = readFileSync(path, "utf8");
        const occurrences = original.split(search).length - 1;
        if (occurrences === 0) throw new Error(`Search text not found in ${requested}`);
        if (occurrences > 1) {
          throw new Error(`Ambiguous edit: search text found ${occurrences} times in ${requested}. Provide more surrounding context.`);
        }

        const next = original.replace(search, replacement);
        const checkpointId = checkpointFile({
          cwd: context.cwd,
          absolutePath: path,
          nextContent: next,
          sessionId: context.sessionId,
          turnId: context.turnId
        });
        writeAtomic(path, next);
        return receipt(call, "write", startedAt, {
          ok: true,
          summary: `Edited ${requested}`,
          output: { path: requested },
          checkpointId
        });
      }

      if (call.name === "fs.patch") {
        const requested = stringArgument(call, "path");
        const diff = stringArgument(call, "diff");
        const path = resolveWorkspacePath(context.cwd, requested);
        if (!existsSync(path)) throw new Error(`File not found: ${requested}`);

        const original = readFileSync(path, "utf8");
        const next = applyUnifiedDiff(original, diff);
        const checkpointId = checkpointFile({
          cwd: context.cwd,
          absolutePath: path,
          nextContent: next,
          sessionId: context.sessionId,
          turnId: context.turnId
        });
        writeAtomic(path, next);
        return receipt(call, "write", startedAt, {
          ok: true,
          summary: `Patched ${requested}`,
          output: { path: requested },
          checkpointId
        });
      }

      if (call.name === "fs.glob") {
        const pattern = stringArgument(call, "pattern");
        const base = typeof call.arguments.base === "string" ? call.arguments.base : ".";
        const matches = globFiles(context.cwd, base, pattern);
        return receipt(call, "read", startedAt, {
          ok: true,
          summary: `Found ${matches.length} files matching "${pattern}" in ${base}`,
          output: matches
        });
      }

      if (call.name === "fs.list") {
        const requested = typeof call.arguments.path === "string" ? call.arguments.path : ".";
        const path = resolveWorkspacePath(context.cwd, requested);
        if (!existsSync(path)) throw new Error(`Path not found: ${requested}`);
        const entries = readdirSync(path, { withFileTypes: true })
          .filter((entry) => entry.name !== ".git" && entry.name !== "node_modules" && entry.name !== ".vectiscode")
          .slice(0, 200)
          .map((entry) => ({
            name: entry.name,
            isDirectory: entry.isDirectory(),
            isFile: entry.isFile()
          }));
        return receipt(call, "read", startedAt, {
          ok: true,
          summary: `Listed ${entries.length} entries in ${requested}`,
          output: entries
        });
      }

      if (call.name === "roblox.detect") {
        const project = detectRobloxProject(context.cwd);
        return receipt(call, "read", startedAt, {
          ok: true,
          summary: `Roblox detection: ${project.signals.join(", ") || "none"}`,
          output: project
        });
      }

      const definition = this.mcp.definitions().find((item) => item.name === call.name);
      if (!definition) throw new Error(`Unknown tool: ${call.name}`);
      const before = await this.mcp.beginMutation(call.name, call.arguments);
      const output = await this.mcp.callTool(call.name, call.arguments);
      const receiptRecord = await this.mcp.completeMutation(call.name, call.arguments, before);
      return receipt(call, definition.risk, startedAt, {
        ok: true,
        summary: `Studio tool ${call.name} completed`,
        output,
        studioReceipt: receiptRecord
      });
    } catch (error) {
      const definition = (await this.definitions()).find((item) => item.name === call.name);
      return receipt(call, definition?.risk ?? "unknown", startedAt, {
        ok: false,
        summary: error instanceof Error ? error.message : String(error)
      });
    }
  }
}
