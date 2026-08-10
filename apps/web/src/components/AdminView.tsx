import { Activity, Ban, Bell, Copy, CreditCard, Database, Download, ExternalLink, Globe2, LockKeyhole, Mail, Minus, Plus, ReceiptText, RefreshCcw, Search, Settings, Shield, ShieldCheck, Trash2, UserCheck, Users, Zap } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { api } from "../api";
import { useVectis } from "../hooks/useVectis";
import type { AdminPaymentOverview, AdminProductInsights, AdminUser, CustomerEvidenceEvent, CustomerEvidenceExport, PlanName, ModelEvaluationRun, ModelEvaluationLeaderboardEntry, ModelEvaluationRunResult, UserPreferences } from "../types";
import { AdminProviderHealth } from "./AdminProviderHealth";
import { Modal } from "./Modal";

const planCapacity: Record<PlanName, number> = {
  free: 50,
  starter: 1000,
  pro: 2500,
  studio: 5000
};

const planMonthlyCapacity: Record<PlanName, number> = {
  free: 200,
  starter: 4000,
  pro: 10000,
  studio: 20000
};

const planLabels: Record<PlanName, string> = {
  free: "Free",
  starter: "Starter",
  pro: "Pro",
  studio: "Studio"
};

const modelEvaluationCost: Record<string, number> = {
  "gemini-3.1-flash-lite": 32,
  "gemini-3-flash": 32,
  "gemini-3-flash-preview": 32,
  "deepseek-v4-flash": 4,
  "deepseek-v4-pro": 38,
  "gemini-3.1-pro-preview": 120,
  "gemini-3.5-flash": 24,
  "qwen3.7-max": 72,
  "gpt-5.5": 72,
  "claude-opus-4-8": 160,
  "kimi-k2.7-code": 40
};

const modelChatCost: Record<string, number> = {
  "gemini-3.1-flash-lite": 8,
  "gemini-3-flash": 8,
  "gemini-3-flash-preview": 8,
  "deepseek-v4-flash": 1,
  "deepseek-v4-pro": 9,
  "gemini-3.1-pro-preview": 30,
  "gemini-3.5-flash": 8,
  "qwen3.7-max": 18,
  "gpt-5.5": 18,
  "claude-opus-4-8": 40,
  "kimi-k2.7-code": 10
};

const providerCreditValueUsd = 0.00125;
const modelCreditMarginMultiplier = 1.6;
const liveEvaluationJudgeEnabled = false;

const PRE_POPULATED_RUNS: ModelEvaluationRun[] = [
  {
    id: "eval_VAS_001",
    promptId: "sprint",
    promptText: "Create a client sprint LocalScript in StarterPlayerScripts that changes the character WalkSpeed to 24 when Shift is pressed, and a server verification Script in ServerScriptService that checks WalkSpeed via player speed monitoring and flags/warns if a speed hack is detected.",
    startedAt: "2026-05-19T22:14:00Z",
    completedAt: "2026-05-19T22:14:28Z",
    runs: [
      {
        modelId: "gemini-3-flash-preview",
        success: true,
        latencyMs: 3200,
        costCredits: 20,
        safetyOk: true,
        blockedPatterns: [],
        syntaxOk: true,
        syntaxErrors: [],
        score: 7,
        reasoning: "Generates a working sprint toggle using ContextActionService and properly separates client/server responsibilities. The server-side speed monitor uses a polling loop that compares HumanoidRootPart velocity magnitude against a threshold, which is a valid approach. However, the detection threshold is set too high at 40 studs/s, meaning moderate speed hacks would pass undetected. The kick logic also fires instantly with no grace period, risking false positives from physics glitches or vehicle dismounts. Code style is clean modern Luau with type annotations."
      },
      {
        modelId: "gemini-3.1-flash-lite",
        success: true,
        latencyMs: 1800,
        costCredits: 8,
        safetyOk: true,
        blockedPatterns: [],
        syntaxOk: false,
        syntaxErrors: ["Line 14: Expected 'then' after condition, got ':'", "Line 28: Attempt to index nil with 'WaitForChild'"],
        score: 4,
        reasoning: "While the code is syntactically close to correct Luau and uses modern patterns, the speed hack detection is completely non-functional because client-side WalkSpeed checks are trivially bypassed. The server script relies on checking Humanoid.WalkSpeed directly from the server, which only reflects the replicated property and not actual movement speed. A proper implementation would track position deltas over time. Additionally there are two syntax errors that would prevent the script from loading at all."
      },
      {
        modelId: "gemini-3.5-flash",
        success: true,
        latencyMs: 4100,
        costCredits: 57,
        safetyOk: true,
        blockedPatterns: [],
        syntaxOk: true,
        syntaxErrors: [],
        score: 9,
        reasoning: "Excellent implementation. The client sprint script uses UserInputService with proper InputBegan/InputEnded handlers for LeftShift, cleanly toggling WalkSpeed between 16 and 24 with no edge cases around character respawn. The server-side anti-exploit tracks position deltas using a heartbeat loop with a sliding window of 3 samples, computes average velocity, and compares against a configurable threshold of 28 studs/s (reasonable for sprint speed + some tolerance). Includes a warning counter that only kicks after 3 consecutive violations, preventing false positives. Uses Luau strict mode and proper type annotations throughout. Only deduction is the lack of a RemoteEvent for the client to inform the server that sprint is active, which would let the server adjust its threshold dynamically."
      },
      {
        modelId: "gemini-3.1-pro-preview",
        success: true,
        latencyMs: 7400,
        costCredits: 76,
        safetyOk: true,
        blockedPatterns: [],
        syntaxOk: true,
        syntaxErrors: [],
        score: 9,
        reasoning: "Top-tier generation. Produces a sprint LocalScript with ContextActionService binding for Shift, a shared sprint state via an Attribute on the character, and a server Script that monitors actual movement velocity using position delta tracking every 0.5 seconds. The anti-exploit includes a configurable grace period, a strike system (3 strikes before kick), logging to a BindableEvent for admin dashboards, and handles edge cases like teleportation, vehicle seats, and ragdoll physics. Code is fully typed Luau with proper error handling. The only minor issue is that the server monitoring interval of 0.5s could miss very short burst hacks, but this is a reasonable tradeoff for performance."
      }
    ]
  },
  {
    id: "eval_8K9_002",
    promptId: "leaderstats",
    promptText: "Create a Roblox script that gives a player +10 Gold when they touch a specific part. The part should be named 'GoldPart' and have a cooldown of 5 seconds to prevent spamming. Persist the leaderstats under the name 'Gold'.",
    startedAt: "2026-05-19T21:30:00Z",
    completedAt: "2026-05-19T21:30:22Z",
    runs: [
      {
        modelId: "gemini-3-flash-preview",
        success: true,
        latencyMs: 2700,
        costCredits: 20,
        safetyOk: true,
        blockedPatterns: [],
        syntaxOk: true,
        syntaxErrors: [],
        score: 7,
        reasoning: "Produces a functional leaderstats setup in a server Script under ServerScriptService. PlayerAdded handler creates a leaderstats folder with a Gold IntValue. The touch handler on GoldPart uses a debounce table keyed by Player.UserId with os.clock() for cooldown tracking. Clean and correct, but does not implement any data persistence via DataStoreService despite the prompt asking to 'persist' the leaderstats. The Gold value only lives in memory and resets on rejoin."
      },
      {
        modelId: "gemini-3.1-flash-lite",
        success: true,
        latencyMs: 1500,
        costCredits: 8,
        safetyOk: true,
        blockedPatterns: [],
        syntaxOk: true,
        syntaxErrors: [],
        score: 5,
        reasoning: "The script creates leaderstats with Gold correctly and handles the touch event with a basic debounce. However, the debounce implementation uses a simple boolean flag per player stored in a table, but never resets the flag after the cooldown period using task.delay or task.wait. This means after the first touch, the player can never collect Gold again for the entire session. Additionally, there is no data persistence despite being explicitly requested. The code is syntactically valid but functionally incomplete."
      },
      {
        modelId: "gemini-3.5-flash",
        success: true,
        latencyMs: 3800,
        costCredits: 57,
        safetyOk: true,
        blockedPatterns: [],
        syntaxOk: true,
        syntaxErrors: [],
        score: 8,
        reasoning: "Strong implementation. Creates leaderstats correctly, implements touch detection with GetPlayerFromCharacter, and uses a per-player cooldown table with tick() comparison. Includes DataStoreService integration with pcall-wrapped GetAsync on PlayerAdded and SetAsync on PlayerRemoving and game:BindToClose. The data store key format is clean (Gold_ .. player.UserId). Minor deduction: the BindToClose handler iterates Players:GetPlayers() but does not wait for all saves to complete before the server shuts down, which could cause data loss on rapid shutdowns. Overall well-structured modern Luau."
      },
      {
        modelId: "gemini-3.1-pro-preview",
        success: true,
        latencyMs: 6900,
        costCredits: 76,
        safetyOk: true,
        blockedPatterns: [],
        syntaxOk: true,
        syntaxErrors: [],
        score: 9,
        reasoning: "Comprehensive solution. Sets up leaderstats with Gold IntValue, loads saved data from DataStoreService with retry logic (up to 3 attempts with exponential backoff), and saves on PlayerRemoving with proper pcall error handling. The touch handler uses a cooldown dictionary with os.clock() and correctly validates that the touching part belongs to a character with a Humanoid (preventing non-player touches from triggering). BindToClose implementation uses coroutines to save all players in parallel and waits for completion. Includes comments explaining each section. The only improvement would be implementing session locking to prevent duplication exploits, but this goes beyond the prompt scope."
      }
    ]
  },
  {
    id: "eval_7AK_003",
    promptId: "leaderstats",
    promptText: "Create a Roblox script that gives a player +10 Gold when they touch a specific part. The part should be named 'GoldPart' and have a cooldown of 5 seconds to prevent spamming. Persist the leaderstats under the name 'Gold'.",
    startedAt: "2026-05-18T15:05:00Z",
    completedAt: "2026-05-18T15:05:19Z",
    runs: [
      {
        modelId: "gemini-3-flash-preview",
        success: true,
        latencyMs: 2900,
        costCredits: 20,
        safetyOk: true,
        blockedPatterns: [],
        syntaxOk: true,
        syntaxErrors: [],
        score: 6,
        reasoning: "Functional but basic. Creates leaderstats and handles touch events with debounce. Missing DataStoreService persistence entirely. The cooldown uses wait(5) inside the touch handler which blocks the thread per player, a suboptimal pattern compared to timestamp-based debounce. No error handling around player character access."
      },
      {
        modelId: "gemini-3.1-flash-lite",
        success: true,
        latencyMs: 1400,
        costCredits: 8,
        safetyOk: true,
        blockedPatterns: [],
        syntaxOk: false,
        syntaxErrors: ["Line 22: Expected identifier when parsing expression, got ')'"],
        score: 3,
        reasoning: "Fast generation but low quality. The leaderstats creation is correct, but the touch handler has a parenthesis mismatch that prevents compilation. Even ignoring the syntax error, the debounce logic is flawed: it uses a single global boolean rather than per-player tracking, meaning all players share one cooldown. No persistence implemented."
      }
    ]
  },
  {
    id: "eval_XC6_004",
    promptId: "sprint",
    promptText: "Create a client sprint LocalScript in StarterPlayerScripts that changes the character WalkSpeed to 24 when Shift is pressed, and a server verification Script in ServerScriptService that checks WalkSpeed via player speed monitoring and flags/warns if a speed hack is detected.",
    startedAt: "2026-05-17T10:22:00Z",
    completedAt: "2026-05-17T10:22:31Z",
    runs: [
      {
        modelId: "gemini-3-flash-preview",
        success: true,
        latencyMs: 3100,
        costCredits: 20,
        safetyOk: true,
        blockedPatterns: [],
        syntaxOk: true,
        syntaxErrors: [],
        score: 6,
        reasoning: "Basic sprint implementation works but the anti-exploit is weak. Client side correctly toggles WalkSpeed on Shift input. Server side checks Humanoid.WalkSpeed property directly rather than tracking actual movement, which is easily spoofed. No warning system or strike counter before punishment."
      },
      {
        modelId: "gemini-3.1-flash-lite",
        success: true,
        latencyMs: 1600,
        costCredits: 8,
        safetyOk: true,
        blockedPatterns: [],
        syntaxOk: true,
        syntaxErrors: [],
        score: 4,
        reasoning: "Minimal implementation. Sprint toggle works but uses deprecated KeyDown/KeyUp events instead of UserInputService or ContextActionService. Server anti-exploit simply reads WalkSpeed in a while loop with wait(1), providing no real protection. No type annotations or modern Luau conventions used."
      }
    ]
  }
];

function usageLeftPercent(user: AdminUser) {
  const capacity = planCapacity[user.plan] ?? planCapacity.free;
  const weeklyRemaining = user.usage?.weekly.remaining ?? Math.min(user.credits, capacity);
  return Math.min(100, Math.max(0, Math.round((weeklyRemaining / capacity) * 100)));
}

function money(cents?: number | null, currency = "usd") {
  if (typeof cents !== "number") return "n/a";
  return `$${(cents / 100).toFixed(2).replace(/\.00$/, "")}`;
}

function shortDate(value?: string) {
  if (!value) return "n/a";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "n/a";
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

function resolveModelId(modelId: string) {
  const id = modelId.replace(/-(yunwu|google)$/, "");
  return id === "gemini-3-flash" ? "gemini-3-flash-preview" : id;
}

function binaryThinkingLevel(level: "none" | "low" | "medium" | "high" | undefined, fallback: "none" | "high") {
  if (!level) return fallback;
  return level === "none" ? "none" : "high";
}

function deepSeekThinkingLevel(level: "none" | "high" | "max" | undefined, fallback: "none" | "high") {
  if (!level) return fallback;
  if (level === "none" || level === "high" || level === "max") return level;
  return fallback;
}

function isBinaryThinkingModel(modelId: string) {
  const resolved = resolveModelId(modelId);
  return resolved === "qwen3.7-max";
}

function isAlwaysThinkingModel(modelId: string) {
  return resolveModelId(modelId) === "kimi-k2.7-code";
}

function thinkingLevelFor(modelId: string, preferences?: UserPreferences): "none" | "low" | "medium" | "high" | "xhigh" | "max" {
  const resolved = resolveModelId(modelId);
  if (resolved === "gemini-3.5-flash") return preferences?.thinkingGemini35Flash ?? "medium";
  if (resolved === "gemini-3-flash-preview") return preferences?.thinkingGemini3Flash ?? "high";
  if (resolved === "gemini-3.1-pro-preview") return preferences?.thinkingGemini31Pro ?? "high";
  if (resolved === "gemini-3.1-flash-lite") return preferences?.thinkingGemini31FlashLite ?? "none";
  if (resolved === "deepseek-v4-flash") return deepSeekThinkingLevel(preferences?.thinkingDeepSeekV4Flash, "high");
  if (resolved === "deepseek-v4-pro") return deepSeekThinkingLevel(preferences?.thinkingDeepSeekV4Pro, "none");
  if (resolved === "gpt-5.5") return preferences?.thinkingGpt55 ?? "medium";
  if (resolved === "qwen3.7-max") return preferences?.thinkingQwen ?? "high";
  if (resolved === "claude-opus-4-8") return preferences?.thinkingOpus ?? "high";
  if (resolved === "kimi-k2.7-code") return "high";
  return "none";
}

function thinkingMultiplierFor(modelId: string, preferences?: UserPreferences) {
  const level = thinkingLevelFor(modelId, preferences);
  const resolved = resolveModelId(modelId);
  if (resolved === "deepseek-v4-flash" || resolved === "deepseek-v4-pro") {
    if (level === "none") return 1;
    if (level === "high") return 1.5;
    if (level === "max") return 2;
  }
  if (isAlwaysThinkingModel(modelId)) return 1;
  if (isBinaryThinkingModel(modelId)) return level === "none" ? 1 : 1.5;
  if (level === "low") return 1.2;
  if (level === "medium") return 1.5;
  if (level === "high") return 2;
  if (level === "xhigh") return 2.5;
  if (level === "max") return 3;
  return 1;
}

function thinkingLevelLabelFor(modelId: string, level: string) {
  const resolved = resolveModelId(modelId);
  if (resolved === "deepseek-v4-flash" || resolved === "deepseek-v4-pro") {
    if (level === "none") return "Off";
    if (level === "high") return "High";
    if (level === "max") return "Max";
    return level;
  }
  if (isAlwaysThinkingModel(modelId)) {
    return "Always on";
  }
  if (isBinaryThinkingModel(modelId)) {
    return level === "none" ? "Off" : "Thinking";
  }
  if (level === "none") return resolved === "gemini-3.1-pro-preview" ? "Low minimum" : "Minimal";
  if (level === "xhigh") return "Extra High";
  return level.charAt(0).toUpperCase() + level.slice(1);
}

function estimateFixedCost(modelId: string, mode: "chat" | "changeset", preferences?: UserPreferences) {
  const resolved = resolveModelId(modelId);
  const baseCost = mode === "chat"
    ? (modelChatCost[resolved] ?? 5)
    : (modelEvaluationCost[resolved] ?? 20);
  return Math.ceil(baseCost * thinkingMultiplierFor(resolved, preferences));
}

function estimateJudgeCost(preferences?: UserPreferences) {
  return estimateFixedCost("gemini-3.5-flash", "chat", {
    ...(preferences ?? {}),
    thinkingGemini35Flash: "high"
  }) * 2;
}

function estimateProviderCostUsd(credits: number) {
  return (credits * providerCreditValueUsd) / modelCreditMarginMultiplier;
}

export function AdminView() {
  const { data, fetchEvaluations, runEvaluation, deleteEvaluation, clearEvaluations, authConfig } = useVectis();
  const [adminUsers, setAdminUsers] = useState<AdminUser[]>([]);
  const [adminUsersTotal, setAdminUsersTotal] = useState(0);
  const [adminUsersCursor, setAdminUsersCursor] = useState<string | undefined>();
  const [selectedUser, setSelectedUser] = useState<AdminUser | null>(null);
  const [modalType, setModalType] = useState<"credits" | "plan" | "status" | "reset" | "notify" | "evidence" | null>(null);
  const [creditAmount, setCreditAmount] = useState(100);
  const [creditReason, setCreditReason] = useState("Admin balance grant");
  const [selectedPlan, setSelectedPlan] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [paymentOverview, setPaymentOverview] = useState<AdminPaymentOverview | null>(null);
  const [paymentError, setPaymentError] = useState("");
  const [paymentsLoading, setPaymentsLoading] = useState(false);
  const [evidenceDetail, setEvidenceDetail] = useState<CustomerEvidenceExport | null>(null);
  const [evidenceLoading, setEvidenceLoading] = useState(false);
  const [clientErrors, setClientErrors] = useState<CustomerEvidenceEvent[]>([]);
  const [insights, setInsights] = useState<AdminProductInsights | null>(null);
  const [insightsLoading, setInsightsLoading] = useState(false);
  const [insightsError, setInsightsError] = useState("");
  const [subscribers, setSubscribers] = useState<Array<{ id: string; email: string; subscribedAt: string; ip?: string }>>([]);
  const [subscribersLoading, setSubscribersLoading] = useState(false);

  // Search & Filter States
  const [searchQuery, setSearchQuery] = useState("");
  const [planFilter, setPlanFilter] = useState<string>("all");
  const [statusFilter, setStatusFilter] = useState<string>("all");

  const [activeTab, setActiveTab] = useState<"users" | "insights" | "evaluations" | "payments" | "provider-health" | "subscribers">("users");
  const [evaluations, setEvaluations] = useState<ModelEvaluationRun[]>([]);
  const [evaluationLeaderboard, setEvaluationLeaderboard] = useState<ModelEvaluationLeaderboardEntry[]>([]);
  const [scenarios, setScenarios] = useState<any[]>([]);
  const [selectedScenarioId, setSelectedScenarioId] = useState<string>("leaderstats");
  const [customPrompt, setCustomPrompt] = useState<string>("");
  const [isScenarioDropdownOpen, setIsScenarioDropdownOpen] = useState(false);

  const AVAILABLE_MODELS = useMemo(() => {
    const baseModels = !authConfig?.models
      ? [
          { id: "gemini-3.1-flash-lite", name: "Gemini 3.1 Flash Lite", desc: "" },
          { id: "gemini-3.5-flash", name: "Gemini 3.5 Flash", desc: "" },
          { id: "gemini-3.1-pro-preview", name: "Gemini 3.1 Pro", desc: "" }
        ]
      : authConfig.models.map(m => ({
          id: m.id,
          name: m.label,
          desc: m.description
        }));

    return [
      ...baseModels,
      { id: "gemini-3.5-flash-google", name: "Gemini 3.5 Flash (Google)", desc: "Direct Google Vertex AI route" },
      { id: "gemini-3.5-flash-yunwu", name: "Gemini 3.5 Flash (Yunwu)", desc: "Yunwu API proxy route" },
      { id: "gemini-3.1-pro-preview-google", name: "Gemini 3.1 Pro (Google)", desc: "Direct Google Vertex AI route" },
      { id: "gemini-3.1-pro-preview-yunwu", name: "Gemini 3.1 Pro (Yunwu)", desc: "Yunwu API proxy route" }
    ];
  }, [authConfig?.models]);

  const [selectedModels, setSelectedModels] = useState<string[]>([]);

  useEffect(() => {
    if (AVAILABLE_MODELS.length > 0 && selectedModels.length === 0) {
      // Only pre-select models that are not locked or coming soon
      const unlocked = AVAILABLE_MODELS.filter(m => {
        const modelMeta = authConfig?.models?.find(am => am.id === m.id)
          || authConfig?.models?.find(am => am.id === resolveModelId(m.id));
        if (!modelMeta) return true;
        if (modelMeta.status === "soon") return false;
        const userPlan = data?.organization?.plan;
        const canUsePremium = userPlan === "pro" || userPlan === "studio";
        if (modelMeta.tier === "premium" && !canUsePremium) return false;
        return true;
      });
      setSelectedModels(unlocked.map(m => m.id));
    }
  }, [AVAILABLE_MODELS]);

  const getModelName = (id: string) => {
    const resolved = resolveModelId(id);
    const found = AVAILABLE_MODELS.find(m => m.id === resolved);
    const name = found ? found.name : id;
    if (id.endsWith("-google")) return `${name} (Google)`;
    if (id.endsWith("-yunwu")) return `${name} (Yunwu)`;
    return name;
  };

  const getModelShortName = (id: string) => {
    const resolved = resolveModelId(id);
    const suffix = id.endsWith("-google") ? " (Google)" : id.endsWith("-yunwu") ? " (Yunwu)" : "";
    switch (resolved) {
      case "gemini-3-flash-preview": return "Flash 3" + suffix;
      case "gemini-3.1-flash-lite": return "Lite 3.1" + suffix;
      case "gemini-3.5-flash": return "Flash 3.5" + suffix;
      case "qwen3.7-max": return "Qwen 3.7" + suffix;
      case "gpt-5.5": return "GPT-5.5" + suffix;
      case "gemini-3.1-pro-preview": return "Pro 3.1" + suffix;
      case "deepseek-v4-flash": return "DeepSeek Flash" + suffix;
      case "deepseek-v4-pro": return "DeepSeek Pro" + suffix;
      default: {
        const found = AVAILABLE_MODELS.find(m => m.id === resolved);
        if (found) return found.name.replace("Gemini ", "") + suffix;
        return id;
      }
    }
  };

  const [isEvalRunning, setIsEvalRunning] = useState(false);
  const [evalError, setEvalError] = useState("");
  const [evalSuccessMessage, setEvalSuccessMessage] = useState("");
  const [showWarningModal, setShowWarningModal] = useState(false);
  const [expandedCardId, setExpandedCardId] = useState<string | null>(null);
  const [liveStep, setLiveStep] = useState<string>("");
  const [liveRunMetrics, setLiveRunMetrics] = useState<any[]>([]);
  const [modelHealth, setModelHealth] = useState<Array<{ modelId: string; usedModelId?: string; ok: boolean; latencyMs: number; thinkingLevel: string; thinkingMultiplier: number; text?: string; error?: string }>>([]);
  const [modelHealthLoading, setModelHealthLoading] = useState(false);
  const [evaluationConfirm, setEvaluationConfirm] = useState<{ type: "delete" | "clear"; runId?: string } | null>(null);
  const [evaluationMutationBusy, setEvaluationMutationBusy] = useState(false);

  const refreshEvaluations = async () => {
    try {
      const res = await fetchEvaluations();
      const dbRuns: ModelEvaluationRun[] = res.runs || [];
      const merged = dbRuns.sort((a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime());
      setEvaluations(merged);
      setEvaluationLeaderboard(res.leaderboard || []);
      if (res.scenarios && res.scenarios.length > 0) {
        setScenarios(res.scenarios);
      } else {
        setScenarios([
          {
            id: "leaderstats",
            name: "Leaderstats and Touch Reward",
            promptText: "Create a Roblox script that gives a player +10 Gold when they touch a specific part. The part should be named 'GoldPart' and have a cooldown of 5 seconds to prevent spamming. Persist the leaderstats under the name 'Gold'.",
            estimatedCostCredits: 30
          },
          {
            id: "sprint",
            name: "Client Sprint & Server Anti-Exploit",
            promptText: "Create a client sprint LocalScript in StarterPlayerScripts that changes the character WalkSpeed to 24 when Shift is pressed, and a server verification Script in ServerScriptService that checks WalkSpeed via player speed monitoring and flags/warns if a speed hack is detected.",
            estimatedCostCredits: 30
          },
          {
            id: "shop",
            name: "GUI Shop & Remote Wiring",
            promptText: "Create a basic GUI Shop system. Under StarterGui, create a ScreenGui named 'ShopGui' with a shop panel Frame, a TextButton to open/close the shop, and a purchase TextButton for an item 'SpeedPotion' that costs 50 Gold. Include a RemoteEvent named 'ShopPurchase' in ReplicatedStorage, and a server Script to handle the purchase, deducting Gold from leaderstats.",
            estimatedCostCredits: 40
          }
        ]);
      }
    } catch (err) {
      console.error("Failed to fetch evaluations", err);
    }
  };

  const handleDeleteEvaluation = async (runId: string) => {
    setEvaluationConfirm({ type: "delete", runId });
  };

  const confirmEvaluationMutation = async () => {
    if (!evaluationConfirm) return;
    setEvaluationMutationBusy(true);
    setEvalError("");
    try {
      if (evaluationConfirm.type === "delete" && evaluationConfirm.runId) {
        await deleteEvaluation(evaluationConfirm.runId);
        if (expandedCardId === evaluationConfirm.runId) setExpandedCardId(null);
        await refreshEvaluations();
        setEvalSuccessMessage("Evaluation entry deleted.");
      } else if (evaluationConfirm.type === "clear") {
        await clearEvaluations();
        setExpandedCardId(null);
        await refreshEvaluations();
        setEvalSuccessMessage("Backend evaluation history cleared.");
      }
      setEvaluationConfirm(null);
    } catch (error) {
      setEvalError(error instanceof Error ? error.message : "Could not update evaluation history.");
    } finally {
      setEvaluationMutationBusy(false);
    }
  };

  const handleClearEvaluations = async () => {
    setEvaluationConfirm({ type: "clear" });
  };

  const checkModelHealth = async () => {
    try {
      setModelHealthLoading(true);
      setEvalError("");
      const res = await api.adminModelHealth();
      setModelHealth(res.results || []);
    } catch (error) {
      setEvalError(error instanceof Error ? error.message : "Could not check model health.");
    } finally {
      setModelHealthLoading(false);
    }
  };

  useEffect(() => {
    if (data?.isAdmin) {
      refreshEvaluations().catch(() => {});
    }
  }, [data?.isAdmin]);

  const evaluationScenarioCount = Math.max(1, scenarios.length || 3);
  const adminPreferences = data?.user.preferences;
  const judgeCostPerModelRun = liveEvaluationJudgeEnabled ? estimateJudgeCost(adminPreferences) : 0;

  const getModelEvaluationCostBreakdown = (modelId: string) => {
    const generationCostCredits = estimateFixedCost(modelId, "changeset", adminPreferences);
    const totalCostCredits = generationCostCredits + judgeCostPerModelRun;
    return {
      thinkingLevel: thinkingLevelFor(modelId, adminPreferences),
      thinkingMultiplier: thinkingMultiplierFor(modelId, adminPreferences),
      generationCostCredits,
      judgeCostCredits: judgeCostPerModelRun,
      totalCostCredits,
      allPromptCostCredits: totalCostCredits * evaluationScenarioCount
    };
  };

  const getEstimatedCost = () => {
    return selectedModels.reduce((total, modelId) => total + getModelEvaluationCostBreakdown(modelId).allPromptCostCredits, 0);
  };

  const estimatedProviderUsd = estimateProviderCostUsd(getEstimatedCost());
  const selectedModelRunCount = selectedModels.length * evaluationScenarioCount;
  const formatRate = (value: number) => `${Math.round(value * 100)}%`;

  const renderRequirementChecks = (result: ModelEvaluationRunResult) => {
    if (!result.requirementChecks || result.requirementChecks.length === 0) return null;
    return (
      <details style={{ marginTop: "10px", borderTop: "1px solid var(--border-color)", paddingTop: "8px" }}>
        <summary style={{ cursor: "pointer", fontSize: "12px", fontWeight: 700, color: "var(--text-bright)" }}>
          Requirement checks ({result.requirementChecks.filter(check => check.ok).length}/{result.requirementChecks.length})
        </summary>
        <div style={{ display: "flex", flexWrap: "wrap", gap: "6px", marginTop: "8px" }}>
          {result.requirementChecks.map((check) => (
            <span
              key={check.label}
              title={check.detail}
              style={{
                fontSize: "10px",
                fontWeight: 700,
                padding: "2px 6px",
                borderRadius: "4px",
                color: check.ok ? "#2e7d32" : "#c62828",
                background: check.ok ? "rgba(46, 125, 50, 0.08)" : "rgba(198, 40, 40, 0.08)"
              }}
            >
              {check.ok ? "OK" : "Missing"}: {check.label}
            </span>
          ))}
        </div>
      </details>
    );
  };

  const renderGeneratedOutput = (result: ModelEvaluationRunResult) => {
    if (!result.generatedFiles || result.generatedFiles.length === 0) return null;
    return (
      <details style={{ marginTop: "10px", borderTop: "1px solid var(--border-color)", paddingTop: "8px" }}>
        <summary style={{ cursor: "pointer", fontSize: "12px", fontWeight: 700, color: "var(--text-bright)" }}>
          Actual output ({result.generatedFiles.length} files){result.outputTruncated ? " - truncated" : ""}
        </summary>
        <div style={{ display: "flex", flexDirection: "column", gap: "8px", marginTop: "8px" }}>
          {(result.generatedTitle || result.generatedSummary) && (
            <div style={{ fontSize: "12px", color: "var(--text-muted)", lineHeight: 1.45 }}>
              {result.generatedTitle && <strong style={{ color: "var(--text-bright)" }}>{result.generatedTitle}</strong>}
              {result.generatedSummary && <p style={{ margin: "4px 0 0" }}>{result.generatedSummary}</p>}
            </div>
          )}
          {result.generatedFiles.map((file) => (
            <div key={file.id || file.instancePath} style={{ border: "1px solid var(--border-color)", borderRadius: "6px", overflow: "hidden", background: "rgba(94, 75, 50, 0.025)" }}>
              <div style={{ padding: "7px 9px", fontSize: "11px", display: "flex", justifyContent: "space-between", gap: "8px", color: "var(--text-muted)", borderBottom: "1px solid var(--border-color)" }}>
                <strong style={{ color: "var(--text-bright)" }}>{file.className}</strong>
                <span style={{ textAlign: "right", overflowWrap: "anywhere" }}>{file.action} - {file.instancePath}</span>
              </div>
              {file.source ? (
                <pre style={{ margin: 0, padding: "9px", maxHeight: "260px", overflow: "auto", fontSize: "11px", lineHeight: 1.45, whiteSpace: "pre-wrap", color: "var(--text-muted)", fontFamily: 'monospace', border: '1px solid var(--border-color)' }}>
                  {file.source.split("\n").map((line: string, idx: number) => {
                    const isAdded = line.startsWith("+");
                    const isRemoved = line.startsWith("-");
                    return (
                      <div
                        key={idx}
                        style={{
                          backgroundColor: isAdded ? "rgba(46, 189, 79, 0.08)" : isRemoved ? "rgba(235, 87, 87, 0.08)" : "transparent",
                          color: isAdded ? "#2ebd4f" : isRemoved ? "#df3d3d" : "var(--text-secondary)",
                          paddingLeft: "8px",
                          borderLeft: isAdded ? "3px solid #2ebd4f" : isRemoved ? "3px solid #df3d3d" : "3px solid transparent",
                          display: "block"
                        }}
                      >
                        {line}
                      </div>
                    );
                  })}
                </pre>
              ) : (
                <pre style={{ margin: 0, padding: "9px", maxHeight: "180px", overflow: "auto", fontSize: "11px", lineHeight: 1.45, whiteSpace: "pre-wrap", color: "var(--text-muted)" }}>{JSON.stringify(file.properties ?? {}, null, 2)}</pre>
              )}
            </div>
          ))}
        </div>
      </details>
    );
  };

  const refreshUsers = async (mode: "reset" | "more" = "reset") => {
    try {
      setIsLoading(true);
      setLoadError("");
      const res = await api.adminUsers({ cursor: mode === "more" ? adminUsersCursor : undefined, limit: 50 });
      setAdminUsers((current) => {
        if (mode === "reset") return res.users;
        const byId = new Map(current.map((user) => [user.id, user]));
        for (const user of res.users) byId.set(user.id, user);
        return [...byId.values()];
      });
      setAdminUsersTotal(res.total);
      setAdminUsersCursor(res.nextCursor);
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : "Could not load admin users");
    } finally {
      setIsLoading(false);
    }
  };

  const refreshClientErrors = async () => {
    try {
      const res = await api.adminClientErrors();
      setClientErrors(res.events || []);
    } catch (error) {
      console.error("Failed to fetch client errors", error);
    }
  };

  const refreshInsights = async () => {
    try {
      setInsightsLoading(true);
      setInsightsError("");
      setInsights(await api.adminInsights());
    } catch (error) {
      setInsightsError(error instanceof Error ? error.message : "Could not load product insights");
    } finally {
      setInsightsLoading(false);
    }
  };

  const refreshPayments = async () => {
    try {
      setPaymentsLoading(true);
      setPaymentError("");
      const res = await api.adminPayments();
      setPaymentOverview(res);
    } catch (error) {
      setPaymentError(error instanceof Error ? error.message : "Could not load payment overview");
    } finally {
      setPaymentsLoading(false);
    }
  };

  useEffect(() => {
    if (data?.isAdmin) {
      refreshUsers().catch(() => {});
      refreshClientErrors().catch(() => {});
      refreshInsights().catch(() => {});
    }
  }, [data?.isAdmin]);

  useEffect(() => {
    if (data?.isAdmin && activeTab === "payments" && !paymentOverview) {
      refreshPayments().catch(() => {});
    }
  }, [data?.isAdmin, activeTab, paymentOverview]);

  const filteredUsers = useMemo(() => {
    return adminUsers.filter((user) => {
      const matchesSearch =
        !searchQuery ||
        (user.name || "Unnamed creator").toLowerCase().includes(searchQuery.toLowerCase()) ||
        (user.email && user.email.toLowerCase().includes(searchQuery.toLowerCase())) ||
        user.id.toLowerCase().includes(searchQuery.toLowerCase());
      
      const matchesPlan = planFilter === "all" || user.plan === planFilter;
      
      const userStatus = user.status === "banned" ? "banned" : "active";
      const matchesStatus = statusFilter === "all" || userStatus === statusFilter;
      
      return matchesSearch && matchesPlan && matchesStatus;
    });
  }, [adminUsers, searchQuery, planFilter, statusFilter]);

  const adminStats = useMemo(() => {
    const active = adminUsers.filter((user) => user.status !== "banned").length;
    const paid = adminUsers.filter((user) => user.plan !== "free").length;
    const banned = adminUsers.filter((user) => user.status === "banned").length;
    const authOnly = adminUsers.filter((user) => user.authOnly).length;
    return { active, paid, banned, authOnly };
  }, [adminUsers]);

  if (!data?.isAdmin) {
    return <div className="page-container">Access Denied</div>;
  }

  const handleCreditGrant = async () => {
    if (!selectedUser) return;
    setIsSubmitting(true);
    try {
      await api.adminGiveCredits(selectedUser.id, creditAmount, creditReason || "Admin balance grant");
      await refreshUsers();
      setModalType(null);
    } catch (e) {
      alert(e instanceof Error ? e.message : "Failed");
    } finally {
      setIsSubmitting(false);
    }
  };

  const openEvidence = async (user: AdminUser) => {
    setSelectedUser(user);
    setModalType("evidence");
    setEvidenceDetail(null);
    setEvidenceLoading(true);
    try {
      const evidence = await api.adminEvidence(user.id);
      setEvidenceDetail(evidence);
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : "Could not load customer evidence");
    } finally {
      setEvidenceLoading(false);
    }
  };

  const handlePlanUpdate = async (plan: string) => {
    if (!selectedUser) return;
    setIsSubmitting(true);
    try {
      await api.adminUpdatePlan(selectedUser.id, plan);
      await refreshUsers();
      setModalType(null);
    } catch (e) {
      alert(e instanceof Error ? e.message : "Failed");
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleResetUsage = async () => {
    if (!selectedUser) return;
    setIsSubmitting(true);
    try {
      await api.adminResetUsage(selectedUser.id);
      await refreshUsers();
      setModalType(null);
    } catch (e) {
      alert(e instanceof Error ? e.message : "Failed");
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleStatusToggle = async () => {
    if (!selectedUser) return;
    setIsSubmitting(true);
    const nextStatus = selectedUser.status === "banned" ? "active" : "banned";
    try {
      await api.adminUpdateStatus(selectedUser.id, nextStatus);
      await refreshUsers();
      setModalType(null);
    } catch (e) {
      alert(e instanceof Error ? e.message : "Failed");
    } finally {
      setIsSubmitting(false);
    }
  };

  const checkoutPaymentConfig = paymentOverview?.paymentMethodConfigurations?.find((configuration) => configuration.usedByCheckout)
    ?? paymentOverview?.paymentMethodConfigurations?.find((configuration) => !configuration.application)
    ?? paymentOverview?.paymentMethodConfigurations?.[0];
  const activePaymentMethods = checkoutPaymentConfig?.counts.active ?? 0;
  const requestedPaymentMethods = checkoutPaymentConfig?.counts.requested ?? 0;
  const stripeDashboardBase = "https://dashboard.stripe.com";

  return (
    <div className="page-container admin-page">
      <section className="admin-hero-panel">
        <div>
          <div className="profile-kicker"><Shield size={14} /> Admin Console</div>
          <h1>Workspace Admin</h1>
          <p>Manage users, plans, account status, and individual usage from one quieter operational surface.</p>
        </div>
        <div className="settings-lock-pill"><Zap size={14} /> Operational</div>
      </section>

      <section className="profile-metric-grid">
        <div className="profile-metric-card"><Users size={18} /><span>Total Users</span><strong>{adminUsersTotal}</strong></div>
        <div className="profile-metric-card"><UserCheck size={18} /><span>Loaded Active</span><strong>{adminStats.active}</strong></div>
        <div className="profile-metric-card"><Settings size={18} /><span>Loaded Paid</span><strong>{adminStats.paid}</strong></div>
        <div className="profile-metric-card"><Ban size={18} /><span>Loaded Restricted</span><strong>{adminStats.banned}</strong></div>
        <div className="profile-metric-card"><LockKeyhole size={18} /><span>Loaded Auth Only</span><strong>{adminStats.authOnly}</strong></div>
      </section>

      {/* Tab Switcher */}
      <div className="admin-tabs" role="tablist" aria-label="Admin sections">
        <button
          className={`tab-btn ${activeTab === "users" ? "active" : ""}`}
          role="tab"
          aria-selected={activeTab === "users"}
          onClick={() => setActiveTab("users")}
        >
          <Users size={16} />
          User Management
        </button>
        <button
          className={`tab-btn ${activeTab === "insights" ? "active" : ""}`}
          role="tab"
          aria-selected={activeTab === "insights"}
          onClick={() => setActiveTab("insights")}
        >
          <Activity size={16} />
          Insights
        </button>
        <button
          className={`tab-btn ${activeTab === "evaluations" ? "active" : ""}`}
          role="tab"
          aria-selected={activeTab === "evaluations"}
          onClick={() => setActiveTab("evaluations")}
        >
          <Zap size={16} />
          Model Evaluations
        </button>
        <button
          className={`tab-btn ${activeTab === "payments" ? "active" : ""}`}
          role="tab"
          aria-selected={activeTab === "payments"}
          onClick={() => setActiveTab("payments")}
        >
          <CreditCard size={16} />
          Payments
        </button>
        <button
          className={`tab-btn ${activeTab === "provider-health" ? "active" : ""}`}
          role="tab"
          aria-selected={activeTab === "provider-health"}
          onClick={() => setActiveTab("provider-health")}
        >
          <Globe2 size={16} />
          Provider Health
        </button>
        <button
          className={`tab-btn ${activeTab === "subscribers" ? "active" : ""}`}
          role="tab"
          aria-selected={activeTab === "subscribers"}
          onClick={() => {
            setActiveTab("subscribers");
            if (subscribers.length === 0 && !subscribersLoading) {
              setSubscribersLoading(true);
              api.adminSubscribers()
                .then(res => setSubscribers(res.subscribers))
                .catch(() => {})
                .finally(() => setSubscribersLoading(false));
            }
          }}
        >
          <Mail size={16} />
          Subscribers
        </button>
      </div>

      <style>{`
        @keyframes pulse {
          0% { opacity: 0.6; }
          50% { opacity: 1; }
          100% { opacity: 0.6; }
        }
        .admin-table tbody tr {
          transition: background-color 0.2s ease;
        }
        .admin-table tbody tr:hover {
          background-color: rgba(94, 75, 50, 0.02) !important;
        }
        .btn-action-card {
          transition: background-color 0.2s, border-color 0.2s, color 0.2s;
        }
        .btn-action-card:hover {
          background-color: rgba(94, 75, 50, 0.1) !important;
          border-color: var(--accent) !important;
          color: var(--accent) !important;
        }
        .btn-action-card.danger:hover {
          background-color: color-mix(in srgb, var(--danger) 10%, var(--bg-card)) !important;
          border-color: var(--danger) !important;
          color: var(--danger) !important;
        }
        .custom-avatar {
          background: linear-gradient(135deg, var(--accent-warm-soft), color-mix(in srgb, var(--accent) 72%, var(--bg-card))) !important;
          color: var(--text-primary) !important;
          font-weight: 700 !important;
          box-shadow: 0 2px 4px rgba(91, 67, 33, 0.14);
        }
        .premium-plan-badge {
          display: inline-flex;
          align-items: center;
          padding: 4px 8px;
          border-radius: 4px;
          font-size: 11px;
          font-weight: 700;
          text-transform: uppercase;
          letter-spacing: 0.05em;
        }
        .premium-plan-badge.free {
          background: color-mix(in srgb, var(--bg-hover) 55%, var(--bg-card));
          border: 1px solid var(--border-default);
          color: var(--text-muted);
        }
        .premium-plan-badge.starter {
          background: color-mix(in srgb, var(--accent-warm-soft) 64%, var(--bg-card));
          border: 1px solid color-mix(in srgb, var(--accent) 24%, var(--border-default));
          color: var(--accent-hover);
        }
        .premium-plan-badge.pro {
          background: color-mix(in srgb, var(--accent-warm-soft) 70%, var(--bg-card));
          border: 1px solid color-mix(in srgb, var(--accent) 30%, var(--border-default));
          color: var(--accent-hover);
        }
        .premium-plan-badge.studio {
          background: color-mix(in srgb, var(--accent-warm-soft) 82%, var(--bg-card));
          border: 1px solid color-mix(in srgb, var(--accent) 38%, var(--border-default));
          color: var(--accent-hover);
          text-shadow: none;
        }
        .premium-status-badge {
          display: inline-flex;
          align-items: center;
          padding: 4px 8px;
          border-radius: 4px;
          font-size: 11px;
          font-weight: 700;
          text-transform: uppercase;
        }
        .premium-status-badge.active {
          background: color-mix(in srgb, var(--success) 12%, var(--bg-card));
          border: 1px solid color-mix(in srgb, var(--success) 30%, var(--border-default));
          color: var(--success);
        }
        .premium-status-badge.banned {
          background: color-mix(in srgb, var(--danger) 10%, var(--bg-card));
          border: 1px solid color-mix(in srgb, var(--danger) 30%, var(--border-default));
          color: var(--danger);
        }
        .premium-status-badge.auth-only {
          background: color-mix(in srgb, var(--accent-warm-soft) 42%, var(--bg-card));
          border: 1px solid color-mix(in srgb, var(--accent) 22%, var(--border-default));
          color: var(--accent-hover);
        }
        .payment-grid {
          display: grid;
          grid-template-columns: repeat(4, minmax(0, 1fr));
          gap: 14px;
        }
        .payment-card {
          border: 1px solid var(--border-default);
          background: var(--bg-card);
          border-radius: 12px;
          padding: 16px;
          display: flex;
          flex-direction: column;
          gap: 8px;
          min-width: 0;
        }
        .payment-card strong {
          font-size: 22px;
          line-height: 1.1;
          color: var(--text-primary);
        }
        .payment-card span,
        .payment-card small {
          color: var(--text-muted);
        }
        .payment-section {
          border: 1px solid var(--border-default);
          background: var(--bg-card);
          border-radius: 14px;
          padding: 18px;
          display: flex;
          flex-direction: column;
          gap: 14px;
        }
        .payment-section-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 12px;
        }
        .payment-section-title {
          display: flex;
          align-items: center;
          gap: 8px;
          font-weight: 800;
          color: var(--text-primary);
        }
        .payment-table {
          width: 100%;
          border-collapse: collapse;
          font-size: 12px;
        }
        .payment-table th,
        .payment-table td {
          border-bottom: 1px solid var(--border-default);
          padding: 9px 8px;
          text-align: left;
          vertical-align: top;
        }
        .payment-table th {
          color: var(--text-muted);
          font-size: 11px;
          text-transform: uppercase;
          letter-spacing: 0.04em;
        }
        .payment-status-pill {
          display: inline-flex;
          align-items: center;
          gap: 5px;
          padding: 3px 8px;
          border-radius: 999px;
          border: 1px solid var(--border-default);
          background: var(--bg-hover);
          font-size: 11px;
          font-weight: 800;
          white-space: nowrap;
        }
        .payment-status-pill.ok {
          color: #176f43;
          border-color: rgba(23, 111, 67, 0.22);
          background: rgba(23, 111, 67, 0.08);
        }
        .payment-status-pill.warn {
          color: #9b5b17;
          border-color: rgba(155, 91, 23, 0.2);
          background: rgba(155, 91, 23, 0.08);
        }
        .payment-status-pill.off {
          color: var(--text-muted);
        }
        .payment-method-cloud {
          display: flex;
          flex-wrap: wrap;
          gap: 6px;
        }
        @media (max-width: 1100px) {
          .payment-grid {
            grid-template-columns: repeat(2, minmax(0, 1fr));
          }
        }
        @media (max-width: 700px) {
          .payment-grid {
            grid-template-columns: 1fr;
          }
        }
      `}</style>

      {activeTab === "insights" && (
        <section className="card admin-users-card">
          <div className="card-header admin-card-title-row">
            <div className="admin-card-title">
              <Activity size={16} />
              <span>Product Insights</span>
            </div>
            <button
              onClick={refreshInsights}
              disabled={insightsLoading}
              className="glass-action admin-refresh-btn"
              title="Refresh insights"
            >
              <RefreshCcw size={14} className={insightsLoading ? "spin" : ""} />
            </button>
          </div>

          {insightsError && <div className="err-msg">{insightsError}</div>}
          {insightsLoading && !insights ? (
            <p style={{ color: "var(--text-muted)", fontSize: "14px", padding: "18px 0" }}>Loading product telemetry...</p>
          ) : insights ? (
            <div style={{ display: "grid", gap: "18px" }}>
              <div className="profile-metric-grid">
                <div className="profile-metric-card"><ShieldCheck size={18} /><span>Patch success</span><strong>{formatRate(insights.patches.successRate)}</strong></div>
                <div className="profile-metric-card"><Activity size={18} /><span>Apply failures</span><strong>{insights.patches.applyFailures}</strong></div>
                <div className="profile-metric-card"><Zap size={18} /><span>Timeout rate</span><strong>{formatRate(insights.ai.timeoutRate)}</strong></div>
                <div className="profile-metric-card"><ReceiptText size={18} /><span>Refund rate</span><strong>{formatRate(insights.credits.refundRate)}</strong></div>
                <div className="profile-metric-card"><Globe2 size={18} /><span>Online Studio</span><strong>{insights.studio.onlineSessions}/{insights.studio.activeSessions}</strong></div>
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: "14px" }}>
                <div style={{ border: "1px solid var(--border-color)", borderRadius: "8px", padding: "14px", background: "rgba(94, 75, 50, 0.03)" }}>
                  <strong style={{ color: "var(--text-bright)" }}>Patch Funnel</strong>
                  <div className="plan-usage-snapshot" style={{ marginTop: "12px" }}>
                    <div><span>Total</span><strong>{insights.patches.total.toLocaleString()}</strong></div>
                    <div><span>Reviewable</span><strong>{insights.patches.reviewable.toLocaleString()}</strong></div>
                    <div><span>Applied</span><strong>{insights.patches.applied.toLocaleString()}</strong></div>
                    <div><span>Failed</span><strong>{insights.patches.failed.toLocaleString()}</strong></div>
                    <div><span>Rejected</span><strong>{insights.patches.rejected.toLocaleString()}</strong></div>
                    <div><span>Conflict bypasses</span><strong>{insights.patches.conflictsBypassed.toLocaleString()}</strong></div>
                  </div>
                </div>

                <div style={{ border: "1px solid var(--border-color)", borderRadius: "8px", padding: "14px", background: "rgba(94, 75, 50, 0.03)" }}>
                  <strong style={{ color: "var(--text-bright)" }}>Provider Reliability</strong>
                  <div className="plan-usage-snapshot" style={{ marginTop: "12px" }}>
                    <div><span>Assistant messages</span><strong>{insights.ai.assistantMessages.toLocaleString()}</strong></div>
                    <div><span>Timeouts</span><strong>{insights.ai.timeoutCount.toLocaleString()}</strong></div>
                    <div><span>Avg latency</span><strong>{(insights.ai.averageLatencyMs / 1000).toFixed(1)}s</strong></div>
                    <div><span>Debited credits</span><strong>{insights.credits.debitedCredits.toLocaleString()}</strong></div>
                    <div><span>Refunded credits</span><strong>{insights.credits.refundedCredits.toLocaleString()}</strong></div>
                    <div><span>Refund events</span><strong>{insights.credits.refundEvents.toLocaleString()}</strong></div>
                  </div>
                </div>

                <div style={{ border: "1px solid var(--border-color)", borderRadius: "8px", padding: "14px", background: "rgba(94, 75, 50, 0.03)" }}>
                  <strong style={{ color: "var(--text-bright)" }}>Studio Connector Health</strong>
                  <div className="plan-usage-snapshot" style={{ marginTop: "12px" }}>
                    <div><span>Sessions</span><strong>{insights.studio.sessions.toLocaleString()}</strong></div>
                    <div><span>Expired</span><strong>{insights.studio.expiredSessions.toLocaleString()}</strong></div>
                    <div><span>24h syncs</span><strong>{insights.studio.recentSnapshotSyncs.toLocaleString()}</strong></div>
                    <div><span>24h errors</span><strong>{insights.studio.recentRuntimeErrors.toLocaleString()}</strong></div>
                    <div><span>24h warnings</span><strong>{insights.studio.recentRuntimeWarnings.toLocaleString()}</strong></div>
                  </div>
                </div>
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: "14px" }}>
                <div style={{ border: "1px solid var(--border-color)", borderRadius: "8px", padding: "14px" }}>
                  <strong style={{ color: "var(--text-bright)" }}>Model Cost Per Successful Patch</strong>
                  {insights.ai.modelCostPerSuccessfulPatch.length === 0 ? (
                    <p style={{ color: "var(--text-muted)", fontSize: "13px" }}>No applied patch cost data yet.</p>
                  ) : (
                    <div style={{ display: "grid", gap: "8px", marginTop: "12px" }}>
                      {insights.ai.modelCostPerSuccessfulPatch.slice(0, 8).map((row) => (
                        <div key={row.modelId} style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: "10px", alignItems: "center", fontSize: "12px", padding: "8px", borderRadius: "6px", background: "var(--bg-panel)" }}>
                          <span>{getModelName(row.modelId)}</span>
                          <strong>{row.averageCostCredits.toFixed(1)} credits</strong>
                          <small style={{ color: "var(--text-muted)" }}>{row.successfulPatches} successful</small>
                          <small style={{ color: "var(--text-muted)", textAlign: "right" }}>{row.totalCostCredits.toLocaleString()} total</small>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                <div style={{ border: "1px solid var(--border-color)", borderRadius: "8px", padding: "14px" }}>
                  <strong style={{ color: "var(--text-bright)" }}>Connector Versions</strong>
                  {insights.studio.connectorVersions.length === 0 ? (
                    <p style={{ color: "var(--text-muted)", fontSize: "13px" }}>No connector sessions yet.</p>
                  ) : (
                    <div style={{ display: "grid", gap: "8px", marginTop: "12px" }}>
                      {insights.studio.connectorVersions.slice(0, 8).map((row) => (
                        <div key={row.version} style={{ display: "flex", justifyContent: "space-between", gap: "10px", fontSize: "12px", padding: "8px", borderRadius: "6px", background: "var(--bg-panel)" }}>
                          <code>{row.version}</code>
                          <strong>{row.count}</strong>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>

              <div style={{ border: "1px solid var(--border-color)", borderRadius: "8px", padding: "14px" }}>
                <strong style={{ color: "var(--text-bright)" }}>Recent Failures</strong>
                {insights.recentFailures.length === 0 ? (
                  <p style={{ color: "var(--text-muted)", fontSize: "13px" }}>No recent failures found.</p>
                ) : (
                  <div style={{ display: "grid", gap: "8px", marginTop: "12px" }}>
                    {insights.recentFailures.map((failure) => (
                      <div key={failure.id} style={{ display: "grid", gridTemplateColumns: "150px 1fr auto", gap: "10px", alignItems: "center", fontSize: "12px", padding: "8px", borderRadius: "6px", background: "var(--bg-panel)" }}>
                        <span style={{ color: "var(--text-muted)" }}>{new Date(failure.createdAt).toLocaleString()}</span>
                        <div style={{ minWidth: 0 }}>
                          <strong style={{ color: "var(--text-bright)" }}>{failure.label}</strong>
                          <div style={{ color: "var(--text-muted)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{failure.detail}</div>
                        </div>
                        <code style={{ color: "var(--text-muted)" }}>{failure.modelId || failure.source}</code>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <p style={{ color: "var(--text-muted)", fontSize: "12px", margin: 0 }}>
                Generated {new Date(insights.generatedAt).toLocaleString()}
                {insights.sample.truncatedCollections.length > 0
                  ? ` - recent ${insights.sample.perCollectionLimit.toLocaleString()} records per collection; truncated: ${insights.sample.truncatedCollections.join(", ")}`
                  : " - complete dataset"}
              </p>
            </div>
          ) : (
            <p style={{ color: "var(--text-muted)", fontSize: "14px", padding: "18px 0" }}>No product insight data loaded yet.</p>
          )}
        </section>
      )}

      {activeTab === "users" && (
        <>
          <section className="card admin-users-card">
            <div className="card-header admin-card-title-row">
              <div className="admin-card-title">
                <Users size={16} />
                <span>User Management</span>
              </div>
              <button 
                onClick={() => refreshUsers()} 
                disabled={isLoading}
                className="glass-action admin-refresh-btn"
                title="Refresh users"
              >
                <RefreshCcw size={14} className={isLoading ? "spin" : ""} />
              </button>
            </div>

            {/* Search and Filters row */}
            <div className="admin-filter-bar">
              <div className="admin-search-wrap">
                <input
                  type="text"
                  placeholder="Search by name, email, or ID..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                />
                <Search size={14} />
              </div>
              
              <label className="admin-filter-control">
                <span>Tier</span>
                <select
                  value={planFilter}
                  onChange={(e) => setPlanFilter(e.target.value)}
                >
                  <option value="all">All Plans</option>
                  <option value="free">Free</option>
                  <option value="starter">Starter</option>
                  <option value="pro">Pro</option>
                  <option value="studio">Studio</option>
                </select>
              </label>

              <label className="admin-filter-control">
                <span>Status</span>
                <select
                  value={statusFilter}
                  onChange={(e) => setStatusFilter(e.target.value)}
                >
                  <option value="all">All Statuses</option>
                  <option value="active">Active</option>
                  <option value="banned">Restricted</option>
                </select>
              </label>
              <span className="admin-results-count">{filteredUsers.length} shown, {adminUsers.length} loaded of {adminUsersTotal}</span>
            </div>

            {loadError && <div className="err-msg">{loadError}</div>}

            <div style={{ border: "1px solid var(--border-color)", borderRadius: "8px", padding: "14px", background: "rgba(94, 75, 50, 0.03)", display: "flex", flexDirection: "column", gap: "10px" }}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: "12px", alignItems: "center" }}>
                <div>
                  <strong style={{ fontSize: "14px", color: "var(--text-bright)" }}>Client Error Feed</strong>
                  <p style={{ margin: "3px 0 0", color: "var(--text-muted)", fontSize: "12px" }}>Runtime, render, console, and API failures reported by browsers.</p>
                </div>
                <button className="login-btn secondary small" onClick={refreshClientErrors}>Refresh</button>
              </div>
              {clientErrors.length === 0 ? (
                <span style={{ color: "var(--text-muted)", fontSize: "12px" }}>No browser errors recorded yet.</span>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: "8px", maxHeight: "220px", overflow: "auto" }}>
                  {clientErrors.slice(0, 8).map((event) => (
                    <div key={event.id} style={{ display: "grid", gridTemplateColumns: "140px 1fr auto", gap: "10px", alignItems: "center", fontSize: "12px", padding: "8px", borderRadius: "6px", background: "var(--bg-panel)" }}>
                      <span style={{ color: "var(--text-muted)" }}>{new Date(event.createdAt).toLocaleString()}</span>
                      <div style={{ minWidth: 0 }}>
                        <strong style={{ color: "var(--text-bright)" }}>{event.action}</strong>
                        <div style={{ color: "var(--text-muted)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{event.status || "No message"}</div>
                        <small style={{ color: "var(--text-muted)" }}>{String(event.metadata?.route || event.route || "")}</small>
                      </div>
                      <code style={{ color: "var(--text-muted)" }}>{event.metadata?.statusCode ? `HTTP ${String(event.metadata.statusCode)}` : event.userId || "anon"}</code>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {isLoading && adminUsers.length === 0 ? (
              <div style={{ padding: "40px", display: "flex", flexDirection: "column", gap: "24px" }}>
                {[1, 2, 3, 4].map((i) => (
                  <div key={i} style={{ display: "flex", alignItems: "center", gap: "20px", width: "100%" }}>
                    <div style={{ width: "36px", height: "36px", borderRadius: "50%", background: "rgba(94, 75, 50, 0.08)", animation: "pulse 1.5s infinite" }} />
                    <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: "8px" }}>
                      <div style={{ width: "150px", height: "12px", borderRadius: "4px", background: "rgba(94, 75, 50, 0.08)", animation: "pulse 1.5s infinite" }} />
                      <div style={{ width: "200px", height: "8px", borderRadius: "4px", background: "rgba(94, 75, 50, 0.05)", animation: "pulse 1.5s infinite" }} />
                    </div>
                    <div style={{ width: "80px", height: "18px", borderRadius: "10px", background: "rgba(94, 75, 50, 0.05)", animation: "pulse 1.5s infinite" }} />
                    <div style={{ width: "120px", height: "8px", borderRadius: "4px", background: "rgba(94, 75, 50, 0.05)", animation: "pulse 1.5s infinite" }} />
                  </div>
                ))}
              </div>
            ) : (
              <div className="admin-table-container">
                <table className="admin-table">
                  <thead>
                    <tr>
                      <th>User</th>
                      <th>Plan</th>
                      <th>Status</th>
                      <th>Available Now</th>
                      <th>Projects</th>
                      <th>Last Seen</th>
                      <th>Evidence</th>
                      <th>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredUsers.length === 0 ? (
                      <tr>
                        <td colSpan={8} style={{ textAlign: "center", padding: "60px 40px", color: "var(--text-muted)", fontSize: "14px" }}>
                          No creators found matching active search or filters.
                        </td>
                      </tr>
                    ) : (
                      filteredUsers.map((user) => {
                        const remaining = usageLeftPercent(user);
                        const displayName = user.name || "Unnamed creator";
                        const isAuthOnly = Boolean(user.authOnly);
                        return (
                          <tr key={user.id}>
                            <td>
                              <div className="admin-user-cell">
                                <div className="avatar-circle small custom-avatar">{displayName.slice(0, 1).toUpperCase()}</div>
                                <div>
                                  <strong style={{ color: "var(--text-bright)" }}>{displayName}</strong>
                                  <span style={{ fontSize: "11px", color: "var(--text-muted)" }}>
                                    {user.email || user.authProvider}
                                    {isAuthOnly ? " - Supabase Auth only" : ""}
                                  </span>
                                </div>
                              </div>
                            </td>
                            <td><span className={`premium-plan-badge ${user.plan}`}>{planLabels[user.plan]}</span></td>
                            <td><span className={`premium-status-badge ${isAuthOnly ? "auth-only" : user.status === "banned" ? "banned" : "active"}`}>{isAuthOnly ? "auth only" : user.status || "active"}</span></td>
                            <td>
                              <div className="admin-usage-cell" style={{ display: "flex", flexDirection: "column", gap: "5px" }}>
                                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
                                  <strong style={{ fontSize: "13px", fontWeight: "700" }}>
                                    {user.credits.toLocaleString()}
                                  <span style={{ fontSize: "11px", fontWeight: "normal", color: "var(--text-muted)", marginLeft: "4px" }}>available</span>
                                  </strong>
                                  <span className={`premium-plan-badge ${user.plan}`} style={{ fontSize: "9px", padding: "1px 5px", height: "auto", display: "inline-flex", fontWeight: "800" }}>
                                    {remaining}%
                                  </span>
                                </div>
                                <div className="usage-bar-track compact" style={{ height: "6px", borderRadius: "3px", background: "rgba(94, 75, 50, 0.1)", overflow: "hidden", margin: "2px 0" }}>
                                  <div className="usage-bar-fill" style={{ width: `${remaining}%`, height: "100%", background: "linear-gradient(90deg, var(--accent), var(--accent-warm-soft))", borderRadius: "3px" }} />
                                </div>
                                <div style={{ display: "flex", justifyContent: "space-between", fontSize: "10px", color: "var(--text-muted)", fontWeight: "500" }}>
                                  <span>Weekly cap: {planCapacity[user.plan]?.toLocaleString() ?? 100}</span>
                                  <span>Monthly plan: {planMonthlyCapacity[user.plan]?.toLocaleString() ?? 400}</span>
                                </div>
                                <div style={{ display: "flex", justifyContent: "space-between", fontSize: "10px", color: "var(--text-muted)", fontWeight: "500" }}>
                                  <span>Weekly left: {(user.usage?.weekly.remaining ?? Math.min(user.credits, planCapacity[user.plan] ?? 100)).toLocaleString()}</span>
                                  <span>Admin: {(user.usage?.monthly.adminGrantedCredits ?? 0).toLocaleString()}</span>
                                </div>
                              </div>
                            </td>
                            <td>{user.projects}</td>
                            <td>{new Date(user.lastSeen).toLocaleDateString()}</td>
                            <td>
                              <div className="admin-evidence-mini">
                                <strong>{(user.evidenceCount ?? 0).toLocaleString()}</strong>
                                <span>{user.lastIp || user.location || "No IP yet"}</span>
                              </div>
                            </td>
                            <td>
                              <div className="admin-action-row">
                                <button className="btn-action-card" title={isAuthOnly ? "This registration has not created a Vectis workspace yet" : "Grant Credits"} disabled={isAuthOnly} onClick={() => { setSelectedUser(user); setModalType("credits"); setCreditAmount(100); setCreditReason("Admin balance grant"); }}><Plus size={16} /></button>
                                <button className="btn-action-card" title={isAuthOnly ? "No Vectis evidence until the user completes app login" : "Customer Evidence"} disabled={isAuthOnly} onClick={() => openEvidence(user)}><Database size={16} /></button>
                                <button className="btn-action-card" title={isAuthOnly ? "Workspace plan is created after first app login" : "Change Plan"} disabled={isAuthOnly} onClick={() => { setSelectedUser(user); setModalType("plan"); setSelectedPlan(user.plan); }}><Settings size={16} /></button>
                                <button className="btn-action-card danger" title={isAuthOnly ? "Use Supabase Auth controls for auth-only users" : user.status === "banned" ? "Unban" : "Ban"} disabled={isAuthOnly} onClick={() => { setSelectedUser(user); setModalType("status"); }}>
                                  {user.status === "banned" ? <UserCheck size={16} /> : <Ban size={16} />}
                                </button>
                                <button className="btn-action-card" title={isAuthOnly ? "No workspace maintenance until first app login" : "More Actions"} disabled={isAuthOnly} onClick={() => { setSelectedUser(user); setModalType("reset"); }}><RefreshCcw size={16} /></button>
                              </div>
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
                {adminUsersCursor && (
                  <div style={{ display: "flex", justifyContent: "center", padding: "16px" }}>
                    <button className="login-btn secondary small" disabled={isLoading} onClick={() => refreshUsers("more")}>
                      {isLoading ? "Loading..." : `Load more users (${adminUsers.length} of ${adminUsersTotal})`}
                    </button>
                  </div>
                )}
              </div>
            )}
          </section>

          <Modal isOpen={modalType === "credits"} onClose={() => setModalType(null)} title={`Grant Credits: ${selectedUser?.name}`} footer={<><button className="login-btn secondary small" onClick={() => setModalType(null)}>Cancel</button><button className="login-btn primary small" onClick={handleCreditGrant} disabled={isSubmitting || creditAmount === 0}>{isSubmitting ? "Processing..." : "Apply Credits"}</button></>}>
            <p className="modal-help-text">Use positive credits to add available-now balance and negative credits to reduce it. This does not change the automatic monthly plan allowance.</p>
            <div className="custom-number-input credit-number-input">
              <button className="stepper-btn" onClick={() => setCreditAmount(creditAmount - 100)}><Minus size={16} /></button>
              <input type="number" value={creditAmount} onChange={(event) => setCreditAmount(parseInt(event.target.value, 10) || 0)} aria-label="Credit adjustment" />
              <button className="stepper-btn" onClick={() => setCreditAmount(creditAmount + 100)}><Plus size={16} /></button>
            </div>
            <input className="modal-text-input" value={creditReason} onChange={(event) => setCreditReason(event.target.value)} placeholder="Reason" />
          </Modal>

          <Modal isOpen={modalType === "plan"} onClose={() => setModalType(null)} title={`Subscription Management: ${selectedUser?.name}`} footer={<button className="login-btn secondary small" onClick={() => setModalType(null)}>Close</button>}>
            <p className="modal-help-text">Assign a new workspace tier to this user.</p>
            <div className="admin-plan-grid">
              {(["free", "starter", "pro", "studio"] as PlanName[]).map((plan) => (
                <button
                  key={plan}
                  className={`select-trigger-custom ${selectedPlan === plan ? "selected" : ""}`}
                  onClick={() => handlePlanUpdate(plan)}
                  disabled={isSubmitting}
                >
                  <span>{planLabels[plan]}</span>
                  <strong>{planMonthlyCapacity[plan].toLocaleString()} monthly credits</strong>
                </button>
              ))}
            </div>
          </Modal>

          <Modal isOpen={modalType === "status"} onClose={() => setModalType(null)} title={selectedUser?.status === "banned" ? "Restore Access" : "Restrict Access"} footer={<><button className="login-btn secondary small" onClick={() => setModalType(null)}>Cancel</button><button className="login-btn primary small" style={{ background: selectedUser?.status === "banned" ? "var(--accent)" : "var(--danger)" }} onClick={handleStatusToggle} disabled={isSubmitting}>{isSubmitting ? "Updating..." : selectedUser?.status === "banned" ? "Unban Account" : "Confirm Ban"}</button></>}>
            <p className="modal-help-text">
              {selectedUser?.status === "banned"
                ? `Restore full platform access for ${selectedUser?.name}.`
                : `Ban ${selectedUser?.name} and block active Studio access.`}
            </p>
          </Modal>

          <Modal
            isOpen={modalType === "evidence"}
            onClose={() => setModalType(null)}
            title={`Customer Evidence: ${selectedUser?.name}`}
            footer={<button className="login-btn secondary small" onClick={() => setModalType(null)}>Close</button>}
          >
            <div className="customer-evidence-panel">
              {evidenceLoading ? (
                <p className="modal-help-text">Loading customer usage, billing, IP, and workflow evidence...</p>
              ) : evidenceDetail ? (
                <>
                  <div className="evidence-summary-grid">
                    <div><span>Total events</span><strong>{evidenceDetail.counts.total.toLocaleString()}</strong></div>
                    <div><span>Usage</span><strong>{evidenceDetail.counts.usage.toLocaleString()}</strong></div>
                    <div><span>Billing</span><strong>{evidenceDetail.counts.billing.toLocaleString()}</strong></div>
                    <div><span>Credits now</span><strong>{(evidenceDetail.snapshot?.creditBalance ?? selectedUser?.credits ?? 0).toLocaleString()}</strong></div>
                    <div><span>Weekly left</span><strong>{(evidenceDetail.snapshot?.weeklyRemaining ?? selectedUser?.usage?.weekly.remaining ?? 0).toLocaleString()}</strong></div>
                    <div><span>Monthly used</span><strong>{(evidenceDetail.snapshot?.monthlyUsed ?? selectedUser?.usage?.monthly.used ?? 0).toLocaleString()}</strong></div>
                    <div><span>Projects</span><strong>{(evidenceDetail.snapshot?.projectCount ?? selectedUser?.projects ?? 0).toLocaleString()}</strong></div>
                    <div><span>Messages</span><strong>{(evidenceDetail.snapshot?.messageCount ?? 0).toLocaleString()}</strong></div>
                    <div><span>Attachments</span><strong>{(evidenceDetail.snapshot?.attachmentCount ?? evidenceDetail.counts.attachments).toLocaleString()}</strong></div>
                    <div><span>Generated icons</span><strong>{(evidenceDetail.snapshot?.generatedIconCount ?? evidenceDetail.counts.generatedIcons).toLocaleString()}</strong></div>
                    <div><span>Studio sessions</span><strong>{(evidenceDetail.snapshot?.activeStudioSessions ?? 0).toLocaleString()} active</strong></div>
                    <div><span>Last IP</span><strong>{evidenceDetail.snapshot?.lastIp ?? selectedUser?.lastIp ?? "No IP yet"}</strong></div>
                    <div><span>Country</span><strong>{evidenceDetail.snapshot?.lastCountry ?? selectedUser?.location ?? "Unknown"}</strong></div>
                    <div><span>Plan</span><strong>{evidenceDetail.snapshot?.plan ?? evidenceDetail.organization?.plan ?? selectedUser?.plan ?? "n/a"}</strong></div>
                    <div><span>Stripe customer</span><strong>{evidenceDetail.snapshot?.stripeCustomerId ?? evidenceDetail.organization?.stripeCustomerId ?? "none"}</strong></div>
                    <div><span>Subscription</span><strong>{evidenceDetail.snapshot?.stripeSubscriptionStatus ?? evidenceDetail.organization?.stripeSubscriptionStatus ?? "none"}</strong></div>
                    <div><span>Billing period end</span><strong>{evidenceDetail.snapshot?.billingCurrentPeriodEnd ? shortDate(evidenceDetail.snapshot.billingCurrentPeriodEnd) : "n/a"}</strong></div>
                    <div><span>User agent</span><strong>{evidenceDetail.snapshot?.lastUserAgent ?? selectedUser?.lastUserAgent ?? "No agent yet"}</strong></div>
                  </div>
                  <div className="evidence-download-row">
                    <a className="login-btn secondary small" href={selectedUser ? api.adminEvidenceJsonUrl(selectedUser.id) : "#"} target="_blank" rel="noreferrer"><Download size={14} /> JSON</a>
                    <a className="login-btn secondary small" href={selectedUser ? api.adminEvidenceCsvUrl(selectedUser.id) : "#"} target="_blank" rel="noreferrer"><Download size={14} /> CSV</a>
                  </div>
                  <div className="evidence-event-list">
                    {evidenceDetail.events.slice(0, 40).map((event) => (
                      <div key={event.id} className="evidence-event-row">
                        <div>
                          <strong>{event.action}</strong>
                          <span>{event.type} - {new Date(event.createdAt).toLocaleString()}</span>
                          <small>{event.route} - {event.ip || "no ip"} {event.country ? `- ${event.country}` : ""}</small>
                        </div>
                        <code>{event.amountCredits ? `${event.amountCredits} credits` : event.status || "ok"}</code>
                      </div>
                    ))}
                  </div>
                </>
              ) : (
                <p className="modal-help-text">No evidence loaded for this customer.</p>
              )}
            </div>
          </Modal>

          <Modal isOpen={modalType === "reset"} onClose={() => setModalType(null)} title={`Maintenance: ${selectedUser?.name}`} footer={<button className="login-btn secondary small" onClick={() => setModalType(null)}>Done</button>}>
            <div className="modal-action-stack">
              <p className="modal-help-text">Reset usage offsets this month&apos;s usage ledger and refills the workspace back into normal weekly capacity.</p>
              <button className="select-trigger-custom" onClick={handleResetUsage} disabled={isSubmitting}><RefreshCcw size={16} /> {isSubmitting ? "Resetting..." : "Reset Usage Stats"}</button>
              <button className="select-trigger-custom" onClick={() => { navigator.clipboard.writeText(selectedUser?.id || ""); alert("ID Copied"); }}><Copy size={16} /> Copy Vectis ID</button>
              <button className="select-trigger-custom" onClick={() => setModalType("notify")}><Bell size={16} /> Send System Notification</button>
            </div>
          </Modal>
        </>
      )}

      {activeTab === "payments" && (
        <div className="admin-evaluations-dashboard" style={{ display: "flex", flexDirection: "column", gap: "18px" }}>
          <section className="payment-section">
            <div className="payment-section-header">
              <div>
                <div className="payment-section-title"><CreditCard size={16} /> Stripe Command Center</div>
                <p style={{ marginTop: "6px", color: "var(--text-muted)", maxWidth: "760px" }}>
                  Live billing, payment methods, webhook health, sale pricing, subscriptions, checkout sessions, and local workspace mapping. Secrets stay server side and are never returned to this page.
                </p>
              </div>
              <div style={{ display: "flex", gap: "8px", flexWrap: "wrap", justifyContent: "flex-end" }}>
                <a className="login-btn secondary small" href={`${stripeDashboardBase}/settings/payment_methods`} target="_blank" rel="noreferrer"><Globe2 size={14} /> Payment methods</a>
                <a className="login-btn secondary small" href={`${stripeDashboardBase}/products`} target="_blank" rel="noreferrer"><ReceiptText size={14} /> Products</a>
                <a className="login-btn secondary small" href={`${stripeDashboardBase}/webhooks`} target="_blank" rel="noreferrer"><ExternalLink size={14} /> Webhooks</a>
                <button className="login-btn primary small" onClick={refreshPayments} disabled={paymentsLoading}>
                  <RefreshCcw size={14} className={paymentsLoading ? "spin" : ""} /> Refresh
                </button>
              </div>
            </div>
          </section>

          {paymentError && <div className="err-msg">{paymentError}</div>}

          {paymentsLoading && !paymentOverview ? (
            <section className="payment-section">Loading Stripe payment intelligence...</section>
          ) : paymentOverview ? (
            <>
              <section className="payment-grid">
                <div className="payment-card">
                  <span>Stripe account</span>
                  <strong>{paymentOverview.account?.id ?? "Not configured"}</strong>
                  <small>{paymentOverview.account?.chargesEnabled ? "Charges enabled" : "Charges not enabled"} / $</small>
                </div>
                <div className="payment-card">
                  <span>Estimated MRR</span>
                  <strong>{money(paymentOverview.subscriptions?.estimatedMrrCents ?? 0)}</strong>
                  <small>{money(paymentOverview.subscriptions?.estimatedArrCents ?? 0)} estimated ARR from live recurring prices</small>
                </div>
                <div className="payment-card">
                  <span>Subscriptions</span>
                  <strong>{paymentOverview.subscriptions?.total ?? 0}</strong>
                  <small>{Object.entries(paymentOverview.subscriptions?.statusCounts ?? {}).map(([status, count]) => `${status}: ${count}`).join(" / ") || "No subscriptions yet"}</small>
                </div>
                <div className="payment-card">
                  <span>Payment methods</span>
                  <strong>{activePaymentMethods}</strong>
                  <small>{requestedPaymentMethods} more requested but not currently available for every checkout context</small>
                </div>
              </section>

              <section className="payment-section">
                <div className="payment-section-header">
                  <div className="payment-section-title"><ShieldCheck size={16} /> Checkout And Secret Safety</div>
                  <span className={`payment-status-pill ${paymentOverview.security.secretExposedToClient ? "warn" : "ok"}`}>
                    {paymentOverview.security.secretExposedToClient ? "Review needed" : "No client secret exposure"}
                  </span>
                </div>
                <div className="payment-grid">
                  <div className="payment-card">
                    <span>Plan checkout mode</span>
                    <strong>{paymentOverview.checkout?.planMode ?? "n/a"}</strong>
                    <small>Monthly and annual plans are created as recurring Stripe subscriptions.</small>
                  </div>
                  <div className="payment-card">
                    <span>Price ID coverage</span>
                    <strong>{paymentOverview.checkout?.checkoutUsesConfiguredPriceIds ? "Configured" : "Inline fallback"}</strong>
                    <small>{paymentOverview.checkout?.missingConfiguredPriceIds?.length ? `Missing: ${paymentOverview.checkout.missingConfiguredPriceIds.join(", ")}` : "All plan checkouts use Stripe price IDs"}</small>
                  </div>
                  <div className="payment-card">
                    <span>Secret storage</span>
                    <strong>{paymentOverview.security.keyKind}</strong>
                    <small>{paymentOverview.security.secretStorage}</small>
                  </div>
                  <div className="payment-card">
                    <span>Webhook verification</span>
                    <strong>{paymentOverview.security.webhookSignatureRequired ? "Required" : "Missing"}</strong>
                    <small>{paymentOverview.security.webhookSecretConfigured ? "Signing secret configured" : "Webhook secret missing"}</small>
                  </div>
                  <div className="payment-card">
                    <span>Webhook idempotency</span>
                    <strong>{paymentOverview.webhookProcessing?.processedEventCount ?? 0} processed</strong>
                    <small>{paymentOverview.webhookProcessing?.duplicateIgnoredCount ?? 0} duplicate webhook or session replays ignored</small>
                  </div>
                </div>
              </section>

              <section className="payment-section">
                <div className="payment-section-header">
                  <div className="payment-section-title"><Activity size={16} /> Credit Economics</div>
                  <span className="payment-status-pill ok">Annual target 17.5%</span>
                </div>
                <div style={{ overflowX: "auto" }}>
                  <table className="payment-table">
                    <thead>
                      <tr>
                        <th>Plan</th>
                        <th>Cycle</th>
                        <th>Credit value</th>
                        <th>Target margin</th>
                        <th>After Stripe margin</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(paymentOverview.economics?.fullUsageMargins ?? []).map((row) => (
                        <tr key={`${row.plan}-${row.billingCycle}`}>
                          <td><span className={`premium-plan-badge ${row.plan}`}>{planLabels[row.plan]}</span></td>
                          <td>{row.billingCycle}</td>
                          <td>${row.creditValueUsd.toFixed(6)}</td>
                          <td>{Math.round(row.targetMargin * 1000) / 10}%</td>
                          <td>
                            <span className={`payment-status-pill ${row.estimatedFullUsageMargin >= 0.15 ? "ok" : "warn"}`}>
                              {Math.round(row.estimatedFullUsageMargin * 1000) / 10}%
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <p className="modal-help-text">
                  Studio custom refill: ${paymentOverview.economics?.topUps.studioCustomPricePerThousandUsd.toFixed(2) ?? "1.40"} per 1,000 credits. Fixed packs stay ${paymentOverview.economics?.topUps.fixedPricePerThousandUsd.toFixed(2) ?? "2.00"} per 1,000 credits.
                </p>
              </section>

              <section className="payment-section">
                <div className="payment-section-header">
                  <div className="payment-section-title"><ReceiptText size={16} /> Live Prices And Sale Math</div>
                  <span className="payment-status-pill ok">Monthly is recurring subscription</span>
                </div>
                <div style={{ overflowX: "auto" }}>
                  <table className="payment-table">
                    <thead>
                      <tr>
                        <th>Price</th>
                        <th>Mode</th>
                        <th>Interval</th>
                        <th>Stripe amount</th>
                        <th>Original</th>
                        <th>Sale info</th>
                        <th>Status</th>
                        <th>Product</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(paymentOverview.prices ?? []).map((price) => (
                        <tr key={price.key}>
                          <td>
                            <strong>{price.label}</strong>
                            <div style={{ color: "var(--text-muted)" }}>{price.priceId || "Not configured"}</div>
                          </td>
                          <td>{price.expectedCheckoutMode}</td>
                          <td>{price.recurringInterval ?? (price.cycle === "one_time" ? "one time" : "missing")}</td>
                          <td>{money(price.unitAmount, price.currency)}</td>
                          <td>{money(price.baseAmountCents, price.currency)}</td>
                          <td>{price.salePercent ? `${price.salePercent}% / ${money(price.saleAmountCents, price.currency)}` : "No active sale"}</td>
                          <td>
                            <span className={`payment-status-pill ${price.active && price.matchesExpectedAmount !== false ? "ok" : "warn"}`}>
                              {price.active ? "active" : "inactive"}{price.monthlyIsSubscription === false ? " / not monthly recurring" : ""}
                            </span>
                          </td>
                          <td>{price.productName || price.productId || "n/a"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>

              <section className="payment-section">
                <div className="payment-section-header">
                  <div className="payment-section-title"><Globe2 size={16} /> Payment Method Configuration</div>
                  <span className="payment-status-pill ok">Dynamic Checkout methods enabled</span>
                </div>
                {(paymentOverview.paymentMethodConfigurations ?? []).map((configuration) => (
                  <div key={configuration.id} style={{ display: "grid", gap: "10px", padding: "12px", border: "1px solid var(--border-default)", borderRadius: "12px", background: "var(--bg-hover)" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", gap: "12px", flexWrap: "wrap" }}>
                      <div>
                        <strong>{configuration.name} / {configuration.id}</strong>
                        <div style={{ color: "var(--text-muted)", fontSize: "12px" }}>
                          {configuration.application ? `Connected app ${configuration.application}` : "Account default"} / {configuration.usedByCheckout ? "used by Vectis Checkout" : "not selected by Vectis Checkout"}
                        </div>
                      </div>
                      <div className="payment-method-cloud">
                        <span className="payment-status-pill ok">{configuration.counts.active} active</span>
                        <span className="payment-status-pill warn">{configuration.counts.requested} requested</span>
                        <span className="payment-status-pill off">{configuration.counts.off} off</span>
                      </div>
                    </div>
                    <div className="payment-method-cloud">
                      {configuration.methods.map((method) => (
                        <span key={method.method} className={`payment-status-pill ${method.status === "active" ? "ok" : method.status === "requested" ? "warn" : "off"}`}>
                          {method.method.replace(/_/g, " ")} / {method.status}
                        </span>
                      ))}
                    </div>
                  </div>
                ))}
              </section>

              <section className="payment-section">
                <div className="payment-section-header">
                  <div className="payment-section-title"><LockKeyhole size={16} /> Webhooks</div>
                  <span className="payment-status-pill ok">Secrets hidden</span>
                </div>
                <div style={{ overflowX: "auto" }}>
                  <table className="payment-table">
                    <thead>
                      <tr>
                        <th>Endpoint</th>
                        <th>Status</th>
                        <th>API version</th>
                        <th>Events</th>
                        <th>Created</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(paymentOverview.webhooks ?? []).map((webhook) => (
                        <tr key={webhook.id}>
                          <td>
                            <strong>{webhook.id}</strong>
                            <div style={{ color: "var(--text-muted)" }}>{webhook.url}</div>
                          </td>
                          <td><span className={`payment-status-pill ${webhook.status === "enabled" ? "ok" : "off"}`}>{webhook.status}</span></td>
                          <td>{webhook.apiVersion ?? "n/a"}</td>
                          <td>{webhook.enabledEvents.join(", ")}</td>
                          <td>{shortDate(webhook.createdAt)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>

              <section className="payment-section">
                <div className="payment-section-header">
                  <div className="payment-section-title"><ReceiptText size={16} /> Subscriptions And Checkout Sessions</div>
                  <span className="payment-status-pill ok">Server-created Checkout only</span>
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "14px" }}>
                  <div style={{ overflowX: "auto" }}>
                    <table className="payment-table">
                      <thead>
                        <tr>
                          <th>Subscription</th>
                          <th>Status</th>
                          <th>Price</th>
                          <th>Cycle</th>
                          <th>Renews</th>
                        </tr>
                      </thead>
                      <tbody>
                        {(paymentOverview.subscriptions?.rows ?? []).slice(0, 12).map((subscription) => (
                          <tr key={subscription.id}>
                            <td>
                              <strong>{subscription.id}</strong>
                              <div style={{ color: "var(--text-muted)" }}>{subscription.customerId}</div>
                            </td>
                            <td><span className={`payment-status-pill ${subscription.status === "active" ? "ok" : "warn"}`}>{subscription.status}</span></td>
                            <td>{money(subscription.amount, subscription.currency)} {subscription.interval ? `/ ${subscription.interval}` : ""}</td>
                            <td>{subscription.billingCycle ?? "monthly"}</td>
                            <td>{shortDate(subscription.currentPeriodEnd)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <div style={{ overflowX: "auto" }}>
                    <table className="payment-table">
                      <thead>
                        <tr>
                          <th>Checkout</th>
                          <th>Mode</th>
                          <th>Payment</th>
                          <th>Amount</th>
                        </tr>
                      </thead>
                      <tbody>
                        {(paymentOverview.checkoutSessions ?? []).slice(0, 12).map((session) => (
                          <tr key={session.id}>
                            <td>
                              <strong>{session.id}</strong>
                              <div style={{ color: "var(--text-muted)" }}>{session.plan ?? "top up"} {session.billingCycle ?? ""}</div>
                            </td>
                            <td>{session.mode}</td>
                            <td><span className={`payment-status-pill ${session.paymentStatus === "paid" ? "ok" : "warn"}`}>{session.paymentStatus}</span></td>
                            <td>{money(session.amountTotal, session.currency ?? "usd")}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </section>

              <section className="payment-section">
                <div className="payment-section-header">
                  <div className="payment-section-title"><Users size={16} /> Local Workspace Billing Map</div>
                  <span className="payment-status-pill">
                    {paymentOverview.localWorkspaces.length} loaded of {paymentOverview.localWorkspacesTotal} workspaces
                  </span>
                </div>
                <div style={{ overflowX: "auto" }}>
                  <table className="payment-table">
                    <thead>
                      <tr>
                        <th>Workspace owner</th>
                        <th>Plan</th>
                        <th>Credits</th>
                        <th>Stripe customer</th>
                        <th>Subscription</th>
                        <th>Cycle</th>
                        <th>Period end</th>
                      </tr>
                    </thead>
                    <tbody>
                      {paymentOverview.localWorkspaces.map((workspace) => (
                        <tr key={workspace.id}>
                          <td>
                            <strong>{workspace.name}</strong>
                            <div style={{ color: "var(--text-muted)" }}>{workspace.email || workspace.organizationId || workspace.id}</div>
                          </td>
                          <td><span className={`premium-plan-badge ${workspace.plan}`}>{planLabels[workspace.plan]}</span></td>
                          <td>{workspace.credits.toLocaleString()}</td>
                          <td>{workspace.stripeCustomerId || "n/a"}</td>
                          <td>{workspace.stripeSubscriptionId || "n/a"}<div style={{ color: "var(--text-muted)" }}>{workspace.stripeSubscriptionStatus || ""}</div></td>
                          <td>{workspace.billingCycle ?? "monthly"}</td>
                          <td>{shortDate(workspace.billingCurrentPeriodEnd)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>

              {paymentOverview.errors.length > 0 && (
                <section className="payment-section">
                  <div className="payment-section-title"><Shield size={16} /> Stripe Read Warnings</div>
                  {paymentOverview.errors.map((error) => (
                    <div key={error} className="payment-status-pill warn">{error}</div>
                  ))}
                </section>
              )}
            </>
          ) : (
            <section className="payment-section">No payment data loaded yet.</section>
          )}
        </div>
      )}

      {activeTab === "provider-health" && (
        <div className="admin-evaluations-dashboard">
          <AdminProviderHealth />
        </div>
      )}

      {activeTab === "evaluations" && (
        <div className="admin-evaluations-dashboard" style={{ display: "flex", flexDirection: "column", gap: "24px" }}>
          {/* Upper Controls */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "24px" }}>
            
            {/* Scenario Suite Card */}
            <div className="card" style={{ display: "flex", flexDirection: "column", gap: "16px", padding: "20px" }}>
              <div className="card-header" style={{ borderBottom: "1px solid var(--border-color)", paddingBottom: "10px", fontWeight: "700" }}>
                <Zap size={16} style={{ marginRight: "8px", verticalAlign: "middle" }} />
                Evaluation Prompt Suite
              </div>

              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "12px", background: "rgba(94, 75, 50, 0.05)", borderRadius: "6px" }}>
                <div style={{ display: "flex", flexDirection: "column", gap: "3px" }}>
                  <strong style={{ fontSize: "14px", color: "var(--text-bright)" }}>All built-in prompts</strong>
                  <span style={{ fontSize: "12px", color: "var(--text-muted)" }}>{evaluationScenarioCount} prompts run from one evaluation button.</span>
                </div>
                <span style={{ fontSize: "12px", fontWeight: "700", color: "var(--accent)" }}>{selectedModelRunCount || 0} model runs</span>
              </div>

              <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                {scenarios.map((s, index) => (
                  <div key={s.id} style={{ padding: "10px 12px", borderRadius: "6px", border: "1px solid var(--border-color)", background: "var(--bg-panel)" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", gap: "12px", alignItems: "center", marginBottom: "4px" }}>
                      <strong style={{ fontSize: "13px", color: "var(--text-bright)" }}>{index + 1}. {s.name}</strong>
                      <span style={{ fontSize: "11px", color: "var(--text-muted)", whiteSpace: "nowrap" }}>{selectedModels.length} models</span>
                    </div>
                    <p style={{ margin: 0, fontSize: "12px", color: "var(--text-muted)", lineHeight: 1.45 }}>{s.promptText}</p>
                  </div>
                ))}
              </div>
              
              <div style={{ display: "none", flexDirection: "column", gap: "8px", position: "relative" }}>
                <label style={{ fontSize: "12px", fontWeight: "600", color: "var(--text-muted)" }}>Target Prompt</label>
                
                {/* Custom Dropdown Trigger */}
                <button
                  type="button"
                  onClick={() => setIsScenarioDropdownOpen(!isScenarioDropdownOpen)}
                  style={{
                    width: "100%",
                    padding: "10px 14px",
                    borderRadius: "6px",
                    background: "var(--bg-accent)",
                    color: "var(--text-bright)",
                    border: "1px solid var(--border-color)",
                    fontSize: "14px",
                    textAlign: "left",
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    cursor: "pointer",
                    outline: "none",
                    fontWeight: "500",
                    transition: "border-color 0.2s, background-color 0.2s"
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.borderColor = "var(--accent)";
                    e.currentTarget.style.backgroundColor = "rgba(94, 75, 50, 0.05)";
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.borderColor = "var(--border-color)";
                    e.currentTarget.style.backgroundColor = "var(--bg-accent)";
                  }}
                >
                  <span>{selectedScenarioId === "custom" ? "Custom Prompt..." : scenarios.find(s => s.id === selectedScenarioId)?.name || "Select Scenario"}</span>
                  <span style={{ 
                    transform: isScenarioDropdownOpen ? "rotate(180deg)" : "rotate(0deg)", 
                    transition: "transform 0.2s ease",
                    fontSize: "10px",
                    color: "var(--text-muted)"
                  }}>▼</span>
                </button>

                {/* Custom Options Panel */}
                {isScenarioDropdownOpen && (
                  <>
                    <div 
                      onClick={() => setIsScenarioDropdownOpen(false)}
                      style={{
                        position: "fixed",
                        top: 0,
                        bottom: 0,
                        left: 0,
                        right: 0,
                        zIndex: 99
                      }}
                    />
                    
                    <div
                      style={{
                        position: "absolute",
                        top: "100%",
                        left: 0,
                        right: 0,
                        marginTop: "4px",
                        background: "var(--bg-card, #fff8e6)",
                        border: "1px solid var(--border-color)",
                        borderRadius: "6px",
                        boxShadow: "0 16px 34px rgba(91, 67, 33, 0.14)",
                        zIndex: 100,
                        maxHeight: "250px",
                        overflowY: "auto",
                        padding: "4px"
                      }}
                    >
                      {scenarios.map((s) => (
                        <button
                          key={s.id}
                          type="button"
                          onClick={() => {
                            setSelectedScenarioId(s.id);
                            setIsScenarioDropdownOpen(false);
                          }}
                          style={{
                            width: "100%",
                            padding: "8px 12px",
                            textAlign: "left",
                            background: selectedScenarioId === s.id ? "var(--bg-hover)" : "transparent",
                            color: selectedScenarioId === s.id ? "var(--accent)" : "var(--text-bright)",
                            border: "none",
                            borderRadius: "4px",
                            cursor: "pointer",
                            fontSize: "13px",
                            fontWeight: selectedScenarioId === s.id ? "600" : "400",
                            transition: "background 0.2s"
                          }}
                          onMouseEnter={(e) => {
                            if (selectedScenarioId !== s.id) {
                              e.currentTarget.style.background = "var(--bg-hover)";
                            }
                          }}
                          onMouseLeave={(e) => {
                            if (selectedScenarioId !== s.id) {
                              e.currentTarget.style.background = "transparent";
                            }
                          }}
                        >
                          {s.name}
                        </button>
                      ))}
                      <button
                        type="button"
                        onClick={() => {
                          setSelectedScenarioId("custom");
                          setIsScenarioDropdownOpen(false);
                        }}
                        style={{
                          width: "100%",
                          padding: "8px 12px",
                          textAlign: "left",
                          background: selectedScenarioId === "custom" ? "var(--bg-hover)" : "transparent",
                          color: selectedScenarioId === "custom" ? "var(--accent)" : "var(--text-bright)",
                          border: "none",
                          borderRadius: "4px",
                          cursor: "pointer",
                          fontSize: "13px",
                          fontWeight: selectedScenarioId === "custom" ? "600" : "400",
                          transition: "background 0.2s",
                          borderTop: "1px solid var(--border-color)",
                          marginTop: "4px",
                          paddingTop: "12px"
                        }}
                        onMouseEnter={(e) => {
                          if (selectedScenarioId !== "custom") {
                            e.currentTarget.style.background = "var(--bg-hover)";
                          }
                        }}
                        onMouseLeave={(e) => {
                          if (selectedScenarioId !== "custom") {
                            e.currentTarget.style.background = "transparent";
                          }
                        }}
                      >
                        Custom Prompt...
                      </button>
                    </div>
                  </>
                )}
              </div>

              {false && selectedScenarioId === "custom" && (
                <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                  <label style={{ fontSize: "12px", fontWeight: "600", color: "var(--text-muted)" }}>Custom Prompt Text</label>
                  <textarea
                    value={customPrompt}
                    onChange={(e) => setCustomPrompt(e.target.value)}
                    placeholder="Enter custom prompt instructions for Roblox models..."
                    style={{
                      width: "100%",
                      height: "100px",
                      padding: "10px",
                      borderRadius: "6px",
                      background: "var(--bg-accent)",
                      color: "var(--text-bright)",
                      border: "1px solid var(--border-color)",
                      fontSize: "14px",
                      resize: "vertical"
                    }}
                  />
                </div>
              )}

              {false && selectedScenarioId !== "custom" && (
                <div style={{ padding: "12px", background: "rgba(94, 75, 50, 0.05)", borderRadius: "6px", fontSize: "13px", color: "var(--text-muted)" }}>
                  <strong>Prompt:</strong> {scenarios.find(s => s.id === selectedScenarioId)?.promptText}
                </div>
              )}
            </div>

            {/* Model Selection & Trigger Card */}
            <div className="card" style={{ display: "flex", flexDirection: "column", gap: "16px", padding: "20px" }}>
              <div className="card-header" style={{ borderBottom: "1px solid var(--border-color)", paddingBottom: "10px", fontWeight: "700" }}>
                <UserCheck size={16} style={{ marginRight: "8px", verticalAlign: "middle" }} />
                Select Models & Trigger
              </div>

              <button className="login-btn secondary small" onClick={checkModelHealth} disabled={modelHealthLoading} style={{ alignSelf: "flex-start" }}>
                {modelHealthLoading ? "Checking thinking models..." : "Check Thinking Models"}
              </button>

              {modelHealth.length > 0 && (
                <div style={{ display: "flex", flexDirection: "column", gap: "6px", padding: "10px", borderRadius: "6px", background: "rgba(94, 75, 50, 0.04)" }}>
                  {modelHealth.map((health) => (
                    <div key={health.modelId} style={{ display: "flex", justifyContent: "space-between", gap: "10px", fontSize: "11px", color: "var(--text-muted)" }}>
                      <strong style={{ color: health.ok ? "var(--success)" : "var(--danger)" }}>{getModelName(health.modelId)}: {health.ok ? "OK" : "Failed"}</strong>
                      <span>{health.usedModelId && health.usedModelId !== health.modelId ? `${getModelName(health.usedModelId)} fallback, ` : ""}{thinkingLevelLabelFor(health.usedModelId ?? health.modelId, health.thinkingLevel)}, {health.thinkingMultiplier}x, {(health.latencyMs / 1000).toFixed(1)}s</span>
                    </div>
                  ))}
                </div>
              )}

              <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
                <label style={{ fontSize: "12px", fontWeight: "600", color: "var(--text-muted)" }}>Evaluate Models</label>
                <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                  {AVAILABLE_MODELS.map((model) => {
                    const isSelected = selectedModels.includes(model.id);
                    const modelMeta = authConfig?.models?.find(am => am.id === model.id)
                      || authConfig?.models?.find(am => am.id === resolveModelId(model.id));
                    const isSoon = modelMeta?.status === "soon";
                    const userPlan = data?.organization?.plan;
                    const canUsePremium = userPlan === "pro" || userPlan === "studio";
                    const isLockedPremium = modelMeta?.tier === "premium" && !canUsePremium;
                    const isDisabled = isSoon || isLockedPremium;
                    const costBreakdown = getModelEvaluationCostBreakdown(model.id);
                    const thinkingLevelCapitalized = thinkingLevelLabelFor(model.id, costBreakdown.thinkingLevel);
                    const thinkingColor = costBreakdown.thinkingLevel === "high" ? "#c62828" : costBreakdown.thinkingLevel === "medium" ? "var(--accent)" : costBreakdown.thinkingLevel === "low" ? "#ef6c00" : "var(--text-muted)";
                    return (
                      <label
                        key={model.id}
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: "10px",
                          padding: "10px 12px",
                          borderRadius: "6px",
                          background: isSelected ? "rgba(94, 75, 50, 0.08)" : "rgba(94, 75, 50, 0.03)",
                          cursor: isDisabled ? "not-allowed" : "pointer",
                          fontSize: "13px",
                          fontWeight: "500",
                          userSelect: "none",
                          opacity: isDisabled ? 0.5 : 1,
                          filter: isDisabled ? "grayscale(60%)" : "none",
                          border: isSelected ? "1px solid rgba(94, 75, 50, 0.15)" : "1px solid transparent",
                          transition: "background 0.15s, border-color 0.15s"
                        }}
                        title={isLockedPremium ? "Requires Pro or Studio plan" : isSoon ? "Coming soon" : ""}
                      >
                        <input
                          type="checkbox"
                          checked={isSelected}
                          disabled={isDisabled}
                          onChange={() => {
                            if (isDisabled) return;
                            if (isSelected) {
                              setSelectedModels(selectedModels.filter(m => m !== model.id));
                            } else {
                              setSelectedModels([...selectedModels, model.id]);
                            }
                          }}
                          style={{ cursor: isDisabled ? "not-allowed" : "pointer", flexShrink: 0 }}
                        />
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                            <strong>{model.name}</strong>
                            {isSoon && <span style={{ fontSize: "9px", fontWeight: "700", padding: "1px 5px", borderRadius: "3px", background: "rgba(94, 75, 50, 0.12)", color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.04em" }}>Soon</span>}
                            {isLockedPremium && <span style={{ fontSize: "9px", fontWeight: "700", padding: "1px 5px", borderRadius: "3px", background: "rgba(94, 75, 50, 0.12)", color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.04em" }}>Pro</span>}
                            <span style={{ fontSize: "10px", fontWeight: "700", padding: "2px 6px", borderRadius: "4px", background: costBreakdown.thinkingLevel === "none" ? "rgba(94, 75, 50, 0.06)" : "rgba(94, 75, 50, 0.12)", color: thinkingColor, marginLeft: "auto", whiteSpace: "nowrap" }}>
                              {thinkingLevelCapitalized}{costBreakdown.thinkingMultiplier > 1 ? ` (${costBreakdown.thinkingMultiplier}x)` : ""}
                            </span>
                          </div>
                          <div style={{ display: "flex", gap: "8px", flexWrap: "wrap", marginTop: "5px", alignItems: "center" }}>
                            <span style={{ fontSize: "11px", fontWeight: "600", color: "var(--accent)" }}>{costBreakdown.generationCostCredits} cr/prompt</span>
                            <span style={{ fontSize: "10px", color: "var(--text-muted)", fontWeight: "500" }}>{liveEvaluationJudgeEnabled ? `+ Judge ${costBreakdown.judgeCostCredits} cr` : "Quick score"}</span>
                            <span style={{ fontSize: "11px", color: "var(--text-muted)", fontWeight: "600", marginLeft: "auto" }}>Total: {costBreakdown.allPromptCostCredits} cr</span>
                          </div>
                        </div>
                      </label>
                    );
                  })}
                </div>
              </div>

              <div style={{ display: "flex", flexDirection: "column", gap: "12px", marginTop: "auto", borderTop: "1px solid var(--border-color)", paddingTop: "15px" }}>
                {/* Per-model cost breakdown */}
                {selectedModels.length > 0 && (
                  <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
                    <span style={{ fontSize: "11px", fontWeight: "600", color: "var(--text-muted)", marginBottom: "2px" }}>Per-model breakdown ({evaluationScenarioCount} prompts each):</span>
                    {selectedModels.map((modelId) => {
                      const bd = getModelEvaluationCostBreakdown(modelId);
                      const lvl = thinkingLevelLabelFor(modelId, bd.thinkingLevel);
                      return (
                        <div key={modelId} style={{ display: "flex", justifyContent: "space-between", fontSize: "11px", color: "var(--text-muted)", padding: "3px 6px", borderRadius: "4px", background: "rgba(94, 75, 50, 0.04)" }}>
                          <span style={{ fontWeight: "600" }}>{getModelName(modelId)}</span>
                          <span>{bd.allPromptCostCredits} cr <span style={{ color: bd.thinkingLevel !== "none" ? "var(--accent)" : "inherit", fontWeight: "600" }}>({lvl}{bd.thinkingMultiplier > 1 ? ` ${bd.thinkingMultiplier}x` : ""})</span></span>
                        </div>
                      );
                    })}
                  </div>
                )}
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <div style={{ display: "flex", flexDirection: "column" }}>
                  <span style={{ fontSize: "12px", color: "var(--text-muted)", fontWeight: "500" }}>Estimated Total Cost</span>
                  <strong style={{ fontSize: "18px", color: "var(--accent)" }}>{getEstimatedCost()} credits</strong>
                  <span style={{ fontSize: "11px", color: "var(--text-muted)" }}>
                    {evaluationScenarioCount} prompts x {selectedModels.length} models
                  </span>
                  <span style={{ fontSize: "11px", color: "var(--text-muted)" }}>
                    Provider estimate ${estimatedProviderUsd.toFixed(2)}
                  </span>
                </div>
                
                <button
                  className="login-btn primary small"
                  onClick={() => setShowWarningModal(true)}
                  disabled={isEvalRunning || selectedModels.length === 0 || scenarios.length === 0}
                  style={{
                    padding: "10px 20px",
                    borderRadius: "6px",
                    border: "none",
                    cursor: "pointer",
                    fontWeight: "600",
                    display: "flex",
                    alignItems: "center",
                    gap: "8px",
                    background: "var(--accent)",
                    color: "var(--text-on-dark)",
                    opacity: (isEvalRunning || selectedModels.length === 0 || scenarios.length === 0) ? 0.5 : 1,
                    transition: "opacity 0.2s"
                  }}
                >
                  {isEvalRunning ? "Running..." : "Run All Prompts"}
                </button>
              </div>
              </div>
            </div>

          </div>

          {evaluationLeaderboard.length > 0 && (
            <div className="card" style={{ padding: "20px", display: "flex", flexDirection: "column", gap: "14px" }}>
              <div className="card-header" style={{ borderBottom: "1px solid var(--border-color)", paddingBottom: "10px", fontWeight: "700" }}>
                <Database size={16} style={{ marginRight: "8px", verticalAlign: "middle" }} />
                Backend Model Leaderboard
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: "12px" }}>
                {evaluationLeaderboard.map((entry, index) => (
                  <div key={entry.modelId} style={{ border: "1px solid var(--border-color)", borderRadius: "8px", padding: "12px", background: index === 0 ? "rgba(46, 125, 50, 0.045)" : "rgba(94, 75, 50, 0.02)", display: "flex", flexDirection: "column", gap: "10px" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", gap: "10px", alignItems: "center" }}>
                      <strong style={{ fontSize: "14px", color: "var(--text-bright)" }}>#{index + 1} {getModelName(entry.modelId)}</strong>
                      <span style={{ fontSize: "12px", fontWeight: 800, color: entry.averageScore >= 8 ? "#2e7d32" : entry.averageScore >= 6 ? "#ef6c00" : "#c62828" }}>
                        {entry.averageScore.toFixed(1)}/10 avg
                      </span>
                    </div>
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "6px", fontSize: "11px", color: "var(--text-muted)" }}>
                      <span>{entry.runCount} runs</span>
                      <span>{formatRate(entry.successRate)} success</span>
                      <span>{formatRate(entry.syntaxPassRate)} syntax</span>
                      <span>{formatRate(entry.safetyPassRate)} safety</span>
                      <span>{(entry.averageLatencyMs / 1000).toFixed(1)}s avg</span>
                      <span>{entry.averageCostCredits.toFixed(1)} cr avg</span>
                      <span>{entry.averageRankScore?.toFixed(1) ?? "0.0"} rank</span>
                      <span>{entry.averageValueScore?.toFixed(2) ?? "0.00"} value</span>
                    </div>
                    {entry.bestPromptName && (
                      <div style={{ fontSize: "11px", color: "var(--text-muted)", lineHeight: 1.4 }}>
                        Best: <strong style={{ color: "var(--text-bright)" }}>{entry.bestScore}/10</strong> on {entry.bestPromptName}
                      </div>
                    )}
                    <div style={{ display: "flex", flexWrap: "wrap", gap: "5px" }}>
                      {entry.strengths.slice(0, 3).map((strength) => (
                        <span key={strength} style={{ fontSize: "10px", fontWeight: 700, color: "#2e7d32", background: "rgba(46, 125, 50, 0.08)", borderRadius: "4px", padding: "2px 5px" }}>{strength}</span>
                      ))}
                      {entry.weaknesses.slice(0, 3).map((weakness) => (
                        <span key={weakness} style={{ fontSize: "10px", fontWeight: 700, color: "#c62828", background: "rgba(198, 40, 40, 0.08)", borderRadius: "4px", padding: "2px 5px" }}>{weakness}</span>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Live Runner Status Panel */}
          {(isEvalRunning || liveStep || evalError || evalSuccessMessage || liveRunMetrics.length > 0) && (
            <div className="card" style={{ padding: "20px", display: "flex", flexDirection: "column", gap: "16px" }}>
              <div className="card-header" style={{ borderBottom: "1px solid var(--border-color)", paddingBottom: "10px", fontWeight: "700" }}>
                <RefreshCcw size={16} className={isEvalRunning ? "spin" : ""} style={{ marginRight: "8px", verticalAlign: "middle" }} />
                Active Runner Progress
              </div>

              {isEvalRunning && (
                <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", fontSize: "13px", fontWeight: "500" }}>
                    <span>{liveStep}</span>
                    <span>In Progress...</span>
                  </div>
                  <div style={{ height: "6px", borderRadius: "3px", background: "rgba(94, 75, 50, 0.1)", overflow: "hidden" }}>
                    <div
                      style={{
                        height: "100%",
                        background: "linear-gradient(90deg, var(--accent), var(--accent-warm-soft))",
                        borderRadius: "3px",
                        width: liveStep.includes("complete") ? "100%" : liveStep.includes("judge") ? "80%" : liveStep.includes("syntax") ? "50%" : liveStep.includes("generating") ? "30%" : "10%",
                        transition: "width 0.5s ease"
                      }}
                    />
                  </div>
                </div>
              )}

              {evalError && <div className="err-msg" style={{ margin: "0" }}>{evalError}</div>}
              {evalSuccessMessage && <div style={{ color: "var(--success)", fontSize: "14px", fontWeight: "600" }}>{evalSuccessMessage}</div>}

              {/* Live Run Metrics Cards */}
              {liveRunMetrics.length > 0 && (
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "16px", marginTop: "10px" }}>
                  {[...liveRunMetrics].sort((a, b) => b.score - a.score).map((run, index) => (
                    <div
                      key={run.compositeId || run.modelId}
                      className="card"
                      style={{
                        padding: "16px",
                        border: "1px solid var(--border-color)",
                        background: "rgba(94, 75, 50, 0.02)",
                        display: "flex",
                        flexDirection: "column",
                        gap: "12px"
                      }}
                    >
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                        <strong style={{ fontSize: "15px" }}>Rank #{index + 1}: {getModelName(run.modelId)}</strong>
                        <span
                          style={{
                            padding: "4px 8px",
                            borderRadius: "12px",
                            fontSize: "12px",
                            fontWeight: "700",
                            background: run.score >= 8 ? "rgba(46, 125, 50, 0.1)" : run.score >= 6 ? "rgba(239, 108, 0, 0.1)" : "rgba(198, 40, 40, 0.1)",
                            color: run.score >= 8 ? "#2e7d32" : run.score >= 6 ? "#ef6c00" : "#c62828"
                          }}
                        >
                          Score: {run.score}/10
                        </span>
                      </div>

                      <div style={{ display: "flex", gap: "10px", flexWrap: "wrap" }}>
                        {run.scenarioName && (
                          <span style={{ fontSize: "11px", padding: "2px 6px", borderRadius: "4px", background: "rgba(94, 75, 50, 0.08)", color: "var(--text-muted)", fontWeight: "600" }}>
                            {run.scenarioName}
                          </span>
                        )}
                        <span style={{ fontSize: "11px", padding: "2px 6px", borderRadius: "4px", background: run.safetyOk ? "rgba(46, 125, 50, 0.1)" : "rgba(198, 40, 40, 0.1)", color: run.safetyOk ? "#2e7d32" : "#c62828", fontWeight: "600" }}>
                          {run.safetyOk ? "Safe" : "Safety Flagged"}
                        </span>
                        <span style={{ fontSize: "11px", padding: "2px 6px", borderRadius: "4px", background: run.syntaxOk ? "rgba(46, 125, 50, 0.1)" : "rgba(198, 40, 40, 0.1)", color: run.syntaxOk ? "#2e7d32" : "#c62828", fontWeight: "600" }}>
                          {run.syntaxOk ? "Syntax OK" : "Syntax Error"}
                        </span>
                        <span style={{ fontSize: "11px", color: "var(--text-muted)", fontWeight: "500" }}>Speed: {(run.latencyMs / 1000).toFixed(1)}s</span>
                        <span style={{ fontSize: "11px", color: "var(--text-muted)", fontWeight: "500" }}>Cost: {run.costCredits} credits</span>
                        {run.rankScore !== undefined && <span style={{ fontSize: "11px", color: "var(--text-muted)", fontWeight: "500" }}>Rank score: {run.rankScore.toFixed(1)}</span>}
                        {run.valueScore !== undefined && <span style={{ fontSize: "11px", color: "var(--text-muted)", fontWeight: "500" }}>Value: {run.valueScore.toFixed(2)}</span>}
                        {run.generationCostCredits !== undefined && run.judgeCostCredits !== undefined && (
                          <span style={{ fontSize: "11px", color: "var(--text-muted)", fontWeight: "500" }}>
                            Gen {run.generationCostCredits} + Judge {run.judgeCostCredits}
                          </span>
                        )}
                        {run.estimatedProviderCostUsd !== undefined && (
                          <span style={{ fontSize: "11px", color: "var(--text-muted)", fontWeight: "500" }}>
                            Provider ${run.estimatedProviderCostUsd.toFixed(2)}
                          </span>
                        )}
                        <span style={{ fontSize: "11px", padding: "2px 6px", borderRadius: "4px", background: run.thinkingLevel && run.thinkingLevel !== "none" ? "rgba(94, 75, 50, 0.12)" : "rgba(94, 75, 50, 0.05)", color: run.thinkingLevel && run.thinkingLevel !== "none" ? "var(--accent)" : "var(--text-muted)", fontWeight: "700" }}>
                          Thinking: {thinkingLevelLabelFor(run.modelId, run.thinkingLevel || "none")}{run.thinkingMultiplier !== undefined && run.thinkingMultiplier > 1 ? ` (${run.thinkingMultiplier}x)` : ""}
                        </span>
                        {run.usageMultiplier !== undefined && run.usageMultiplier !== 1 && (
                          <span style={{ fontSize: "11px", padding: "2px 6px", borderRadius: "4px", background: "rgba(94, 75, 50, 0.05)", color: "var(--text-muted)", fontWeight: "600" }}>
                            Usage: {run.usageMultiplier}x
                          </span>
                        )}
                        {run.repairAttempts !== undefined && (
                          <span style={{ fontSize: "11px", color: "var(--text-muted)", fontWeight: "500" }}>Repairs: {run.repairAttempts}</span>
                        )}
                      </div>

                      <div style={{ fontSize: "13px", color: "var(--text-muted)", borderTop: "1px dashed var(--border-color)", paddingTop: "8px" }}>
                        <strong>Judge Feedback:</strong>
                        <p style={{ marginTop: "4px", fontStyle: "italic", lineHeight: "1.4" }}>{run.reasoning}</p>
                      </div>

                      {run.syntaxErrors && run.syntaxErrors.length > 0 && (
                        <div style={{ fontSize: "12px", background: "rgba(198, 40, 40, 0.05)", padding: "8px", borderRadius: "4px", border: "1px solid rgba(198, 40, 40, 0.1)" }}>
                          <strong style={{ color: "#c62828" }}>Syntax Errors:</strong>
                          <ul style={{ margin: "4px 0 0 16px", padding: "0" }}>
                            {run.syntaxErrors.map((err: string, i: number) => (
                              <li key={i}>{err}</li>
                            ))}
                          </ul>
                        </div>
                      )}

                      {renderRequirementChecks(run)}
                      {renderGeneratedOutput(run)}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Historical Evaluations Log */}
          <div className="card" style={{ padding: "20px" }}>
            <div className="card-header" style={{ borderBottom: "1px solid var(--border-color)", paddingBottom: "10px", fontWeight: "700", display: "flex", justifyContent: "space-between", gap: "12px", alignItems: "center" }}>
              <span>
                <Users size={16} style={{ marginRight: "8px", verticalAlign: "middle" }} />
                Evaluation Run History
              </span>
              <button className="login-btn secondary small" onClick={handleClearEvaluations} disabled={evaluations.length === 0 || isEvalRunning || evaluationMutationBusy} style={{ display: "inline-flex", alignItems: "center", gap: "6px" }}>
                <Trash2 size={13} />
                Clear
              </button>
            </div>

            {evaluations.length === 0 ? (
              <div style={{ textAlign: "center", padding: "40px 20px", color: "var(--text-muted)", fontSize: "14px" }}>
                No past evaluations found. Configure and trigger a run above to generate results.
              </div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: "12px", marginTop: "16px" }}>
                {evaluations.map((run) => {
                  const dateLabel = new Date(run.startedAt).toLocaleString();
                  const scenarioName = scenarios.find(s => s.id === run.promptId)?.name || (run.promptId === "custom" ? "Custom Scenario" : run.promptId);
                  const isExpanded = expandedCardId === run.id;

                  return (
                    <div
                      key={run.id}
                      style={{
                        border: "1px solid var(--border-color)",
                        borderRadius: "8px",
                        background: "rgba(94, 75, 50, 0.01)",
                        overflow: "hidden"
                      }}
                    >
                      <div
                        onClick={() => setExpandedCardId(isExpanded ? null : run.id)}
                        style={{
                          padding: "14px 16px",
                          display: "flex",
                          justifyContent: "space-between",
                          alignItems: "center",
                          cursor: "pointer",
                          background: "rgba(94, 75, 50, 0.03)",
                          transition: "background 0.2s"
                        }}
                      >
                        <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
                          <strong style={{ fontSize: "14px", color: "var(--text-bright)" }}>{scenarioName}</strong>
                          <span style={{ fontSize: "11px", color: "var(--text-muted)" }}>{dateLabel} • ID: {run.id.slice(0, 8)}</span>
                        </div>

                        <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
                          <div style={{ display: "flex", gap: "6px" }}>
                            {[...run.runs].sort((a, b) => b.score - a.score).map((r, index) => (
                              <span
                                key={`${r.modelId}-${index}`}
                                style={{
                                  padding: "2px 6px",
                                  borderRadius: "4px",
                                  fontSize: "11px",
                                  fontWeight: "600",
                                  background: r.score >= 8 ? "rgba(46, 125, 50, 0.1)" : r.score >= 6 ? "rgba(239, 108, 0, 0.1)" : "rgba(198, 40, 40, 0.1)",
                                  color: r.score >= 8 ? "#2e7d32" : r.score >= 6 ? "#ef6c00" : "#c62828"
                                }}
                              >
                                {getModelShortName(r.modelId)}: {r.score}
                              </span>
                            ))}
                          </div>
                          <span style={{ fontSize: "12px", color: "var(--text-muted)" }}>
                            {isExpanded ? "Collapse" : "Expand"}
                          </span>
                          <button
                            className="login-btn secondary small"
                            onClick={(event) => {
                              event.stopPropagation();
                              void handleDeleteEvaluation(run.id);
                            }}
                            disabled={isEvalRunning || evaluationMutationBusy}
                            title="Delete evaluation entry"
                            style={{ display: "inline-flex", alignItems: "center", gap: "5px", padding: "5px 8px" }}
                          >
                            <Trash2 size={12} />
                            Delete
                          </button>
                        </div>
                      </div>

                      {isExpanded && (
                        <div style={{ padding: "16px", borderTop: "1px solid var(--border-color)", display: "flex", flexDirection: "column", gap: "16px" }}>
                          <div style={{ fontSize: "13px", color: "var(--text-muted)", background: "var(--bg-accent)", padding: "10px", borderRadius: "6px" }}>
                            <strong>Original Prompt:</strong>
                            <p style={{ marginTop: "4px", fontFamily: "monospace", whiteSpace: "pre-wrap" }}>{run.promptText}</p>
                          </div>

                          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "16px" }}>
                            {[...run.runs].sort((a, b) => b.score - a.score).map((r, index) => (
                              <div
                                key={`${r.modelId}-${index}`}
                                style={{
                                  padding: "14px",
                                  borderRadius: "6px",
                                  border: "1px solid var(--border-color)",
                                  background: "var(--bg-panel)"
                                }}
                              >
                                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "8px" }}>
                                  <strong>Rank #{index + 1}: {getModelName(r.modelId)}</strong>
                                  <span
                                    style={{
                                      fontSize: "11px",
                                      padding: "2px 6px",
                                      borderRadius: "4px",
                                      fontWeight: "700",
                                      background: r.score >= 8 ? "rgba(46, 125, 50, 0.1)" : r.score >= 6 ? "rgba(239, 108, 0, 0.1)" : "rgba(198, 40, 40, 0.1)",
                                      color: r.score >= 8 ? "#2e7d32" : r.score >= 6 ? "#ef6c00" : "#c62828"
                                    }}
                                  >
                                    Score: {r.score}/10
                                  </span>
                                </div>

                                <div style={{ display: "flex", gap: "8px", fontSize: "11px", marginBottom: "10px", flexWrap: "wrap" }}>
                                  <span style={{ padding: "2px 4px", borderRadius: "3px", background: r.safetyOk ? "rgba(46, 125, 50, 0.05)" : "rgba(198, 40, 40, 0.05)", color: r.safetyOk ? "#2e7d32" : "#c62828" }}>
                                    Safety: {r.safetyOk ? "OK" : "Flagged"}
                                  </span>
                                  <span style={{ padding: "2px 4px", borderRadius: "3px", background: r.syntaxOk ? "rgba(46, 125, 50, 0.05)" : "rgba(198, 40, 40, 0.05)", color: r.syntaxOk ? "#2e7d32" : "#c62828" }}>
                                    Syntax: {r.syntaxOk ? "OK" : "Errors"}
                                  </span>
                                  <span style={{ color: "var(--text-muted)" }}>Speed: {(r.latencyMs / 1000).toFixed(1)}s</span>
                                  <span style={{ color: "var(--text-muted)" }}>Cost: {r.costCredits} cr</span>
                                  {r.rankScore !== undefined && <span style={{ color: "var(--text-muted)" }}>Rank {r.rankScore.toFixed(1)}</span>}
                                  {r.valueScore !== undefined && <span style={{ color: "var(--text-muted)" }}>Value {r.valueScore.toFixed(2)}</span>}
                                  {r.generationCostCredits !== undefined && r.judgeCostCredits !== undefined && (
                                    <span style={{ color: "var(--text-muted)" }}>Gen {r.generationCostCredits} + Judge {r.judgeCostCredits}</span>
                                  )}
                                  {r.estimatedProviderCostUsd !== undefined && (
                                    <span style={{ color: "var(--text-muted)" }}>Provider ${r.estimatedProviderCostUsd.toFixed(2)}</span>
                                  )}
                                  <span style={{ padding: "2px 5px", borderRadius: "3px", background: r.thinkingLevel && r.thinkingLevel !== "none" ? "rgba(94, 75, 50, 0.12)" : "rgba(94, 75, 50, 0.05)", color: r.thinkingLevel && r.thinkingLevel !== "none" ? "var(--accent)" : "var(--text-muted)", fontWeight: "700" }}>
                                    Thinking: {thinkingLevelLabelFor(r.modelId, r.thinkingLevel || "none")}{r.thinkingMultiplier !== undefined && r.thinkingMultiplier > 1 ? ` (${r.thinkingMultiplier}x)` : ""}
                                  </span>
                                  {r.usageMultiplier !== undefined && r.usageMultiplier !== 1 && (
                                    <span style={{ padding: "2px 5px", borderRadius: "3px", background: "rgba(94, 75, 50, 0.05)", color: "var(--text-muted)", fontWeight: "600" }}>
                                      Usage: {r.usageMultiplier}x
                                    </span>
                                  )}
                                  {r.repairAttempts !== undefined && (
                                    <span style={{ color: "var(--text-muted)" }}>Repairs: {r.repairAttempts}</span>
                                  )}
                                </div>

                                <div style={{ fontSize: "12px", borderTop: "1px solid var(--border-color)", paddingTop: "8px" }}>
                                  <strong>Feedback:</strong>
                                  <p style={{ margin: "4px 0 0 0", fontStyle: "italic" }}>{r.reasoning}</p>
                                </div>

                                {r.syntaxErrors && r.syntaxErrors.length > 0 && (
                                  <div style={{ fontSize: "11px", background: "rgba(198, 40, 40, 0.05)", padding: "8px", borderRadius: "4px", border: "1px solid rgba(198, 40, 40, 0.1)", marginTop: "10px" }}>
                                    <strong style={{ color: "#c62828" }}>Syntax Errors:</strong>
                                    <ul style={{ margin: "4px 0 0 12px", padding: "0" }}>
                                      {r.syntaxErrors.map((err: string, i: number) => (
                                        <li key={i}>{err}</li>
                                      ))}
                                    </ul>
                                  </div>
                                )}

                                {renderRequirementChecks(r)}
                                {renderGeneratedOutput(r)}
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
           </div>
        </div>
      )}

      {activeTab === "subscribers" && (
        <div className="admin-panel-section">
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "16px" }}>
            <h3 style={{ margin: 0 }}>Email Subscribers ({subscribers.length})</h3>
            <button
              className="login-btn secondary small"
              onClick={() => {
                setSubscribersLoading(true);
                api.adminSubscribers()
                  .then(res => setSubscribers(res.subscribers))
                  .catch(() => {})
                  .finally(() => setSubscribersLoading(false));
              }}
              disabled={subscribersLoading}
            >
              <RefreshCcw size={13} />
              {subscribersLoading ? "Loading..." : "Refresh"}
            </button>
          </div>
          {subscribersLoading && subscribers.length === 0 ? (
            <p style={{ color: "var(--text-muted)", fontSize: "13px" }}>Loading subscribers...</p>
          ) : subscribers.length === 0 ? (
            <p style={{ color: "var(--text-muted)", fontSize: "13px" }}>No email subscribers yet.</p>
          ) : (
            <table className="admin-table">
              <thead>
                <tr>
                  <th>Email</th>
                  <th>Subscribed</th>
                  <th>IP</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {subscribers.map(sub => (
                  <tr key={sub.id}>
                    <td><strong>{sub.email}</strong></td>
                    <td>{new Date(sub.subscribedAt).toLocaleDateString()}</td>
                    <td style={{ fontSize: "11px", color: "var(--text-muted)" }}>{sub.ip || "-"}</td>
                    <td>
                      <button
                        className="glass-action danger"
                        title="Remove subscriber"
                        onClick={async () => {
                          await api.adminDeleteSubscriber(sub.id);
                          setSubscribers(prev => prev.filter(s => s.id !== sub.id));
                        }}
                      >
                        <Trash2 size={12} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      <Modal
        isOpen={Boolean(evaluationConfirm)}
        onClose={() => {
          if (!evaluationMutationBusy) setEvaluationConfirm(null);
        }}
        title={evaluationConfirm?.type === "clear" ? "Clear Evaluation History" : "Delete Evaluation Entry"}
        footer={
          <>
            <button className="login-btn secondary small" onClick={() => setEvaluationConfirm(null)} disabled={evaluationMutationBusy}>Cancel</button>
            <button className="login-btn primary small" onClick={() => void confirmEvaluationMutation()} disabled={evaluationMutationBusy}>
              {evaluationMutationBusy ? "Working..." : evaluationConfirm?.type === "clear" ? "Clear History" : "Delete Entry"}
            </button>
          </>
        }
      >
        <p className="modal-help-text">
          {evaluationConfirm?.type === "clear"
            ? "This removes all backend evaluation runs and leaderboard entries from saved history."
            : "This removes the selected backend evaluation run from saved history."}
        </p>
        <p className="modal-help-text" style={{ marginTop: "10px" }}>
          This only affects stored evaluation data. Project chats and Studio patches are untouched.
        </p>
      </Modal>

      {/* Warning Confirmation Modal */}
      <Modal
        isOpen={showWarningModal}
        onClose={() => setShowWarningModal(false)}
        title="Confirm Evaluation Run"
        footer={
          <>
            <button className="login-btn secondary small" onClick={() => setShowWarningModal(false)}>Cancel</button>
            <button
              className="login-btn primary small"
              onClick={async () => {
                setShowWarningModal(false);
                setIsEvalRunning(true);
                setEvalError("");
                setEvalSuccessMessage("");
                setLiveRunMetrics([]);
                
                try {
                  const scenarioSuite = scenarios.length > 0 ? scenarios : [
                    { id: "leaderstats", name: "Leaderstats and Touch Reward" },
                    { id: "sprint", name: "Client Sprint & Server Anti-Exploit" },
                    { id: "shop", name: "GUI Shop & Remote Wiring" }
                  ];
                  const completedRuns: ModelEvaluationRun[] = [];
                  let totalCharged = 0;
                  let failedRuns = 0;
                  const totalRuns = scenarioSuite.length * selectedModels.length;

                  for (let index = 0; index < scenarioSuite.length; index++) {
                    const scenario = scenarioSuite[index];
                    setLiveStep(`Running ${index + 1}/${scenarioSuite.length}: ${scenario.name} with ${selectedModels.length} models`);

                    try {
                      const res = await runEvaluation({
                        promptId: scenario.id as "leaderstats" | "sprint" | "shop",
                        models: selectedModels,
                        judgeEnabled: liveEvaluationJudgeEnabled
                      });

                      const returnedRuns = res.runs?.length ? res.runs : [res.run];
                      completedRuns.push(...returnedRuns);
                      totalCharged += res.totalCostCredits ?? returnedRuns.reduce((sum, run) => sum + (run.totalCostCredits ?? run.runs.reduce((runSum, modelRun) => runSum + modelRun.costCredits, 0)), 0);

                      setLiveRunMetrics((current) => [
                        ...current,
                        ...returnedRuns.flatMap((run) => run.runs.map((modelRun) => ({
                          ...modelRun,
                          compositeId: `${run.id}-${modelRun.modelId}`,
                          scenarioName: scenarios.find(s => s.id === run.promptId)?.name || scenario.name || run.promptId
                        })))
                      ]);
                    } catch (err) {
                      failedRuns += selectedModels.length;
                      setLiveRunMetrics((current) => [
                        ...current,
                        ...selectedModels.map((modelId) => ({
                          compositeId: `failed-${scenario.id}-${modelId}`,
                          modelId,
                          scenarioName: scenario.name,
                          success: false,
                          latencyMs: 0,
                          costCredits: 0,
                          safetyOk: false,
                          blockedPatterns: [],
                          syntaxOk: false,
                          syntaxErrors: [],
                          score: 1,
                          reasoning: err instanceof Error && err.message.includes("Could not reach")
                            ? "This grouped model run lost the API connection before the server returned. The suite continued with the next prompt."
                            : err instanceof Error ? err.message : "This grouped model run failed before returning a result."
                        }))
                      ]);
                    }
                  }

                  setLiveStep("Evaluation complete!");
                  setEvalSuccessMessage(
                    failedRuns > 0
                      ? `Evaluation finished with ${totalRuns - failedRuns}/${totalRuns} runs completed. Total charge: ${totalCharged.toLocaleString()} credits.`
                      : `Evaluation completed successfully. Total charge: ${totalCharged.toLocaleString()} credits.`
                  );
                  await refreshEvaluations();
                } catch (err) {
                  setLiveStep("Evaluation failed.");
                  setEvalError(err instanceof Error ? err.message : "An error occurred during the evaluation run.");
                } finally {
                  setIsEvalRunning(false);
                }
              }}
            >
              Confirm and Run
            </button>
          </>
        }
      >
        <p className="modal-help-text">
          Executing the full prompt suite will consume an estimated <strong>{getEstimatedCost()} credits</strong>.
        </p>
        <p className="modal-help-text" style={{ marginTop: "10px" }}>
          This runs {evaluationScenarioCount} prompts across {selectedModels.length} selected models with quick safety and syntax scoring. Estimated provider cost is ${estimatedProviderUsd.toFixed(2)}.
        </p>
      </Modal>
    </div>
  );
}
