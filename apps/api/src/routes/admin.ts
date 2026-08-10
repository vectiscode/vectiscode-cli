import type express from "express";
import {
  adminCreditsSchema,
  adminUsageAdjustmentSchema,
  adminStatusSchema,
  adminPlanSchema,
  clientErrorSchema,
  runEvaluationSchema,
  emailSubscribeSchema
} from "../schemas.js";
import { createLogger } from "../services/logger.js";
import {
  config,
  CREDIT_VALUE_USD,
  MODEL_CREDIT_MARGIN_MULTIPLIER,
  calculateUsageCostCredits,
  getThinkingMultiplier,
  getThinkingLevel,
  modelConfigFor,
  modelFixedCost,
  resolveAiModel,
  runtimeAiModels
} from "../services/config.js";
import { answerProjectQuestion, generateSafeChangeSet, type AiProviderResult } from "../services/aiProvider.js";
import { EVALUATION_SCENARIOS, validateLuauSyntax, runJudgeScoring } from "../services/evaluator.js";
import { MODEL_HEALTH_CHAT_PROMPT, assessModelHealthText, assessModelLatency, modelLatencyBudgetMs } from "../services/modelHealth.js";
import { planCreditEconomics } from "../services/pricing.js";
import type { AiUsageAccumulator } from "../services/usageAccounting.js";
import type { AdminProductInsights, AiMessage, ChangeFile, ChangeSet, CreditLedger, CustomerEvidenceEvent, ModelEvaluationLeaderboardEntry, ModelEvaluationRun, Organization, Project, StudioLog, StudioObservation, StudioSession, StudioTaskRun, UserPreferences } from "../types.js";
import { normalizePlanName, planFor } from "../services/plans.js";
import { getAdminPaymentOverview } from "../services/billing.js";
import { store } from "../services/store.js";
import type { RouteContext } from "../routeContext.js";

function isAdminUser(user: { email?: string }) {
  return Boolean(user.email && config.adminEmails.includes(user.email.toLowerCase().trim()));
}

function csvCell(value: unknown) {
  const text = typeof value === "string" ? value : value == null ? "" : JSON.stringify(value);
  return `"${text.replace(/"/g, '""')}"`;
}

function getCost(model: string | undefined, mode: "chat" | "changeset", usage?: AiUsageAccumulator, preferences?: UserPreferences) {
  const activeModel = resolveAiModel(model || config.defaultAiModel);

  if (usage && usage.inputTokens + usage.outputTokens > 0) {
    const economics = planCreditEconomics("studio", "monthly");
    return calculateUsageCostCredits(
      activeModel,
      Math.max(0, usage.inputTokens),
      Math.max(0, usage.outputTokens),
      economics.creditValueUsd,
      economics.targetMargin,
      Math.max(0, usage.cacheInputTokens ?? 0)
    );
  }

  const baseCost = modelFixedCost(activeModel, mode);
  const multiplier = getThinkingMultiplier(activeModel, mode, preferences);
  return Math.ceil(baseCost * multiplier);
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(message)), timeoutMs);
  });
  return Promise.race([promise, timeout]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}

function estimateProviderCostUsd(credits: number) {
  return Number(((credits * CREDIT_VALUE_USD) / MODEL_CREDIT_MARGIN_MULTIPLIER).toFixed(4));
}

function getJudgeCost(preferences?: UserPreferences) {
  return getCost("gemini-3.5-flash-google", "chat", undefined, {
    ...(preferences ?? {}),
    thinkingGemini35Flash: "high"
  });
}

function estimateEvaluationModelCost(modelId: string, judgeEnabled: boolean, preferences?: UserPreferences) {
  const generationCostCredits = getCost(modelId, "changeset", undefined, preferences);
  const judgeCostCredits = judgeEnabled ? getJudgeCost(preferences) * 2 : 0;
  const totalCostCredits = generationCostCredits + judgeCostCredits;

  return {
    generationCostCredits,
    judgeCostCredits,
    totalCostCredits,
    estimatedProviderCostUsd: estimateProviderCostUsd(totalCostCredits)
  };
}

const EVALUATION_OUTPUT_SOURCE_LIMIT = 20_000;

// 60-second in-memory TTL cache for the insights endpoint.
// The insights query fans out across 16 Supabase calls fetching up to 16k documents;
// caching it reduces DB load by ~98% for polling admin dashboards.
let insightsCache: { data: AdminProductInsights; expiresAt: number } | undefined;
const INSIGHTS_CACHE_TTL_MS = 60_000;

function sanitizeEvaluationGeneratedFiles(files: ChangeFile[]) {
  let truncated = false;
  const sanitized = files.map((file) => {
    if (!file.source || file.source.length <= EVALUATION_OUTPUT_SOURCE_LIMIT) return file;
    truncated = true;
    return {
      ...file,
      source: `${file.source.slice(0, EVALUATION_OUTPUT_SOURCE_LIMIT)}\n-- Output truncated for evaluation storage.`
    };
  });
  return { files: sanitized, truncated };
}

function fileCorpus(files: AiProviderResult["files"]) {
  return files.map(file => [
    file.instancePath,
    file.className,
    file.source,
    JSON.stringify(file.properties ?? {})
  ].filter(Boolean).join("\n")).join("\n").toLowerCase();
}

function hasFile(files: AiProviderResult["files"], predicate: (file: AiProviderResult["files"][number]) => boolean) {
  return files.some(predicate);
}

function buildRequirementChecks(promptText: string, files: AiProviderResult["files"]) {
  const prompt = promptText.toLowerCase();
  const corpus = fileCorpus(files);
  const checks: Array<{ label: string; ok: boolean; detail?: string }> = [];
  const add = (label: string, ok: boolean, detail?: string) => checks.push({ label, ok, detail });

  add(
    "Executable Luau scripts",
    hasFile(files, file => ["Script", "LocalScript", "ModuleScript"].includes(file.className) && Boolean(file.source?.trim())),
    "At least one Script, LocalScript, or ModuleScript with source is required."
  );
  add(
    "Roblox service paths",
    files.every(file => /^(ReplicatedStorage|ServerScriptService|ServerStorage|StarterPlayer|StarterGui|StarterPack|Workspace)\b/.test(file.instancePath)),
    "Every generated object should live under a valid Roblox service."
  );

  if (prompt.includes("goldpart") || prompt.includes("+10 gold")) {
    add("GoldPart wiring", corpus.includes("goldpart"), "Expected a GoldPart reference or Workspace/GoldPart object.");
    add("Gold leaderstats", corpus.includes("leaderstats") && /\bgold\b/.test(corpus), "Expected leaderstats with a Gold value.");
    add("Gold reward amount", /\+?\s*10\b/.test(corpus), "Expected a +10 Gold reward.");
    add("Per-player cooldown", /(cooldown|debounce)/.test(corpus) && /(userid|player)/.test(corpus) && /\b5\b/.test(corpus), "Expected a 5 second cooldown keyed per player.");
    add("Persistence", /(datastoreservice|getasync|setasync|updateasync)/.test(corpus), "The prompt asks to persist Gold, so DataStoreService or equivalent persistence is expected.");
  }

  if (prompt.includes("shift") && prompt.includes("walkspeed")) {
    add("Client sprint script", hasFile(files, file => file.className === "LocalScript" && /StarterPlayerScripts/i.test(file.instancePath)), "Expected a LocalScript under StarterPlayerScripts.");
    add("Shift input", /(leftshift|rightshift|keycode\.shift|keyboard\.shift)/.test(corpus), "Expected sprint input bound to Shift.");
    add("Sprint speed 24", corpus.includes("walkspeed") && /\b24\b/.test(corpus), "Expected WalkSpeed 24 while sprinting.");
    add("Server verification script", hasFile(files, file => file.className === "Script" && /ServerScriptService/i.test(file.instancePath)), "Expected a server Script under ServerScriptService.");
    add("Actual speed monitoring", /(heartbeat|stepped|position|assemblylinearvelocity|magnitude|studs)/.test(corpus), "Expected server-side movement or velocity monitoring, not only trusting client WalkSpeed.");
    add("Flag or warn", /(warn\(|flag|strike|violation|kick)/.test(corpus), "Expected warning or flag behavior when speed hacking is detected.");
  }

  if (prompt.includes("shopgui") || prompt.includes("speedpotion") || prompt.includes("shoppurchase")) {
    add("ShopGui under StarterGui", corpus.includes("startergui") && corpus.includes("shopgui"), "Expected a ScreenGui named ShopGui under StarterGui.");
    add("Shop panel frame", corpus.includes("frame") && /(shop panel|shoppanel|panel)/.test(corpus), "Expected a shop panel Frame.");
    add("Open and close control", /(open|close|toggle)/.test(corpus) && corpus.includes("textbutton"), "Expected a TextButton to open or close the shop.");
    add("SpeedPotion purchase button", /speed\s*potion/.test(corpus) && corpus.includes("textbutton"), "Expected a purchase TextButton for SpeedPotion.");
    add("50 Gold price", /\b50\b/.test(corpus) && /\bgold\b/.test(corpus), "Expected SpeedPotion to cost 50 Gold.");
    add("RemoteEvent ShopPurchase", corpus.includes("replicatedstorage") && corpus.includes("remoteevent") && corpus.includes("shoppurchase"), "Expected a ReplicatedStorage RemoteEvent named ShopPurchase.");
    add("Server-side purchase handling", /onserverevent/.test(corpus) && /(leaderstats|gold)/.test(corpus), "Expected a server Script to validate purchase and deduct Gold from leaderstats.");
  }

  return checks;
}

function scoreGeneratedEvaluation(promptText: string, files: AiProviderResult["files"], safetyOk: boolean, syntaxOk: boolean, latencyMs: number) {
  let score = 10;
  const reasoning: string[] = [];
  const requirementChecks = buildRequirementChecks(promptText, files);

  if (!files.length) {
    return {
      score: 1,
      reasoning: "No reviewable Roblox files were generated.",
      requirementChecks,
      valueScore: 0,
      rankScore: 0
    };
  }

  if (!safetyOk) {
    score -= 4;
    reasoning.push("Safety validation flagged generated operations.");
  }

  if (!syntaxOk) {
    score -= 3;
    reasoning.push("Luau syntax validation found errors.");
  }

  const scriptFiles = files.filter((file) => ["Script", "LocalScript", "ModuleScript"].includes(file.className));
  if (scriptFiles.length === 0) {
    score -= 2;
    reasoning.push("The output did not include executable Luau scripts.");
  }

  const failedChecks = requirementChecks.filter(check => !check.ok);
  if (failedChecks.length > 0) {
    const promptSpecificPenalty = Math.min(5, failedChecks.length);
    score -= promptSpecificPenalty;
    reasoning.push(`Missing or weak requirement checks: ${failedChecks.slice(0, 4).map(check => check.label).join(", ")}.`);
  }

  if (latencyMs > 120_000) {
    score -= 1;
    reasoning.push("Generation was very slow.");
  }

  const finalScore = Math.max(1, Math.min(10, score));
  const valueScore = Number((finalScore / Math.max(1, Math.log10(Math.max(10, latencyMs / 1000)) + 1)).toFixed(2));
  const rankScore = Number((finalScore * 10 + (safetyOk ? 8 : 0) + (syntaxOk ? 8 : 0) - Math.min(15, latencyMs / 10_000)).toFixed(2));

  return {
    score: finalScore,
    reasoning: reasoning.length
      ? reasoning.join(" ")
      : "Quick evaluation passed prompt requirement, safety, and Luau syntax checks with reviewable Roblox files.",
    requirementChecks,
    valueScore,
    rankScore
  };
}

function percentage(count: number, total: number) {
  return total > 0 ? Number((count / total).toFixed(3)) : 0;
}

function average(values: number[]) {
  if (values.length === 0) return 0;
  return Number((values.reduce((sum, value) => sum + value, 0) / values.length).toFixed(2));
}

function ratio(count: number, total: number) {
  return total > 0 ? Number((count / total).toFixed(3)) : 0;
}

function isTimeoutMessage(message: AiMessage) {
  const text = `${message.content} ${message.error ?? ""}`.toLowerCase();
  return /\b(timed out|timeout|did not return|aborted|operation was aborted)\b/i.test(text);
}

function buildAdminProductInsights(input: {
  changeSets: ChangeSet[];
  messages: AiMessage[];
  ledger: CreditLedger[];
  sessions: StudioSession[];
  taskRuns: StudioTaskRun[];
  observations: StudioObservation[];
  logs: StudioLog[];
  evidence: CustomerEvidenceEvent[];
  sample: AdminProductInsights["sample"];
}): AdminProductInsights {
  const nowMs = Date.now();
  const recentCutoffMs = nowMs - 24 * 60 * 60 * 1000;
  const isRecent = (value?: string) => {
    const ms = Date.parse(value ?? "");
    return Number.isFinite(ms) && ms >= recentCutoffMs;
  };

  const reviewableStatuses = new Set(["ready_for_review", "approved_for_studio", "applied", "failed", "rejected", "undone"]);
  const appliedChangeSets = input.changeSets.filter((changeSet) => changeSet.status === "applied" || changeSet.status === "undone");
  const failedChangeSets = input.changeSets.filter((changeSet) => changeSet.status === "failed");
  const rejectedChangeSets = input.changeSets.filter((changeSet) => changeSet.status === "rejected");
  const completedTaskRuns = input.taskRuns.filter((run) => ["passed", "passed_with_warnings", "failed", "rolled_back"].includes(run.status));
  const successfulTaskRuns = completedTaskRuns.filter((run) => run.status === "passed" || run.status === "passed_with_warnings" || run.status === "rolled_back");
  const failedTaskRuns = completedTaskRuns.filter((run) => run.status === "failed");
  const applyFailures = input.observations.filter((observation) => observation.kind === "apply_result" && observation.status === "failed");

  const assistantMessages = input.messages.filter((message) => message.role === "assistant");
  const timeoutMessages = assistantMessages.filter(isTimeoutMessage);
  const latencySamples = assistantMessages
    .map((message) => message.thoughtDurationMs)
    .filter((value): value is number => typeof value === "number" && Number.isFinite(value));

  const messagesById = new Map(input.messages.map((message) => [message.id, message]));
  const modelCosts = new Map<string, { modelId: string; successfulPatches: number; totalCostCredits: number }>();
  for (const changeSet of appliedChangeSets) {
    const message = messagesById.get(changeSet.aiMessageId);
    const modelId = message?.modelUsed;
    if (!modelId) continue;
    const entry = modelCosts.get(modelId) ?? { modelId, successfulPatches: 0, totalCostCredits: 0 };
    entry.successfulPatches += 1;
    entry.totalCostCredits += Math.max(0, message.usageCostCredits ?? 0);
    modelCosts.set(modelId, entry);
  }

  const debits = input.ledger.filter((entry) => entry.delta < 0);
  const refunds = input.ledger.filter((entry) => entry.delta > 0 && /\brefund\b/i.test(entry.reason));
  const debitedCredits = debits.reduce((sum, entry) => sum + Math.abs(entry.delta), 0);
  const refundedCredits = refunds.reduce((sum, entry) => sum + entry.delta, 0);

  const onlineSessions = input.sessions.filter((session) => {
    if (session.status !== "connected" && session.status !== "paired") return false;
    const lastSeenMs = Date.parse(session.lastSeenAt ?? session.pairedAt ?? session.createdAt);
    return Number.isFinite(lastSeenMs) && nowMs - lastSeenMs < 90_000;
  });
  const versions = new Map<string, number>();
  for (const session of input.sessions) {
    const version = session.pluginVersion || "unknown";
    versions.set(version, (versions.get(version) ?? 0) + 1);
  }
  const recentLogs = input.logs.filter((log) => isRecent(log.createdAt));
  const recentFailures: AdminProductInsights["recentFailures"] = [
    ...failedTaskRuns.map((run) => ({
      id: run.id,
      createdAt: run.updatedAt,
      source: "task" as const,
      label: "Studio task failed",
      detail: `Change set ${run.changeSetId} failed in Studio.`,
      projectId: run.projectId
    })),
    ...recentLogs
      .filter((log) => log.level === "error")
      .map((log) => ({
        id: log.id,
        createdAt: log.createdAt,
        source: "log" as const,
        label: "Studio runtime error",
        detail: log.message
      })),
    ...timeoutMessages.map((message) => ({
      id: message.id,
      createdAt: message.createdAt,
      source: "message" as const,
      label: "Provider timeout",
      detail: message.error ?? message.content.slice(0, 220),
      projectId: message.projectId,
      modelId: message.modelUsed
    }))
  ].sort((left, right) => right.createdAt.localeCompare(left.createdAt)).slice(0, 12);

  return {
    generatedAt: new Date().toISOString(),
    sample: input.sample,
    patches: {
      total: input.changeSets.length,
      reviewable: input.changeSets.filter((changeSet) => reviewableStatuses.has(changeSet.status)).length,
      applied: appliedChangeSets.length,
      failed: failedChangeSets.length,
      rejected: rejectedChangeSets.length,
      successRate: ratio(successfulTaskRuns.length || appliedChangeSets.length, completedTaskRuns.length || appliedChangeSets.length + failedChangeSets.length),
      applyFailures: applyFailures.length,
      conflictsBypassed: input.changeSets.filter((changeSet) => changeSet.approvedWithSnapshotConflict).length
    },
    ai: {
      assistantMessages: assistantMessages.length,
      timeoutCount: timeoutMessages.length,
      timeoutRate: ratio(timeoutMessages.length, assistantMessages.length),
      averageLatencyMs: Math.round(average(latencySamples)),
      modelCostPerSuccessfulPatch: [...modelCosts.values()]
        .map((entry) => ({
          ...entry,
          averageCostCredits: average([entry.totalCostCredits / Math.max(1, entry.successfulPatches)])
        }))
        .sort((left, right) => right.successfulPatches - left.successfulPatches || left.averageCostCredits - right.averageCostCredits)
    },
    credits: {
      debitedCredits,
      refundedCredits,
      refundRate: ratio(refundedCredits, debitedCredits),
      refundEvents: refunds.length
    },
    studio: {
      sessions: input.sessions.length,
      activeSessions: input.sessions.filter((session) => session.status === "connected" || session.status === "paired").length,
      onlineSessions: onlineSessions.length,
      expiredSessions: input.sessions.filter((session) => session.status === "expired").length,
      recentSnapshotSyncs: input.evidence.filter((event) => event.type === "studio" && event.action === "snapshot_sync" && isRecent(event.createdAt)).length,
      recentRuntimeErrors: recentLogs.filter((log) => log.level === "error").length,
      recentRuntimeWarnings: recentLogs.filter((log) => log.level === "warn").length,
      connectorVersions: [...versions.entries()]
        .map(([version, count]) => ({ version, count }))
        .sort((left, right) => right.count - left.count || left.version.localeCompare(right.version))
    },
    recentFailures
  };
}

function buildEvaluationLeaderboard(runs: ModelEvaluationRun[]): ModelEvaluationLeaderboardEntry[] {
  const scenarioNames = new Map(EVALUATION_SCENARIOS.map((scenario) => [scenario.id, scenario.name]));
  const grouped = new Map<string, Array<{ run: ModelEvaluationRun; result: ModelEvaluationRun["runs"][number] }>>();

  for (const run of runs) {
    for (const result of run.runs) {
      const list = grouped.get(result.modelId) ?? [];
      list.push({ run, result });
      grouped.set(result.modelId, list);
    }
  }

  return [...grouped.entries()].map(([modelId, entries]) => {
    const scores = entries.map(entry => entry.result.score);
    const latencies = entries.map(entry => entry.result.latencyMs);
    const costs = entries.map(entry => entry.result.costCredits);
    const valueScores = entries.map(entry => entry.result.valueScore ?? (entry.result.score / Math.max(1, entry.result.costCredits)));
    const rankScores = entries.map(entry => entry.result.rankScore ?? (entry.result.score * 10));
    const successCount = entries.filter(entry => entry.result.success).length;
    const syntaxPassCount = entries.filter(entry => entry.result.syntaxOk).length;
    const safetyPassCount = entries.filter(entry => entry.result.safetyOk).length;
    const slowRunCount = entries.filter(entry => entry.result.latencyMs > 120_000).length;
    const best = [...entries].sort((a, b) =>
      b.result.score - a.result.score ||
      a.result.latencyMs - b.result.latencyMs ||
      b.run.startedAt.localeCompare(a.run.startedAt)
    )[0];
    const latest = [...entries].sort((a, b) => b.run.startedAt.localeCompare(a.run.startedAt))[0];
    const runCount = entries.length;
    const averageScore = average(scores);
    const averageLatencyMs = Math.round(average(latencies));
    const syntaxPassRate = percentage(syntaxPassCount, runCount);
    const safetyPassRate = percentage(safetyPassCount, runCount);
    const successRate = percentage(successCount, runCount);
    const averageValueScore = average(valueScores);
    const averageRankScore = average(rankScores);

    const strengths: string[] = [];
    const weaknesses: string[] = [];
    if (averageScore >= 9) strengths.push("highest quality");
    else if (averageScore >= 8) strengths.push("strong quality");
    if (syntaxPassRate >= 0.95) strengths.push("clean Luau syntax");
    if (safetyPassRate >= 0.95) strengths.push("safe outputs");
    if (averageLatencyMs > 0 && averageLatencyMs <= 30_000) strengths.push("fast responses");
    if (costs.length > 0 && average(costs) <= 20) strengths.push("low credit cost");
    if (averageValueScore >= 1.5) strengths.push("good value");

    if (averageScore < 7) weaknesses.push("lower average score");
    if (syntaxPassRate < 0.9) weaknesses.push("syntax failures");
    if (safetyPassRate < 0.9) weaknesses.push("safety flags");
    if (slowRunCount > 0) weaknesses.push("slow runs");
    if (successRate < 0.9) weaknesses.push("incomplete generations");

    return {
      modelId,
      runCount,
      successCount,
      successRate,
      averageScore,
      bestScore: Math.max(...scores),
      worstScore: Math.min(...scores),
      averageLatencyMs,
      averageCostCredits: average(costs),
      totalCostCredits: costs.reduce((sum, cost) => sum + cost, 0),
      averageValueScore,
      averageRankScore,
      syntaxPassRate,
      safetyPassRate,
      slowRunCount,
      latestRunAt: latest?.run.completedAt ?? latest?.run.startedAt,
      bestPromptId: best?.run.promptId,
      bestPromptName: best ? scenarioNames.get(best.run.promptId) ?? best.run.promptId : undefined,
      bestRunId: best?.run.id,
      strengths,
      weaknesses
    };
  }).sort((a, b) =>
    b.averageRankScore - a.averageRankScore ||
    b.averageScore - a.averageScore ||
    b.successRate - a.successRate ||
    a.averageLatencyMs - b.averageLatencyMs
  );
}

async function customerEvidenceSnapshot(
  store: RouteContext["store"],
  targetUser: Awaited<ReturnType<typeof store.fetchUser>>,
  targetOrganization: Organization | undefined,
  events: Awaited<ReturnType<typeof store.fetchCustomerEvidenceForUser>>
) {
  if (!targetUser) return undefined;
  const projects = targetOrganization ? await store.fetchProjectsForOrganization(targetOrganization.id) : [];
  const [sessions, creditBalance, usage, ledger, projectDetails] = await Promise.all([
    store.fetchSessionsForUser(targetUser.id),
    targetOrganization ? store.getCreditBalance(targetOrganization.id) : Promise.resolve(0),
    targetOrganization ? store.getUsageStats(targetOrganization.id) : Promise.resolve(undefined),
    targetOrganization ? store.fetchLedgerForOrganization(targetOrganization.id) : Promise.resolve([]),
    Promise.all(projects.map(async (project) => {
      const [threads, messages, attachments, snapshot] = await Promise.all([
        store.fetchThreadsForProject(project.id),
        store.fetchMessagesForProject(project.id),
        store.fetchAttachmentsForProject(project.id),
        store.fetchLatestSnapshot(project.id)
      ]);
      return { threads, messages, attachments, snapshot };
    }))
  ]);
  const allThreads = projectDetails.flatMap((item) => item.threads);
  const allMessages = projectDetails.flatMap((item) => item.messages);
  const allAttachments = projectDetails.flatMap((item) => item.attachments);
  const latestEvidenceWithIp = events.find((event) => event.ip);
  const latestEvidenceWithAgent = events.find((event) => event.userAgent);
  const latestSnapshot = projectDetails
    .map((item) => item.snapshot)
    .filter(Boolean)
    .sort((a, b) => (b!.createdAt).localeCompare(a!.createdAt))[0];

  return {
    userId: targetUser.id,
    email: targetUser.email,
    authProvider: targetUser.authProvider,
    organizationId: targetOrganization?.id,
    plan: targetOrganization?.plan ?? "free",
    creditBalance,
    weeklyAllowance: usage?.weekly.allowance ?? 0,
    weeklyRemaining: usage?.weekly.remaining ?? 0,
    monthlyAllowance: usage?.monthly.allowance ?? 0,
    monthlyUsed: usage?.monthly.used ?? 0,
    monthlyRemaining: usage?.monthly.remaining ?? 0,
    adminGrantedCredits: usage?.monthly.adminGrantedCredits ?? 0,
    paidExtraCredits: usage?.monthly.paidExtraCredits ?? 0,
    projectCount: projects.length,
    threadCount: allThreads.length,
    messageCount: allMessages.length,
    attachmentCount: allAttachments.length,
    generatedIconCount: allAttachments.filter((attachment) => attachment.source === "generated_icon").length,
    ledgerEntryCount: ledger.length,
    studioSessionCount: sessions.length,
    activeStudioSessions: sessions.filter((session) => session.status === "connected" || session.status === "paired").length,
    latestStudioPluginVersion: sessions[0]?.pluginVersion,
    latestPlaceId: sessions[0]?.placeId,
    latestPlaceName: sessions[0]?.placeName,
    latestSnapshotAt: latestSnapshot?.createdAt,
    latestSnapshotNodes: latestSnapshot?.nodes.length ?? 0,
    latestSnapshotScripts: latestSnapshot?.nodes.filter((node) => node.className.includes("Script")).length ?? 0,
    lastIp: latestEvidenceWithIp?.ip,
    lastCountry: latestEvidenceWithIp?.country,
    lastUserAgent: latestEvidenceWithAgent?.userAgent,
    lastEvidenceAt: events[0]?.createdAt,
    lastSeenAt: sessions[0]?.lastSeenAt || targetUser.createdAt,
    stripeCustomerId: targetOrganization?.stripeCustomerId,
    stripeSubscriptionId: targetOrganization?.stripeSubscriptionId,
    stripeSubscriptionStatus: targetOrganization?.stripeSubscriptionStatus,
    stripePriceId: targetOrganization?.stripePriceId,
    billingCycle: targetOrganization?.billingCycle,
    billingCurrentPeriodEnd: targetOrganization?.billingCurrentPeriodEnd
  };
}

async function evidenceJson(
  store: RouteContext["store"],
  targetUser: Awaited<ReturnType<typeof store.fetchUser>>,
  targetOrganization: Organization | undefined,
  events: Awaited<ReturnType<typeof store.fetchCustomerEvidenceForUser>>
) {
  const snapshot = await customerEvidenceSnapshot(store, targetUser, targetOrganization, events);
  return {
    generatedAt: new Date().toISOString(),
    user: targetUser,
    organization: targetOrganization,
    snapshot,
    counts: {
      total: events.length,
      usage: events.filter((event) => event.type === "usage").length,
      billing: events.filter((event) => event.type === "billing").length,
      attachments: events.filter((event) => event.type === "attachment").length,
      generatedIcons: events.filter((event) => event.type === "image_generation").length
    },
    events
  };
}

function evidenceCsv(events: Awaited<ReturnType<typeof store.fetchCustomerEvidenceForUser>>, snapshot?: Record<string, unknown>) {
  const header = ["createdAt", "type", "action", "status", "ip", "country", "userAgent", "projectId", "threadId", "amountCredits", "metadata"];
  const snapshotRows = snapshot ? Object.entries(snapshot).map(([key, value]) => [
    new Date().toISOString(),
    "snapshot",
    key,
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    value
  ].map(csvCell).join(",")) : [];
  const rows = events.map((event) => [
    event.createdAt,
    event.type,
    event.action,
    event.status,
    event.ip,
    event.country,
    event.userAgent,
    event.projectId,
    event.threadId,
    event.amountCredits,
    event.metadata
  ].map(csvCell).join(","));
  return [header.join(","), ...snapshotRows, ...rows].join("\n");
}

async function adminUserSummary(store: RouteContext["store"], userId: string) {
  const targetUser = await store.fetchUser(userId);
  if (!targetUser) return undefined;
  const targetUserOrg = await store.fetchOrganizationForUser(userId);
  const projects = await store.fetchProjectsForOrganization(targetUserOrg?.id || "");
  const sessions = await store.fetchSessionsForUser(userId);
  const evidence = await store.fetchCustomerEvidenceForUser(userId);
  const recentEvidence = evidence[0];
  return {
    ...targetUser,
    plan: normalizePlanName(targetUserOrg?.plan),
    credits: targetUserOrg ? await store.getCreditBalance(targetUserOrg.id) : 0,
    projects: projects.length,
    usage: targetUserOrg ? await store.getUsageStats(targetUserOrg.id) : undefined,
    evidenceCount: evidence.length,
    usageEvents: evidence.filter((event) => event.type === "usage").length,
    organizationId: targetUserOrg?.id,
    stripeCustomerId: targetUserOrg?.stripeCustomerId,
    stripeSubscriptionId: targetUserOrg?.stripeSubscriptionId,
    stripeSubscriptionStatus: targetUserOrg?.stripeSubscriptionStatus,
    stripePriceId: targetUserOrg?.stripePriceId,
    billingCycle: targetUserOrg?.billingCycle,
    billingCurrentPeriodEnd: targetUserOrg?.billingCurrentPeriodEnd,
    location: recentEvidence?.country || recentEvidence?.ip || "Unknown",
    lastIp: recentEvidence?.ip,
    lastUserAgent: recentEvidence?.userAgent,
    lastSeen: sessions[0]?.lastSeenAt || targetUser.createdAt
  };
}

export function registerAdminRoutes(app: express.Express, ctx: RouteContext) {
  app.get("/admin/client-errors", async (req, res, next) => {
    try {
      if (!(await ctx.requireAdmin(req, res))) return;
      const events = await ctx.store.fetchRecentCustomerEvidence(200, "client_error");
      res.json({ events });
    } catch (error) {
      next(error);
    }
  });

  app.get("/admin/insights", async (req, res, next) => {
    try {
      await ctx.store.ready();
      if (!(await ctx.requireAdmin(req, res))) return;
      if (insightsCache && insightsCache.expiresAt > Date.now()) {
        res.json(insightsCache.data);
        return;
      }
      const sampleLimit = 2000;
      const collections = ["changeSets", "messages", "ledger", "sessions", "studioTaskRuns", "studioObservations", "logs", "customerEvidence"] as const;
      const [changeSets, messages, ledger, sessions, taskRuns, observations, logs, evidence, ...counts] = await Promise.all([
        ctx.store.fetchRecentDocs<ChangeSet>("changeSets", sampleLimit),
        ctx.store.fetchRecentDocs<AiMessage>("messages", sampleLimit),
        ctx.store.fetchRecentDocs<CreditLedger>("ledger", sampleLimit),
        ctx.store.fetchRecentDocs<StudioSession>("sessions", sampleLimit),
        ctx.store.fetchRecentDocs<StudioTaskRun>("studioTaskRuns", sampleLimit),
        ctx.store.fetchRecentDocs<StudioObservation>("studioObservations", sampleLimit),
        ctx.store.fetchRecentDocs<StudioLog>("logs", sampleLimit),
        ctx.store.fetchRecentDocs<CustomerEvidenceEvent>("customerEvidence", sampleLimit),
        ...collections.map((collection) => ctx.store.countDocs(collection))
      ]);
      const insights = buildAdminProductInsights({
        changeSets,
        messages,
        ledger,
        sessions,
        taskRuns,
        observations,
        logs,
        evidence,
        sample: {
          perCollectionLimit: sampleLimit,
          truncatedCollections: collections.filter((_collection, index) => (counts[index] ?? 0) > sampleLimit)
        }
      });
      insightsCache = { data: insights, expiresAt: Date.now() + INSIGHTS_CACHE_TTL_MS };
      res.json(insights);
    } catch (error) {
      next(error);
    }
  });

  app.get("/admin/users", async (req, res) => {
    await ctx.store.ready();
    if (!(await ctx.requireAdmin(req, res))) return;

    const rawLimit = typeof req.query.limit === "string" ? Number.parseInt(req.query.limit, 10) : 50;
    const limit = Number.isFinite(rawLimit) ? Math.min(Math.max(rawLimit, 1), 100) : 50;
    const cursor = typeof req.query.cursor === "string" ? req.query.cursor : undefined;
    const page = await ctx.store.fetchUsersWithStatsPage({ limit, cursor });
    let users = page.users;
    if (config.isProduction) {
      users = users.filter(
        (u) =>
          u.id !== "user_owner" &&
          u.id !== "user_same_org_other" &&
          (!u.email || !u.email.toLowerCase().endsWith("@example.com"))
      );
    }
    res.json({ users, total: page.total, nextCursor: page.nextCursor });
  });

  app.get("/admin/users/:userId/evidence", async (req, res) => {
    if (!(await ctx.requireAdmin(req, res))) return;

    const targetUser = await ctx.store.fetchUser(req.params.userId);
    if (!targetUser) {
      res.status(404).json({ error: "User not found" });
      return;
    }

    const targetOrganization = await ctx.store.fetchOrganizationForUser(req.params.userId);
    const events = await ctx.store.fetchCustomerEvidenceForUser(req.params.userId);
    res.json(await evidenceJson(ctx.store, targetUser, targetOrganization, events));
  });

  app.get("/admin/users/:userId/evidence.json", async (req, res) => {
    if (!(await ctx.requireAdmin(req, res))) return;

    const targetUser = await ctx.store.fetchUser(req.params.userId);
    if (!targetUser) {
      res.status(404).json({ error: "User not found" });
      return;
    }

    const targetOrganization = await ctx.store.fetchOrganizationForUser(req.params.userId);
    const events = await ctx.store.fetchCustomerEvidenceForUser(req.params.userId);
    const exportJson = await evidenceJson(ctx.store, targetUser, targetOrganization, events);
    res.setHeader("Content-Type", "application/json");
    res.setHeader("Content-Disposition", `attachment; filename="vectis-evidence-${req.params.userId}.json"`);
    res.send(JSON.stringify(exportJson, null, 2));
  });

  app.get("/admin/users/:userId/evidence.csv", async (req, res) => {
    if (!(await ctx.requireAdmin(req, res))) return;

    const targetUser = await ctx.store.fetchUser(req.params.userId);
    if (!targetUser) {
      res.status(404).json({ error: "User not found" });
      return;
    }

    const targetOrganization = await ctx.store.fetchOrganizationForUser(req.params.userId);
    const events = await ctx.store.fetchCustomerEvidenceForUser(req.params.userId);
    const exportJson = await evidenceJson(ctx.store, targetUser, targetOrganization, events);
    res.setHeader("Content-Type", "text/csv");
    res.setHeader("Content-Disposition", `attachment; filename="vectis-evidence-${req.params.userId}.csv"`);
    res.send(evidenceCsv(events, exportJson.snapshot as Record<string, unknown> | undefined));
  });

  app.get("/admin/evaluations", async (req, res, next) => {
    try {
      if (!(await ctx.requireAdmin(req, res))) return;
      const runs = await ctx.store.fetchEvaluationRuns();
      res.json({ runs, scenarios: EVALUATION_SCENARIOS, leaderboard: buildEvaluationLeaderboard(runs) });
    } catch (error) {
      next(error);
    }
  });

  app.delete("/admin/evaluations", async (req, res, next) => {
    try {
      if (!(await ctx.requireAdmin(req, res))) return;
      const deleted = await ctx.store.clearEvaluationRuns();
      res.json({ ok: true, deleted });
    } catch (error) {
      next(error);
    }
  });

  app.delete("/admin/evaluations/:runId", async (req, res, next) => {
    try {
      if (!(await ctx.requireAdmin(req, res))) return;
      const runs = await ctx.store.fetchEvaluationRuns();
      const run = runs.find(candidate => candidate.id === req.params.runId);
      if (!run) {
        res.status(404).json({ error: "Evaluation run not found." });
        return;
      }
      await ctx.store.deleteEvaluationRun(run.id);
      res.json({ ok: true, deleted: run.id });
    } catch (error) {
      next(error);
    }
  });

  app.get("/admin/payments", async (req, res, next) => {
    try {
      await ctx.store.ready();
      if (!(await ctx.requireAdmin(req, res))) return;
      const overview = await getAdminPaymentOverview();
      res.json(overview);
    } catch (error) {
      next(error);
    }
  });

  app.post("/admin/evaluations/run", async (req, res, next) => {
    try {
      const admin = await ctx.requireAdmin(req, res);
      if (!admin) return;
      const input = runEvaluationSchema.parse(req.body);
      const preferences = admin.preferences;

      const scenarioInputs = input.promptId === "all"
        ? EVALUATION_SCENARIOS
        : [
            input.promptId === "custom"
              ? {
                  id: "custom",
                  name: "Custom Scenario",
                  promptText: input.customPromptText || "Custom Roblox request",
                  estimatedCostCredits: 0
                }
              : EVALUATION_SCENARIOS.find(s => s.id === input.promptId)
          ].filter(Boolean) as typeof EVALUATION_SCENARIOS;

      if (scenarioInputs.length === 0) {
        res.status(400).json({ error: "No evaluation scenarios selected." });
        return;
      }

      const estimatedTotalCost = scenarioInputs.reduce((scenarioTotal) => {
        return scenarioTotal + input.models.reduce((modelTotal, modelId) => {
          return modelTotal + estimateEvaluationModelCost(modelId, input.judgeEnabled !== false, preferences).totalCostCredits;
        }, 0);
      }, 0);

      const adminOrganization = await ctx.store.fetchOrganizationForUser(admin.id);
      if (!adminOrganization) {
        res.status(404).json({ error: "Admin organization not found." });
        return;
      }

      if ((await ctx.store.getCreditBalance(adminOrganization.id)) < estimatedTotalCost) {
        res.status(402).json({ error: `Not enough credits for evaluation. Estimated total is ${estimatedTotalCost} credits.` });
        return;
      }

      const savedRuns = [];
      let actualTotalCost = 0;

      for (const scenario of scenarioInputs) {
        const runId = `eval_${ctx.nanoid()}`;
        const startedAt = new Date().toISOString();
        const promptText = scenario.promptText;

        const runModelEvaluation = async (modelId: string) => {
          const modelStartedAt = Date.now();
          let success = false;
          let latencyMs = 0;
          let safetyOk = true;
          let blockedPatterns: string[] = [];
          let syntaxOk = true;
          let syntaxErrors: string[] | undefined = undefined;
          let score = 0;
          let reasoning = "Skipped judge scoring.";
          let generatedTitle: string | undefined = undefined;
          let generatedSummary: string | undefined = undefined;
          let generatedFiles: ChangeFile[] | undefined = undefined;
          let outputTruncated = false;
          let repairAttempts: number | undefined = undefined;
          let requirementChecks: Array<{ label: string; ok: boolean; detail?: string }> | undefined = undefined;
          let valueScore: number | undefined = undefined;
          let rankScore: number | undefined = undefined;

          const resolved = resolveAiModel(modelId);
          const modelCfg = modelConfigFor(resolved);
          const usageMultiplier = modelCfg?.usageMultiplier ?? 1;
          const thinkingLevel = getThinkingLevel(resolved, preferences);
          const thinkingMultiplier = getThinkingMultiplier(resolved, "changeset", preferences);
          const generationCostCredits = getCost(modelId, "changeset", undefined, preferences);
          let judgeCostCredits = 0;

          try {
            const dummyProject: Project = {
              id: "eval_project",
              organizationId: "eval_org",
              name: "Evaluator",
              template: "obby",
              description: "Temporary evaluation project",
              createdAt: new Date().toISOString(),
              updatedAt: new Date().toISOString()
            };

            const generated = await generateSafeChangeSet({
              project: dummyProject,
              prompt: promptText,
              model: modelId,
              planMode: false,
              snapshot: undefined,
              history: [],
              preferences,
              providerTimeoutMs: Math.min(300_000, Math.max(120_000, Math.round(modelLatencyBudgetMs(resolved, "changeset") * thinkingMultiplier)))
            });

            latencyMs = Date.now() - modelStartedAt;
            generatedTitle = generated.title;
            generatedSummary = generated.summary;
            const sanitizedOutput = sanitizeEvaluationGeneratedFiles(generated.files);
            generatedFiles = sanitizedOutput.files;
            outputTruncated = sanitizedOutput.truncated;
            repairAttempts = generated.repairAttempts;
            success = generated.safety.ok && generated.files.length > 0;
            safetyOk = generated.safety.ok;
            blockedPatterns = generated.safety.blockedPatterns;

            if (success) {
              const luaFiles = generated.files.filter(f => f.source && ["Script", "LocalScript", "ModuleScript"].includes(f.className));
              const errors: string[] = [];
              for (const file of luaFiles) {
                const syntaxRes = validateLuauSyntax(file.source || "");
                if (!syntaxRes.ok && syntaxRes.errors) {
                  errors.push(...syntaxRes.errors);
                }
              }
              syntaxOk = errors.length === 0;
              if (errors.length > 0) {
                syntaxErrors = errors;
              }

              if (input.judgeEnabled !== false) {
                judgeCostCredits = getJudgeCost(preferences) * 2;
                const [judge1, judge2] = await Promise.all([
                  runJudgeScoring(promptText, generated.files, preferences),
                  runJudgeScoring(promptText, generated.files, preferences)
                ]);
                const scoredJudges = [judge1, judge2].filter((judge): judge is { score: number; reasoning: string } => judge.score !== null);
                if (scoredJudges.length > 0) {
                  score = Math.round(scoredJudges.reduce((sum, judge) => sum + judge.score, 0) / scoredJudges.length);
                  reasoning = [judge1, judge2].map((judge, index) => `Judge ${index + 1} (${judge.score === null ? "unscored" : `${judge.score}/10`}): ${judge.reasoning}`).join("\n\n");
                } else {
                  const quickScore = scoreGeneratedEvaluation(promptText, generated.files, safetyOk, syntaxOk, latencyMs);
                  score = quickScore.score;
                  reasoning = `Both judge calls were unscored. ${quickScore.reasoning}`;
                  requirementChecks = quickScore.requirementChecks;
                  valueScore = quickScore.valueScore;
                  rankScore = quickScore.rankScore;
                }
              } else {
                const quickScore = scoreGeneratedEvaluation(promptText, generated.files, safetyOk, syntaxOk, latencyMs);
                score = quickScore.score;
                reasoning = quickScore.reasoning;
                requirementChecks = quickScore.requirementChecks;
                valueScore = quickScore.valueScore;
                rankScore = quickScore.rankScore;
              }
            } else {
              score = 1;
              reasoning = "Model failed to produce valid Roblox change files.";
            }

          } catch (err: unknown) {
            const log = createLogger({ service: "admin" });
            log.error("Evaluation failed", { modelId, error: String(err) });
            score = 1;
            reasoning = `Internal evaluation failure: ${err instanceof Error ? err.message : String(err)}`;
            latencyMs = Date.now() - modelStartedAt;
          }

          const costCredits = generationCostCredits + judgeCostCredits;

          return {
            modelId,
            success,
            latencyMs,
            costCredits,
            generationCostCredits,
            judgeCostCredits,
            estimatedProviderCostUsd: estimateProviderCostUsd(costCredits),
            safetyOk,
            blockedPatterns,
            syntaxOk,
            syntaxErrors,
            score,
            reasoning,
            thinkingLevel,
            thinkingMultiplier,
            usageMultiplier,
            repairAttempts,
            generatedTitle,
            generatedSummary,
            generatedFiles,
            requirementChecks,
            valueScore,
            rankScore,
            outputTruncated
          };
        };

        const runsResults = [];
        for (const modelId of input.models) {
          runsResults.push(await runModelEvaluation(modelId));
        }
        const totalCostCredits = runsResults.reduce((sum, result) => sum + result.costCredits, 0);
        actualTotalCost += totalCostCredits;

        const evaluationRun = await ctx.store.saveEvaluationRun({
          id: runId,
          promptId: scenario.id,
          promptText,
          startedAt,
          completedAt: new Date().toISOString(),
          totalCostCredits,
          estimatedProviderCostUsd: estimateProviderCostUsd(totalCostCredits),
          runs: runsResults
        });

        savedRuns.push(evaluationRun);
      }

      if (actualTotalCost > 0) {
        const debit = await ctx.store.tryDeductCredits(
          adminOrganization.id,
          actualTotalCost,
          `Model evaluation suite (${scenarioInputs.length} prompts, ${input.models.length} models)`
        );
        if (!debit.ok) {
          res.status(402).json({ error: "Not enough credits to finalize evaluation charge." });
          return;
        }
      }

      res.status(201).json({
        run: savedRuns[0],
        runs: savedRuns,
        totalCostCredits: actualTotalCost,
        estimatedCostCredits: estimatedTotalCost,
        estimatedProviderCostUsd: estimateProviderCostUsd(actualTotalCost),
        creditBalance: await ctx.store.getCreditBalance(adminOrganization.id)
      });
    } catch (error) {
      next(error);
    }
  });

  app.get("/admin/provider-health", async (req, res, next) => {
    try {
      const admin = await ctx.requireAdmin(req, res);
      if (!admin) return;

      interface ProviderCheck {
        id: string;
        name: string;
        reachable: boolean;
        latencyMs: number;
        error: string | null;
        models: Array<{ id: string; name: string; status: string; note: string }>;
        credits?: {
          usedUsd?: number;
          limitUsd?: number;
          remainingUsd?: number;
          isUnlimited?: boolean;
          details: string;
        };
      }

      const results: ProviderCheck[] = [];
      const allowAllStatus = (status: number) => status < 500;

      async function checkUrl(url: string, headers: Record<string, string>, acceptStatus?: (status: number) => boolean): Promise<{ ok: boolean; ms: number; error: string | null }> {
        const start = Date.now();
        try {
          const res = await fetch(url, { headers, signal: AbortSignal.timeout(10_000) });
          const ok = acceptStatus ? acceptStatus(res.status) : res.ok;
          return { ok, ms: Date.now() - start, error: ok ? null : `HTTP ${res.status}` };
        } catch (err) {
          return { ok: false, ms: Date.now() - start, error: (err as Error).message };
        }
      }

      if (config.yunwu.apiKey) {
        const { ok, ms, error } = await checkUrl(`${config.yunwu.baseUrl.replace(/\/$/, "")}/models`, {
          Authorization: `Bearer ${config.yunwu.apiKey}`,
        });

        let credits = undefined;
        try {
          const billingBaseUrl = config.yunwu.baseUrl.replace(/\/v1\/?$/, "");
          const tokenRes = await fetch(`${billingBaseUrl}/api/usage/token/`, {
            headers: { Authorization: `Bearer ${config.yunwu.apiKey}` },
            signal: AbortSignal.timeout(5000)
          });
          if (tokenRes.ok) {
            const tokenData = await tokenRes.json() as any;
            if (tokenData.success && tokenData.data) {
              const data = tokenData.data;
              const totalUsed = data.total_used || 0;
              const totalGranted = data.total_granted || 0;
              const totalAvailable = data.total_available || 0;
              const isUnlimited = !!data.unlimited_quota;

              const usedUsd = totalUsed / 500000;
              if (isUnlimited) {
                credits = {
                  usedUsd,
                  isUnlimited: true,
                  details: "Unlimited (Token quota is unlimited. Check master account balance in Yunwu Dashboard)"
                };
              } else {
                const limitUsd = totalGranted / 500000;
                const remainingUsd = Math.max(0, totalAvailable / 500000);
                credits = {
                  usedUsd,
                  limitUsd,
                  remainingUsd,
                  isUnlimited: false,
                  details: `Remaining: $${remainingUsd.toFixed(2)}`
                };
              }
            }
          }
        } catch (tokenErr) {
          // ignore
        }

        if (!credits) {
          try {
            const billingBaseUrl = config.yunwu.baseUrl.replace(/\/v1\/?$/, "");
            const subRes = await fetch(`${billingBaseUrl}/dashboard/billing/subscription`, {
              headers: { Authorization: `Bearer ${config.yunwu.apiKey}` },
              signal: AbortSignal.timeout(5000)
            });
            const usageRes = await fetch(`${billingBaseUrl}/dashboard/billing/usage`, {
              headers: { Authorization: `Bearer ${config.yunwu.apiKey}` },
              signal: AbortSignal.timeout(5000)
            });
            if (subRes.ok && usageRes.ok) {
              const subData = await subRes.json() as any;
              const usageData = await usageRes.json() as any;
              const limitUsd = (subData.hard_limit_usd || 0) / 100;
              const usedUsd = (usageData.total_usage || 0) / 100;
              const isUnlimited = limitUsd >= 500000;
              if (isUnlimited) {
                credits = {
                  usedUsd,
                  isUnlimited: true,
                  details: "Unlimited (Token quota is unlimited. Check master account balance in Yunwu Dashboard)"
                };
              } else {
                credits = {
                  usedUsd,
                  limitUsd,
                  remainingUsd: Math.max(0, limitUsd - usedUsd),
                  isUnlimited: false,
                  details: `Remaining: $${Math.max(0, limitUsd - usedUsd).toFixed(2)}`
                };
              }
            }
          } catch (subErr) {
            // ignore
          }
        }

        results.push({
          id: "yunwu", name: "Yunwu API", reachable: ok, latencyMs: ms, error, credits,
          models: [
            { id: "gpt-5.5", name: "GPT-5.5", status: ok ? "healthy" : "failing", note: "Yunwu route" },
            { id: "qwen3.7-max", name: "Qwen3.7 Max", status: ok ? "healthy" : "failing", note: "Yunwu route" },
            { id: "claude-opus-4-8", name: "Claude Opus 4.8", status: ok ? "healthy" : "failing", note: "Yunwu route" },
            { id: "gemini-3.1-pro-preview", name: "Gemini 3.1 Pro Preview", status: ok ? "healthy" : "failing", note: "Yunwu route" },
            { id: "gemini-3.5-flash", name: "Gemini 3.5 Flash", status: ok ? "healthy" : "failing", note: "Yunwu route" },
            { id: "deepseek-v4-flash", name: "DeepSeek V4 Flash", status: ok ? "healthy" : "failing", note: "Yunwu route" },
          ],
        });
      } else {
        results.push({
          id: "yunwu", name: "Yunwu API", reachable: false, latencyMs: 0, error: "No YUNWU_API_KEY configured",
          models: [
            { id: "gpt-5.5", name: "GPT-5.5", status: "unknown", note: "" },
            { id: "qwen3.7-max", name: "Qwen3.7 Max", status: "unknown", note: "" },
            { id: "claude-opus-4-8", name: "Claude Opus 4.8", status: "unknown", note: "" },
            { id: "gemini-3.1-pro-preview", name: "Gemini 3.1 Pro Preview", status: "unknown", note: "" },
            { id: "gemini-3.5-flash", name: "Gemini 3.5 Flash", status: "unknown", note: "" },
            { id: "deepseek-v4-flash", name: "DeepSeek V4 Flash", status: "unknown", note: "" },
          ],
        });
      }

      if (config.googleVertex.projectId) {
        try {
          const { GoogleAuth } = await import("google-auth-library");
          const auth = new GoogleAuth({ scopes: ["https://www.googleapis.com/auth/cloud-platform"] });
          const client = await auth.getClient();
          const tokenResponse = await client.getAccessToken();
          const host = config.googleVertex.location === "global" ? "aiplatform.googleapis.com" : `${config.googleVertex.location}-aiplatform.googleapis.com`;
          const endpoint = `https://${host}/v1/projects/${config.googleVertex.projectId}/locations/${config.googleVertex.location}/publishers/google/models/gemini-3.5-flash:generateContent`;
          const start = Date.now();
          const resp = await fetch(endpoint, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${tokenResponse.token}`
            },
            body: JSON.stringify({ contents: [{ role: "user", parts: [{ text: "hi" }] }] })
          });
          const latencyMs = Date.now() - start;
          const ok = resp.ok;
          const error = ok ? null : `HTTP ${resp.status}`;
          results.push({
            id: "google-vertex", name: "Google Vertex AI", reachable: ok, latencyMs, error,
            credits: {
              details: "Check remaining trial balance in the Google Cloud Console"
            },
            models: [
              { id: "gemini-3-flash-preview", name: "Gemini 3 Flash", status: ok ? "healthy" : "failing", note: "Vertex direct" },
              { id: "gemini-3.5-flash", name: "Gemini 3.5 Flash", status: ok ? "healthy" : "failing", note: "Vertex direct" },
              { id: "gemini-3.1-pro-preview", name: "Gemini 3.1 Pro", status: ok ? "healthy" : "failing", note: "Vertex direct" },
            ],
          });
        } catch (err) {
          results.push({
            id: "google-vertex", name: "Google Vertex AI", reachable: false, latencyMs: 0, error: String(err),
            credits: {
              details: "Check remaining trial balance in the Google Cloud Console"
            },
            models: [
              { id: "gemini-3-flash-preview", name: "Gemini 3 Flash", status: "unknown", note: "" },
              { id: "gemini-3.5-flash", name: "Gemini 3.5 Flash", status: "unknown", note: "" },
              { id: "gemini-3.1-pro-preview", name: "Gemini 3.1 Pro", status: "unknown", note: "" },
            ],
          });
        }
      } else {
        results.push({
          id: "google-vertex", name: "Google Vertex AI", reachable: false, latencyMs: 0, error: "No GOOGLE_CLOUD_PROJECT configured",
          models: [
            { id: "gemini-3-flash-preview", name: "Gemini 3 Flash", status: "unknown", note: "" },
            { id: "gemini-3.5-flash", name: "Gemini 3.5 Flash", status: "unknown", note: "" },
            { id: "gemini-3.1-pro-preview", name: "Gemini 3.1 Pro", status: "unknown", note: "" },
          ],
        });
      }

      if (config.deepseek.apiKey) {
        const { ok, ms, error } = await checkUrl(`${config.deepseek.baseUrl}/v1/models`, {
          Authorization: `Bearer ${config.deepseek.apiKey}`,
        });
        results.push({
          id: "deepseek-official", name: "DeepSeek Official", reachable: ok, latencyMs: ms, error,
          models: [
            { id: "deepseek-v4-flash", name: "DeepSeek V4 Flash", status: "healthy", note: "Direct API, no NVIDIA queue" },
            { id: "deepseek-v4-pro", name: "DeepSeek V4 Pro", status: "healthy", note: "Direct API, no NVIDIA queue" },
          ],
        });
      }

      if (config.zai.apiKey) {
        const { ok, ms, error } = await checkUrl(`${config.zai.baseUrl}/models`, {
          Authorization: `Bearer ${config.zai.apiKey}`,
        });
        results.push({
          id: "zai-official", name: "Z.AI (GLM)", reachable: ok, latencyMs: ms, error,
          models: [],
        });
      }



      // --- Core Infrastructure & Integrations Health Checks ---

      // 1. Cloudflare CDN Check
      const cfCheck = await checkUrl("https://vectiscode.com", {}, allowAllStatus);
      results.push({
        id: "cloudflare-cdn",
        name: "Cloudflare Edge CDN",
        reachable: cfCheck.ok,
        latencyMs: cfCheck.ms,
        error: cfCheck.error,
        models: [
          { id: "cloudflare-cdn", name: "Edge DNS & Caching", status: cfCheck.ok ? "healthy" : "failing", note: "vectiscode.com root" }
        ]
      });

      // 2. Stripe API Check
      const stripeCheck = await checkUrl("https://api.stripe.com", {}, allowAllStatus);
      results.push({
        id: "stripe-api",
        name: "Stripe Payment Gateway",
        reachable: stripeCheck.ok,
        latencyMs: stripeCheck.ms,
        error: stripeCheck.error,
        models: [
          { id: "stripe-api", name: "Stripe API Connectivity", status: stripeCheck.ok ? "healthy" : "failing", note: "api.stripe.com" }
        ]
      });

      // 3. Firebase Identity Check
      const firebaseCheck = await checkUrl("https://identitytoolkit.googleapis.com", {}, allowAllStatus);
      results.push({
        id: "firebase-identity",
        name: "Firebase Auth Identity",
        reachable: firebaseCheck.ok,
        latencyMs: firebaseCheck.ms,
        error: firebaseCheck.error,
        models: [
          { id: "firebase-identity", name: "Firebase Identity Service", status: firebaseCheck.ok ? "healthy" : "failing", note: "identitytoolkit.googleapis.com" }
        ]
      });

      // 4. Database Check
      const dbStart = Date.now();
      let dbOk = false;
      let dbError: string | null = null;
      try {
        await ctx.store.fetchUser("non_existent_check_user_id");
        dbOk = true;
      } catch (err) {
        dbError = (err as Error).message;
      }
      results.push({
        id: "database",
        name: config.useSupabase ? "Supabase Database Connection" : "Local Database Connection",
        reachable: dbOk,
        latencyMs: Date.now() - dbStart,
        error: dbError,
        models: [
          { id: "database", name: "Core Read Check", status: dbOk ? "healthy" : "failing", note: config.useSupabase ? "Supabase vectis_collections" : "Local JSON" }
        ]
      });

      res.json({ timestamp: new Date().toISOString(), providers: results });
    } catch (error) {
      next(error);
    }
  });

  app.get("/admin/model-health", async (req, res, next) => {
    try {
      const admin = await ctx.requireAdmin(req, res);
      if (!admin) return;
      const thinkingModels = runtimeAiModels()
        .filter(model => model.status === "available")
        .map(model => model.id);
      const dummyProject: Project = {
        id: "health_project",
        organizationId: "health_org",
        name: "Model Health Check",
        template: "obby",
        description: "Temporary model health probe",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };

      const results = await Promise.all(thinkingModels.map(async (modelId) => {
        const started = Date.now();
        const probeModelId = modelId;
        try {
          const budget = modelLatencyBudgetMs(probeModelId, "chat");
          const thinkingMultiplier = getThinkingMultiplier(probeModelId, "chat", admin.preferences);
          const adjustedBudget = Math.round(budget * thinkingMultiplier);
          const timeoutMs = Math.min(300_000, Math.max(20_000, adjustedBudget));
          const response = await withTimeout(
            answerProjectQuestion({
              project: dummyProject,
              prompt: MODEL_HEALTH_CHAT_PROMPT,
              model: probeModelId,
              preferences: admin.preferences,
              providerTimeoutMs: timeoutMs
            }),
            timeoutMs,
            `${probeModelId} health check timed out`
          );
          const quality = assessModelHealthText(response.text);
          const latency = assessModelLatency(probeModelId, Date.now() - started, "chat");
          return {
            modelId,
            usedModelId: probeModelId,
            ok: quality.ok && latency.ok,
            qualityOk: quality.ok,
            speedOk: latency.ok,
            latencyMs: latency.latencyMs,
            latencyBudgetMs: latency.budgetMs,
            issues: [...quality.reasons, ...(latency.ok ? [] : [`slower than ${Math.round(latency.budgetMs / 1000)}s chat budget`])],
            thinkingLevel: getThinkingLevel(probeModelId, admin.preferences),
            thinkingMultiplier: getThinkingMultiplier(probeModelId, "chat", admin.preferences),
            text: response.text.slice(0, 120)
          };
        } catch (error) {
          return {
            modelId,
            ok: false,
            latencyMs: Date.now() - started,
            thinkingLevel: getThinkingLevel(modelId, admin.preferences),
            thinkingMultiplier: getThinkingMultiplier(modelId, "chat", admin.preferences),
            error: error instanceof Error ? error.message : String(error)
          };
        }
      }));

      res.json({ results });
    } catch (error) {
      next(error);
    }
  });

  app.post("/admin/users/:userId/credits", async (req, res) => {
    const admin = await ctx.requireAdmin(req, res);
    if (!admin) return;

    const input = adminCreditsSchema.parse(req.body);
    const targetUserOrg = await ctx.store.fetchOrganizationForUser(req.params.userId);
    if (!targetUserOrg) return res.status(404).json({ error: "User or organization not found" });

    const reason = input.reason.replace(/^Admin credit grant$/i, "Admin balance grant");
    await ctx.store.addCredits(targetUserOrg.id, input.delta, reason);
    await ctx.recordEvidence(req, {
      userId: req.params.userId,
      organizationId: targetUserOrg.id,
      type: "admin",
      action: "admin_balance_grant",
      status: "ok",
      amountCredits: input.delta,
      metadata: {
        adminUserId: admin.id,
        reason
      }
    });
    res.json({ ok: true, user: await adminUserSummary(ctx.store, req.params.userId) });
  });

  app.post("/admin/users/:userId/usage-adjustment", async (req, res) => {
    const admin = await ctx.requireAdmin(req, res);
    if (!admin) return;

    const input = adminUsageAdjustmentSchema.parse(req.body);
    const targetUserOrg = await ctx.store.fetchOrganizationForUser(req.params.userId);
    if (!targetUserOrg) return res.status(404).json({ error: "User or organization not found" });

    const capacity = planFor(targetUserOrg.plan).creditsPerMonth;
    const delta = Math.round((capacity * input.deltaPercent) / 100);
    await ctx.store.addCredits(targetUserOrg.id, delta, input.reason);
    await ctx.recordEvidence(req, {
      userId: req.params.userId,
      organizationId: targetUserOrg.id,
      type: "admin",
      action: "admin_usage_adjustment",
      status: "ok",
      amountCredits: delta,
      metadata: {
        adminUserId: admin.id,
        deltaPercent: input.deltaPercent,
        reason: input.reason
      }
    });
    res.json({ ok: true, user: await adminUserSummary(ctx.store, req.params.userId) });
  });

  app.post("/admin/users/:userId/usage-reset", async (req, res) => {
    const admin = await ctx.requireAdmin(req, res);
    if (!admin) return;

    const targetUserOrg = await ctx.store.fetchOrganizationForUser(req.params.userId);
    if (!targetUserOrg) return res.status(404).json({ error: "User or organization not found" });

    const usage = await ctx.store.getUsageStats(targetUserOrg.id);
    const resetCredits = Math.max(0, usage.monthly.used);
    if (resetCredits > 0) {
      await ctx.store.addCredits(targetUserOrg.id, resetCredits, "Admin usage reset");
    }
    await ctx.recordEvidence(req, {
      userId: req.params.userId,
      organizationId: targetUserOrg.id,
      type: "admin",
      action: "admin_usage_reset",
      status: "ok",
      amountCredits: resetCredits,
      metadata: {
        adminUserId: admin.id,
        monthlyUsedBeforeReset: usage.monthly.used
      }
    });
    res.json({ ok: true, resetCredits, user: await adminUserSummary(ctx.store, req.params.userId) });
  });

  app.patch("/admin/users/:userId/plan", async (req, res) => {
    const admin = await ctx.requireAdmin(req, res);
    if (!admin) return;

    const input = adminPlanSchema.parse(req.body);
    const targetUserOrg = await ctx.store.fetchOrganizationForUser(req.params.userId);
    if (!targetUserOrg) return res.status(404).json({ error: "User or organization not found" });

    const priorPlan = targetUserOrg.plan;
    targetUserOrg.plan = input.plan;
    await ctx.store.saveOrganization(targetUserOrg);
    const balance = await ctx.store.getCreditBalance(targetUserOrg.id);
    const includedCapacity = planFor(input.plan).creditsPerMonth;
    const delta = includedCapacity - balance;
    if (delta !== 0) {
      await ctx.store.addCredits(targetUserOrg.id, delta, `Admin plan capacity set to ${planFor(input.plan).label}`);
    }
    await ctx.recordEvidence(req, {
      userId: req.params.userId,
      organizationId: targetUserOrg.id,
      type: "admin",
      action: "admin_plan_update",
      status: "ok",
      amountCredits: delta,
      metadata: {
        adminUserId: admin.id,
        priorPlan,
        nextPlan: input.plan
      }
    });
    res.json({ ok: true, user: await adminUserSummary(ctx.store, req.params.userId) });
  });

  app.patch("/admin/users/:userId/status", async (req, res) => {
    const admin = await ctx.requireAdmin(req, res);
    if (!admin) return;

    const input = adminStatusSchema.parse(req.body);
    const targetUser = await ctx.store.fetchUser(req.params.userId);
    if (!targetUser) return res.status(404).json({ error: "User not found" });

    const priorStatus = targetUser.status || "active";
    targetUser.status = input.status;
    await ctx.store.saveUser(targetUser);
    const targetUserOrg = await ctx.store.fetchOrganizationForUser(req.params.userId);
    await ctx.recordEvidence(req, {
      userId: req.params.userId,
      organizationId: targetUserOrg?.id,
      type: "admin",
      action: "admin_status_update",
      status: "ok",
      metadata: {
        adminUserId: admin.id,
        priorStatus,
        nextStatus: input.status
      }
    });
    res.json({ ok: true, user: await adminUserSummary(ctx.store, req.params.userId) });
  });

  // --- Email Subscribers (admin) ---

  app.get("/admin/subscribers", async (req, res, next) => {
    try {
      if (!(await ctx.requireAdmin(req, res))) return;
      const subscribers = await ctx.store.fetchEmailSubscribers();
      res.json({ subscribers });
    } catch (error) {
      next(error);
    }
  });

  app.delete("/admin/subscribers/:id", async (req, res, next) => {
    try {
      if (!(await ctx.requireAdmin(req, res))) return;
      await ctx.store.deleteEmailSubscriber(req.params.id);
      res.json({ ok: true });
    } catch (error) {
      next(error);
    }
  });

  // --- Email Subscribe (public) ---

  app.post("/subscribe", ctx.subscribeLimiter, async (req, res, next) => {
    try {
      const input = emailSubscribeSchema.parse(req.body);
      const exists = await ctx.store.emailSubscriberExists(input.email);
      if (exists) {
        res.json({ ok: true, message: "Already subscribed" });
        return;
      }
      await ctx.store.saveEmailSubscriber({
        id: `sub_${ctx.nanoid()}`,
        email: input.email.toLowerCase().trim(),
        subscribedAt: new Date().toISOString(),
        ip: ctx.requestIp(req)
      });
      res.json({ ok: true, message: "Subscribed successfully" });
    } catch (error) {
      next(error);
    }
  });
}
