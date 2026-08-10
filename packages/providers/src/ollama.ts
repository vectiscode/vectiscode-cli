import type { ProviderAdapter, ProviderTurnRequest, ProviderTurnResult, ToolCall } from "@vectiscode/core";

import { asArray, asNumber, asRecord, asString, emptyUsage, responseError } from "./shared.js";

export class OllamaAdapter implements ProviderAdapter {
  readonly id = "ollama";
  readonly label = "Ollama";
  readonly capabilities = { tools: true, images: false, reasoning: false, modelDiscovery: true, promptCaching: false, parallelToolCalls: false };

  private baseUrl(): string {
    return (process.env.OLLAMA_BASE_URL ?? "http://127.0.0.1:11434").replace(/\/+$/, "");
  }

  async validate(): Promise<{ ok: boolean; detail?: string }> {
    try {
      const response = await fetch(`${this.baseUrl()}/api/tags`, { signal: AbortSignal.timeout(2_000) });
      return response.ok ? { ok: true } : { ok: false, detail: `Ollama returned ${response.status}` };
    } catch (error) {
      return { ok: false, detail: error instanceof Error ? error.message : String(error) };
    }
  }

  async listModels(): Promise<Array<{ id: string; label: string }>> {
    const response = await fetch(`${this.baseUrl()}/api/tags`, { signal: AbortSignal.timeout(10_000) });
    if (!response.ok) throw await responseError(this.label, response);
    const root = asRecord(await response.json());
    return asArray(root?.models).map(asRecord).filter((model): model is Record<string, unknown> => model !== null)
      .map((model) => asString(model.name)).filter((id): id is string => Boolean(id)).map((id) => ({ id, label: id }));
  }

  async complete(request: ProviderTurnRequest): Promise<ProviderTurnResult> {
    const response = await fetch(`${this.baseUrl()}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: request.model,
        messages: request.messages.map((message) => ({ role: message.role, content: message.content })),
        tools: request.tools.map((tool) => ({ type: "function", function: { name: tool.name, description: tool.description, parameters: tool.inputSchema } })),
        stream: true
      }),
      signal: request.signal
    });
    if (!response.ok) throw await responseError(this.label, response);
    if (!response.body) throw new Error("Ollama returned no response body");
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let text = "";
    let usage = emptyUsage(this.id, request.model);
    const calls: ToolCall[] = [];
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop() ?? "";
      for (const line of lines.filter(Boolean)) {
        const root = asRecord(JSON.parse(line));
        const message = asRecord(root?.message);
        const delta = asString(message?.content);
        if (delta) {
          text += delta;
          request.onTextDelta?.(delta);
        }
        for (const rawCall of asArray(message?.tool_calls)) {
          const fn = asRecord(asRecord(rawCall)?.function);
          calls.push({ id: `ollama-${calls.length}-${Date.now()}`, name: asString(fn?.name) ?? "unknown", arguments: asRecord(fn?.arguments) ?? {} });
        }
        if (root?.done === true) usage = { provider: this.id, model: request.model, inputTokens: asNumber(root.prompt_eval_count) ?? 0, outputTokens: asNumber(root.eval_count) ?? 0 };
      }
    }
    return { text, toolCalls: calls, usage };
  }
}
