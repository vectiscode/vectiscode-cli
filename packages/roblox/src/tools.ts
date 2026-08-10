import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { dirname, relative } from "node:path";

import type { ToolCall, ToolDefinition, ToolExecutionContext, ToolExecutor, ToolReceipt } from "@vectiscode/core";

import { checkpointFile } from "./checkpoints.js";
import { resolveWorkspacePath } from "./path-safety.js";
import { studioMcp, type StudioMcpClient } from "./studio-mcp.js";

function stringArgument(call: ToolCall, name: string): string {
  const value = call.arguments[name];
  if (typeof value !== "string" || !value) throw new Error(`${call.name} requires a non-empty ${name} string`);
  return value;
}

function receipt(call: ToolCall, risk: ToolDefinition["risk"], startedAt: string, options: Omit<ToolReceipt, "toolCallId" | "toolName" | "risk" | "startedAt" | "completedAt">): ToolReceipt {
  return { toolCallId: call.id, toolName: call.name, risk, startedAt, completedAt: new Date().toISOString(), ...options };
}

function searchFiles(root: string, query: string, limit: number): Array<{ path: string; line: number; text: string }> {
  const matches: Array<{ path: string; line: number; text: string }> = [];
  const visit = (directory: string): void => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      if (matches.length >= limit || entry.name === "node_modules" || entry.name === ".git" || entry.name === "dist") continue;
      const path = resolveWorkspacePath(root, relative(root, `${directory}/${entry.name}`));
      if (entry.isDirectory()) visit(path);
      else if (entry.isFile() && statSync(path).size <= 1_000_000) {
        let content: string;
        try { content = readFileSync(path, "utf8"); } catch { continue; }
        content.split(/\r?\n/).forEach((line, index) => {
          if (matches.length < limit && line.toLowerCase().includes(query.toLowerCase())) matches.push({ path: relative(root, path), line: index + 1, text: line.trim().slice(0, 300) });
        });
      }
    }
  };
  visit(root);
  return matches;
}

export class RobloxToolExecutor implements ToolExecutor {
  constructor(private readonly mcp: StudioMcpClient = studioMcp) {}

  async definitions(): Promise<ToolDefinition[]> {
    const localTools: ToolDefinition[] = [
      { name: "fs.read", description: "Read a UTF-8 file inside the current project", inputSchema: { type: "object", properties: { path: { type: "string" } }, required: ["path"] }, risk: "read" },
      { name: "fs.search", description: "Search text files inside the current project", inputSchema: { type: "object", properties: { query: { type: "string" }, limit: { type: "number" } }, required: ["query"] }, risk: "read" },
      { name: "fs.write", description: "Write a UTF-8 file inside the current project with a rollback checkpoint", inputSchema: { type: "object", properties: { path: { type: "string" }, content: { type: "string" } }, required: ["path", "content"] }, risk: "write" }
    ];
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
        return receipt(call, "read", startedAt, { ok: true, summary: `Read ${requested}`, output: { path: requested, content: readFileSync(path, "utf8") } });
      }
      if (call.name === "fs.search") {
        const query = stringArgument(call, "query");
        const limitValue = call.arguments.limit;
        const limit = typeof limitValue === "number" ? Math.max(1, Math.min(200, Math.floor(limitValue))) : 50;
        const matches = searchFiles(context.cwd, query, limit);
        return receipt(call, "read", startedAt, { ok: true, summary: `Found ${matches.length} matches for ${query}`, output: matches });
      }
      if (call.name === "fs.write") {
        const requested = stringArgument(call, "path");
        const content = stringArgument(call, "content");
        const path = resolveWorkspacePath(context.cwd, requested);
        const checkpointId = checkpointFile({ cwd: context.cwd, absolutePath: path, nextContent: content, sessionId: context.sessionId, turnId: context.turnId });
        mkdirSync(dirname(path), { recursive: true });
        writeFileSync(path, content, "utf8");
        return receipt(call, "write", startedAt, { ok: true, summary: `Wrote ${requested}`, output: { path: requested, bytes: Buffer.byteLength(content) }, checkpointId });
      }
      const definition = this.mcp.definitions().find((item) => item.name === call.name);
      if (!definition) throw new Error(`Unknown tool: ${call.name}`);
      const output = await this.mcp.callTool(call.name, call.arguments);
      return receipt(call, definition.risk, startedAt, { ok: true, summary: `Studio tool ${call.name} completed`, output });
    } catch (error) {
      const definition = (await this.definitions()).find((item) => item.name === call.name);
      return receipt(call, definition?.risk ?? "unknown", startedAt, { ok: false, summary: error instanceof Error ? error.message : String(error) });
    }
  }
}
