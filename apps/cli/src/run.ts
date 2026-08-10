import { runAgent, type AgentEvent, type PermissionMode, credentialVault } from "@vectiscode/core";
import { createProviderRegistry } from "@vectiscode/providers";
import { RobloxToolExecutor } from "@vectiscode/roblox";

import { output } from "./output.js";
import { confirm } from "./prompt.js";

export interface HeadlessRunOptions {
  json?: boolean;
  provider: string;
  model: string;
  mode: PermissionMode;
  cwd: string;
  sessionId?: string;
}

export async function runHeadless(prompt: string, options: HeadlessRunOptions) {
  const provider = createProviderRegistry(credentialVault).get(options.provider);
  const validation = await provider.validate();
  if (!validation.ok) throw new Error(validation.detail ?? `${provider.label} is not configured`);
  let streamed = false;
  const onEvent = (event: AgentEvent): void => {
    if (options.json) {
      output.line(JSON.stringify(event));
      return;
    }
    if (event.type === "message.delta" && typeof event.payload.delta === "string") {
      streamed = true;
      output.write(event.payload.delta);
    } else if (event.type === "tool.requested") {
      output.muted(`\n[tool] ${JSON.stringify(event.payload.call)}`);
    }
  };
  const result = await runAgent({
    prompt,
    cwd: options.cwd,
    provider,
    model: options.model,
    permissionMode: options.mode,
    sessionId: options.sessionId,
    tools: new RobloxToolExecutor(),
    approve: async (call, definition) => confirm(`${definition.risk} tool ${call.name} wants to run. Approve?`),
    onEvent
  });
  if (!options.json) {
    if (!streamed && result.text) output.line(result.text);
    output.muted(`\nSession ${result.sessionId.slice(0, 8)} - ${result.receipts.length} tool receipt(s) - ${result.status}`);
  }
  return result;
}
