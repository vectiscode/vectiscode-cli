import type { AiUsageAccumulator } from "./usageAccounting.js";
import { normalizeAiUsage } from "./usageAccounting.js";

export type AiRuntimeErrorCode =
  | "provider_auth"
  | "provider_http"
  | "provider_timeout"
  | "empty_body"
  | "stream_parse"
  | "empty_response"
  | "invalid_json";

export class AiRuntimeError extends Error {
  readonly code: AiRuntimeErrorCode;
  readonly provider: string;
  readonly status?: number;
  readonly retryable: boolean;
  readonly retryAfterMs?: number;

  constructor(input: {
    code: AiRuntimeErrorCode;
    provider: string;
    message: string;
    status?: number;
    retryable?: boolean;
    retryAfterMs?: number;
  }) {
    super(input.message);
    this.name = "AiRuntimeError";
    this.code = input.code;
    this.provider = input.provider;
    this.status = input.status;
    this.retryable = input.retryable ?? false;
    this.retryAfterMs = input.retryAfterMs;
  }
}

export type AiRuntimeEvent =
  | { type: "text_delta"; text: string }
  | { type: "reasoning_delta"; text: string }
  | { type: "usage"; usage: AiUsageAccumulator }
  | { type: "finish"; reason?: string }
  | { type: "warning"; message: string };

export type AiRuntimeEventSink = (event: AiRuntimeEvent) => void;

export interface OpenAiCompatibleResult {
  text: string;
  reasoning: string;
  usage?: AiUsageAccumulator;
  finishReason?: string;
}

export interface AiToolCall {
  id: string;
  name: string;
  input: Record<string, unknown>;
  thoughtSignature?: string;
}

export interface ProviderProfile {
  nativeTools: boolean;
  structuredOutput: boolean;
  imageInput: boolean;
  promptCaching: boolean;
  parallelToolCalls: boolean;
  retrySafe: boolean;
  reasoningTransport: "none" | "effort" | "thinking_level" | "thinking_budget" | "provider_default";
  maxOutputTokens: number;
}

export function retryDelayMs(error: AiRuntimeError, attempt: number) {
  if (error.retryAfterMs !== undefined) return Math.min(10_000, Math.max(0, error.retryAfterMs));
  return Math.min(4_000, 400 * (2 ** Math.max(0, attempt - 1)));
}

export async function withProviderRetry<T>(
  operation: (attempt: number) => Promise<T>,
  options: { maxAttempts?: number; onRetry?: (error: AiRuntimeError, delayMs: number, attempt: number) => void } = {}
): Promise<T> {
  const maxAttempts = Math.max(1, options.maxAttempts ?? 2);
  let lastError: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      return await operation(attempt);
    } catch (error) {
      lastError = error;
      if (!(error instanceof AiRuntimeError) || !error.retryable || attempt >= maxAttempts) throw error;
      const delayMs = retryDelayMs(error, attempt);
      options.onRetry?.(error, delayMs, attempt);
      await new Promise<void>((resolve) => setTimeout(resolve, delayMs));
    }
  }
  throw lastError;
}

export interface OpenAiCompatibleMessage {
  role?: unknown;
  content?: unknown;
  tool_calls?: unknown;
}

export interface OpenAiCompatibleChoice {
  message?: unknown;
  finish_reason?: unknown;
}

type UsageLike = {
  prompt_tokens?: unknown;
  input_tokens?: unknown;
  completion_tokens?: unknown;
  output_tokens?: unknown;
};

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null ? value as Record<string, unknown> : undefined;
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function numberValue(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function usageFromUnknown(value: unknown, provider: string): AiUsageAccumulator | undefined {
  const usage = asRecord(value) as UsageLike | undefined;
  if (!usage) return undefined;
  return normalizeAiUsage({
    inputTokens: numberValue(usage.prompt_tokens) || numberValue(usage.input_tokens),
    outputTokens: numberValue(usage.completion_tokens) || numberValue(usage.output_tokens)
  }, provider);
}

export function isAbortLikeError(error: unknown) {
  return error instanceof Error && (error.name === "AbortError" || /aborted/i.test(error.message));
}

export function providerTimeoutError(provider: string, timeoutMs: number) {
  return new AiRuntimeError({
    code: "provider_timeout",
    provider,
    message: `${provider} request timed out after ${Math.round(timeoutMs / 1000)}s.`,
    retryable: true
  });
}

export async function providerHttpError(provider: string, response: Response) {
  const body = await response.text().catch(() => "");
  const code: AiRuntimeErrorCode = response.status === 401 || response.status === 403 ? "provider_auth" : "provider_http";
  const retryAfterMsHeader = response.headers.get("retry-after-ms");
  const retryAfterHeader = response.headers.get("retry-after");
  const retryAfterMs = retryAfterMsHeader && Number.isFinite(Number(retryAfterMsHeader))
    ? Number(retryAfterMsHeader)
    : retryAfterHeader && Number.isFinite(Number(retryAfterHeader))
      ? Number(retryAfterHeader) * 1000
      : undefined;
  return new AiRuntimeError({
    code,
    provider,
    status: response.status,
    retryable: response.status === 408 || response.status === 409 || response.status === 429 || response.status >= 500,
    retryAfterMs,
    message: `${provider} API Error: ${response.status}${body ? ` - ${body}` : ""}`
  });
}

function readChoice(value: unknown): Record<string, unknown> | undefined {
  const record = asRecord(value);
  const choices = Array.isArray(record?.choices) ? record.choices : [];
  return asRecord(choices[0]);
}

function parseJsonObject(value: unknown): Record<string, unknown> {
  if (typeof value === "object" && value !== null && !Array.isArray(value)) return value as Record<string, unknown>;
  if (typeof value !== "string" || !value.trim()) return {};
  try {
    const parsed = JSON.parse(value) as unknown;
    return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

export function openAiCompatibleMessage(value: unknown): OpenAiCompatibleMessage | undefined {
  return asRecord(readChoice(value)?.message);
}

export function openAiCompatibleToolCalls(value: unknown): AiToolCall[] {
  const message = openAiCompatibleMessage(value);
  const calls = Array.isArray(message?.tool_calls) ? message.tool_calls : [];
  return calls.flatMap((call, index) => {
    const record = asRecord(call);
    const fn = asRecord(record?.function);
    const name = stringValue(fn?.name);
    if (!name) return [];
    return [{
      id: stringValue(record?.id) || `call_${index}`,
      name,
      input: parseJsonObject(fn?.arguments)
    }];
  });
}

export function parseOpenAiCompatibleJson(value: unknown, provider: string): OpenAiCompatibleResult {
  const record = asRecord(value);
  const choice = readChoice(value);
  const message = asRecord(choice?.message);
  const text = stringValue(message?.content) || stringValue(record?.output_text);
  const usage = usageFromUnknown(record?.usage, provider);
  const finishReason = stringValue(choice?.finish_reason) || undefined;
  return { text, reasoning: "", usage, finishReason };
}

export async function parseOpenAiCompatibleSse(input: {
  response: Response;
  provider: string;
  onText?: (text: string) => void;
  onEvent?: AiRuntimeEventSink;
}): Promise<OpenAiCompatibleResult> {
  const reader = input.response.body?.getReader();
  if (!reader) {
    throw new AiRuntimeError({
      code: "empty_body",
      provider: input.provider,
      message: `${input.provider} returned an empty response body.`,
      retryable: true
    });
  }

  const decoder = new TextDecoder();
  let buffer = "";
  let text = "";
  let reasoning = "";
  let usage: AiUsageAccumulator | undefined;
  let finishReason: string | undefined;
  let malformedChunks = 0;

  const applyData = (data: string) => {
    if (data === "[DONE]") return;
    let parsed: unknown;
    try {
      parsed = JSON.parse(data);
    } catch {
      malformedChunks += 1;
      return;
    }

    const record = asRecord(parsed);
    const choice = readChoice(parsed);
    const delta = asRecord(choice?.delta);
    const content = stringValue(delta?.content);
    if (content) {
      text += content;
      input.onText?.(content);
      input.onEvent?.({ type: "text_delta", text: content });
    }

    const reasoningContent = stringValue(delta?.reasoning_content) || stringValue(delta?.reasoning);
    if (reasoningContent) {
      reasoning += reasoningContent;
      input.onEvent?.({ type: "reasoning_delta", text: reasoningContent });
    }

    const nextUsage = usageFromUnknown(record?.usage, input.provider);
    if (nextUsage) {
      usage = nextUsage;
      input.onEvent?.({ type: "usage", usage: nextUsage });
    }

    const nextFinishReason = stringValue(choice?.finish_reason);
    if (nextFinishReason) {
      finishReason = nextFinishReason;
      input.onEvent?.({ type: "finish", reason: nextFinishReason });
    }
  };

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() || "";
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith("data:")) continue;
      applyData(trimmed.slice(5).trim());
    }
  }

  buffer += decoder.decode();
  for (const line of buffer.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed.startsWith("data:")) applyData(trimmed.slice(5).trim());
  }

  if (!text && malformedChunks > 0) {
    throw new AiRuntimeError({
      code: "stream_parse",
      provider: input.provider,
      message: `${input.provider} returned malformed streaming chunks before any usable text.`,
      retryable: true
    });
  }
  if (malformedChunks > 0) {
    input.onEvent?.({ type: "warning", message: `${malformedChunks} malformed streaming chunk(s) were skipped.` });
  }

  return { text, reasoning, usage, finishReason };
}

export function requireRuntimeText(result: OpenAiCompatibleResult, provider: string) {
  if (result.text.trim()) return result.text;
  throw new AiRuntimeError({
    code: "empty_response",
    provider,
    message: `Empty response from ${provider} model.`,
    retryable: true
  });
}

export function runtimeResultToChatCompletion(result: OpenAiCompatibleResult) {
  return {
    choices: [{ message: { content: result.text }, finish_reason: result.finishReason }],
    usage: result.usage
      ? {
          prompt_tokens: result.usage.inputTokens,
          completion_tokens: result.usage.outputTokens
        }
      : undefined
  };
}
