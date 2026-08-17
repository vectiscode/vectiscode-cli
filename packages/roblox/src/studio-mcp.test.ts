import { describe, expect, it } from "vitest";

import { classifyStudioTool } from "./studio-mcp.js";

describe("Studio MCP risk classification", () => {
  it("classifies pure read tools as read", () => {
    expect(classifyStudioTool("script_read")).toBe("read");
    expect(classifyStudioTool("search_game_tree")).toBe("read");
    expect(classifyStudioTool("inspect_instance")).toBe("read");
    expect(classifyStudioTool("get_console_output")).toBe("read");
    expect(classifyStudioTool("screen_capture")).toBe("read");
    expect(classifyStudioTool("list_roblox_studios")).toBe("read");
  });

  it("classifies write and mutation tools as write", () => {
    expect(classifyStudioTool("script_write")).toBe("write");
    expect(classifyStudioTool("multi_edit")).toBe("write");
    expect(classifyStudioTool("insert_model")).toBe("write");
    expect(classifyStudioTool("set_property")).toBe("write");
    expect(classifyStudioTool("read_and_write")).toBe("write");
  });

  it("classifies destructive and execution tools as destructive", () => {
    expect(classifyStudioTool("delete_instance")).toBe("destructive");
    expect(classifyStudioTool("destroy_model")).toBe("destructive");
    expect(classifyStudioTool("execute_luau")).toBe("destructive");
    expect(classifyStudioTool("get_and_delete")).toBe("destructive");
    expect(classifyStudioTool("mouse_click")).toBe("destructive");
  });

  it("classifies unknown tools as unknown", () => {
    expect(classifyStudioTool("arbitrary_unknown_plugin_tool")).toBe("unknown");
    expect(classifyStudioTool("custom_extension")).toBe("unknown");
  });
});
