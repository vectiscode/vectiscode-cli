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
