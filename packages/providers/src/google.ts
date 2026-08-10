import type { AgentMessage, CredentialVault, ProviderAdapter, ProviderTurnRequest, ProviderTurnResult, ToolCall } from "@vectiscode/core";

import { asArray, asNumber, asRecord, asString, emptyUsage, readSse, responseError } from "./shared.js";

function findToolName(messages: AgentMessage[], toolCallId: string | undefined): string {
  for (const message of [...messages].reverse()) {
    const match = message.toolCalls?.find((call) => call.id === toolCallId);
    if (match) return match.name;
  }
  return "unknown";
}

function googleContents(messages: AgentMessage[]): unknown[] {
  return messages.filter((message) => message.role !== "system").map((message) => {
    if (message.role === "assistant") {
      return { role: "model", parts: [
        ...(message.content ? [{ text: message.content }] : []),
        ...(message.toolCalls ?? []).map((call) => ({ functionCall: { name: call.name, args: call.arguments } }))
      ] };
    }
    if (message.role === "tool") {
      return { role: "user", parts: [{ functionResponse: { name: findToolName(messages, message.toolCallId), response: { result: message.content } } }] };
    }
    return { role: "user", parts: [{ text: message.content }] };
  });
}

export class GoogleAdapter implements ProviderAdapter {
  readonly id = "google";
  readonly label = "Google Gemini";
  readonly capabilities = { tools: true, images: true, reasoning: true, modelDiscovery: true, promptCaching: true, parallelToolCalls: true };

  constructor(private readonly vault: CredentialVault) {}

  private async key(): Promise<string> {
    const key = await this.vault.get(this.id);
    if (!key) throw new Error("Missing Google credential. Run: vectiscode providers login google");
    return key;
  }

  async validate(): Promise<{ ok: boolean; detail?: string }> {
    return await this.vault.get(this.id) ? { ok: true } : { ok: false, detail: "Missing Google credential. Run: vectiscode providers login google" };
  }

  async listModels(): Promise<Array<{ id: string; label: string }>> {
    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(await this.key())}`, { signal: AbortSignal.timeout(10_000) });
    if (!response.ok) throw await responseError(this.label, response);
    const root = asRecord(await response.json());
    return asArray(root?.models).map(asRecord).filter((model): model is Record<string, unknown> => model !== null)
      .filter((model) => asArray(model.supportedGenerationMethods).includes("generateContent"))
      .map((model) => ({ id: (asString(model.name) ?? "").replace(/^models\//, ""), label: asString(model.displayName) ?? asString(model.name) ?? "" }))
      .filter((model) => model.id);
  }

  async complete(request: ProviderTurnRequest): Promise<ProviderTurnResult> {
    const key = await this.key();
    const system = request.messages.filter((message) => message.role === "system").map((message) => message.content).join("\n\n");
    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(request.model)}:streamGenerateContent?alt=sse&key=${encodeURIComponent(key)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: system }] },
        contents: googleContents(request.messages),
        tools: request.tools.length ? [{ functionDeclarations: request.tools.map((tool) => ({ name: tool.name, description: tool.description, parameters: tool.inputSchema })) }] : undefined
      }),
      signal: request.signal
    });
    if (!response.ok) throw await responseError(this.label, response);
    if (!response.body) throw new Error("Google returned no response body");

    let text = "";
    let finishReason: string | undefined;
    let usage = emptyUsage(this.id, request.model);
    const calls: ToolCall[] = [];
    await readSse(response.body, request.signal, (line) => {
      const root = asRecord(JSON.parse(line));
      const candidate = asRecord(asArray(root?.candidates)[0]);
      finishReason = asString(candidate?.finishReason) ?? finishReason;
      for (const rawPart of asArray(asRecord(candidate?.content)?.parts)) {
        const part = asRecord(rawPart);
        const value = asString(part?.text);
        if (value) {
          text += value;
          request.onTextDelta?.(value);
        }
        const functionCall = asRecord(part?.functionCall);
        if (functionCall) calls.push({ id: `google-${calls.length}-${Date.now()}`, name: asString(functionCall.name) ?? "unknown", arguments: asRecord(functionCall.args) ?? {} });
      }
      const usageData = asRecord(root?.usageMetadata);
      if (usageData) usage = {
        provider: this.id,
        model: request.model,
        inputTokens: asNumber(usageData.promptTokenCount) ?? 0,
        outputTokens: asNumber(usageData.candidatesTokenCount) ?? 0,
        cacheReadTokens: asNumber(usageData.cachedContentTokenCount)
      };
    });
    return { text, toolCalls: calls, usage, finishReason };
  }
}
