import { createHash } from "node:crypto";
import {
  defaultAiModel,
  modelConfigFor,
  modelFixedCost,
  modelIsAvailable,
  modelIsPremium,
  resolveAiModel,
  modelHasTieredThinking,
  getThinkingMultiplier,
  calculateUsageCostCredits,
  eventDiscountMultiplier
} from "../services/config.js";
import { planFor } from "../services/plans.js";
import { planCreditEconomics } from "../services/pricing.js";
import { modelLatencyBudgetMs } from "../services/modelHealth.js";
import type { AiMessage, AgentActivityStep, ChangeSet, Project, ProjectSnapshot, UsageStats, UserPreferences } from "../types.js";
import type { AiUsageAccumulator } from "../services/usageAccounting.js";

export const WEAK_UI_PATCH_MODELS = new Set(["gemini-3-flash-preview", "gemini-3-flash", "deepseek-v4-flash"]);
export const HIGH_SPEND_DIRECT_MODELS = new Set(["qwen3.7-max", "gpt-5.5", "claude-opus-4-8"]);
export const CHAT_TITLE_STOP_WORDS = new Set([
  "a", "an", "and", "are", "can", "for", "from", "i", "in", "is", "it",
  "me", "my", "of", "on", "please", "the", "this", "to", "with", "you",
  "what", "how", "why", "should", "would", "do"
]);

export function usageLimitPayload(input: {
  plan?: string;
  creditBalance: number;
  requiredCredits?: number;
  usage?: UsageStats;
}) {
  const plan = planFor(input.plan);
  const canTopUp = plan.topUps;
  const upgradeTarget = plan.name === "free"
    ? "Starter, Pro, or Studio"
    : plan.name === "starter"
      ? "Pro or Studio"
      : "Studio";
  const message = canTopUp
    ? `Your ${plan.label} weekly usage is used for now. Wait for the next weekly refill or add a Studio usage pack.`
    : plan.name === "studio"
      ? `Your ${plan.label} weekly usage is used for now. Wait for the next weekly refill.`
      : `Your ${plan.label} weekly usage is used for now. Wait for the next weekly refill or upgrade to ${upgradeTarget} for more weekly usage.`;

  return {
    error: "Usage limit reached",
    code: "usage_limit_reached",
    title: "Usage limit reached",
    message,
    plan: plan.name,
    planLabel: plan.label,
    canTopUp,
    action: canTopUp ? "top_up" : "upgrade",
    actionLabel: canTopUp ? "Add Studio usage" : plan.name === "free" ? "View plans" : "Upgrade plan",
    creditBalance: Math.max(0, input.creditBalance),
    requiredCredits: input.requiredCredits ?? 0,
    weeklyRemaining: input.usage?.weekly.remaining,
    weeklyAllowance: input.usage?.weekly.allowance,
    nextRefillAt: input.usage?.weekly.nextRefillAt
  };
}

export function usageLimitError(payload: ReturnType<typeof usageLimitPayload>) {
  return Object.assign(new Error(payload.message), {
    statusCode: 402,
    payload
  });
}

export function chatNameFromPrompt(prompt: string) {
  const normalized = prompt.replace(/https?:\/\/\S+/gi, " ").replace(/\s+/g, " ").trim();
  if (!normalized) return "New chat";
  const words = normalized
    .replace(/[`*_~>#()[\]{}]/g, " ")
    .replace(/[^a-z0-9' ]+/gi, " ")
    .split(/\s+/)
    .map((word) => word.trim().slice(0, 24))
    .filter(Boolean);
  const contentWords = words.filter((word) => !CHAT_TITLE_STOP_WORDS.has(word.toLowerCase()));
  const titleWords = (contentWords.length >= 2 ? contentWords : words).slice(0, 5);
  if (titleWords.length === 0) return "New chat";
  const title = titleWords.join(" ");
  return title.charAt(0).toUpperCase() + title.slice(1);
}

export function isDefaultThreadName(name: string) {
  return /^new chat$/i.test(name.trim());
}

export function isPlanModeImplementationRequest(prompt: string, history: AiMessage[]) {
  const normalized = prompt.toLowerCase().replace(/\s+/g, " ").trim();
  const asksToExecute = /\b(go ahead|implement|integrate|build|create|edit|apply|do it|make it|ship it|add it|execute|proceed)\b/i.test(normalized);
  if (!asksToExecute) return false;
  const recentPlan = history.slice(-8).some((message) =>
    message.role === "assistant" &&
    /\b(plan mode|implementation plan|implementation route|files or systems|steps i would take)\b/i.test(message.content)
  );
  const isShortConfirmation = /\b(go ahead|do it|proceed|apply|execute|approve|implement)\b/i.test(normalized) && normalized.length <= 40;
  return recentPlan || isShortConfirmation;
}

export function planModeImplementationBlockedText() {
  return [
    "Plan Mode is still enabled, so I cannot create, edit, queue, or apply files from that plan.",
    "",
    "Turn Plan Mode off, then send the same request again and I can implement it as a reviewed Studio patch."
  ].join("\n");
}

export function isUiOrGameplayPatchPrompt(prompt: string) {
  return /\b(ui|gui|hud|button|screen|menu|modal|panel|image|icon|picture|mobile|touch|interface|layout|shop|inventory|sprint|shoot|blaster|weapon|combat|movement|controller)\b/i.test(prompt);
}

export function isSimpleTuningPatchPrompt(prompt: string) {
  const normalized = prompt.toLowerCase().replace(/\s+/g, " ").trim();
  if (!normalized || normalized.length > 160) return false;
  if (/[.;:]/.test(normalized)) return false;
  if (/\b(and|also|then|after|before|with|plus|multiple|system|systems|whole|entire|all|everything|implement|create|build|add|generate|backend|server|remote|datastore|save|inventory|shop|ui|gui|hud|combat|weapon|quest|leaderboard)\b/i.test(normalized)) {
    return false;
  }
  return /\b(make|set|change|increase|decrease|raise|lower|boost|buff|nerf|speed up|slow down|recolor|rename|resize|move)\b/i.test(normalized)
    && /\b(fast|faster|slow|slower|speed|walkspeed|acceleration|turn|handling|jump|health|damage|price|cost|cooldown|gravity|size|color|colour|red|blue|green|yellow|black|white)\b/i.test(normalized);
}

export function isRoutineImplementationPatchPrompt(prompt: string) {
  const normalized = prompt.toLowerCase().replace(/\s+/g, " ").trim();
  if (!normalized || normalized.length > 260) return false;
  // Multi-system / economy work should keep the planning pass.
  if (/\b(shop|inventory|datastore|save|purchase|rebirth|dash|double\s*jump|mobile|controller|custom design|theme|themed|quest|leaderboard|combat|weapon|ability wheel|full ui|whole ui)\b/i.test(normalized)) {
    return false;
  }
  const asksSprintSystem =
    /\bsprint(?:ing)?\b/i.test(normalized)
    && (
      /\b(stamina|energy)\b/i.test(normalized)
      || /\b(ui|gui|hud|bar|meter)\b/i.test(normalized)
      || /\b(server[- ]?validat(?:ed|ion)|anti[- ]?exploit|secure)\b/i.test(normalized)
      || /\bsystem\b/i.test(normalized)
    );
  return asksSprintSystem;
}

export function shouldRunPlanningPass(input: {
  deterministicTemplateEligible: boolean;
  prompt: string;
  model: string;
  simpleOptimized?: boolean;
}) {
  const resolvedModel = resolveAiModel(input.model);
  if (input.deterministicTemplateEligible) return false;
  if (resolvedModel === "deepseek-v4-flash") return false;
  if (isHighSpendDirectModel(input.model)) return false;
  if (isSimpleTuningPatchPrompt(input.prompt)) return false;
  if (isRoutineImplementationPatchPrompt(input.prompt)) return false;
  if (input.simpleOptimized && !isUiOrGameplayPatchPrompt(input.prompt)) return false;
  if (resolvedModel === "gemini-3-flash-preview" && input.prompt.length <= 220 && !/\b(system|architecture|backend|server|remote|datastore|save|inventory|shop|ui|gui|hud|combat|weapon|quest|leaderboard)\b/i.test(input.prompt)) {
    return false;
  }
  return true;
}

export function thinkingLevelLabel(level: string, modelId?: string) {
  if (level === "none" && modelId === "gemini-3.1-pro-preview") return "low thinking minimum";
  if (level === "none" && modelHasTieredThinking(modelId)) return "minimal thinking";
  return `${level} thinking`;
}

export function modelDisplayName(modelId: string) {
  return modelConfigFor(modelId)?.label ?? modelId;
}

export function isHighSpendDirectModel(modelId?: string) {
  return HIGH_SPEND_DIRECT_MODELS.has(resolveAiModel(modelId));
}

export function changeSetRepairAttemptsFor(modelId?: string) {
  void modelId;
  return 1;
}

// Removed unused timeout fallback model helper

export function providerTimeoutMessage(modelId: string, mode: "answer" | "changeset", timeoutMs?: number) {
  if (mode === "answer") {
    return `${modelDisplayName(modelId)} did not return a finished response.`;
  }
  void timeoutMs;
  return `${modelDisplayName(modelId)} did not return a finished patch.`;
}

export function isProviderTimeoutError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return /timed out|did not return|did not finish|pending after|request timed out|aborted|gateway timeout|\b504\b/i.test(message);
}

export function providerTimeoutAssistantText(modelId: string, mode: "answer" | "changeset", timeoutMs?: number) {
  void timeoutMs;
  if (mode === "answer") {
    return [
      `${modelDisplayName(modelId)} did not return a finished response, so Vectis stopped the turn cleanly.`,
      "",
      "Nothing was changed, no Studio patch was queued, and no usage was charged for this attempt.",
      "",
      "Try again, or split the request into a smaller question first."
    ].join("\n");
  }
  return [
    `${modelDisplayName(modelId)} did not return a finished patch, so Vectis stopped the turn cleanly.`,
    "",
    "Nothing was changed, no Studio patch was queued, and no usage was charged for this attempt.",
    "",
    "Try again, or split the work into smaller requests, such as gameplay logic first and UI second."
  ].join("\n");
}

export function isContextQuestion(prompt: string) {
  const normalized = prompt.toLowerCase();
  const asksForChange = /\b(add|build|create|implement|generate|make|fix|update|delete|write|code|script|deploy|upload|publish|release)\b/.test(normalized);
  const asksForContext = /\b(what do you see|what can you see|inspect|current|context|structure|files|overview|explain|status|summari[sz]e|analy[sz]e)\b/.test(normalized);
  return asksForContext && !asksForChange;
}

export function extractMarketplaceQuery(prompt: string): string | undefined {
  const normalized = prompt.toLowerCase().replace(/\s+/g, " ").trim();
  if (!normalized || normalized.length > 200) return undefined;
  
  const match = /\b(?:import|add|find|insert|get|spawn|load|search|need|want)\s+(?:a|an|some|the|polished|styled|custom)?\s*([a-z0-9\s\-]{2,30})\s*(?:from|in)?\s*(?:the)?\s*(?:marketplace|market|store|creator store)?/i.exec(prompt);
  
  if (match && match[1]) {
    const query = match[1].trim();
    const uiKeywords = /\b(?:ui|gui|menu|hud|script|datastore|leaderstats|localscript|modulescript|remote|remotes|variable|button|frame|screen|rebirth|shop|store|coins?|cash|points?|currency|save|leaderboard|saving|anti\s*cheat|anti-exploit|anti-cheat)\b/i;
    if (uiKeywords.test(query)) {
      return undefined;
    }
    return query;
  }
  
  return undefined;
}

export function planOnlyPrompt(prompt: string) {
  return [
    "Plan Mode is enabled.",
    "Read the synced Roblox Studio snapshot and conversation history.",
    "Formulate a structured implementation plan and output it as a JSON object inside a <VECTIS_PLAN> block.",
    "The JSON object must follow this structure exactly:",
    "{",
    '  "goal": "Overall goal of the task",',
    '  "assumptions": ["List of key design/code assumptions"],',
    '  "targetInstances": ["Roblox paths to instances that will be modified/created"],',
    '  "steps": [',
    '    {"id": "step_1", "description": "Step details", "targetFile": "Optional target script path"}',
    '  ],',
    '  "acceptanceCriteria": ["What must be verified to count as successful"],',
    '  "risks": ["Potential risks or side-effects"],',
    '  "estimatedComplexity": "low" | "medium" | "high"',
    "}",
    "",
    "Outside the <VECTIS_PLAN> tag, write a friendly explanation of the plan, outlining the approach and rationale.",
    "Do not include code blocks or full source code inside the explanation or JSON.",
    "",
    `User request: ${prompt}`
  ].join("\n");
}

export function planOnlyText(text: string) {
  const withoutCodeBlocks = text.replace(/```[\s\S]*?```/g, "[Code block omitted in Plan Mode.]").trim();
  return withoutCodeBlocks || [
    "Plan Mode is enabled.",
    "I can inspect the synced project and outline the implementation, but I will not create, edit, or queue files while Plan Mode is on."
  ].join(" ");
}

export function promptDigest(prompt: string) {
  return createHash("sha256").update(prompt).digest("hex");
}

export function activityStep(
  kind: AgentActivityStep["kind"],
  label: string,
  status: AgentActivityStep["status"],
  detail?: string
): AgentActivityStep {
  return { id: `act_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`, kind, label, status, detail };
}

export function buildGenerationActivity(input: {
  snapshotNodes: number;
  scriptCount: number;
  modelUsed?: string;
  thinkingLevel?: string;
  generationDurationMs?: number;
  planningSkipped?: boolean;
  usedPlanner: boolean;
  fileCount: number;
  safetyOk: boolean;
  blockedPatterns: string[];
  luauGuardStatus?: "passed" | "blocked";
  luauGuardDetail?: string;
  verificationMode?: "off" | "standard" | "deep";
}): AgentActivityStep[] {
  const routeStep = input.modelUsed
    ? activityStep("inspect", "Model route selected", "success",
        `${modelDisplayName(input.modelUsed)} with ${thinkingLevelLabel(input.thinkingLevel ?? "none", input.modelUsed)}.`)
    : undefined;

  return [
    activityStep("inspect", "Inspected synced Studio context",
      input.snapshotNodes > 0 ? "success" : "warning",
      `${input.snapshotNodes} nodes, ${input.scriptCount} script${input.scriptCount === 1 ? "" : "s"}.`),
    ...(routeStep ? [routeStep] : []),
    ...(input.usedPlanner
      ? [activityStep("inspect", "Planned implementation", "success", "Mapped existing instances before generating.")]
      : []),
    activityStep(input.fileCount > 0 ? "create" : "validate", "Generated Studio operations",
      input.fileCount > 0 ? "success" : "warning",
      input.fileCount > 0 ? `${input.fileCount} operation${input.fileCount === 1 ? "" : "s"} ready for review.` : "No operations recovered."),
    activityStep("validate", "Patch checks", "success", "Paths, wiring, and Studio compatibility passed."),
    activityStep("validate", "Ready to apply", "warning",
      "Studio plugin will apply and verify on approval.")
  ];
}

export function getCost(
  model: string | undefined,
  mode: "chat" | "changeset",
  usage?: AiUsageAccumulator,
  preferences?: UserPreferences,
  plan?: string,
  billingCycle?: string
) {
  const resolved = resolveAiModel(model ?? defaultAiModel());
  const discount = eventDiscountMultiplier(resolved);
  if (usage && (usage.inputTokens > 0 || usage.outputTokens > 0)) {
    const economics = planCreditEconomics(plan, billingCycle);
    const baseCost = calculateUsageCostCredits(
      resolved,
      Math.max(0, usage.inputTokens),
      Math.max(0, usage.outputTokens),
      economics.creditValueUsd,
      economics.targetMargin,
      Math.max(0, usage.cacheInputTokens ?? 0)
    );
    return Math.max(1, Math.round(baseCost * discount));
  }
  const baseCost = modelFixedCost(resolved, mode);
  const thinkingMultiplier = getThinkingMultiplier(resolved, mode, preferences, plan);
  return Math.max(1, Math.round(baseCost * thinkingMultiplier * discount));
}

export function optimizedModelFor(mode: "explain" | "changeset", optimizationMode?: "disabled" | "balanced" | "cost_saver") {
  if (optimizationMode === "cost_saver" && mode === "explain") return "deepseek-v4-flash";
  if (optimizationMode === "balanced" && mode === "explain") return "qwen3.7-max";
  if (optimizationMode === "balanced" && mode === "changeset") return "gemini-3.5-flash";
  if (optimizationMode === "cost_saver" && mode === "changeset") return "deepseek-v4-flash";
  return undefined;
}

export const PROJECT_CONTEXT_SUMMARY_CACHE_MODEL_ID = "project-context-summary-v2";

function normalizeDigestValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(normalizeDigestValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entryValue]) => [key, normalizeDigestValue(entryValue)])
    );
  }
  if (typeof value === "number" && !Number.isFinite(value)) return String(value);
  return value;
}

export function projectSnapshotContentDigest(snapshot: ProjectSnapshot) {
  const normalizedNodes = snapshot.nodes
    .map((node) => ({
      className: node.className,
      path: node.path,
      properties: normalizeDigestValue(node.properties ?? {}),
      source: node.source ?? ""
    }))
    .sort((left, right) => `${left.path}\0${left.className}`.localeCompare(`${right.path}\0${right.className}`));
  return createHash("sha256").update(JSON.stringify(normalizedNodes)).digest("hex");
}

export function projectSnapshotCacheKey(snapshot: ProjectSnapshot) {
  return `project:${snapshot.projectId}:sha256:${projectSnapshotContentDigest(snapshot)}`;
}

export function buildProjectContextSummary(snapshot?: ProjectSnapshot) {
  const nodes = snapshot?.nodes ?? [];
  if (nodes.length === 0) return undefined;

  const classCounts = new Map<string, number>();
  const rootCounts = new Map<string, number>();
  const serverScriptPaths: string[] = [];
  const clientScriptPaths: string[] = [];
  const moduleScriptPaths: string[] = [];
  const remotePaths: string[] = [];
  const uiPaths: string[] = [];
  const worldPaths: string[] = [];
  let sourceBackedScripts = 0;

  for (const node of nodes) {
    classCounts.set(node.className, (classCounts.get(node.className) ?? 0) + 1);
    const root = node.path.split("/")[0] || node.path;
    rootCounts.set(root, (rootCounts.get(root) ?? 0) + 1);
    if (["Script", "LocalScript", "ModuleScript"].includes(node.className) && node.source?.trim()) sourceBackedScripts += 1;
    if (node.className === "Script") serverScriptPaths.push(node.path);
    if (node.className === "LocalScript") clientScriptPaths.push(node.path);
    if (node.className === "ModuleScript") moduleScriptPaths.push(node.path);
    if (["RemoteEvent", "RemoteFunction"].includes(node.className)) remotePaths.push(node.path);
    if (["ScreenGui", "Frame", "ScrollingFrame", "TextButton", "TextLabel", "ImageButton", "ImageLabel"].includes(node.className)) uiPaths.push(node.path);
    if (["Workspace", "Folder", "Model", "Part", "MeshPart", "SpawnLocation", "Tool"].includes(node.className) && root === "Workspace") worldPaths.push(node.path);
  }

  const topClasses = [...classCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([name, count]) => `${name}:${count}`).join(", ");
  const roots = [...rootCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([name, count]) => `${name}:${count}`).join(", ");
  const list = (items: string[]) => items.sort().slice(0, 12).join(", ") || "none detected";
  const scriptCount = serverScriptPaths.length + clientScriptPaths.length + moduleScriptPaths.length;

  return [
    `Project context: ${nodes.length} synced nodes, ${scriptCount} scripts/modules, ${remotePaths.length} remotes, ${uiPaths.length} UI objects.`,
    `Top services/groups: ${roots}.`,
    `Common classes: ${topClasses}.`,
    `Server scripts: ${list(serverScriptPaths)}.`,
    `Client scripts: ${list(clientScriptPaths)}.`,
    `Module scripts: ${list(moduleScriptPaths)}.`,
    `Remotes: ${list(remotePaths)}.`,
    `UI objects: ${list(uiPaths)}.`,
    `Workspace objects: ${list(worldPaths)}.`,
    `Script source coverage: ${sourceBackedScripts}/${scriptCount} scripts include source text in the synced snapshot.`
  ].join("\n");
}

export function isPremiumModel(modelId?: string) {
  return modelIsPremium(modelId);
}

export async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(message)), timeoutMs);
  });
  return Promise.race([promise, timeout]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}

export async function isTaskSimple(prompt: string, project: Project): Promise<boolean> {
  try {
    const { answerProjectQuestion } = await import("../services/aiProvider.js");
    const verdict = await withTimeout(
      answerProjectQuestion({
        project: project as any,
        snapshot: { id: "empty", projectId: project.id, studioSessionId: "", nodes: [], createdAt: new Date().toISOString() },
        prompt: `TASK: "${prompt}"\nIs this a trivial task (e.g. rename, color change, small logic tweak)? Answer ONLY with YES or NO.`,
        model: "deepseek-v4-flash",
      }),
      12_000,
      "Task simplicity check timed out."
    );
    return verdict.text.toUpperCase().includes("YES");
  } catch {
    return false;
  }
}

export function resolveOptimizationMode(inputMode?: "disabled" | "balanced" | "cost_saver", usageOptimizer?: boolean, preferences?: UserPreferences, plan?: string) {
  if (inputMode) return inputMode;
  if (usageOptimizer) return "balanced";
  return preferences?.optimizationMode ?? "disabled";
}

export function mergeApplyValidationActivity(changeSet: ChangeSet, status: "applied" | "failed", details: string) {
  const existing = changeSet.activity ?? [];
  const withoutOld = existing.filter((step: AgentActivityStep) => step.label !== "Studio validation result");
  changeSet.activity = [
    ...withoutOld,
    activityStep("validate", "Studio validation result", status === "applied" ? "success" : "failed",
      details || (status === "applied" ? "Studio reported the patch was applied." : "Studio reported the patch failed."))
  ];
}
