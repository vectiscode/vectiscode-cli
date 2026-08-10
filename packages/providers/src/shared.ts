import type { AgentMessage, ToolCall, UsageRecord } from "@vectiscode/core";

export function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

export function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

export function asString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

export function asNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

export function parseJsonObject(value: string | undefined): Record<string, unknown> {
  if (!value) return {};
  try {
    return asRecord(JSON.parse(value)) ?? {};
  } catch {
    return {};
  }
}

export async function readSse(
  body: ReadableStream<Uint8Array>,
  signal: AbortSignal,
  onData: (data: string) => void
): Promise<void> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  while (true) {
    if (signal.aborted) throw signal.reason ?? new Error("Cancelled");
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true }).replace(/\r\n/g, "\n");
    const events = buffer.split("\n\n");
    buffer = events.pop() ?? "";
    for (const event of events) {
      const data = event.split("\n")
        .filter((line) => line.startsWith("data:"))
        .map((line) => line.slice(5).trimStart())
        .join("\n");
      if (data) onData(data);
    }
  }
}

export function openAiMessages(messages: AgentMessage[]): unknown[] {
  return messages.map((message) => {
    if (message.role === "assistant" && message.toolCalls?.length) {
      return {
        role: "assistant",
        content: message.content || null,
        tool_calls: message.toolCalls.map((call) => ({
          id: call.id,
          type: "function",
          function: { name: call.name, arguments: JSON.stringify(call.arguments) }
        }))
      };
    }
    if (message.role === "tool") {
      return { role: "tool", tool_call_id: message.toolCallId, content: message.content };
    }
    return { role: message.role, content: message.content };
  });
}

export interface MutableToolCall {
  id: string;
  name: string;
  argumentsJson: string;
}

export function finalizeToolCalls(calls: Map<number, MutableToolCall>): ToolCall[] {
  return [...calls.entries()].sort(([left], [right]) => left - right).map(([, call]) => ({
    id: call.id,
    name: call.name,
    arguments: parseJsonObject(call.argumentsJson)
  }));
}

export function emptyUsage(provider: string, model: string): UsageRecord {
  return { provider, model, inputTokens: 0, outputTokens: 0 };
}

export async function responseError(label: string, response: Response): Promise<Error> {
  const text = (await response.text()).slice(0, 800);
  return new Error(`${label} ${response.status}: ${text || response.statusText}`);
}
