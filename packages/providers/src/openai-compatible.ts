import type {
  CredentialVault,
  ProviderAdapter,
  ProviderCapabilities,
  ProviderTurnRequest,
  ProviderTurnResult
} from "@vectiscode/core";

import {
  asArray,
  asNumber,
  asRecord,
  asString,
  emptyUsage,
  finalizeToolCalls,
  openAiMessages,
  readSse,
  responseError,
  type MutableToolCall
} from "./shared.js";

interface OpenAiCompatibleOptions {
  id: string;
  label: string;
  baseUrl: () => string;
  credentialProvider: string;
  credentialRequired: boolean;
  headers?: () => Record<string, string>;
  capabilities?: Partial<ProviderCapabilities>;
}

export class OpenAiCompatibleAdapter implements ProviderAdapter {
  readonly id: string;
  readonly label: string;
  readonly capabilities: ProviderCapabilities;

  constructor(private readonly vault: CredentialVault, private readonly options: OpenAiCompatibleOptions) {
    this.id = options.id;
    this.label = options.label;
    this.capabilities = {
      tools: true,
      images: false,
      reasoning: true,
      modelDiscovery: true,
      promptCaching: false,
      parallelToolCalls: true,
      ...options.capabilities
    };
  }

  private baseUrl(): string {
    return this.options.baseUrl().replace(/\/+$/, "");
  }

  private async headers(): Promise<Record<string, string>> {
    const key = await this.vault.get(this.options.credentialProvider);
    return {
      "Content-Type": "application/json",
      ...(key ? { Authorization: `Bearer ${key}` } : {}),
      ...this.options.headers?.()
    };
  }

  async validate(): Promise<{ ok: boolean; detail?: string }> {
    if (this.options.credentialRequired && !(await this.vault.get(this.options.credentialProvider))) {
      return { ok: false, detail: `Missing ${this.label} credential. Run: vectiscode providers login ${this.id}` };
    }
    if (this.options.credentialRequired) return { ok: true };
    try {
      const response = await fetch(`${this.baseUrl()}/models`, {
        headers: await this.headers(),
        signal: AbortSignal.timeout(3_000)
      });
      if (!response.ok) return { ok: false, detail: `${this.label} returned HTTP ${response.status} from /models` };
      return { ok: true };
    } catch (error) {
      return { ok: false, detail: `${this.label} is unreachable: ${error instanceof Error ? error.message : String(error)}` };
    }
  }

  async listModels(): Promise<Array<{ id: string; label: string }>> {
    const response = await fetch(`${this.baseUrl()}/models`, { headers: await this.headers(), signal: AbortSignal.timeout(10_000) });
    if (!response.ok) throw await responseError(this.label, response);
    const root = asRecord(await response.json());
    return asArray(root?.data).map(asRecord).filter((model): model is Record<string, unknown> => model !== null)
      .map((model) => asString(model.id))
      .filter((id): id is string => Boolean(id))
      .sort()
      .map((id) => ({ id, label: id }));
  }

  async complete(request: ProviderTurnRequest): Promise<ProviderTurnResult> {
    const targetModel = (this.id !== "openrouter" && request.model.startsWith(`${this.id}/`))
      ? request.model.slice(this.id.length + 1)
      : request.model;

    const response = await fetch(`${this.baseUrl()}/chat/completions`, {
      method: "POST",
      headers: await this.headers(),
      body: JSON.stringify({
        model: targetModel,
        messages: openAiMessages(request.messages),
        tools: request.tools.length ? request.tools.map((tool) => ({
          type: "function",
          function: { name: tool.name, description: tool.description, parameters: tool.inputSchema }
        })) : undefined,
        stream: true,
        stream_options: { include_usage: true }
      }),
      signal: request.signal
    });
    if (!response.ok) throw await responseError(this.label, response);
    if (!response.body) throw new Error(`${this.label} returned no response body`);

    let text = "";
    let reasoning = "";
    let finishReason: string | undefined;
    let usage = emptyUsage(this.id, request.model);
    const calls = new Map<number, MutableToolCall>();

    await readSse(response.body, request.signal, (line) => {
      if (line === "[DONE]") return;
      const root = asRecord(JSON.parse(line));
      const choice = asRecord(asArray(root?.choices)[0]);
      const delta = asRecord(choice?.delta);
      const content = asString(delta?.content);
      if (content) {
        text += content;
        request.onTextDelta?.(content);
      }
      const reasoningDelta = asString(delta?.reasoning_content) ?? asString(delta?.reasoning);
      if (reasoningDelta) {
        reasoning += reasoningDelta;
        request.onReasoningDelta?.(reasoningDelta);
      }
      for (const rawCall of asArray(delta?.tool_calls)) {
        const call = asRecord(rawCall);
        const index = asNumber(call?.index) ?? calls.size;
        const fn = asRecord(call?.function);
        const current = calls.get(index) ?? { id: "", name: "", argumentsJson: "" };
        current.id += asString(call?.id) ?? "";
        current.name += asString(fn?.name) ?? "";
        current.argumentsJson += asString(fn?.arguments) ?? "";
        calls.set(index, current);
      }
      finishReason = asString(choice?.finish_reason) ?? finishReason;
      const usageData = asRecord(root?.usage);
      if (usageData) {
        usage = {
          provider: this.id,
          model: request.model,
          inputTokens: asNumber(usageData.prompt_tokens) ?? 0,
          outputTokens: asNumber(usageData.completion_tokens) ?? 0,
          cacheReadTokens: asNumber(asRecord(usageData.prompt_tokens_details)?.cached_tokens)
        };
      }
    });

    return { text, reasoning, toolCalls: finalizeToolCalls(calls), usage, finishReason };
  }
}
