#!/usr/bin/env node
import { performance } from "node:perf_hooks";
import { StudioMcpClient, classifyStudioTool, detectRobloxProject } from "../packages/roblox/dist/index.js";
import { RobloxToolExecutor, parseUnifiedDiff, applyUnifiedDiff } from "../packages/roblox/dist/tools.js";

async function main() {
  console.log("== [verify:connector] Studio MCP Contract & Tools Test ==");
  const start = performance.now();

  // 1. Tool Classification Tests
  const classifications = [
    { tool: "script_read", expected: "read" },
    { tool: "script_search", expected: "read" },
    { tool: "script_grep", expected: "read" },
    { tool: "search_game_tree", expected: "read" },
    { tool: "inspect_instance", expected: "read" },
    { tool: "get_studio_state", expected: "read" },
    { tool: "get_console_output", expected: "read" },
    { tool: "screen_capture", expected: "read" },
    { tool: "multi_edit", expected: "write" },
    { tool: "execute_luau", expected: "destructive" },
    { tool: "character_navigation", expected: "destructive" },
    { tool: "user_keyboard_input", expected: "destructive" },
    { tool: "set_active_studio", expected: "external" }
  ];

  for (const { tool, expected } of classifications) {
    const actual = classifyStudioTool(tool);
    if (actual !== expected) {
      console.error(`FAIL: classifyStudioTool("${tool}") returned "${actual}", expected "${expected}"`);
      process.exit(1);
    }
  }
  console.log(`✓ Verified ${classifications.length} Studio MCP tool risk classifications`);

  // 2. Diff & Patch Engine Verification
  const sampleSource = "local x = 1\nlocal y = 2\nlocal z = 3\n";
  const sampleDiff = "--- a/test.luau\n+++ b/test.luau\n@@ -1,3 +1,3 @@\n local x = 1\n-local y = 2\n+local y = 20\n local z = 3\n";
  const hunks = parseUnifiedDiff(sampleDiff);
  if (hunks.length !== 1 || hunks[0].oldCount !== 3 || hunks[0].newCount !== 3) {
    console.error("FAIL: parseUnifiedDiff returned unexpected hunk structure");
    process.exit(1);
  }
  const patched = applyUnifiedDiff(sampleSource, sampleDiff);
  if (patched !== "local x = 1\nlocal y = 20\nlocal z = 3\n") {
    console.error(`FAIL: applyUnifiedDiff produced unexpected output: ${JSON.stringify(patched)}`);
    process.exit(1);
  }
  console.log("✓ Verified unified diff parser and context-aware patch applicator");

  // 3. Studio MCP Client Contract
  const client = new StudioMcpClient();
  const status = client.status();
  console.log(`✓ Studio MCP launcher status: ${status.command} (connected: ${status.connected})`);

  const elapsed = (performance.now() - start).toFixed(2);
  console.log(`== [verify:connector] Completed in ${elapsed}ms: ALL CHECKS PASSED ==`);
}

main().catch((err) => {
  console.error("verify:connector failed:", err);
  process.exit(1);
});
