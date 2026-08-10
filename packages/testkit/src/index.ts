import type {
  ProviderAdapter,
  ProviderTurnRequest,
  ProviderTurnResult,
  ToolCall,
  ToolDefinition,
  ToolExecutionContext,
  ToolExecutor,
  ToolReceipt
} from "@vectiscode/core";

export class FakeProvider implements ProviderAdapter {
  readonly id = "fake";
  readonly label = "Fake provider";
  readonly capabilities = { tools: true, images: false, reasoning: true, modelDiscovery: true, promptCaching: false, parallelToolCalls: true };
  readonly requests: ProviderTurnRequest[] = [];

  constructor(private readonly turns: ProviderTurnResult[]) {}

  async validate(): Promise<{ ok: boolean }> { return { ok: true }; }
  async listModels(): Promise<Array<{ id: string; label: string }>> { return [{ id: "fake-model", label: "Fake model" }]; }
  async complete(request: ProviderTurnRequest): Promise<ProviderTurnResult> {
    this.requests.push({ ...request, messages: structuredClone(request.messages), tools: structuredClone(request.tools) });
    const turn = this.turns.shift();
    if (!turn) throw new Error("Fake provider has no remaining turn");
    if (turn.text) request.onTextDelta?.(turn.text);
    if (turn.reasoning) request.onReasoningDelta?.(turn.reasoning);
    return turn;
  }
}

export class FakeToolExecutor implements ToolExecutor {
  readonly calls: ToolCall[] = [];

  constructor(private readonly toolDefinitions: ToolDefinition[] = [{
    name: "fake.read",
    description: "Fake read tool",
    inputSchema: { type: "object" },
    risk: "read"
  }]) {}

  async definitions(): Promise<ToolDefinition[]> { return this.toolDefinitions; }
  async execute(call: ToolCall, _context: ToolExecutionContext): Promise<ToolReceipt> {
    this.calls.push(call);
    const risk = this.toolDefinitions.find((definition) => definition.name === call.name)?.risk ?? "unknown";
    const now = new Date().toISOString();
    return { toolCallId: call.id, toolName: call.name, risk, ok: true, summary: `${call.name} executed`, output: call.arguments, startedAt: now, completedAt: now };
  }
}

export function fakeUsage() {
  return { provider: "fake", model: "fake-model", inputTokens: 10, outputTokens: 5 };
}
