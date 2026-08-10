import type express from "express";
import { customAlphabet } from "nanoid";
import { z } from "zod";
import { chatSchema, editMessageSchema } from "../schemas.js";
import { currentUser, requireUser } from "../services/auth.js";
import { createLogger } from "../services/logger.js";
import {
  config,
  defaultAiModel,
  modelConfigFor,
  modelFixedCost,
  modelIsAvailable,
  modelIsOptimizable,
  modelIsPremium,
  modelCapabilitiesFor,
  resolveAiModel,
  configuredProviderForModel,
  getThinkingLevel,
  getThinkingMultiplier,
  calculateUsageCostCredits,
  resolveModelMode
} from "../services/config.js";
import { answerProjectQuestion, generateSafeChangeSet, shouldUseNoCostDeterministicTemplate, type AiStudioToolRuntime } from "../services/aiProvider.js";
import { store } from "../services/store.js";
import { searchRobloxMarketplace } from "../services/marketplace.js";
import { freeSoundCatalogPromptBlock, promptRequestsSound } from "../services/freeSounds.js";
import { socketService } from "../services/socket.js";
import { modelLatencyBudgetMs } from "../services/modelHealth.js";
import { planAllowsPlanMode, planAllowsPremiumModels, planAllowsLuauGuard, planFor } from "../services/plans.js";
import { planCreditEconomics } from "../services/pricing.js";
import { publicChatResponse } from "../services/publicMessages.js";
import { mergeAiUsage, type AiUsageAccumulator } from "../services/usageAccounting.js";
import {
  effectiveChatModeWithHistory,
  isAutoSyncStatusPrompt,
  isBroadRecommendationFollowup,
  isFailedGenerationFollowup,
  needsUiBackendClarification,
  resolvePromptWithHistory,
  broadRecommendationFollowupText,
  blockedPatchFollowupText
} from "../services/chatIntent.js";
import { attachmentPromptContext, readAttachmentBytes } from "../services/assets.js";
import { snapshotFingerprint } from "../services/snapshots.js";
import { generateDeterministicReviewReport } from "../services/reviewReport.js";
import { buildConsoleFixerPrompt } from "../services/consoleFixer.js";
import { queueStudioCommand, STUDIO_COMMAND_TIMEOUT_MS } from "./studio.js";
import type { AiRuntimeEvent, AiToolCall } from "../services/aiRuntime.js";
import type { AgentRun, AiMessage, Attachment, ChangeFile, ChangeSet, DesignProfile, PlanName, Project, ProjectContextIndex, ProjectSnapshot, StudioCommandType, StudioSession, Thread, UsageStats, UserPreferences } from "../types.js";
import type { RouteContext } from "../routeContext.js";
import {
  usageLimitPayload,
  usageLimitError,
  chatNameFromPrompt,
  isDefaultThreadName,
  isPlanModeImplementationRequest,
  planModeImplementationBlockedText,
  isUiOrGameplayPatchPrompt,
  isRoutineImplementationPatchPrompt,
  shouldRunPlanningPass,
  thinkingLevelLabel,
  modelDisplayName,
  isHighSpendDirectModel,
  changeSetRepairAttemptsFor,
  providerTimeoutAssistantText,
  providerTimeoutMessage,
  isProviderTimeoutError,
  isContextQuestion,
  extractMarketplaceQuery,
  planOnlyPrompt,
  planOnlyText,
  promptDigest,
  activityStep,
  buildGenerationActivity,
  getCost,
  optimizedModelFor,
  isPremiumModel,
  withTimeout,
  isTaskSimple,
  resolveOptimizationMode,
  mergeApplyValidationActivity,
  WEAK_UI_PATCH_MODELS,
  PROJECT_CONTEXT_SUMMARY_CACHE_MODEL_ID,
  projectSnapshotCacheKey,
  buildProjectContextSummary
} from "./chatHelpers.js";
import type { AgentActivityStep } from "../types.js";

const nanoid = customAlphabet("23456789ABCDEFGHJKLMNPQRSTUVWXYZ", 12);
const log = createLogger({ service: "chat" });
const STUDIO_LOG_CONTEXT_WINDOW_MS = 10 * 60 * 1000;
const MAX_REASONING_PREVIEW_CHARS = 1_800;

function sanitizeReasoningPreview(text: string) {
  return text
    .replace(/<\/?think(?:ing)?>/gi, "")
    .replace(/\s+/g, " ")
    .trim();
}

async function cachedProjectContextSummary(snapshot?: ProjectSnapshot) {
  if (!snapshot) return undefined;
  const cacheKey = projectSnapshotCacheKey(snapshot);
  const cached = await store.fetchAiCache(cacheKey, PROJECT_CONTEXT_SUMMARY_CACHE_MODEL_ID).catch((error) => {
    log.warn("Project context summary cache read failed", { snapshotId: snapshot.id, cacheKey, error: String(error) });
    return null;
  });
  if (cached?.summary) return cached.summary;

  const summary = buildProjectContextSummary(snapshot);
  if (!summary) return undefined;
  const now = new Date();
  await store.saveAiCache({
    id: await store.createUniqueId("ai_caches", "cache_", 18),
    snapshotId: cacheKey,
    modelId: PROJECT_CONTEXT_SUMMARY_CACHE_MODEL_ID,
    cacheName: "Project context summary",
    summary,
    snapshotSizeChars: JSON.stringify(snapshot.nodes).length,
    ttlSeconds: 7 * 24 * 60 * 60,
    createdAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000).toISOString()
  }).catch((error) => {
    log.warn("Project context summary cache write failed", { snapshotId: snapshot.id, cacheKey, error: String(error) });
  });
  return summary;
}

type CreditReservation = {
  amount: number;
  settled: boolean;
};

type ExistingChatRequest =
  | { state: "completed"; response: ReturnType<typeof publicChatResponse> }
  | { state: "in_progress" };

const CHAT_REQUEST_IN_PROGRESS_STALE_MS = 12 * 60 * 1000;

async function existingChatRequestResponse(input: {
  clientRequestId?: string;
  messages: AiMessage[];
  organizationId: string;
}): Promise<ExistingChatRequest | undefined> {
  if (!input.clientRequestId) return undefined;

  const requestMessages = input.messages.filter((message) => message.clientRequestId === input.clientRequestId);
  const userMessage = requestMessages.find((message) => message.role === "user");
  if (!userMessage) return undefined;

  // Prefer a successful assistant reply when both success and failure exist for the same request.
  const assistantMessages = requestMessages.filter((message) => message.role === "assistant");
  const assistantMessage = assistantMessages.find((message) => message.status !== "failed")
    ?? assistantMessages[assistantMessages.length - 1];
  if (!assistantMessage) {
    // Without an assistant message the request is either still generating or was abandoned
    // after a process crash. Only block concurrent retries while the request looks fresh.
    const startedAtMs = Date.parse(userMessage.createdAt);
    const ageMs = Number.isFinite(startedAtMs) ? Date.now() - startedAtMs : 0;
    if (ageMs <= CHAT_REQUEST_IN_PROGRESS_STALE_MS) {
      return { state: "in_progress" };
    }
    // Stale orphan user rows no longer block a new generation with the same client request id.
    return undefined;
  }

  const changeSet = assistantMessage.changeSetId
    ? await store.fetchChangeSet(assistantMessage.changeSetId)
    : undefined;
  return {
    state: "completed",
    response: publicChatResponse({
      userMessage,
      assistantMessage,
      changeSet,
      creditBalance: await store.getCreditBalance(input.organizationId)
    })
  };
}

function chatAnswerTimeoutMs() {
  return config.aiTimeouts.chatAnswerMs;
}

function chatChangeSetTimeoutMs() {
  return config.aiTimeouts.chatChangeSetMs;
}

function providerTimeoutLimitMs(modelId: string, mode: "answer" | "changeset", preferences?: UserPreferences, plan?: string) {
  if (mode === "answer") return chatAnswerTimeoutMs();
  const serviceLimit = chatChangeSetTimeoutMs();
  const budget = modelLatencyBudgetMs(modelId, "changeset");
  const thinkingMultiplier = getThinkingMultiplier(modelId, "changeset", preferences, plan);
  const adjustedBudget = Math.round(budget * thinkingMultiplier);
  const floor = 60_000;
  const cap = 600_000;
  const directCap = isHighSpendDirectModel(modelId) && mode === "changeset" ? 240_000 : cap;
  return Math.min(serviceLimit, directCap, Math.max(floor, adjustedBudget));
}

function compactChatHistory(messages: AiMessage[]) {
  if (messages.length <= 14) return messages;
  const recent = messages.slice(-4);
  const older = messages.slice(0, -4);
  const constraints = older
    .filter((message) => message.role === "user")
    .flatMap((message) => message.content.split(/\r?\n/))
    .map((line) => line.trim())
    .filter((line) => /\b(must|never|do not|don't|prefer|keep|avoid|require|should)\b/i.test(line))
    .slice(-16);
  const touchedInstances = Array.from(new Set(older.flatMap((message) => message.content.match(/(?:Workspace|ReplicatedStorage|ServerScriptService|ServerStorage|StarterPlayer|StarterGui|StarterPack)(?:\/[A-Za-z0-9_. -]+)+/g) ?? []))).slice(-24);
  const patchIds = Array.from(new Set(older.flatMap((message) => message.changeSetId ? [message.changeSetId] : []))).slice(-12);
  const memory: AiMessage = {
    id: `compacted_${messages[0]?.id ?? "history"}`,
    projectId: messages[0]?.projectId ?? "",
    threadId: messages[0]?.threadId ?? "",
    role: "assistant",
    content: [
      "COMPACTED EARLIER CONVERSATION MEMORY:",
      constraints.length ? `Explicit constraints:\n${constraints.map((line) => `- ${line}`).join("\n")}` : "Explicit constraints: none retained.",
      touchedInstances.length ? `Touched or discussed instances: ${touchedInstances.join(", ")}` : "",
      patchIds.length ? `Relevant prior change sets: ${patchIds.join(", ")}` : "",
      "Use this memory only as prior context. The newest user request and current Studio evidence take precedence."
    ].filter(Boolean).join("\n"),
    createdAt: older[older.length - 1]?.createdAt ?? new Date(0).toISOString()
  };
  return [memory, ...recent];
}

function dynamicAnswerTimeoutMs(input: {
  prompt: string;
  latestSnapshot?: ProjectSnapshot;
  answerSnapshot?: ProjectSnapshot;
  history: AiMessage[];
  thinkingLevel: string;
  hasStudioSession: boolean;
  planMode?: boolean;
}) {
  const serviceLimit = chatAnswerTimeoutMs();
  const nodeCount = input.latestSnapshot?.nodes.length ?? 0;
  const usesFullSnapshot = Boolean(input.answerSnapshot);
  const historyChars = input.history.slice(-8).reduce((sum, message) => sum + message.content.length, 0);
  let budget = 150_000;

  if (usesFullSnapshot) {
    budget += Math.min(120_000, Math.ceil(nodeCount / 800) * 15_000);
  } else if (nodeCount > 2000) {
    budget += 60_000;
  }

  if (input.prompt.length > 1200) budget += 30_000;
  if (input.prompt.length > 4000) budget += 45_000;
  if (historyChars > 10_000) budget += 45_000;
  if (input.hasStudioSession) budget += 60_000;
  if (input.planMode) budget += 45_000;

  if (input.thinkingLevel === "low") budget += 30_000;
  else if (input.thinkingLevel === "medium") budget += 60_000;
  else if (input.thinkingLevel === "high") budget += 90_000;
  else if (input.thinkingLevel === "xhigh" || input.thinkingLevel === "max") budget += 120_000;

  return Math.min(serviceLimit, Math.max(120_000, budget));
}

async function markThreadActive(thread: Thread, prompt?: string) {
  if (prompt && isDefaultThreadName(thread.name)) {
    thread.name = chatNameFromPrompt(prompt);
  }
  thread.updatedAt = new Date().toISOString();
  await store.saveThread(thread);
}

function deterministicProjectStructureInspection(snapshot: ProjectSnapshot | undefined, prompt: string) {
  if (!/\b(inspect|review|check|look at|analy[sz]e)\b/i.test(prompt)) return undefined;
  if (!/\b(project structure|structure|improve first|what.*improve|suggest.*improve|where.*start)\b/i.test(prompt)) return undefined;
  if (!snapshot) return undefined;

  const nodes = snapshot.nodes ?? [];
  const scripts = nodes.filter((node) => /^(Script|LocalScript|ModuleScript)$/.test(node.className));
  if (nodes.length > 40 || scripts.length > 2) return undefined;

  const topLevel = nodes
    .map((node) => node.path.split("/")[0])
    .filter(Boolean)
    .filter((value, index, list) => list.indexOf(value) === index)
    .slice(0, 8);
  const hasSpawn = nodes.some((node) => node.className === "SpawnLocation");
  const hasBaseplate = nodes.some((node) => /baseplate/i.test(node.path));
  const hasWorkspace = nodes.some((node) => node.path === "Workspace" || node.path.startsWith("Workspace/"));
  const hasServerScriptService = nodes.some((node) => node.path === "ServerScriptService" || node.path.startsWith("ServerScriptService/"));
  const hasReplicatedStorage = nodes.some((node) => node.path === "ReplicatedStorage" || node.path.startsWith("ReplicatedStorage/"));

  const facts = [
    `I see ${nodes.length} synced instance${nodes.length === 1 ? "" : "s"} and ${scripts.length} script${scripts.length === 1 ? "" : "s"}.`,
    topLevel.length ? `Top-level areas present: ${topLevel.join(", ")}.` : "The synced hierarchy is almost empty.",
    hasBaseplate || hasSpawn ? `Current playable basics: ${[hasBaseplate ? "Baseplate" : "", hasSpawn ? "SpawnLocation" : ""].filter(Boolean).join(", ")}.` : ""
  ].filter(Boolean);

  const nextSteps = [
    hasWorkspace ? "Create `Workspace/Stages`, `Workspace/Checkpoints`, and `Workspace/Hazards` before adding more parts." : "Add a clear `Workspace` layout for stages, checkpoints, and hazards.",
    hasServerScriptService ? "Put checkpoint and stage progress logic in `ServerScriptService`, not in client scripts." : "Add `ServerScriptService` logic for checkpoints before building many obstacle parts.",
    hasReplicatedStorage ? "Keep shared remotes and modules under `ReplicatedStorage/Remotes` and `ReplicatedStorage/Modules`." : "Add `ReplicatedStorage/Remotes` and `ReplicatedStorage/Modules` once gameplay needs client-server communication.",
    "Build one complete checkpoint loop first: spawn, checkpoint touch, stage value, respawn behavior. Then duplicate the pattern."
  ];

  return [
    "This is still a very small project, so the right first move is structure, not more decoration.",
    "",
    ...facts,
    "",
    "Improve this first:",
    ...nextSteps.map((step, index) => `${index + 1}. ${step}`),
    "",
    "I would not start with DataStores yet. Get one checkpoint loop working in Studio first, then add saving once the loop is stable."
  ].join("\n");
}

async function reuseBlankThreadIfAvailable(projectId: string, userId: string) {
  const threads = await store.fetchThreadsForProject(projectId);
  const defaultThreads = threads.filter((thread) => thread.userId === userId && isDefaultThreadName(thread.name));
  const checked = await Promise.all(
    defaultThreads.map(async (thread) => ({
      thread,
      messages: await store.fetchMessagesForThread(thread.id)
    }))
  );
  const emptyThreads: Thread[] = [];
  for (const item of checked) {
    const firstUserMessage = item.messages.find((message) => message.role === "user" && message.content.trim());
    if (firstUserMessage) {
      item.thread.name = chatNameFromPrompt(firstUserMessage.content);
      await store.saveThread(item.thread);
    } else {
      emptyThreads.push(item.thread);
    }
  }
  emptyThreads.sort((a, b) => {
    const bTime = b.updatedAt || b.createdAt;
    const aTime = a.updatedAt || a.createdAt;
    const diff = bTime.localeCompare(aTime);
    return diff !== 0 ? diff : b.id.localeCompare(a.id);
  });
  const [reusable, ...duplicates] = emptyThreads;
  await Promise.all(duplicates.map((thread) => store.deleteThread(thread.id)));
  return reusable;
}

async function chargePersistedAssistantMessage(input: {
  organizationId: string;
  assistantMessage: AiMessage;
  cost: number;
  reason: string;
  reservation?: CreditReservation;
  insufficientContent?: string;
  onInsufficient?: () => Promise<void>;
}) {
  const reserved = input.reservation?.amount ?? 0;
  if (input.reservation) input.reservation.settled = true;

  const markInsufficient = async (balance: number) => {
    input.assistantMessage.usageCostCredits = reserved > 0 ? reserved : undefined;
    if (input.insufficientContent) {
      input.assistantMessage.content = input.insufficientContent;
    }
    if (input.onInsufficient) {
      try { await input.onInsufficient(); } catch { /* ignore */ }
    }
    try { await store.saveMessage(input.assistantMessage); } catch { /* ignore */ }
    return { ok: false, balance };
  };

  if (input.cost <= 0) {
    if (reserved > 0) {
      await store.addCredits(input.organizationId, reserved, `Refund unused AI reservation (${input.reason})`);
    }
    return { ok: true, balance: await store.getCreditBalance(input.organizationId) };
  }

  let balance = await store.getCreditBalance(input.organizationId);
  const additionalCost = Math.max(0, input.cost - reserved);
  if (additionalCost > 0) {
    const debit = await store.tryDeductCredits(input.organizationId, additionalCost, input.reason);
    if (!debit.ok) {
      return markInsufficient(debit.balance);
    }
    balance = debit.balance;
  } else if (reserved > input.cost) {
    await store.addCredits(input.organizationId, reserved - input.cost, `Refund unused AI reservation (${input.reason})`);
    balance = await store.getCreditBalance(input.organizationId);
  }

  input.assistantMessage.usageCostCredits = input.cost;
  try { await store.saveMessage(input.assistantMessage); } catch { /* ignore */ }
  return { ok: true, balance };
}

async function deterministicAssistantContent(projectId: string, prompt: string, history: AiMessage[] = []) {
  if (isFailedGenerationFollowup(prompt, history)) {
    return blockedPatchFollowupText(history);
  }
  if (isBroadRecommendationFollowup(prompt, history)) {
    return broadRecommendationFollowupText(history);
  }
  if (/\b(credit|credits|cost|spent|used|charge|charged|usage)\b/i.test(prompt)
    && /\b(chat|thread|conversation|total|so far|how many|how much)\b/i.test(prompt)) {
    const total = history.reduce((sum, message) => sum + (message.usageCostCredits ?? 0), 0);
    const chargedMessages = history.filter((message) => typeof message.usageCostCredits === "number");
    const lastCost = chargedMessages[chargedMessages.length - 1]?.usageCostCredits;
    const project = await store.fetchProject(projectId);
    const usage = project ? await store.getUsageStats(project.organizationId) : undefined;
    const weeklyAllowance = usage?.weekly.allowance ?? 100;
    const usagePercent = (amount: number) => `used ${Math.max(1, Math.round((amount / Math.max(weeklyAllowance, 1)) * 100))}%`;
    return [
      `This chat has ${usagePercent(total)} so far.`,
      typeof lastCost === "number" ? `The last charged assistant response ${usagePercent(lastCost)}.` : "I do not see a charged assistant response in this thread yet."
    ].join(" ");
  }
  if (needsUiBackendClarification(prompt)) {
    return "Do you want this as visual-only UI, or should purchases and rebirths actually change player stats on the server?";
  }
  if (isAutoSyncStatusPrompt(prompt)) {
    const sessions = await store.fetchSessionsForProject(projectId);
    const latestSession = sessions
      .filter((session) => session.status === "connected" || session.status === "paired")
      .sort((a, b) => (b.lastSeenAt ?? b.pairedAt ?? b.createdAt).localeCompare(a.lastSeenAt ?? a.pairedAt ?? a.createdAt))[0];
    const lastSeen = latestSession?.lastSeenAt ? new Date(latestSession.lastSeenAt).getTime() : 0;
    const online = Number.isFinite(lastSeen) && Date.now() - lastSeen < 25_000;
    return online
      ? "The Studio plugin is already auto-syncing. I will use the latest synced snapshot for the next patch, and I only need you to reconnect the plugin if it goes offline."
      : "Auto-sync runs from the Studio plugin, but the latest plugin session looks offline. Reopen the Vectis plugin in Roblox Studio, then I will use the latest synced snapshot as soon as it checks in.";
  }
  const projectInspection = deterministicProjectStructureInspection(await store.fetchLatestSnapshot(projectId), prompt);
  if (projectInspection) return projectInspection;
  return undefined;
}

const STUDIO_COMMAND_TOOLS: { type: StudioCommandType; description: string; parameters: Record<string, string> }[] = [
  { type: "read_output", description: "Read recent Studio Output log lines", parameters: { limit: "number of lines (default 30, max 100)" } },
  { type: "script_search", description: "Find scripts by name or path using the connected Studio session", parameters: { query: "script name, path, or feature keyword", limit: "number of scripts (default 10, max 25)" } },
  { type: "script_grep", description: "Search script source for a string in the connected Studio session", parameters: { query: "plain text to find", limit: "number of matches (default 20, max 50)", caseSensitive: "boolean" } },
  { type: "script_read", description: "Read a script's source from the connected Studio session", parameters: { path: "Vectis path to the script", startLine: "optional first line", endLine: "optional last line" } },
  { type: "query_tree", description: "Return the hierarchy of instances under a path", parameters: { path: "optional root path (default game)", maxDepth: "depth 1-5 (default 3)" } },
  { type: "inspect_instance", description: "Read an instance's properties, children, and source", parameters: { path: "Vectis path to the instance" } }
];

const MAX_TOOL_ITERATIONS = 3;
const LIVE_STUDIO_PREFLIGHT_TIMEOUT_MS = 2_000;
const LIVE_STUDIO_PREFLIGHT_MAX_SESSION_AGE_MS = 60_000;
const MAX_LIVE_STUDIO_INSPECTS = 3;

interface StudioToolResult {
  type: StudioCommandType;
  result: Record<string, unknown>;
  error?: string;
}

async function runStudioToolCalls(
  session: StudioSession | undefined,
  toolCalls: Array<{ type: StudioCommandType; arguments: Record<string, unknown> }>
): Promise<StudioToolResult[]> {
  if (!session) {
    return toolCalls.map((t) => ({ type: t.type, result: {}, error: "No Studio session connected" }));
  }
  const results: StudioToolResult[] = [];
  for (let index = 0; index < toolCalls.length; index += 4) {
    const batch = toolCalls.slice(index, index + 4);
    const batchResults = await Promise.all(batch.map(async (call): Promise<StudioToolResult> => {
      try {
        const result = await queueStudioCommand(session.id, {
          id: `cmd_${nanoid()}`,
          type: call.type,
          arguments: call.arguments
        });
        return { type: call.type, result: result ?? {} };
      } catch (error) {
        return { type: call.type, result: {}, error: String(error) };
      }
    }));
    results.push(...batchResults);
  }
  return results;
}

function studioCommandTypeFromToolName(name: string): StudioCommandType | undefined {
  if (STUDIO_COMMAND_TOOLS.some((tool) => tool.type === name)) return name as StudioCommandType;
  return undefined;
}

function createStudioToolRuntime(input: {
  session: StudioSession | undefined;
  onToolCall?: (toolNames: string) => void;
  projectId?: string;
  runId?: string;
}): AiStudioToolRuntime {
  const enabled = Boolean(input.session && ["connected", "paired"].includes(input.session.status));
  return {
    enabled,
    maxIterations: MAX_TOOL_ITERATIONS + 2,
    onToolCall: input.onToolCall,
    isCancelled: async () => input.runId ? (await store.fetchAgentRun(input.runId))?.status === "cancelled" : false,
    consumeSteering: async () => {
      if (!input.runId) return [];
      const run = await store.fetchAgentRun(input.runId);
      if (!run?.queuedSteering?.length) return [];
      const steering = [...run.queuedSteering];
      run.queuedSteering = [];
      run.updatedAt = new Date().toISOString();
      await store.saveAgentRun(run);
      return steering;
    },
    execute: async (calls: AiToolCall[]) => {
      if (input.runId) {
        const run = await store.fetchAgentRun(input.runId);
        if (run?.status === "cancelled") throw new Error("Agent run cancelled at the tool boundary.");
      }
      const artifactResults = new Map<string, { id: string; name: string; result: Record<string, unknown>; error?: string }>();
      for (const call of calls.filter((candidate) => candidate.name === "read_agent_artifact")) {
        const artifactId = typeof call.input.artifactId === "string" ? call.input.artifactId : "";
        const artifact = artifactId ? await store.fetchAgentArtifact(artifactId) : undefined;
        if (!artifact || (input.runId && artifact.runId !== input.runId)) {
          artifactResults.set(call.id, { id: call.id, name: call.name, result: {}, error: "Agent artifact not found or expired." });
          continue;
        }
        const cursor = Math.max(0, typeof call.input.cursor === "number" ? Math.floor(call.input.cursor) : 0);
        const limit = Math.min(12_000, Math.max(1_000, typeof call.input.limit === "number" ? Math.floor(call.input.limit) : 8_000));
        const content = artifact.content.slice(cursor, cursor + limit);
        artifactResults.set(call.id, {
          id: call.id,
          name: call.name,
          result: { artifactId, content, nextCursor: cursor + content.length < artifact.content.length ? cursor + content.length : undefined }
        });
      }
      const commandCalls = calls.map((call) => ({
        call,
        type: studioCommandTypeFromToolName(call.name)
      }));
      const runnable = commandCalls.filter((call): call is { call: AiToolCall; type: StudioCommandType } => Boolean(call.type));
      const results = await runStudioToolCalls(input.session, runnable.map((call) => ({
        type: call.type,
        arguments: call.call.input
      })));
      const byIndex = new Map<number, StudioToolResult>();
      results.forEach((result, index) => byIndex.set(index, result));
      let runnableIndex = 0;
      const mapped = commandCalls.map(({ call, type }) => {
        const artifactResult = artifactResults.get(call.id);
        if (artifactResult) return artifactResult;
        if (!type) {
          return { id: call.id, name: call.name, result: {}, error: `Unknown Studio tool: ${call.name}` };
        }
        const result = byIndex.get(runnableIndex);
        runnableIndex += 1;
        return {
          id: call.id,
          name: call.name,
          result: result?.result ?? {},
          error: result?.error
        };
      });
      return Promise.all(mapped.map(async (toolResult) => {
        if (toolResult.error || !input.projectId || !input.runId) return toolResult;
        const content = JSON.stringify(toolResult.result ?? {});
        if (content.length <= 8_000) return toolResult;
        const artifactId = await store.createUniqueId("agentArtifacts", "artifact_", 18);
        await store.saveAgentArtifact({
          id: artifactId,
          projectId: input.projectId,
          runId: input.runId,
          tool: toolResult.name,
          mimeType: "application/json",
          content,
          summary: `${toolResult.name} returned ${content.length.toLocaleString()} characters.`,
          createdAt: new Date().toISOString(),
          expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1_000).toISOString()
        });
        return {
          ...toolResult,
          result: { truncated: true, artifactId, preview: content.slice(0, 8_000), nextCursor: 8_000 }
        };
      }));
    }
  };
}

async function runStudioCommandWithSoftTimeout(
  session: StudioSession,
  type: StudioCommandType,
  args: Record<string, unknown>,
  timeoutMs = LIVE_STUDIO_PREFLIGHT_TIMEOUT_MS
): Promise<StudioToolResult> {
  const commandId = `cmd_${nanoid()}`;
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const commandPromise = queueStudioCommand(session.id, {
    id: commandId,
    type,
    arguments: args
  })
    .then((result) => ({ type, result: result ?? {} }))
    .catch((error) => ({ type, result: {}, error: String(error) }));

  const timeoutPromise = new Promise<StudioToolResult>((resolve) => {
    timeout = setTimeout(() => {
      resolve({ type, result: {}, error: `Studio tool did not return within ${Math.round(timeoutMs / 1000)}s` });
    }, timeoutMs);
  });

  try {
    return await Promise.race([commandPromise, timeoutPromise]);
  } finally {
    if (timeout) clearTimeout(timeout);
    commandPromise.catch(() => undefined);
  }
}

function liveInspectCandidates(prompt: string, snapshot: ProjectSnapshot | undefined) {
  if (!snapshot) return [];
  const promptLower = prompt.toLowerCase();
  const words = new Set(
    promptLower
      .split(/[^a-z0-9_]+/i)
      .map((word) => word.trim())
      .filter((word) => word.length >= 4)
  );
  return snapshot.nodes
    .filter((node) => /script$/i.test(node.className))
    .map((node) => {
      const pathLower = node.path.toLowerCase();
      const name = node.path.split("/").pop()?.toLowerCase() ?? "";
      let score = 0;
      if (promptLower.includes(name) && name.length >= 4) score += 4;
      for (const word of words) {
        if (pathLower.includes(word)) score += 1;
      }
      return { node, score };
    })
    .filter((candidate) => candidate.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, MAX_LIVE_STUDIO_INSPECTS)
    .map((candidate) => candidate.node.path);
}

function compactStudioToolResult(result: StudioToolResult) {
  if (result.error) return `Tool ${result.type} failed: ${result.error}`;
  const json = JSON.stringify(result.result ?? {});
  return `Tool ${result.type} result: ${json.length > 6_000 ? `${json.slice(0, 6_000)}...` : json}`;
}

function shouldRunLiveStudioPreflight(input: {
  mode: "explain" | "changeset";
  deterministicTemplateEligible: boolean;
}) {
  return input.mode === "changeset"
    && !input.deterministicTemplateEligible;
}

function studioPluginSupportsScriptTools(pluginVersion: string) {
  if (process.env.NODE_ENV === "test" && (pluginVersion === "test" || pluginVersion === "dev")) return true;
  const match = pluginVersion.match(/(\d+)\.(\d+)\.(\d+)/);
  if (!match) return false;
  const [, majorRaw, minorRaw, patchRaw] = match;
  const major = Number(majorRaw);
  const minor = Number(minorRaw);
  const patch = Number(patchRaw);
  if (major > 1) return true;
  if (major < 1) return false;
  if (minor > 19) return true;
  if (minor < 19) return false;
  return patch >= 0;
}

function liveStudioSearchQuery(prompt: string) {
  const candidates = prompt
    .split(/[^A-Za-z0-9_]+/)
    .map((word) => word.trim())
    .filter((word) => word.length >= 4 && !/^(please|make|create|add|fix|with|that|this|when|from|into|because|runtime|error)$/i.test(word));
  return candidates.slice(0, 4).join(" ") || "script";
}

async function buildLiveStudioPreflightContext(input: {
  session: StudioSession | undefined;
  prompt: string;
  snapshot: ProjectSnapshot | undefined;
}) {
  if (!input.session || !["connected", "paired"].includes(input.session.status)) return "";
  const session = input.session;
  const lastSeenMs = input.session.lastSeenAt ? Date.parse(input.session.lastSeenAt) : 0;
  if (!Number.isFinite(lastSeenMs) || Date.now() - lastSeenMs > LIVE_STUDIO_PREFLIGHT_MAX_SESSION_AGE_MS) return "";

  const inspectPaths = liveInspectCandidates(input.prompt, input.snapshot);
  const supportsScriptTools = studioPluginSupportsScriptTools(session.pluginVersion);
  const commands: Array<{ type: StudioCommandType; arguments: Record<string, unknown> }> = [
    { type: "read_output", arguments: { limit: 50 } },
    supportsScriptTools
      ? { type: "script_search", arguments: { query: liveStudioSearchQuery(input.prompt), limit: 10 } }
      : { type: "query_tree", arguments: { maxDepth: 2 } },
    ...(supportsScriptTools
      ? [{ type: "script_grep" as const, arguments: { query: liveStudioSearchQuery(input.prompt), limit: 20 } }]
      : []),
    ...inspectPaths.map((path) => ({
      type: supportsScriptTools ? "script_read" as const : "inspect_instance" as const,
      arguments: { path }
    }))
  ];
  const results = await Promise.all(
    commands.map((command) => runStudioCommandWithSoftTimeout(session, command.type, command.arguments))
  );
  const useful = results.filter((result) => !result.error || result.type !== "query_tree");
  if (useful.length === 0) return "";
  return [
    "LIVE STUDIO TOOL PREFLIGHT:",
    "These results came from the connected Vectis Studio plugin immediately before generating this patch.",
    "Prefer this live evidence over stale assumptions. If a tool failed, continue from the synced snapshot instead of inventing missing details.",
    ...useful.map(compactStudioToolResult)
  ].join("\n");
}

async function answerWithStudioTools(
  input: {
    project: Project;
    prompt: string;
    model: string;
    snapshot: ProjectSnapshot | undefined;
    history: AiMessage[];
    preferences: UserPreferences | undefined;
    plan: PlanName;
    providerTimeoutMs: number;
    contextSummary: string | undefined;
    session: StudioSession | undefined;
    responseStyle?: "concise";
    onChunk?: (text: string) => void;
    onRuntimeEvent?: (event: AiRuntimeEvent) => void;
    onToolCall?: (toolNames: string) => void;
    thinkingLevel: "none" | "low" | "medium" | "high" | "xhigh" | "max";
    attachments?: Array<{ id: string; fileName: string; mimeType: string; dataBase64?: string }>;
    agentRunId?: string;
    contextIndex?: ProjectContextIndex;
  }
): Promise<{ text: string; usage?: AiUsageAccumulator }> {
  const studioTools = createStudioToolRuntime({ session: input.session, onToolCall: input.onToolCall, projectId: input.project.id, runId: input.agentRunId });
  return answerProjectQuestion({
    project: input.project,
    prompt: input.prompt,
    model: input.model,
    planMode: false,
    snapshot: input.snapshot,
    history: input.history,
    preferences: input.preferences,
    plan: input.plan,
    providerTimeoutMs: input.providerTimeoutMs,
    contextSummary: input.contextSummary,
    responseStyle: input.responseStyle,
    onChunk: input.onChunk,
    onRuntimeEvent: input.onRuntimeEvent,
    studioTools,
    thinkingLevel: input.thinkingLevel,
    attachments: input.attachments,
    contextIndex: input.contextIndex
  });
}

async function createAssistantResponse(input: {
  userId: string;
  project: Project;
  organizationId: string;
  threadId: string;
  userMessage: AiMessage;
  prompt: string;
  mode: "explain" | "changeset";
  model?: string;
  planMode?: boolean;
  usageOptimizer?: boolean;
  luauGuard?: boolean;
  verificationMode?: "off" | "standard" | "deep";
  simpleOptimized?: boolean;
  optimizationMode?: "disabled" | "balanced" | "cost_saver";
  preferences?: UserPreferences;
  reservation?: CreditReservation;
  intent?: "general" | "console_fix";
  ctx: RouteContext;
  attachments?: Attachment[];
}) {
  const responseStartedAt = Date.now();
  const organization = await store.fetchOrganization(input.organizationId);
  if (!organization) throw new Error("Organization missing");
  const runtimeTrace = {
    version: "ai-runtime-v2" as const,
    textChunks: 0,
    reasoningChunks: 0,
    usageEvents: 0,
    warnings: [] as string[],
    finishReason: undefined as string | undefined,
    startedAtMs: responseStartedAt,
    firstTextAtMs: undefined as number | undefined,
    firstReasoningAtMs: undefined as number | undefined,
    lastEventAtMs: undefined as number | undefined,
    lastEventType: undefined as AiRuntimeEvent["type"] | undefined
  };
  let reasoningPreviewChars = 0;
  let activeProviderProgress: {
    stage: string;
    label: string;
    model: string;
    thinkingLevel: string;
    timeoutMs?: number;
    planning?: "running" | "skipped" | "completed";
  } | undefined;
  let lastRuntimeProgressAt = 0;
  function runtimeStatusDetail() {
    if (!activeProviderProgress) return undefined;
    if (runtimeTrace.lastEventType === "finish") return "Saving the result.";
    return undefined;
  }
  function emitRuntimeProgress(force = false) {
    if (!activeProviderProgress) return;
    const now = Date.now();
    if (!force && now - lastRuntimeProgressAt < 2500) return;
    lastRuntimeProgressAt = now;
    const label = runtimeTrace.lastEventType === "reasoning_delta"
      ? "Thinking through the project"
      : runtimeTrace.lastEventType === "text_delta"
        ? "Writing response"
        : runtimeTrace.lastEventType === "finish"
          ? "Saving response"
          : activeProviderProgress.label;
    emitProgress(activeProviderProgress.stage, label, runtimeStatusDetail(), {
      model: activeProviderProgress.model,
      thinkingLevel: activeProviderProgress.thinkingLevel,
      planning: activeProviderProgress.planning
    });
  }
  const onRuntimeEvent = (event: AiRuntimeEvent) => {
    const now = Date.now();
    runtimeTrace.lastEventAtMs = now;
    runtimeTrace.lastEventType = event.type;
    if (event.type === "text_delta") {
      runtimeTrace.textChunks += 1;
      runtimeTrace.firstTextAtMs ??= now;
    } else if (event.type === "reasoning_delta") {
      runtimeTrace.reasoningChunks += 1;
      runtimeTrace.firstReasoningAtMs ??= now;
      if (reasoningPreviewChars < MAX_REASONING_PREVIEW_CHARS) {
        const cleaned = sanitizeReasoningPreview(event.text);
        if (cleaned) {
          const remaining = MAX_REASONING_PREVIEW_CHARS - reasoningPreviewChars;
          const preview = cleaned.slice(0, remaining);
          reasoningPreviewChars += preview.length;
          socketService.notifyChatReasoning(input.userId, {
            threadId: input.threadId,
            content: preview,
            done: false
          });
        }
      }
    } else if (event.type === "usage") runtimeTrace.usageEvents += 1;
    else if (event.type === "finish") {
      runtimeTrace.finishReason = event.reason;
      if (reasoningPreviewChars > 0) {
        socketService.notifyChatReasoning(input.userId, {
          threadId: input.threadId,
          content: "",
          done: true
        });
      }
    }
    else if (event.type === "warning" && runtimeTrace.warnings.length < 5) runtimeTrace.warnings.push(event.message);
    emitRuntimeProgress(event.type === "finish" || event.type === "warning");
  };
  const runtimeTraceForMessage = () => {
    if (
      runtimeTrace.textChunks === 0
      && runtimeTrace.reasoningChunks === 0
      && runtimeTrace.usageEvents === 0
      && runtimeTrace.warnings.length === 0
      && !runtimeTrace.finishReason
    ) return undefined;
    return {
      version: runtimeTrace.version,
      textChunks: runtimeTrace.textChunks,
      reasoningChunks: runtimeTrace.reasoningChunks,
      usageEvents: runtimeTrace.usageEvents,
      elapsedMs: Date.now() - runtimeTrace.startedAtMs,
      ...(runtimeTrace.firstTextAtMs ? { firstTextMs: runtimeTrace.firstTextAtMs - runtimeTrace.startedAtMs } : {}),
      ...(runtimeTrace.firstReasoningAtMs ? { firstReasoningMs: runtimeTrace.firstReasoningAtMs - runtimeTrace.startedAtMs } : {}),
      ...(runtimeTrace.lastEventAtMs ? { lastEventMs: runtimeTrace.lastEventAtMs - runtimeTrace.startedAtMs, lastEventType: runtimeTrace.lastEventType } : {}),
      ...(runtimeTrace.warnings.length ? { warnings: [...runtimeTrace.warnings] } : {}),
      ...(runtimeTrace.finishReason ? { finishReason: runtimeTrace.finishReason } : {})
    };
  };

  const emitProgress = (stage: string, label: string, detail?: string, extra?: { model?: string; thinkingLevel?: string; planning?: "running" | "skipped" | "completed" }) => {
    socketService.notifyChatProgress(input.userId, {
      threadId: input.threadId,
      stage, label, detail,
      elapsedMs: Date.now() - responseStartedAt,
      ...extra
    });
  };
  const startProviderHeartbeat = (input: {
    stage: string;
    label: string;
    model: string;
    thinkingLevel: string;
    timeoutMs?: number;
    dynamic?: boolean;
    planning?: "running" | "skipped" | "completed";
  }) => {
    activeProviderProgress = {
      stage: input.stage,
      label: input.label,
      model: input.model,
      thinkingLevel: input.thinkingLevel,
      timeoutMs: input.timeoutMs,
      planning: input.planning
    };
    emitRuntimeProgress(true);
    const timer = setInterval(() => {
      emitRuntimeProgress(true);
    }, 20_000);
    return () => {
      clearInterval(timer);
      if (activeProviderProgress?.stage === input.stage && activeProviderProgress.model === input.model) {
        activeProviderProgress = undefined;
      }
    };
  };

  const allHistory = await store.fetchMessagesForThread(input.threadId);
  const history = compactChatHistory(allHistory);
  const latestSnapshot = await store.fetchLatestSnapshot(input.project.id);
  const contextIndex = latestSnapshot ? await store.fetchProjectContextIndex(latestSnapshot.id) : undefined;
  emitProgress("context", "Reading project context", undefined, { model: input.model || "pending" });
  const contextSummary = await cachedProjectContextSummary(latestSnapshot);
  const shouldUseContextSummary = Boolean(
    contextSummary && (input.preferences?.contextCachingEnabled || input.usageOptimizer || input.optimizationMode !== "disabled")
  );

  // FETCH STUDIO RUNTIME LOGS FOR CONTEXT
  const sessions = await store.fetchSessionsForProject(input.project.id);
  const latestSession = sessions
    .filter((s) => s.status === "connected" || s.status === "paired")
    .sort((a, b) => (b.lastSeenAt ?? b.pairedAt ?? b.createdAt).localeCompare(a.lastSeenAt ?? a.pairedAt ?? a.createdAt))[0];
  
  const sessionFreshAfter = latestSession
    ? Math.max(
        Date.now() - STUDIO_LOG_CONTEXT_WINDOW_MS,
        Date.parse(latestSession.pairedAt ?? latestSession.createdAt) || 0
      )
    : 0;
  const logs = latestSession ? await store.fetchLogsForSession(latestSession.id) : [];
  const recentLogs = logs
    .filter((log) => !/\b(?:StudioActionService|Already polling|polling.*ignoring|session.*ended|agent.*inactive)\b/i.test(log.message))
    .filter((log) => {
      const createdAt = Date.parse(log.createdAt);
      return Number.isFinite(createdAt) && createdAt >= sessionFreshAfter;
    })
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, 50)
    .reverse();

  // RUN MARKETPLACE SEARCH IF RELEVANT
  let marketplaceResultsText = "";
  const marketQuery = extractMarketplaceQuery(input.prompt);
  if (marketQuery && input.mode === "changeset") {
    emitProgress("context", "Searching marketplace", undefined, { model: input.model || "pending" });
    try {
      const results = await searchRobloxMarketplace({
        query: marketQuery,
        assetType: "model",
        limit: 5
      });
      if (results.length > 0) {
        marketplaceResultsText = [
          "ROBLOX CREATOR STORE SEARCH RESULTS (REAL ASSET IDS):",
          "Here are real, active models matching the query in the Roblox Creator Store.",
          "If the user wants you to import or place this asset, use the 'import_asset' action in your changeset with the exact ID listed below:",
          ...results.map(r => `  * Asset ID: ${r.id}, Name: "${r.name}"${r.creatorName ? `, Creator: "${r.creatorName}"` : ""}`)
        ].join("\n");
      }
    } catch (err) {
      log.warn("Creator Store search failed", { marketQuery, error: String(err) });
    }
  }

  // Free verified audio catalog for sound/SFX requests (no user-provided assets required)
  const freeSoundText = input.mode === "changeset" || promptRequestsSound(input.prompt)
    ? freeSoundCatalogPromptBlock(input.prompt)
    : "";
  if (freeSoundText && input.mode === "changeset") {
    emitProgress("context", "Resolving free audio", undefined, { model: input.model || "pending" });
  }

  // BUILD THE COMPOSITE PROMPT WITH CONTEXT
  let promptWithContext = input.prompt;
  if (marketplaceResultsText) {
    promptWithContext = `${promptWithContext}\n\n${marketplaceResultsText}`;
  }
  if (freeSoundText) {
    promptWithContext = `${promptWithContext}\n\n${freeSoundText}`;
  }
  if (recentLogs.length > 0) {
    const formattedLogs = recentLogs
      .map((log) => `[${log.level.toUpperCase()}] ${log.message}`)
      .join("\n");
    promptWithContext = `${promptWithContext}\n\nSTUDIO CONSOLE LOGS (Active Session):\n${formattedLogs}`;
  }

  const deterministicTemplateEligible = input.mode === "changeset" && shouldUseNoCostDeterministicTemplate({ prompt: input.prompt, snapshot: latestSnapshot, history });
  const currentBalance = await store.getCreditBalance(organization.id);

  if (currentBalance <= 0 && !deterministicTemplateEligible && !input.reservation?.amount) {
    const usage = await store.getUsageStats(organization.id).catch(() => undefined);
    throw usageLimitError(usageLimitPayload({
      plan: organization.plan,
      creditBalance: currentBalance,
      requiredCredits: 1,
      usage
    }));
  }

  const selectedModel = input.model || defaultAiModel();
  let actualModel = selectedModel;
  let wasOptimized = false;
  let routingNote: string | undefined;

  if (deterministicTemplateEligible) {
    actualModel = "vectis-recovery";
  } else if (modelIsOptimizable(selectedModel) && input.simpleOptimized) {
    const optModel = optimizedModelFor(input.mode, input.optimizationMode);
    if (optModel && optModel !== selectedModel && modelIsAvailable(optModel)) {
      actualModel = optModel;
      wasOptimized = true;
      routingNote = `Routing note: this request was optimized to ${actualModel} because the task looked routine.`;
    }
  }

  let activeThinkingLevel = getThinkingLevel(actualModel, input.preferences, organization.plan);
  const routineOptimizedAnswer = Boolean(
    input.simpleOptimized && input.mode === "explain" && !input.planMode && !isContextQuestion(input.prompt)
  );
  // For answer mode with large snapshots, always prefer context summary to avoid timeout
  const largeSnapshot = (latestSnapshot?.nodes.length ?? 0) > 2000;
  const useContextSummaryForAnswer = input.mode === "explain" && contextSummary && largeSnapshot;
  const answerSnapshot = (routineOptimizedAnswer && shouldUseContextSummary) || useContextSummaryForAnswer ? undefined : latestSnapshot;
  const contextSummaryForProvider = (shouldUseContextSummary || useContextSummaryForAnswer) ? contextSummary : undefined;

  // Cap thinking to medium for answer mode on large projects when full snapshot is sent (no context summary)
  if (input.mode === "explain" && largeSnapshot && !useContextSummaryForAnswer && (activeThinkingLevel === "high" || activeThinkingLevel === "max" || activeThinkingLevel === "xhigh")) {
    activeThinkingLevel = "medium";
  }

  const runCreatedAt = new Date().toISOString();
  const maxReadCalls = input.planMode || input.verificationMode === "deep" || (latestSnapshot?.nodes.length ?? 0) > 2_000 ? 16 : input.mode === "changeset" ? 12 : 8;
  const agentRun: AgentRun = {
    id: await store.createUniqueId("agentRuns", "run_", 18),
    projectId: input.project.id,
    threadId: input.threadId,
    userId: input.userId,
    userMessageId: input.userMessage.id,
    requestedModel: selectedModel,
    actualModel,
    provider: configuredProviderForModel(actualModel) || "local",
    mode: input.mode === "changeset" ? "changeset" : "answer",
    status: "preparing_context",
    workloadBudget: { maxReadCalls, maxRepairAttempts: maxReadCalls >= 16 ? 2 : 1, maxParallelReads: 4 },
    contextDigest: contextIndex?.digest ?? (latestSnapshot ? snapshotFingerprint(latestSnapshot) : undefined),
    steps: [{ index: 0, kind: "context", status: "completed", title: "Prepared project context", completedAt: runCreatedAt }],
    createdAt: runCreatedAt,
    updatedAt: runCreatedAt
  };
  await store.saveAgentRun(agentRun);
  socketService.notifyAgentRunEvent(input.userId, input.threadId, { type: "run_started", runId: agentRun.id, at: runCreatedAt });
  input.userMessage.agentRunId = agentRun.id;
  await store.saveMessage(input.userMessage);

  const providerAttachments = await Promise.all((input.attachments ?? []).map(async (attachment) => {
    const supportsNativeImage = modelCapabilitiesFor(actualModel).imageInput && /^image\/(png|jpeg|webp)$/i.test(attachment.mimeType);
    if (!supportsNativeImage) return { id: attachment.id, fileName: attachment.fileName, mimeType: attachment.mimeType };
    try {
      const bytes = await readAttachmentBytes(attachment);
      if (!bytes) throw new Error("Attachment bytes are unavailable.");
      return { id: attachment.id, fileName: attachment.fileName, mimeType: attachment.mimeType, dataBase64: bytes.toString("base64") };
    } catch (error) {
      log.warn("Could not load attachment for multimodal provider input", { attachmentId: attachment.id, error: String(error) });
      return { id: attachment.id, fileName: attachment.fileName, mimeType: attachment.mimeType };
    }
  }));

  const finishAgentRun = async (assistantMessage: AiMessage, status: AgentRun["status"], changeSet?: ChangeSet) => {
    const at = new Date().toISOString();
    assistantMessage.agentRunId = agentRun.id;
    assistantMessage.clientRequestId = input.userMessage.clientRequestId;
    await store.saveMessage(assistantMessage);
    agentRun.assistantMessageId = assistantMessage.id;
    agentRun.changeSetId = changeSet?.id;
    agentRun.status = status;
    agentRun.actualModel = assistantMessage.modelUsed || actualModel;
    agentRun.updatedAt = at;
    if (["completed", "failed", "cancelled"].includes(status)) agentRun.completedAt = at;
    agentRun.steps.push({
      index: agentRun.steps.length,
      kind: changeSet ? "review" : "model",
      status: "completed",
      title: changeSet ? "Patch ready for review" : "Response completed",
      completedAt: at
    });
    await store.saveAgentRun(agentRun);
    socketService.notifyAgentRunEvent(input.userId, input.threadId, {
      type: status === "cancelled" ? "run_cancelled" : status === "failed" ? "run_failed" : status === "awaiting_review" ? "awaiting_review" : "run_completed",
      runId: agentRun.id,
      at,
      detail: changeSet?.title
    });
  };

  if (shouldRunLiveStudioPreflight({ mode: input.mode, deterministicTemplateEligible })) {
    emitProgress("context", "Inspecting live Studio", undefined, { model: actualModel, thinkingLevel: activeThinkingLevel });
    const liveStudioPreflight = await buildLiveStudioPreflightContext({
      session: latestSession,
      prompt: input.prompt,
      snapshot: latestSnapshot
    });
    if (liveStudioPreflight) {
      promptWithContext = `${promptWithContext}\n\n${liveStudioPreflight}`;
    }
  }

  emitProgress("routing", "Analyzing your request",
    undefined,
    { model: actualModel, thinkingLevel: activeThinkingLevel });

  const providerTraceFor = (mode: "chat" | "changeset", timeoutMs?: number) => ({
    provider: configuredProviderForModel(actualModel) || "local",
    requestedModel: selectedModel,
    usedModel: actualModel,
    thinkingLevel: activeThinkingLevel,
    thinkingMultiplier: getThinkingMultiplier(actualModel, mode, input.preferences, organization.plan),
    timeoutMs,
    fallbackNote: routingNote?.replace(/^Routing note: /i, ""),
    runtime: runtimeTraceForMessage()
  });

  const saveNoChargeAssistantResponse = async (content: string, modelUsed = actualModel) => {
    let assistantMessage: AiMessage;
    let finalBalance = 0;
    if (input.reservation && !input.reservation.settled && input.reservation.amount > 0) {
      await store.addCredits(organization.id, input.reservation.amount, "Refund unused AI reservation (no-charge response)");
      input.reservation.settled = true;
    }
    await input.ctx.orgLocks.run(organization.id, async () => {
      assistantMessage = await store.saveMessage({
        id: await store.createUniqueId("messages", "msg_", 18),
        projectId: input.project.id,
        threadId: input.threadId,
        role: "assistant",
        content,
        modelUsed,
        modelRequested: selectedModel,
        wasOptimized,
        thoughtDurationMs: Date.now() - responseStartedAt,
        providerTrace: providerTraceFor("chat"),
        createdAt: new Date().toISOString()
      });
      finalBalance = await store.getCreditBalance(organization.id);
    });
    emitProgress("done", "Complete", undefined, { model: actualModel, thinkingLevel: activeThinkingLevel });
    await finishAgentRun(assistantMessage!, "completed");
    return { userMessage: input.userMessage, assistantMessage: assistantMessage!, creditBalance: finalBalance };
  };

  if (input.planMode) {
    if (isPlanModeImplementationRequest(input.prompt, history)) {
      return saveNoChargeAssistantResponse(planModeImplementationBlockedText());
    }
    emitProgress("generating", "Writing response",
      `${modelDisplayName(actualModel)} is reading your project.`,
      { model: actualModel, thinkingLevel: activeThinkingLevel });

    const answerTimeoutMs = dynamicAnswerTimeoutMs({
      prompt: promptWithContext,
      latestSnapshot,
      answerSnapshot: latestSnapshot,
      history,
      thinkingLevel: activeThinkingLevel,
      hasStudioSession: Boolean(latestSession),
      planMode: true
    });
    let result: Awaited<ReturnType<typeof answerProjectQuestion>>;
    const stopHeartbeat = startProviderHeartbeat({
      stage: "generating",
      label: "Writing response",
      model: actualModel,
      thinkingLevel: activeThinkingLevel,
      timeoutMs: answerTimeoutMs,
      dynamic: true
    });
    try {
      result = await withTimeout(
        answerProjectQuestion({
          project: input.project, prompt: planOnlyPrompt(promptWithContext),
          model: actualModel, planMode: true, snapshot: latestSnapshot,
          history, preferences: input.preferences, plan: organization.plan, providerTimeoutMs: answerTimeoutMs,
          contextSummary: contextSummaryForProvider,
          attachments: providerAttachments,
          contextIndex,
          onRuntimeEvent,
          thinkingLevel: activeThinkingLevel
        }),
        answerTimeoutMs, providerTimeoutMessage(actualModel, "answer")
      );
    } catch (error) {
      if (isProviderTimeoutError(error)) {
        return saveNoChargeAssistantResponse(providerTimeoutAssistantText(actualModel, "answer"));
      }
      throw error;
    } finally {
      stopHeartbeat();
    }

    let taskPlan: any = undefined;
    let cleanContent = result.text;
    const planMatch = result.text.match(/<VECTIS_PLAN>([\s\S]*?)<\/VECTIS_PLAN>/);
    if (planMatch) {
      try {
        const parsedJson = JSON.parse(planMatch[1].trim());
        const planId = await store.createUniqueId("taskPlans", "plan_", 18);
        taskPlan = {
          id: planId,
          projectId: input.project.id,
          threadId: input.threadId,
          userMessageId: input.userMessage.id,
          status: "draft",
          goal: parsedJson.goal || "",
          assumptions: parsedJson.assumptions || [],
          targetInstances: parsedJson.targetInstances || [],
          steps: (parsedJson.steps || []).map((s: any) => ({
            id: s.id || `step_${Math.random().toString(36).slice(2, 6)}`,
            description: s.description || "",
            targetFile: s.targetFile
          })),
          acceptanceCriteria: parsedJson.acceptanceCriteria || [],
          risks: parsedJson.risks || [],
          estimatedComplexity: parsedJson.estimatedComplexity || "medium",
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        };
        await store.saveDoc("taskPlans", taskPlan);
        
        cleanContent = result.text.replace(/<VECTIS_PLAN>[\s\S]*?<\/VECTIS_PLAN>/g, "").trim();
      } catch (err) {
        log.warn("Failed to parse VECTIS_PLAN JSON from response", { error: String(err) });
      }
    }

    let assistantMessage: AiMessage;
    let finalBalance = 0;
    await input.ctx.orgLocks.run(organization.id, async () => {
      assistantMessage = await store.saveMessage({
        id: await store.createUniqueId("messages", "msg_", 18),
        projectId: input.project.id, threadId: input.threadId,
        role: "assistant", content: planOnlyText(cleanContent),
        modelUsed: actualModel, modelRequested: selectedModel, wasOptimized,
        thoughtDurationMs: Date.now() - responseStartedAt,
        providerTrace: providerTraceFor("chat", answerTimeoutMs),
        createdAt: new Date().toISOString()
      });
      const cost = getCost(actualModel, "chat", result.usage, input.preferences, organization.plan, organization.billingCycle);
      const charge = await chargePersistedAssistantMessage({
        organizationId: organization.id, assistantMessage, cost,
        reservation: input.reservation,
        reason: `Plan Mode response (${actualModel}) - Context Tax`,
        insufficientContent: "Plan Mode finished reading the project, but your usage capacity changed before the plan could be finalized."
      });
      finalBalance = charge.balance;
    });
    await finishAgentRun(assistantMessage!, "completed");
    return { userMessage: input.userMessage, assistantMessage: assistantMessage!, creditBalance: finalBalance, taskPlan };
  }

  if (input.mode === "explain" || isContextQuestion(input.prompt)) {
    emitProgress("generating", "Writing response",
      `${modelDisplayName(actualModel)} is reading your project.`,
      { model: actualModel, thinkingLevel: activeThinkingLevel });

    const answerTimeoutMs = dynamicAnswerTimeoutMs({
      prompt: promptWithContext,
      latestSnapshot,
      answerSnapshot,
      history,
      thinkingLevel: activeThinkingLevel,
      hasStudioSession: Boolean(latestSession)
    });
    let result: Awaited<ReturnType<typeof answerProjectQuestion>>;
    const streamChunk = (text: string) => {
      socketService.notifyChatContent(input.userId, { threadId: input.threadId, content: text, done: false });
    };
    // Buffered streaming: hold back only enough chars to detect <VECTIS_TOOL prefix
    // (13 chars). Fixes stuck-buffer for <think> tokens from reasoning models.
    const TOOL_GUARD_LEN = 13; // length of "<VECTIS_TOOLS"
    let streamBuffer = "";
    let streamBlocked = false;
    const safeStreamChunk = (text: string) => {
      if (streamBlocked) return;
      streamBuffer += text;
      if (streamBuffer.includes("<VECTIS_TOOLS") || streamBuffer.includes("<VECTIS_TOOL")) {
        streamBlocked = true;
        streamBuffer = "";
        return;
      }
      const flushTo = Math.max(0, streamBuffer.length - TOOL_GUARD_LEN);
      if (flushTo > 0) {
        streamChunk(streamBuffer.slice(0, flushTo));
        streamBuffer = streamBuffer.slice(flushTo);
      }
    };
    const flushSafeStream = () => {
      if (!streamBlocked && streamBuffer) {
        streamChunk(streamBuffer);
        streamBuffer = "";
      }
    };
    const stopHeartbeat = startProviderHeartbeat({
      stage: "generating",
      label: "Writing response",
      model: actualModel,
      thinkingLevel: activeThinkingLevel,
      timeoutMs: answerTimeoutMs,
      dynamic: true
    });
    try {
      result = await withTimeout(
        answerWithStudioTools({
          project: input.project, prompt: promptWithContext,
          model: actualModel, snapshot: answerSnapshot,
          history, preferences: input.preferences, plan: organization.plan, providerTimeoutMs: answerTimeoutMs,
          contextSummary: contextSummaryForProvider,
          session: latestSession,
          attachments: providerAttachments,
          contextIndex,
          agentRunId: agentRun.id,
          responseStyle: routineOptimizedAnswer ? "concise" : undefined,
          onChunk: safeStreamChunk,
          onRuntimeEvent,
          thinkingLevel: activeThinkingLevel,
          onToolCall: (toolNames: string) => {
            emitProgress("generating", "Writing response", toolNames, { model: actualModel, thinkingLevel: activeThinkingLevel });
          }
        }),
        answerTimeoutMs + STUDIO_COMMAND_TIMEOUT_MS, providerTimeoutMessage(actualModel, "answer")
      );
      flushSafeStream();
    } catch (error) {
      if (isProviderTimeoutError(error)) {
        return saveNoChargeAssistantResponse(providerTimeoutAssistantText(actualModel, "answer"));
      }
      throw error;
    } finally {
      stopHeartbeat();
    }

    let assistantMessage: AiMessage;
    let finalBalance = 0;
    await input.ctx.orgLocks.run(organization.id, async () => {
      assistantMessage = await store.saveMessage({
        id: await store.createUniqueId("messages", "msg_", 18),
        projectId: input.project.id, threadId: input.threadId,
        role: "assistant", content: result.text,
        modelUsed: actualModel, modelRequested: selectedModel, wasOptimized,
        thoughtDurationMs: Date.now() - responseStartedAt,
        providerTrace: providerTraceFor("chat", answerTimeoutMs),
        createdAt: new Date().toISOString()
      });
      const cost = getCost(actualModel, "chat", result.usage, input.preferences, organization.plan, organization.billingCycle);
      const charge = await chargePersistedAssistantMessage({
        organizationId: organization.id, assistantMessage, cost,
        reservation: input.reservation,
        reason: `AI response (${actualModel})`,
        insufficientContent: "Your usage capacity changed while the response was being generated. The answer was not saved."
      });
      finalBalance = charge.balance;
    });
    await finishAgentRun(assistantMessage!, "completed");
    return { userMessage: input.userMessage, assistantMessage: assistantMessage!, creditBalance: finalBalance };
  }

  // Changeset mode
  emitProgress("generating", "Building your patch",
    undefined,
    { model: actualModel, thinkingLevel: activeThinkingLevel });

  const shouldPlan = shouldRunPlanningPass({
    deterministicTemplateEligible,
    prompt: input.prompt,
    model: actualModel,
    simpleOptimized: input.simpleOptimized
  });
  if (!shouldPlan) {
    emitProgress("generating", "Building your patch",
      undefined,
      { model: actualModel, thinkingLevel: activeThinkingLevel, planning: "skipped" });
  }

  let plan: string | undefined;
  let planningUsage: AiUsageAccumulator | undefined;
  if (shouldPlan) {
    // Planning is a short outline only - never burn full High/Max thinking here.
    const planningThinkingLevel =
      activeThinkingLevel === "none" || activeThinkingLevel === "low"
        ? activeThinkingLevel
        : "low";
    emitProgress("planning", "Planning implementation", undefined, { model: actualModel, thinkingLevel: planningThinkingLevel, planning: "running" });
    try {
      const planResult = await withTimeout(
        answerProjectQuestion({
          project: input.project,
          prompt: `Plan Mode is enabled. Read the synced Roblox Studio snapshot and return a concise implementation plan for: ${input.prompt}. Do not write code. Return only the plan.`,
          model: actualModel, planMode: true, snapshot: latestSnapshot,
          history, preferences: input.preferences, plan: organization.plan, providerTimeoutMs: 22_000,
          contextSummary: contextSummaryForProvider,
          attachments: providerAttachments,
          contextIndex,
          onRuntimeEvent,
          thinkingLevel: planningThinkingLevel
        }),
        22_000, "Planning pass timed out."
      );
      plan = planResult.text;
      planningUsage = planResult.usage;
      emitProgress("planning", "Plan ready", undefined, { model: actualModel, thinkingLevel: activeThinkingLevel, planning: "completed" });
    } catch {
      emitProgress("planning", "Skipped planning", undefined, { model: actualModel, thinkingLevel: activeThinkingLevel, planning: "skipped" });
    }
    emitProgress("generating", "Building your patch",
      undefined,
      { model: actualModel, thinkingLevel: activeThinkingLevel, planning: plan ? "completed" : "skipped" });
  }

  let changeSetTimeoutMs = providerTimeoutLimitMs(actualModel, "changeset", input.preferences, organization.plan);
  let generated: Awaited<ReturnType<typeof generateSafeChangeSet>>;
  const studioTools = createStudioToolRuntime({
    session: latestSession,
    projectId: input.project.id,
    runId: agentRun.id,
    onToolCall: (toolNames) => {
      emitProgress("generating", "Inspecting Studio", toolNames, { model: actualModel, thinkingLevel: activeThinkingLevel });
    }
  });
  const runChangeSetGeneration = (modelId: string, timeoutMs: number) => withTimeout(
    generateSafeChangeSet({
      project: input.project,
      prompt: plan ? `${promptWithContext}\n\nImplementation route prepared by the planning pass:\n${plan}` : promptWithContext,
      model: modelId,
      planMode: false,
      snapshot: latestSnapshot,
      history,
      preferences: input.preferences,
      plan: organization.plan,
      contextSummary: contextSummaryForProvider,
      attachments: providerAttachments,
      contextIndex,
      providerTimeoutMs: timeoutMs,
      maxRepairAttempts: changeSetRepairAttemptsFor(modelId),
      studioTools,
      onRuntimeEvent,
      thinkingLevel: activeThinkingLevel,
      luauGuard: input.luauGuard
    }),
    timeoutMs + 5_000,
    providerTimeoutMessage(modelId, "changeset", timeoutMs)
  );

  const stopGenerationHeartbeat = startProviderHeartbeat({
    stage: "generating",
    label: "Building your patch",
    model: actualModel,
    thinkingLevel: activeThinkingLevel,
    timeoutMs: changeSetTimeoutMs,
    planning: shouldPlan ? (plan ? "completed" : "skipped") : "skipped"
  });
  try {
    generated = await runChangeSetGeneration(actualModel, changeSetTimeoutMs);
  } catch (error) {
    if (isProviderTimeoutError(error)) {
      return saveNoChargeAssistantResponse(providerTimeoutAssistantText(actualModel, "changeset", changeSetTimeoutMs));
    } else {
      throw error;
    }
  } finally {
    stopGenerationHeartbeat();
  }

  emitProgress("validating", "Checking patch",
    "Checking paths, wiring, and Studio compatibility.",
    { model: actualModel, thinkingLevel: activeThinkingLevel, planning: shouldPlan ? (plan ? "completed" : "skipped") : "skipped" });

  if (!generated || generated.files.length === 0) {
    const emptyPatchContent = String((generated as any)?.text || "").trim()
      || [
        "I finished analyzing the project, but no reviewable Studio patch was produced.",
        "",
        "Try again with a slightly more specific request (paths, scripts, or HUD placement), or lower the thinking level if the model stalled."
      ].join("\n");
    let assistantMessage: AiMessage;
    let finalBalance = 0;
    await input.ctx.orgLocks.run(organization.id, async () => {
      assistantMessage = await store.saveMessage({
        id: await store.createUniqueId("messages", "msg_", 18),
        projectId: input.project.id, threadId: input.threadId,
        role: "assistant", content: emptyPatchContent,
        modelUsed: actualModel, modelRequested: selectedModel, wasOptimized,
        thoughtDurationMs: Date.now() - responseStartedAt,
        providerTrace: providerTraceFor("changeset", changeSetTimeoutMs),
        createdAt: new Date().toISOString()
      });
      finalBalance = await store.getCreditBalance(organization.id);
    });
    await finishAgentRun(assistantMessage!, "failed");
    return { userMessage: input.userMessage, assistantMessage: assistantMessage!, creditBalance: finalBalance };
  }

  const reviewReport = config.features.reviewReportEnabled
    ? generateDeterministicReviewReport(
        generated.files,
        generated.safety,
        input.prompt,
        latestSnapshot?.nodes.length ?? 0,
        input.intent
      )
    : undefined;

  const changeSet = await store.saveChangeSet({
    id: await store.createUniqueId("changeSets", "cs_", 18),
    projectId: input.project.id,
    threadId: input.threadId,
    aiMessageId: "",
    title: generated.title,
    summary: generated.summary,
    status: "ready_for_review",
    files: generated.files,
    safety: generated.safety,
    reviewReport,
    requestedByUserId: input.userId,
    activity: buildGenerationActivity({
      snapshotNodes: latestSnapshot?.nodes.length ?? 0,
      scriptCount: latestSnapshot?.nodes.filter(n => n.className.includes("Script")).length ?? 0,
      modelUsed: actualModel,
      thinkingLevel: activeThinkingLevel,
      generationDurationMs: Date.now() - responseStartedAt,
      planningSkipped: !shouldPlan,
      usedPlanner: shouldPlan,
      fileCount: generated.files.length,
      safetyOk: generated.safety.ok,
      blockedPatterns: generated.safety.blockedPatterns
    }),
    baseSnapshotId: latestSnapshot?.id,
    baseSnapshotCreatedAt: latestSnapshot?.createdAt,
    baseSnapshotNodeCount: latestSnapshot?.nodes.length,
    baseSnapshotFingerprint: snapshotFingerprint(latestSnapshot),
    agentRunId: agentRun.id,
    verificationMode: input.verificationMode,
    createdAt: new Date().toISOString()
  });

  let assistantMessage: AiMessage;
  let finalBalance = 0;
  await input.ctx.orgLocks.run(organization.id, async () => {
    const fileCount = changeSet.files.length;
    const creates = changeSet.files.filter((f: any) => f.action === "create").length;
    const updates = changeSet.files.filter((f: any) => f.action === "update").length;
    const deletes = changeSet.files.filter((f: any) => f.action === "delete").length;
    const opSummary = [
      creates > 0 ? `${creates} created` : "",
      updates > 0 ? `${updates} updated` : "",
      deletes > 0 ? `${deletes} deleted` : ""
    ].filter(Boolean).join(", ");
    const patchSummary = generated.summary
      ? `${generated.summary}`
      : `Prepared ${fileCount} Studio operation${fileCount === 1 ? "" : "s"} for review.`;
    const messageContent = opSummary
      ? `${patchSummary}\n\n${opSummary} - review the patch below and click Apply to push it to Studio.`
      : patchSummary;
    assistantMessage = await store.saveMessage({
      id: await store.createUniqueId("messages", "msg_", 18),
      projectId: input.project.id, threadId: input.threadId,
      role: "assistant",
      content: messageContent,
      modelUsed: actualModel, modelRequested: selectedModel, wasOptimized,
      thoughtDurationMs: generated.deterministic ? 0 : Date.now() - responseStartedAt,
      providerTrace: providerTraceFor("changeset", changeSetTimeoutMs),
      createdAt: new Date().toISOString(),
      changeSetId: changeSet.id
    });
    changeSet.aiMessageId = assistantMessage.id;
    await store.saveChangeSet(changeSet);
    const deliveredUsage = mergeAiUsage(planningUsage, generated.usage);
    const cost = deterministicTemplateEligible ? 0 : getCost(actualModel, "changeset", deliveredUsage, input.preferences, organization.plan, organization.billingCycle);
    const charge = await chargePersistedAssistantMessage({
      organizationId: organization.id, assistantMessage, cost,
      reservation: input.reservation,
      reason: `Generated reviewable Roblox change set (${actualModel})`,
      insufficientContent: "Your usage capacity changed while the patch was being generated. The patch was not saved.",
      onInsufficient: async () => {
        assistantMessage.changeSetId = undefined;
        try {
          await store.deleteChangeSet(changeSet.id);
        } catch {
          changeSet.status = "rejected";
          changeSet.files = [];
          changeSet.summary = "Generation finished, but usage capacity changed before the patch could be charged.";
          await store.saveChangeSet(changeSet);
        }
      }
    });
    finalBalance = charge.balance;
  });

  const paidChangeSet = assistantMessage!.changeSetId ? changeSet : undefined;
  await finishAgentRun(assistantMessage!, "awaiting_review", paidChangeSet);
  return { userMessage: input.userMessage, assistantMessage: assistantMessage!, changeSet: paidChangeSet, creditBalance: finalBalance };
}

async function persistTerminalGenerationFailure(input: {
  userId: string;
  threadId: string;
  userMessage?: AiMessage;
  model: string;
}) {
  const runId = input.userMessage?.agentRunId;
  if (!runId || !input.userMessage) return;
  const run = await store.fetchAgentRun(runId);
  if (!run || ["completed", "failed", "cancelled", "awaiting_review"].includes(run.status)) return;

  const at = new Date().toISOString();
  const error = "The generation stopped before Vectis could save a complete response. Your reserved usage was refunded.";
  const assistantMessage = await store.saveMessage({
    id: await store.createUniqueId("messages", "msg_", 18),
    projectId: input.userMessage.projectId,
    threadId: input.threadId,
    clientRequestId: input.userMessage.clientRequestId,
    role: "assistant",
    content: "",
    modelUsed: run.actualModel || input.model,
    modelRequested: run.requestedModel || input.model,
    agentRunId: run.id,
    status: "failed",
    error,
    errorCode: "chat_generation_failed",
    errorTitle: "Generation stopped",
    errorAction: "retry",
    errorActionLabel: "Try again",
    errorCanRetry: true,
    retryPrompt: input.userMessage.content,
    createdAt: at
  });
  run.status = "failed";
  run.assistantMessageId = assistantMessage.id;
  run.updatedAt = at;
  run.completedAt = at;
  run.steps.push({
    index: run.steps.length,
    kind: "model",
    status: "failed",
    title: "Generation stopped",
    completedAt: at
  });
  await store.saveAgentRun(run);
  socketService.notifyAgentRunEvent(input.userId, input.threadId, {
    type: "run_failed",
    runId: run.id,
    at,
    detail: error
  });
}

export function registerChatRoutes(app: express.Express, ctx: RouteContext) {
  const requireOwnedProject = async (req: express.Request, res: express.Response) => {
    const user = await requireUser(req, res);
    if (!user) return undefined;
    const project = await store.fetchProject(String(req.params.projectId));
    const organization = await store.fetchOrganizationForUser(user.id);
    if (!project || project.organizationId !== organization?.id) {
      res.status(404).json({ error: "Project not found" });
      return undefined;
    }
    return { user, project };
  };

  app.get("/projects/:projectId/agent-runs/:runId", async (req, res, next) => {
    try {
      const owned = await requireOwnedProject(req, res);
      if (!owned) return;
      const run = await store.fetchAgentRun(String(req.params.runId));
      if (!run || run.projectId !== owned.project.id || run.userId !== owned.user.id) {
        res.status(404).json({ error: "Agent run not found" });
        return;
      }
      res.json({ run });
    } catch (error) { next(error); }
  });

  app.post("/projects/:projectId/agent-runs/:runId/cancel", async (req, res, next) => {
    try {
      const owned = await requireOwnedProject(req, res);
      if (!owned) return;
      const run = await store.fetchAgentRun(String(req.params.runId));
      if (!run || run.projectId !== owned.project.id || run.userId !== owned.user.id) {
        res.status(404).json({ error: "Agent run not found" });
        return;
      }
      if (!["completed", "failed", "cancelled"].includes(run.status)) {
        const at = new Date().toISOString();
        run.status = "cancelled";
        run.cancelledAt = at;
        run.completedAt = at;
        run.updatedAt = at;
        await store.saveAgentRun(run);
      }
      res.json({ run });
    } catch (error) { next(error); }
  });

  const queuedTextSchema = z.object({ text: z.string().trim().min(1).max(12_000) }).strict();
  const queueRunText = async (req: express.Request, res: express.Response, next: express.NextFunction, field: "queuedSteering" | "queuedSuccessorPrompts") => {
    try {
      const owned = await requireOwnedProject(req, res);
      if (!owned) return;
      const input = queuedTextSchema.parse(req.body);
      const run = await store.fetchAgentRun(String(req.params.runId));
      if (!run || run.projectId !== owned.project.id || run.userId !== owned.user.id) {
        res.status(404).json({ error: "Agent run not found" });
        return;
      }
      run[field] = [...(run[field] ?? []), input.text].slice(-10);
      run.updatedAt = new Date().toISOString();
      await store.saveAgentRun(run);
      res.status(202).json({ run, queued: true });
    } catch (error) { next(error); }
  };
  app.post("/projects/:projectId/agent-runs/:runId/steer", (req, res, next) => void queueRunText(req, res, next, "queuedSteering"));
  app.post("/projects/:projectId/agent-runs/:runId/queue", (req, res, next) => void queueRunText(req, res, next, "queuedSuccessorPrompts"));

  app.get("/projects/:projectId/agent-runs/:runId/artifacts/:artifactId", async (req, res, next) => {
    try {
      const owned = await requireOwnedProject(req, res);
      if (!owned) return;
      const run = await store.fetchAgentRun(String(req.params.runId));
      const artifact = await store.fetchAgentArtifact(String(req.params.artifactId));
      if (!run || !artifact || run.userId !== owned.user.id || run.projectId !== owned.project.id || artifact.runId !== run.id) {
        res.status(404).json({ error: "Agent artifact not found" });
        return;
      }
      const cursor = Math.max(0, Number.parseInt(String(req.query.cursor ?? "0"), 10) || 0);
      const limit = Math.min(20_000, Math.max(1_000, Number.parseInt(String(req.query.limit ?? "12000"), 10) || 12_000));
      const content = artifact.content.slice(cursor, cursor + limit);
      const nextCursor = cursor + content.length < artifact.content.length ? String(cursor + content.length) : undefined;
      res.json({ artifactId: artifact.id, mimeType: artifact.mimeType, summary: artifact.summary, content, nextCursor });
    } catch (error) { next(error); }
  });

  app.get("/projects/:projectId/design-profile", async (req, res, next) => {
    try {
      const owned = await requireOwnedProject(req, res);
      if (!owned) return;
      res.json({ profile: await store.fetchDesignProfile(owned.project.id) ?? null });
    } catch (error) { next(error); }
  });

  const designProfileSchema = z.object({
    referenceAttachmentIds: z.array(z.string().min(1)).max(12).default([]),
    palette: z.array(z.string().min(1).max(64)).max(16).default([]),
    typography: z.array(z.string().min(1).max(80)).max(12).default([]),
    borders: z.string().max(500).optional(), corners: z.string().max(500).optional(), spacing: z.string().max(500).optional(),
    texture: z.string().max(500).optional(), composition: z.string().max(1_000).optional(), iconDirection: z.string().max(500).optional(),
    forbiddenPatterns: z.array(z.string().min(1).max(180)).max(20).default([])
  }).strict();
  app.put("/projects/:projectId/design-profile", async (req, res, next) => {
    try {
      const owned = await requireOwnedProject(req, res);
      if (!owned) return;
      const input = designProfileSchema.parse(req.body);
      const attachments = input.referenceAttachmentIds.length
        ? await requireOwnedAttachments({ userId: owned.user.id, organizationId: owned.project.organizationId, projectId: owned.project.id, attachmentIds: input.referenceAttachmentIds, res })
        : [];
      if (!attachments) return;
      const current = await store.fetchDesignProfile(owned.project.id);
      const at = new Date().toISOString();
      const profile: DesignProfile = { id: current?.id ?? `design_${nanoid()}`, projectId: owned.project.id, ...input, extractedAt: current?.extractedAt ?? at, updatedAt: at };
      await store.saveDesignProfile(profile);
      res.json({ profile });
    } catch (error) { next(error); }
  });
  async function requireOwnedAttachments(input: {
    userId: string;
    organizationId: string;
    projectId: string;
    attachmentIds: string[];
    res: express.Response;
  }) {
    const uniqueIds = [...new Set(input.attachmentIds)];
    const attachments = [];
    for (const id of uniqueIds) {
      const attachment = await store.fetchAttachment(id);
      if (!attachment || attachment.organizationId !== input.organizationId || attachment.projectId !== input.projectId || attachment.userId !== input.userId) {
        input.res.status(404).json({ error: "Attachment not found" });
        return undefined;
      }
      attachments.push(attachment);
    }
    return attachments;
  }

  app.post("/projects/:projectId/chat", ctx.aiLimiter, async (req, res, next) => {
    try {
      const user = await requireUser(req, res);
      if (!user) return;

      const input = chatSchema.parse(req.body);
      const projectId = String(req.params.projectId);
      const project = await store.fetchProject(projectId);
      const org = await store.fetchOrganizationForUser(user.id);

      if (!project || project.organizationId !== org?.id) {
        res.status(404).json({ error: "Project not found" });
        return;
      }

      const thread = await store.fetchThread(input.threadId);
      if (!thread || thread.projectId !== project.id || thread.userId !== user.id) {
        res.status(404).json({ error: "Thread not found" });
        return;
      }

      const attachments = input.attachmentIds.length
        ? await requireOwnedAttachments({ userId: user.id, organizationId: org.id, projectId: project.id, attachmentIds: input.attachmentIds, res })
        : [];
      if (!attachments) return;

      const attachmentContext = attachmentPromptContext(attachments);
      let userMessage: AiMessage | undefined;
      let promptForAi = "";
      let mode: "explain" | "changeset" = "explain";
      let luauGuardEnabled = false;
      let verificationMode: "off" | "standard" | "deep" = "off";
      let simpleOptimized = false;
      let optimizationMode: "disabled" | "balanced" | "cost_saver" = "disabled";
      let selectedModel = "";
      let shouldProceed = false;
      let reservation: CreditReservation | undefined;

      await ctx.orgLocks.run(org.id, async () => {
        const priorMessages = await store.fetchMessagesForThread(input.threadId);
        const existingRequest = await existingChatRequestResponse({
          clientRequestId: input.clientRequestId,
          messages: priorMessages,
          organizationId: org.id
        });
        if (existingRequest?.state === "completed") {
          res.json(existingRequest.response);
          return;
        }
        if (existingRequest?.state === "in_progress") {
          res.status(409).json({
            error: "This message is already being generated. Vectis will keep recovering the original response.",
            code: "chat_request_in_progress",
            title: "Response still generating",
            action: "retry",
            actionLabel: "Check again"
          });
          return;
        }
        const latestSnapshot = await store.fetchLatestSnapshot(project.id);

        if (input.intent === "console_fix") {
          mode = "changeset";
          const sessions = await store.fetchSessionsForProject(project.id);
          const latestSession = sessions
            .filter((s) => s.status === "connected" || s.status === "paired")
            .sort((a, b) => (b.lastSeenAt ?? b.pairedAt ?? b.createdAt).localeCompare(a.lastSeenAt ?? a.pairedAt ?? a.createdAt))[0];
          const logs = latestSession ? await store.fetchLogsForSession(latestSession.id) : [];
          const consoleFixPrompt = buildConsoleFixerPrompt(logs, latestSnapshot);
          promptForAi = consoleFixPrompt + (input.prompt ? `\n\nAdditional instructions: ${input.prompt}` : "");
        } else {
          mode = input.planMode ? "explain" : effectiveChatModeWithHistory(input.mode, input.prompt, priorMessages);
          const resolvedPrompt = resolvePromptWithHistory(input.prompt, priorMessages);
          promptForAi = attachmentContext ? `${resolvedPrompt}\n${attachmentContext}` : resolvedPrompt;
        }

        if (input.intent !== "console_fix") {
          const deterministicContent = await deterministicAssistantContent(project.id, input.prompt, priorMessages);
          if (deterministicContent) {
            const userMsg = await store.saveMessage({
              id: await store.createUniqueId("messages", "msg_", 18),
              projectId: project.id, threadId: input.threadId,
              clientRequestId: input.clientRequestId,
              role: "user", content: input.prompt,
              attachmentIds: input.attachmentIds,
              createdAt: new Date().toISOString()
            });
            for (const attachment of attachments) {
              attachment.threadId = input.threadId;
              attachment.messageId = userMsg.id;
              await store.saveAttachment(attachment);
            }
            await markThreadActive(thread, input.prompt);
            const assistantMessage = await store.saveMessage({
              id: await store.createUniqueId("messages", "msg_", 18),
              projectId: project.id, threadId: input.threadId,
              clientRequestId: input.clientRequestId,
              role: "assistant", content: deterministicContent,
              modelUsed: "vectis-router", thoughtDurationMs: 0,
              createdAt: new Date().toISOString()
            });
            res.json(publicChatResponse({ userMessage: userMsg, assistantMessage, creditBalance: await store.getCreditBalance(org.id) }));
            return;
          }
        }

        if (input.modelMode && config.features.simplifiedModelModesEnabled) {
          const resolvedMode = resolveModelMode(input.modelMode as any);
          selectedModel = resolvedMode.model;
          verificationMode = resolvedMode.verificationMode;
          optimizationMode = resolvedMode.optimizationMode || "disabled";
        } else {
          selectedModel = input.model || defaultAiModel();
          verificationMode = input.verificationMode && input.verificationMode !== "off" && planAllowsLuauGuard(org.plan)
            ? input.verificationMode
            : "off";
          optimizationMode = resolveOptimizationMode(input.optimizationMode, input.usageOptimizer, user.preferences, org?.plan);
        }

        const selectedModelConfig = modelConfigFor(selectedModel);
        if (!selectedModelConfig || !modelIsAvailable(selectedModel)) {
          res.status(409).json({ error: `${selectedModelConfig?.label ?? selectedModel} is not available for routing yet.` });
          return;
        }
        if (input.planMode && !planAllowsPlanMode(org.plan)) {
          res.status(403).json({ error: "Plan Mode requires Pro or Studio." });
          return;
        }
        if (input.luauGuard && !planAllowsLuauGuard(org.plan)) {
          res.status(403).json({ error: "Luau Guard requires Studio." });
          return;
        }
        if (verificationMode !== "off" && !planAllowsLuauGuard(org.plan)) {
          res.status(403).json({ error: "Code Verification requires Studio." });
          return;
        }
        if (isPremiumModel(selectedModel) && !planAllowsPremiumModels(org.plan)) {
          res.status(403).json({ error: "Premium models require Pro or Studio." });
          return;
        }

        const deterministicTemplateEligible = mode === "changeset" && shouldUseNoCostDeterministicTemplate({ prompt: promptForAi, snapshot: latestSnapshot, history: priorMessages });
        
        if (!(input.modelMode && config.features.simplifiedModelModesEnabled)) {
          optimizationMode = resolveOptimizationMode(input.optimizationMode, input.usageOptimizer, user.preferences, org?.plan);
        }

        if (modelIsOptimizable(selectedModel)) {
          if (optimizationMode === "balanced" || optimizationMode === "cost_saver") {
            const resolvedPrompt = resolvePromptWithHistory(input.prompt, priorMessages);
            simpleOptimized = await isTaskSimple(resolvedPrompt, project);
          }
        }

        const optimizedModel = simpleOptimized ? optimizedModelFor(mode, optimizationMode) : undefined;
        const optimizedEstimateModel = optimizedModel && modelIsAvailable(optimizedModel) ? optimizedModel : selectedModel;
        luauGuardEnabled = mode === "changeset" && Boolean(input.luauGuard) && planAllowsLuauGuard(org.plan);

        if (!(input.modelMode && config.features.simplifiedModelModesEnabled)) {
          verificationMode = input.verificationMode && input.verificationMode !== "off" && planAllowsLuauGuard(org.plan)
            ? input.verificationMode
            : "off";
        }
        const cost = getCost(optimizedEstimateModel, mode === "explain" ? "chat" : "changeset", undefined, user.preferences, org.plan, org.billingCycle);

        const creditBalance = await store.getCreditBalance(org.id);
        if (!deterministicTemplateEligible && creditBalance < cost) {
          const usage = await store.getUsageStats(org.id);
          res.status(402).json(usageLimitPayload({
            plan: org.plan,
            creditBalance,
            requiredCredits: cost,
            usage
          }));
          return;
        }

        if (!deterministicTemplateEligible && cost > 0) {
          const debit = await store.tryDeductCredits(
            org.id,
            cost,
            mode === "explain"
              ? `Reserved AI response (${optimizedEstimateModel})`
              : `Reserved reviewable Roblox change set (${optimizedEstimateModel})`
          );
          if (!debit.ok) {
            const usage = await store.getUsageStats(org.id);
            res.status(402).json(usageLimitPayload({
              plan: org.plan,
              creditBalance: debit.balance,
              requiredCredits: cost,
              usage
            }));
            return;
          }
          reservation = { amount: cost, settled: false };
        }

        userMessage = await store.saveMessage({
          id: await store.createUniqueId("messages", "msg_", 18),
          projectId: project.id, threadId: input.threadId,
          clientRequestId: input.clientRequestId,
          role: "user", content: input.prompt,
          attachmentIds: input.attachmentIds,
          createdAt: new Date().toISOString()
        });
        for (const attachment of attachments) {
          attachment.threadId = input.threadId;
          attachment.messageId = userMessage.id;
          await store.saveAttachment(attachment);
        }
        await markThreadActive(thread, input.prompt);
        await ctx.recordEvidence(req, {
          userId: user.id, organizationId: org.id, projectId: project.id,
          threadId: input.threadId, type: "usage", action: "chat_request", status: "accepted",
          metadata: { mode, selectedModel, promptHash: promptDigest(input.prompt), promptLength: input.prompt.length }
        });
        shouldProceed = true;
      });

      if (!shouldProceed) return;

      // Keep-alive: prevent Cloudflare/proxy 524 timeout by streaming response immediately
      res.setHeader("Content-Type", "application/json");
      res.setHeader("X-Accel-Buffering", "no");
      res.setHeader("Cache-Control", "no-cache");
      res.setHeader("X-Content-Type-Options", "nosniff");
      res.flushHeaders();
      res.write(" ");
      const keepAlive = setInterval(() => {
        if (!res.writableEnded) { res.write(" "); }
      }, 15_000);

      let aiResponse: Awaited<ReturnType<typeof createAssistantResponse>>;
      try {
        aiResponse = await createAssistantResponse({
          userId: user.id, project, organizationId: org.id,
          threadId: input.threadId, userMessage: userMessage!,
          prompt: promptForAi, mode, model: input.model,
          planMode: input.planMode, usageOptimizer: input.usageOptimizer,
          luauGuard: luauGuardEnabled, verificationMode, simpleOptimized, optimizationMode,
          preferences: user.preferences, reservation, intent: input.intent, ctx, attachments
        });
      } catch (error) {
        clearInterval(keepAlive);
        if (reservation && !reservation.settled && reservation.amount > 0) {
          await store.addCredits(org.id, reservation.amount, "Refund unused AI reservation (provider failure)");
          reservation.settled = true;
        }
        await persistTerminalGenerationFailure({
          userId: user.id,
          threadId: input.threadId,
          userMessage,
          model: selectedModel || input.model || defaultAiModel()
        }).catch((persistError) => {
          log.warn("Could not persist terminal chat failure", { runId: userMessage?.agentRunId, error: String(persistError) });
        });
        throw error;
      }

      clearInterval(keepAlive);

      await ctx.recordEvidence(req, {
        userId: user.id, organizationId: org.id, projectId: project.id,
        threadId: input.threadId, type: "usage", action: "chat_response", status: "ok",
        amountCredits: aiResponse.assistantMessage.usageCostCredits,
        metadata: { mode, selectedModel, modelUsed: aiResponse.assistantMessage.modelUsed }
      });

      res.end(JSON.stringify(publicChatResponse(aiResponse)));
    } catch (error) {
      next(error);
    }
  });

  app.patch("/projects/:projectId/messages/:messageId", ctx.aiLimiter, async (req, res, next) => {
    try {
      const user = await requireUser(req, res);
      if (!user) return;

      const input = editMessageSchema.parse(req.body);
      const projectId = String(req.params.projectId);
      const messageId = String(req.params.messageId);
      const project = await store.fetchProject(projectId);
      const org = await store.fetchOrganizationForUser(user.id);

      if (!project || project.organizationId !== org?.id) {
        res.status(404).json({ error: "Project not found" });
        return;
      }

      const thread = await store.fetchThread(input.threadId);
      if (!thread || thread.projectId !== project.id || thread.userId !== user.id) {
        res.status(404).json({ error: "Thread not found" });
        return;
      }

      const attachments = input.attachmentIds.length
        ? await requireOwnedAttachments({ userId: user.id, organizationId: org.id, projectId: project.id, attachmentIds: input.attachmentIds, res })
        : [];
      if (!attachments) return;

      const attachmentContext = attachmentPromptContext(attachments);
      let userMessage: AiMessage | undefined;
      let promptForAi = "";
      let mode: "explain" | "changeset" = "explain";
      let luauGuardEnabled = false;
      let verificationMode: "off" | "standard" | "deep" = "off";
      let simpleOptimized = false;
      let optimizationMode: "disabled" | "balanced" | "cost_saver" = "disabled";
      let selectedModel = "";
      let shouldProceed = false;
      let reservation: CreditReservation | undefined;

      await ctx.orgLocks.run(org.id, async () => {
        const messages = await store.fetchMessagesForThread(input.threadId);
        const existingRequest = await existingChatRequestResponse({
          clientRequestId: input.clientRequestId,
          messages,
          organizationId: org.id
        });
        if (existingRequest?.state === "completed") {
          res.json(existingRequest.response);
          return;
        }
        if (existingRequest?.state === "in_progress") {
          res.status(409).json({
            error: "This edit is already being generated. Vectis will keep recovering the original response.",
            code: "chat_request_in_progress",
            title: "Response still generating",
            action: "retry",
            actionLabel: "Check again"
          });
          return;
        }
        const msgIndex = messages.findIndex(m => m.id === messageId);
        if (msgIndex === -1) {
          res.status(404).json({ error: "Message not found" });
          return;
        }
        if (messages[msgIndex].role !== "user") {
          res.status(400).json({ error: "Only user messages can be edited." });
          return;
        }

        const priorMessages = messages.slice(0, msgIndex);
        const latestSnapshot = await store.fetchLatestSnapshot(project.id);

        if (input.intent === "console_fix") {
          mode = "changeset";
          const sessions = await store.fetchSessionsForProject(project.id);
          const latestSession = sessions
            .filter((s) => s.status === "connected" || s.status === "paired")
            .sort((a, b) => (b.lastSeenAt ?? b.pairedAt ?? b.createdAt).localeCompare(a.lastSeenAt ?? a.pairedAt ?? a.createdAt))[0];
          const logs = latestSession ? await store.fetchLogsForSession(latestSession.id) : [];
          const consoleFixPrompt = buildConsoleFixerPrompt(logs, latestSnapshot);
          promptForAi = consoleFixPrompt + (input.prompt ? `\n\nAdditional instructions: ${input.prompt}` : "");
        } else {
          mode = input.planMode ? "explain" : effectiveChatModeWithHistory(input.mode, input.prompt, priorMessages);
          const resolvedPrompt = resolvePromptWithHistory(input.prompt, priorMessages);
          promptForAi = attachmentContext ? `${resolvedPrompt}\n${attachmentContext}` : resolvedPrompt;
        }

        const toDelete = messages.slice(msgIndex + 1);
        const deletedChangeSetIds = new Set(toDelete.map(m => m.changeSetId).filter(Boolean) as string[]);
        const staleChangeSets = (await store.fetchChangeSetsForProject(project.id)).filter(changeSet =>
          changeSet.threadId === input.threadId &&
          (deletedChangeSetIds.has(changeSet.id) || toDelete.some(message => message.id === changeSet.aiMessageId))
        );

        const applyEditMutation = async () => {
          for (const m of toDelete) { await store.deleteMessage(m.id); }
          for (const changeSet of staleChangeSets) { await store.deleteChangeSet(changeSet.id); }
          const userMsg = messages[msgIndex];
          userMsg.content = input.prompt;
          userMsg.attachmentIds = input.attachmentIds;
          userMsg.clientRequestId = input.clientRequestId;
          await store.saveMessage(userMsg);
          for (const attachment of attachments) {
            attachment.threadId = input.threadId;
            attachment.messageId = userMsg.id;
            await store.saveAttachment(attachment);
          }
          await markThreadActive(thread, input.prompt);
          return userMsg;
        };

        if (input.intent !== "console_fix") {
          const deterministicContent = await deterministicAssistantContent(project.id, input.prompt, priorMessages);
          if (deterministicContent) {
            const userMsg = await applyEditMutation();
            const assistantMessage = await store.saveMessage({
              id: await store.createUniqueId("messages", "msg_", 18),
              projectId: project.id, threadId: input.threadId,
              clientRequestId: input.clientRequestId,
              role: "assistant", content: deterministicContent,
              modelUsed: "vectis-router", thoughtDurationMs: 0,
              createdAt: new Date().toISOString()
            });
            res.json(publicChatResponse({ userMessage: userMsg, assistantMessage, creditBalance: await store.getCreditBalance(org.id) }));
            return;
          }
        }

        if (input.modelMode && config.features.simplifiedModelModesEnabled) {
          const resolvedMode = resolveModelMode(input.modelMode as any);
          selectedModel = resolvedMode.model;
          verificationMode = resolvedMode.verificationMode;
          optimizationMode = resolvedMode.optimizationMode || "disabled";
        } else {
          selectedModel = input.model || defaultAiModel();
          verificationMode = input.verificationMode && input.verificationMode !== "off" && planAllowsLuauGuard(org.plan)
            ? input.verificationMode
            : "off";
          optimizationMode = resolveOptimizationMode(input.optimizationMode, input.usageOptimizer, user.preferences, org?.plan);
        }

        const selectedModelConfig = modelConfigFor(selectedModel);
        if (!selectedModelConfig || !modelIsAvailable(selectedModel)) {
          res.status(409).json({ error: `${selectedModelConfig?.label ?? selectedModel} is not available for routing yet.` });
          return;
        }
        if (input.planMode && !planAllowsPlanMode(org.plan)) {
          res.status(403).json({ error: "Plan Mode requires Pro or Studio." });
          return;
        }
        if (input.luauGuard && !planAllowsLuauGuard(org.plan)) {
          res.status(403).json({ error: "Luau Guard requires Studio." });
          return;
        }
        if (verificationMode !== "off" && !planAllowsLuauGuard(org.plan)) {
          res.status(403).json({ error: "Code Verification requires Studio." });
          return;
        }
        if (isPremiumModel(selectedModel) && !planAllowsPremiumModels(org.plan)) {
          res.status(403).json({ error: "Premium models require Pro or Studio." });
          return;
        }

        const deterministicTemplateEligible = mode === "changeset" && shouldUseNoCostDeterministicTemplate({ prompt: promptForAi, snapshot: latestSnapshot, history: priorMessages });
        
        if (!(input.modelMode && config.features.simplifiedModelModesEnabled)) {
          optimizationMode = resolveOptimizationMode(input.optimizationMode, input.usageOptimizer, user.preferences, org?.plan);
          verificationMode = input.verificationMode && input.verificationMode !== "off" && planAllowsLuauGuard(org.plan)
            ? input.verificationMode
            : "off";
        }

        if (modelIsOptimizable(selectedModel)) {
          if (optimizationMode === "balanced" || optimizationMode === "cost_saver") {
            const resolvedPrompt = resolvePromptWithHistory(input.prompt, priorMessages);
            simpleOptimized = await isTaskSimple(resolvedPrompt, project);
          }
        }

        const optimizedModel = simpleOptimized ? optimizedModelFor(mode, optimizationMode) : undefined;
        const optimizedEstimateModel = optimizedModel && modelIsAvailable(optimizedModel) ? optimizedModel : selectedModel;
        luauGuardEnabled = mode === "changeset" && Boolean(input.luauGuard) && planAllowsLuauGuard(org.plan);
        const cost = getCost(optimizedEstimateModel, mode === "explain" ? "chat" : "changeset", undefined, user.preferences, org.plan, org.billingCycle);
        const creditBalance = await store.getCreditBalance(org.id);
        if (!deterministicTemplateEligible && creditBalance < cost) {
          const usage = await store.getUsageStats(org.id);
          res.status(402).json(usageLimitPayload({
            plan: org.plan,
            creditBalance,
            requiredCredits: cost,
            usage
          }));
          return;
        }

        if (!deterministicTemplateEligible && cost > 0) {
          const debit = await store.tryDeductCredits(
            org.id,
            cost,
            mode === "explain"
              ? `Reserved edited AI response (${optimizedEstimateModel})`
              : `Reserved edited Roblox change set (${optimizedEstimateModel})`
          );
          if (!debit.ok) {
            const usage = await store.getUsageStats(org.id);
            res.status(402).json(usageLimitPayload({
              plan: org.plan,
              creditBalance: debit.balance,
              requiredCredits: cost,
              usage
            }));
            return;
          }
          reservation = { amount: cost, settled: false };
        }

        userMessage = await applyEditMutation();
        await ctx.recordEvidence(req, {
          userId: user.id, organizationId: org.id, projectId: project.id,
          threadId: input.threadId, type: "usage", action: "edit_message", status: "accepted",
          metadata: { mode, selectedModel, promptHash: promptDigest(input.prompt), promptLength: input.prompt.length }
        });
        shouldProceed = true;
      });

      if (!shouldProceed) return;

      // Keep-alive: prevent Cloudflare/proxy 524 timeout
      res.setHeader("Content-Type", "application/json");
      res.setHeader("X-Accel-Buffering", "no");
      res.setHeader("Cache-Control", "no-cache");
      res.setHeader("X-Content-Type-Options", "nosniff");
      res.flushHeaders();
      res.write(" ");
      const keepAlive = setInterval(() => {
        if (!res.writableEnded) { res.write(" "); }
      }, 15_000);

      let aiResponse: Awaited<ReturnType<typeof createAssistantResponse>>;
      try {
        aiResponse = await createAssistantResponse({
          userId: user.id, project, organizationId: org.id,
          threadId: input.threadId, userMessage: userMessage!,
          prompt: promptForAi, mode, model: input.model,
          planMode: input.planMode, usageOptimizer: input.usageOptimizer,
          luauGuard: luauGuardEnabled, verificationMode, simpleOptimized, optimizationMode,
          preferences: user.preferences, reservation, intent: input.intent, ctx, attachments
        });
      } catch (error) {
        clearInterval(keepAlive);
        if (reservation && !reservation.settled && reservation.amount > 0) {
          await store.addCredits(org.id, reservation.amount, "Refund unused AI reservation (provider failure)");
          reservation.settled = true;
        }
        await persistTerminalGenerationFailure({
          userId: user.id,
          threadId: input.threadId,
          userMessage,
          model: selectedModel || input.model || defaultAiModel()
        }).catch((persistError) => {
          log.warn("Could not persist terminal edited-chat failure", { runId: userMessage?.agentRunId, error: String(persistError) });
        });
        throw error;
      }

      clearInterval(keepAlive);

      await ctx.recordEvidence(req, {
        userId: user.id, organizationId: org.id, projectId: project.id,
        threadId: input.threadId, type: "usage", action: "edit_response", status: "ok",
        amountCredits: aiResponse.assistantMessage.usageCostCredits,
        metadata: { mode, selectedModel, modelUsed: aiResponse.assistantMessage.modelUsed }
      });

      res.end(JSON.stringify(publicChatResponse(aiResponse)));
    } catch (error) {
      next(error);
    }
  });
}
