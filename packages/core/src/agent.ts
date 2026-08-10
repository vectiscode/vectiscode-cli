import { randomUUID } from "node:crypto";
import { basename, resolve } from "node:path";

import { sessionStore, type SessionStore } from "./store.js";
import type {
  AgentEvent,
  AgentMessage,
  AgentRunResult,
  PermissionMode,
  ProviderAdapter,
  ToolCall,
  ToolDefinition,
  ToolExecutor,
  ToolReceipt,
  UsageRecord
} from "./types.js";

export interface RunAgentOptions {
  prompt: string;
  cwd: string;
  provider: ProviderAdapter;
  model: string;
  tools: ToolExecutor;
  permissionMode?: PermissionMode;
  sessionId?: string;
  signal?: AbortSignal;
  store?: SessionStore;
  approve?: (call: ToolCall, definition: ToolDefinition) => Promise<boolean>;
  onEvent?: (event: AgentEvent) => void;
  maxToolRounds?: number;
}

function requiresApproval(mode: PermissionMode, risk: ToolDefinition["risk"]): boolean {
  if (risk === "read") return false;
  if (risk === "destructive" || risk === "external" || risk === "unknown") return true;
  return mode === "supervised";
}

function isAllowed(mode: PermissionMode, risk: ToolDefinition["risk"]): boolean {
  if (mode === "plan") return risk === "read";
  return true;
}

function retryable(error: unknown): boolean {
  const message = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();
  return /timeout|econnreset|network|fetch failed|\b50[234]\b/.test(message);
}

function delay(milliseconds: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolveDelay, reject) => {
    const timer = setTimeout(resolveDelay, milliseconds);
    signal.addEventListener("abort", () => {
      clearTimeout(timer);
      reject(signal.reason ?? new Error("Cancelled"));
    }, { once: true });
  });
}

function sessionHistory(store: SessionStore, sessionId: string): AgentMessage[] {
  const history: AgentMessage[] = [];
  for (const event of store.readEvents(sessionId)) {
    if (event.type === "turn.started" && typeof event.payload.prompt === "string") {
      history.push({ role: "user", content: event.payload.prompt });
    }
    if (event.type === "turn.completed" && typeof event.payload.text === "string") {
      history.push({ role: "assistant", content: event.payload.text });
    }
  }
  return history.slice(-20);
}

export async function runAgent(options: RunAgentOptions): Promise<AgentRunResult> {
  const store = options.store ?? sessionStore;
  const permissionMode = options.permissionMode ?? "supervised";
  const cwd = resolve(options.cwd);
  const sessionId = options.sessionId ?? randomUUID();
  const turnId = randomUUID();
  const controller = new AbortController();
  if (options.signal) {
    if (options.signal.aborted) controller.abort(options.signal.reason);
    options.signal.addEventListener("abort", () => controller.abort(options.signal?.reason), { once: true });
  }

  const existing = store.getSession(sessionId);
  const now = new Date().toISOString();
  store.saveSession({
    version: 1,
    id: sessionId,
    projectPath: cwd,
    projectName: basename(cwd),
    provider: options.provider.id,
    model: options.model,
    permissionMode,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now
  });

  const emit = (type: AgentEvent["type"], payload: Record<string, unknown>): AgentEvent => {
    const event = store.appendEvent({ type, timestamp: new Date().toISOString(), sessionId, turnId, payload });
    options.onEvent?.(event);
    return event;
  };

  if (!existing) emit("session.created", { cwd, provider: options.provider.id, model: options.model });
  emit("turn.started", { prompt: options.prompt, permissionMode });

  const definitions = await options.tools.definitions();
  const definitionByName = new Map(definitions.map((definition) => [definition.name, definition]));
  const messages: AgentMessage[] = [
    {
      role: "system",
      content: [
        "You are VectisCode, a local Roblox coding agent.",
        "Inspect before editing. Keep mutations reviewable. Verify results and report evidence.",
        `Permission mode: ${permissionMode}. Project root: ${cwd}.`,
        "Never claim that a tool succeeded unless its receipt says ok=true."
      ].join("\n")
    },
    ...(existing ? sessionHistory(store, sessionId) : []),
    { role: "user", content: options.prompt }
  ];

  const receipts: ToolReceipt[] = [];
  const usage: UsageRecord[] = [];
  let finalText = "";
  let reasoning = "";
  const callCounts = new Map<string, number>();

  try {
    for (let round = 0; round < (options.maxToolRounds ?? 12); round += 1) {
      if (controller.signal.aborted) throw controller.signal.reason ?? new Error("Cancelled");
      let response;
      for (let attempt = 0; attempt < 3; attempt += 1) {
        try {
          response = await options.provider.complete({
            model: options.model,
            messages,
            tools: definitions,
            signal: controller.signal,
            onTextDelta: (delta) => emit("message.delta", { delta }),
            onReasoningDelta: (delta) => emit("reasoning.delta", { delta })
          });
          break;
        } catch (error) {
          if (!retryable(error) || attempt === 2) throw error;
          await delay(250 * (2 ** attempt), controller.signal);
        }
      }
      if (!response) throw new Error("Provider returned no response");
      usage.push(response.usage);
      emit("usage.recorded", { usage: response.usage });
      finalText += response.text;
      reasoning += response.reasoning ?? "";
      messages.push({ role: "assistant", content: response.text, toolCalls: response.toolCalls });

      if (response.toolCalls.length === 0) {
        emit("turn.completed", { text: finalText, receipts, usage });
        return { sessionId, turnId, text: finalText, reasoning, receipts, usage, status: "completed" };
      }

      for (const call of response.toolCalls) {
        const signature = `${call.name}:${JSON.stringify(call.arguments)}`;
        const count = (callCounts.get(signature) ?? 0) + 1;
        callCounts.set(signature, count);
        if (count > 2) throw new Error(`Repeated tool call blocked: ${call.name}`);

        const definition = definitionByName.get(call.name) ?? {
          name: call.name,
          description: "Unknown provider-requested tool",
          inputSchema: {},
          risk: "unknown" as const
        };
        emit("tool.requested", { call, risk: definition.risk });

        if (!isAllowed(permissionMode, definition.risk)) {
          messages.push({ role: "tool", toolCallId: call.id, content: `Denied by ${permissionMode} permission mode.` });
          continue;
        }

        if (requiresApproval(permissionMode, definition.risk)) {
          emit("approval.requested", { call, risk: definition.risk });
          const approved = await options.approve?.(call, definition) ?? false;
          if (!approved) {
            messages.push({ role: "tool", toolCallId: call.id, content: "Rejected by user or unavailable approval channel." });
            continue;
          }
        }

        const receipt = await options.tools.execute(call, { cwd, sessionId, turnId, signal: controller.signal });
        receipts.push(receipt);
        emit("tool.completed", { receipt });
        messages.push({ role: "tool", toolCallId: call.id, content: JSON.stringify(receipt) });
      }
    }
    throw new Error("Tool round limit reached before the agent produced a final answer");
  } catch (error) {
    if (controller.signal.aborted) {
      emit("turn.cancelled", { reason: String(controller.signal.reason ?? "Cancelled") });
      return { sessionId, turnId, text: finalText, reasoning, receipts, usage, status: "cancelled" };
    }
    emit("turn.failed", { error: error instanceof Error ? error.message : String(error) });
    throw error;
  }
}
