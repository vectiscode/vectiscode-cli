import { existsSync } from "node:fs";
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
  const readTools = new Set([
    "list_roblox_studios",
    "script_read",
    "script_search",
    "script_grep",
    "instance_search",
    "get_output",
    "get_selection",
    "docs_search",
    "skills_list"
  ]);
  if (readTools.has(name) || /^(get|list|read|search|grep|inspect)_/.test(name)) return "read";
  if (name === "set_active_studio") return "external";
  if (/delete|remove|destroy|execute|input|mouse|keyboard/i.test(name)) return "destructive";
  if (/write|edit|create|insert|set|update|playtest/i.test(name)) return "write";
  return "unknown";
}

export class StudioMcpClient {
  private client: Client | null = null;
  private transport: StdioClientTransport | null = null;
  private tools: ToolDefinition[] = [];

  async connect(): Promise<StudioMcpStatus> {
    if (this.client) return this.status();
    const command = studioCommand();
    const transport = new StdioClientTransport(command);
    const client = new Client({ name: "vectiscode", version: "0.1.0-alpha.0" });
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
      detail: this.client ? "Connected through stdio" : "Not connected"
    };
  }

  definitions(): ToolDefinition[] {
    return [...this.tools];
  }

  async callTool(name: string, argumentsValue: Record<string, unknown>): Promise<unknown> {
    if (!this.client) await this.connect();
    if (!this.client) throw new Error("Studio MCP did not initialize");
    const result = await this.client.callTool({ name, arguments: argumentsValue });
    if (result.isError) throw new Error(`Studio tool ${name} failed: ${JSON.stringify(result.content)}`);
    return result.structuredContent ?? result.content;
  }

  async listStudios(): Promise<unknown> {
    return this.callTool("list_roblox_studios", {});
  }

  async selectStudio(studioId: string): Promise<unknown> {
    return this.callTool("set_active_studio", { studio_id: studioId });
  }
}

export const studioMcp = new StudioMcpClient();
