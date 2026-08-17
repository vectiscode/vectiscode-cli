import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport, type StdioServerParameters } from "@modelcontextprotocol/client/stdio";

import type { ToolDefinition, ToolRisk } from "@vectiscode/core";

export interface StudioMcpStatus {
  connected: boolean;
  command: string;
  toolCount: number;
  detail: string;
}

export interface PlaytestState {
  active: boolean;
  startedAt?: string;
  studioId?: string;
  error?: string;
}

export interface VisualQaResult {
  ok: boolean;
  summary: string;
  evidence?: unknown[];
}

export interface StudioMutationReceipt {
  studioId: string;
  tool: string;
  risk: ToolRisk;
  reversible: boolean;
  checkpointId?: string;
  before: unknown;
  after: unknown;
  verified: boolean;
  receivedAt: string;
  error?: string;
}

function studioCommand(): StdioServerParameters {
  if (process.env.VECTISCODE_MCP_COMMAND) {
    return {
      command: process.env.VECTISCODE_MCP_COMMAND,
      args: process.env.VECTISCODE_MCP_ARGS ? JSON.parse(process.env.VECTISCODE_MCP_ARGS) as string[] : []
    };
  }
  if (process.platform === "win32") {
    const path = join(process.env.LOCALAPPDATA ?? "", "Roblox", "mcp.bat");
    if (!existsSync(path)) throw new Error(`Roblox Studio MCP launcher not found at ${path}. Enable Studio as an MCP server first.`);
    return { command: "cmd.exe", args: ["/d", "/s", "/c", path], stderr: "pipe" };
  }
  if (process.platform === "darwin") {
    const path = "/Applications/RobloxStudio.app/Contents/MacOS/StudioMCP";
    if (!existsSync(path)) throw new Error(`Roblox Studio MCP launcher not found at ${path}. Enable Studio as an MCP server first.`);
    return { command: path, stderr: "pipe" };
  }
  throw new Error("Roblox Studio MCP is currently supported on Windows and macOS.");
}

export function classifyStudioTool(name: string): ToolRisk {
  if (name === "set_active_studio") return "external";
  if (/delete|remove|destroy|execute|input|mouse|keyboard|navigation|character|subagent/i.test(name)) return "destructive";
  if (/write|edit|multi_edit|create|insert|set|update|generate|upload|store|play/i.test(name)) return "write";

  const readTools = new Set([
    "list_roblox_studios",
    "script_read",
    "script_search",
    "script_grep",
    "search_game_tree",
    "inspect_instance",
    "get_studio_state",
    "get_console_output",
    "screen_capture",
    "http_get",
    "skill",
    "search_asset",
    "wait_job_finished",
    "get_output",
    "get_selection",
    "docs_search",
    "skills_list"
  ]);
  if (readTools.has(name)) return "read";
  if (/^(get|list|read|search|grep|inspect)_[a-z0-9_]+$/i.test(name) && !/(delete|remove|destroy|write|edit|create|insert|set|update|exec)/i.test(name)) {
    return "read";
  }
  return "unknown";
}

export class StudioMcpClient {
  private client: Client | null = null;
  private transport: StdioClientTransport | null = null;
  private tools: ToolDefinition[] = [];
  private activeStudioId = "active";

  async connect(): Promise<StudioMcpStatus> {
    if (this.client) return this.status();
    const command = studioCommand();
    const transport = new StdioClientTransport(command);
    const client = new Client({ name: "vectiscode", version: "0.1.0-alpha.1" });
    try {
      await client.connect(transport);
      const listed = await client.listTools();
      this.tools = listed.tools.map((tool) => ({
        name: tool.name,
        description: tool.description ?? `Roblox Studio MCP tool ${tool.name}`,
        inputSchema: tool.inputSchema as Record<string, unknown>,
        risk: classifyStudioTool(tool.name)
      }));
      this.client = client;
      this.transport = transport;
      return this.status();
    } catch (error) {
      await transport.close().catch(() => undefined);
      throw new Error(`Could not connect to Roblox Studio MCP: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  async close(): Promise<void> {
    const client = this.client;
    this.client = null;
    this.transport = null;
    this.tools = [];
    await client?.close();
  }

  status(): StudioMcpStatus {
    let command = "not available";
    try {
      const parameters = studioCommand();
      command = [parameters.command, ...(parameters.args ?? [])].join(" ");
    } catch (error) {
      return { connected: false, command, toolCount: 0, detail: error instanceof Error ? error.message : String(error) };
    }
    return {
      connected: Boolean(this.client),
      command,
      toolCount: this.tools.length,
      detail: this.client ? `Connected with ${this.tools.length} Studio tools` : "Not connected"
    };
  }

  definitions(): ToolDefinition[] {
    return [...this.tools];
  }

  async callTool(name: string, argumentsValue: Record<string, unknown>): Promise<unknown> {
    if (!this.client) await this.connect();
    if (!this.client) throw new Error("Studio MCP did not initialize");
    const result = await this.client.callTool({ name, arguments: argumentsValue });
    if (result.isError) {
      const errorDetail = Array.isArray(result.content)
        ? result.content.map((item) => ("text" in item ? item.text : JSON.stringify(item))).join("\n")
        : JSON.stringify(result.content);
      throw new Error(`Studio tool ${name} failed: ${errorDetail}`);
    }
    return result.structuredContent ?? result.content;
  }

  async listStudios(): Promise<unknown> {
    return this.callTool("list_roblox_studios", {});
  }

  async selectStudio(studioId: string): Promise<unknown> {
    this.activeStudioId = studioId;
    return this.callTool("set_active_studio", { studio_id: studioId });
  }

  private async captureBefore(name: string, argumentsValue: Record<string, unknown>): Promise<unknown> {
    const target = argumentsValue.path ?? argumentsValue.script_id ?? argumentsValue.instance_id;
    if (target && typeof target === "string" && /script|edit|write|property/i.test(name)) {
      try {
        return await this.callTool("script_read", { path: target });
      } catch {
        return null;
      }
    }
    return null;
  }

  async beginMutation(name: string, argumentsValue: Record<string, unknown>, studioId = this.activeStudioId): Promise<unknown> {
    return this.captureBefore(name, argumentsValue);
  }

  async completeMutation(name: string, argumentsValue: Record<string, unknown>, before: unknown, studioId = this.activeStudioId): Promise<StudioMutationReceipt> {
    let after: unknown = null;
    let verified = false;
    const isDestructive = /delete|destroy|execute|input|upload/i.test(name);
    const reversible = !isDestructive && /write|edit|multi_edit|create|insert|set|update/i.test(name);
    const target = argumentsValue.path ?? argumentsValue.script_id ?? argumentsValue.instance_id;

    if (target && typeof target === "string" && /write|edit|multi_edit|set|update/i.test(name)) {
      try {
        after = await this.callTool("script_read", { path: target });
        verified = Boolean(after !== null && after !== undefined);
      } catch {
        verified = false;
        after = null;
      }
    } else {
      verified = true;
    }

    return {
      studioId,
      tool: name,
      risk: classifyStudioTool(name),
      reversible,
      before,
      after,
      verified,
      receivedAt: new Date().toISOString()
    };
  }

  async getStudioState(): Promise<Record<string, unknown>> {
    const result = await this.callTool("get_studio_state", {});
    return typeof result === "object" && result !== null ? (result as Record<string, unknown>) : { raw: result };
  }

  async startPlaytest(): Promise<PlaytestState> {
    const hasStartStop = this.tools.some((t) => t.name === "start_stop_play");
    const toolName = hasStartStop ? "start_stop_play" : "playtest_start";
    const args = hasStartStop ? { play: true } : {};
    const result = await this.callTool(toolName, args);
    return {
      active: true,
      startedAt: new Date().toISOString(),
      studioId: this.activeStudioId,
      ...(typeof result === "object" && result !== null ? (result as Record<string, unknown>) : {})
    };
  }

  async stopPlaytest(): Promise<PlaytestState> {
    const hasStartStop = this.tools.some((t) => t.name === "start_stop_play");
    const toolName = hasStartStop ? "start_stop_play" : "playtest_stop";
    const args = hasStartStop ? { play: false } : {};
    await this.callTool(toolName, args);
    return { active: false, studioId: this.activeStudioId };
  }

  async captureConsole(): Promise<Array<Record<string, unknown>>> {
    const hasConsoleOutput = this.tools.some((t) => t.name === "get_console_output");
    const toolName = hasConsoleOutput ? "get_console_output" : "get_output";
    const result = await this.callTool(toolName, {});
    const rows = Array.isArray(result) ? result : (result as { output?: unknown; logs?: unknown } | undefined)?.output ?? (result as { logs?: unknown } | undefined)?.logs;
    return Array.isArray(rows) ? (rows as Array<Record<string, unknown>>) : [];
  }

  async captureScreenshot(): Promise<unknown> {
    const hasScreenCapture = this.tools.some((t) => t.name === "screen_capture");
    const toolName = hasScreenCapture ? "screen_capture" : "screenshot";
    return this.callTool(toolName, {});
  }

  async runVisualQa(): Promise<VisualQaResult> {
    const state = await this.captureConsole();
    const screenshot = await this.captureScreenshot().catch(() => null);
    const errors = state.filter((row) => {
      const severity = String(row.severity ?? row.level ?? row.type ?? row.message_type ?? "").toLowerCase();
      return severity.includes("error") || severity.includes("critical");
    });
    const summary = errors.length
      ? `Playtest console reported ${errors.length} error(s)`
      : `Playtest console clean with ${state.length} log line(s)`;
    return {
      ok: errors.length === 0,
      summary,
      evidence: [{ console: state.slice(-20) }, screenshot ? { screenshot } : null].filter(Boolean)
    };
  }
}

export const studioMcp = new StudioMcpClient();

export function detectRobloxProject(cwd = process.cwd()): { enabled: boolean; signals: string[] } {
  const signals: string[] = [];
  const candidates = ["default.project.json", "aftman.toml", "selene.toml", "stylua.toml"];
  for (const pattern of candidates) {
    if (existsSync(join(cwd, pattern))) signals.push(pattern === "default.project.json" ? "Rojo project" : pattern.replace(/\.toml$/, "").replace(/^(\w)/, (first) => first.toUpperCase()));
  }
  const visit = (directory: string, depth: number): void => {
    if (depth > 2) return;
    try {
      for (const entry of readdirSync(directory, { withFileTypes: true })) {
        if (entry.name === "node_modules" || entry.name === ".git" || entry.name === "dist" || entry.name === ".vectiscode") continue;
        if (signals.includes("Luau source") && signals.includes("Studio place")) return;
        if (entry.isDirectory()) {
          visit(join(directory, entry.name), depth + 1);
        } else if (entry.name.endsWith(".rbxl") || entry.name.endsWith(".rbxlx") || entry.name.endsWith(".rbxlx.bak")) {
          signals.push("Studio place");
        } else if (entry.name.endsWith(".lua") || entry.name.endsWith(".luau")) {
          signals.push("Luau source");
        }
      }
    } catch {
      // Ignore permission or read errors in nested directories
    }
  };
  visit(cwd, 0);
  return { enabled: signals.length > 0, signals: [...new Set(signals)] };
}
