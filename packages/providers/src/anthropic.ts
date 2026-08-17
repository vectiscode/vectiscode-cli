import type { AgentMessage, CredentialVault, ProviderAdapter, ProviderTurnRequest, ProviderTurnResult, ToolCall } from "@vectiscode/core";

import { asArray, asNumber, asRecord, asString, emptyUsage, parseJsonObject, readSse, responseError } from "./shared.js";

function anthropicMessages(messages: AgentMessage[]): unknown[] {
  const result: unknown[] = [];
  for (const message of messages.filter((item) => item.role !== "system")) {
    if (message.role === "assistant") {
      result.push({
        role: "assistant",
        content: [
          ...(message.content ? [{ type: "text", text: message.content }] : []),
          ...(message.toolCalls ?? []).map((call) => ({ type: "tool_use", id: call.id, name: call.name, input: call.arguments }))
        ]
      });
    } else if (message.role === "tool") {
      result.push({ role: "user", content: [{ type: "tool_result", tool_use_id: message.toolCallId, content: message.content }] });
    } else {
      result.push({ role: "user", content: message.content });
    }
  }
  return result;
}

export class AnthropicAdapter implements ProviderAdapter {
  readonly id = "anthropic";
  readonly label = "Anthropic";
  readonly capabilities = { tools: true, images: true, reasoning: true, modelDiscovery: true, promptCaching: true, parallelToolCalls: true };

  constructor(private readonly vault: CredentialVault) {}

  async validate(): Promise<{ ok: boolean; detail?: string }> {
    return await this.vault.get(this.id) ? { ok: true } : { ok: false, detail: "Missing Anthropic credential. Run: vectiscode providers login anthropic" };
  }

  private async headers(): Promise<Record<string, string>> {
    const key = await this.vault.get(this.id);
    if (!key) throw new Error("Missing Anthropic credential. Run: vectiscode providers login anthropic");
    return { "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json" };
  }

  async listModels(): Promise<Array<{ id: string; label: string }>> {
    const response = await fetch("https://api.anthropic.com/v1/models?limit=100", { headers: await this.headers(), signal: AbortSignal.timeout(10_000) });
    if (!response.ok) throw await responseError(this.label, response);
    const root = asRecord(await response.json());
    return asArray(root?.data).map(asRecord).filter((model): model is Record<string, unknown> => model !== null).map((model) => ({
      id: asString(model.id) ?? "",
      label: asString(model.display_name) ?? asString(model.id) ?? ""
    })).filter((model) => model.id);
  }

  async complete(request: ProviderTurnRequest): Promise<ProviderTurnResult> {
    const system = request.messages.filter((message) => message.role === "system").map((message) => message.content).join("\n\n");
    const modelId = request.model.replace(/^anthropic\//, "");
    const supportsThinking = /claude-3-7|sonnet-3-7|claude-4/i.test(modelId);

    const body: Record<string, unknown> = {
      model: modelId,
      max_tokens: supportsThinking ? 20_000 : 16_384,
      stream: true,
      system,
      messages: anthropicMessages(request.messages),
      tools: request.tools.map((tool) => ({ name: tool.name, description: tool.description, input_schema: tool.inputSchema }))
    };

    if (supportsThinking) {
      body.thinking = { type: "enabled", budget_tokens: 4096 };
    }

    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: await this.headers(),
      body: JSON.stringify(body),
      signal: request.signal
    });
    if (!response.ok) throw await responseError(this.label, response);
    if (!response.body) throw new Error("Anthropic returned no response body");

    let text = "";
    let reasoning = "";
    let finishReason: string | undefined;
    let usage = emptyUsage(this.id, request.model);
    const calls = new Map<number, { id: string; name: string; input: string }>();

    await readSse(response.body, request.signal, (line) => {
      const root = asRecord(JSON.parse(line));
      const type = asString(root?.type);
      if (type === "message_start") {
        const initialUsage = asRecord(asRecord(root?.message)?.usage);
        usage.inputTokens = asNumber(initialUsage?.input_tokens) ?? usage.inputTokens;
      }
      if (type === "content_block_start") {
        const index = asNumber(root?.index) ?? calls.size;
        const block = asRecord(root?.content_block);
        if (asString(block?.type) === "tool_use") calls.set(index, { id: asString(block?.id) ?? `tool-${index}`, name: asString(block?.name) ?? "unknown", input: "" });
      }
      if (type === "content_block_delta") {
        const index = asNumber(root?.index) ?? 0;
        const delta = asRecord(root?.delta);
        const deltaType = asString(delta?.type);
        if (deltaType === "text_delta") {
          const value = asString(delta?.text) ?? "";
          text += value;
          request.onTextDelta?.(value);
        } else if (deltaType === "thinking_delta") {
          const value = asString(delta?.thinking) ?? "";
          reasoning += value;
          request.onReasoningDelta?.(value);
        } else if (deltaType === "input_json_delta") {
          const current = calls.get(index);
          if (current) current.input += asString(delta?.partial_json) ?? "";
        }
      }
      if (type === "message_delta") {
        finishReason = asString(asRecord(root?.delta)?.stop_reason) ?? finishReason;
        const finalUsage = asRecord(root?.usage);
        usage.outputTokens = asNumber(finalUsage?.output_tokens) ?? usage.outputTokens;
      }
    });

    const toolCalls: ToolCall[] = [...calls.entries()].sort(([left], [right]) => left - right).map(([, call]) => ({
      id: call.id,
      name: call.name,
      arguments: parseJsonObject(call.input)
    }));
    return { text, reasoning, toolCalls, usage, finishReason };
  }
}
