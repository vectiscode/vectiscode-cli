export type PermissionMode = "plan" | "supervised" | "auto";

export type ToolRisk = "read" | "write" | "destructive" | "external" | "unknown";

export interface ProviderCapabilities {
  tools: boolean;
  images: boolean;
  reasoning: boolean;
  modelDiscovery: boolean;
  promptCaching: boolean;
  parallelToolCalls: boolean;
}

export interface ProviderModel {
  id: string;
  label: string;
  provider: string;
  capabilities: ProviderCapabilities;
  contextWindow?: number;
  maxOutputTokens?: number;
  supportsReasoning?: boolean;
  supportsImages?: boolean;
  supportsTools?: boolean;
  streaming?: boolean;
}

export type ProviderAuthMethod = "api_key" | "oauth" | "none";

export interface ProviderAuth {
  method: ProviderAuthMethod;
  envVar?: string;
  loginHint?: string;
}

export interface ProviderError {
  code: "authentication" | "billing" | "rate_limit" | "timeout" | "network" | "context_limit" | "unsupported_feature" | "invalid_model" | "server" | "unknown";
  message: string;
  retryable: boolean;
  retryAfterMs?: number;
}

export type ProviderStreamEventType = "text_delta" | "reasoning_delta" | "tool_call_delta" | "usage" | "error" | "done";

export interface ProviderStreamEvent {
  type: ProviderStreamEventType;
  delta?: string;
  toolCall?: { index: number; id?: string; name?: string; argumentsDelta?: string };
  usage?: UsageRecord;
  error?: ProviderError;
}

export interface UsageRecord {
  provider: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
}

export interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  risk: ToolRisk;
}

export interface ToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

export interface AgentMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  toolCallId?: string;
  toolCalls?: ToolCall[];
}

export interface ProviderTurnRequest {
  model: string;
  messages: AgentMessage[];
  tools: ToolDefinition[];
  signal: AbortSignal;
  onTextDelta?: (delta: string) => void;
  onReasoningDelta?: (delta: string) => void;
}

export interface ProviderTurnResult {
  text: string;
  reasoning?: string;
  toolCalls: ToolCall[];
  usage: UsageRecord;
  finishReason?: string;
}

export interface ProviderAdapter {
  readonly id: string;
  readonly label: string;
  readonly capabilities: ProviderCapabilities;
  validate(): Promise<{ ok: boolean; detail?: string }>;
  listModels(): Promise<Array<{ id: string; label: string }>>;
  complete(request: ProviderTurnRequest): Promise<ProviderTurnResult>;
}

export interface ToolReceipt {
  toolCallId: string;
  toolName: string;
  risk: ToolRisk;
  ok: boolean;
  summary: string;
  output?: unknown;
  checkpointId?: string;
  startedAt: string;
  completedAt: string;
}

export interface ToolExecutor {
  definitions(): Promise<ToolDefinition[]>;
  execute(call: ToolCall, context: ToolExecutionContext): Promise<ToolReceipt>;
}

export interface ToolExecutionContext {
  cwd: string;
  sessionId: string;
  turnId: string;
  signal: AbortSignal;
}

export type AgentEventType =
  | "session.created"
  | "turn.started"
  | "message.delta"
  | "reasoning.delta"
  | "tool.requested"
  | "approval.requested"
  | "tool.completed"
  | "usage.recorded"
  | "turn.completed"
  | "turn.cancelled"
  | "turn.failed";

export interface AgentEvent {
  version: 1;
  seq: number;
  type: AgentEventType;
  timestamp: string;
  sessionId: string;
  turnId?: string;
  payload: Record<string, unknown>;
}

export interface SessionRecord {
  version: 1;
  id: string;
  projectPath: string;
  projectName: string;
  provider: string;
  model: string;
  permissionMode: PermissionMode;
  createdAt: string;
  updatedAt: string;
}

export interface AgentRunResult {
  sessionId: string;
  turnId: string;
  text: string;
  reasoning: string;
  receipts: ToolReceipt[];
  usage: UsageRecord[];
  status: "completed" | "cancelled";
}
