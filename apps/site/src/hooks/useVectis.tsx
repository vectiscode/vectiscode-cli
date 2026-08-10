import { createContext, useContext, useEffect, useMemo, useRef, useState, ReactNode } from "react";
import { ApiError, api } from "../api";
import { shouldGenerateChangeSet } from "../intent";
import { reportClientError } from "../clientDiagnostics";
import type { AdminUser, AiMessage, Attachment, AuthConfig, BillingCycle, BootstrapData, ChangeSet, EvaluationScenario, PlanName, Project, ProjectSnapshot, StudioSession, Thread, TopUpPack, UserPreferences, ModelEvaluationRun, ModelEvaluationLeaderboardEntry, TaskPlan, PatchComment } from "../types";
import { chatTitleFromPrompt, isDefaultThreadName, binaryThinkingLevel, deepSeekThinkingLevel, isAlwaysThinkingModel, isBinaryThinkingModel } from "../utils/chatUtils";
import { formatPairingCode, normalizePairingCode } from "../utils/pairingCode";

interface VectisContextType {
  authConfig: AuthConfig | null;
  data: BootstrapData | null;
  loading: boolean;
  busy: boolean;
  isLoggingOut: boolean;
  thinkingStartedAt: number | null;
  activeChatRequestId: string | null;
  activeChatRequestModel: string | null;
  chatProgress: ChatProgress | null;
  progressSteps: ProgressStep[];
  streamingContent: string;
  reasoningPreview: string;
  reasoningPreviewDone: boolean;
  error: string;
  setError: (err: string) => void;
  setBusy: (busy: boolean) => void;
  load: () => Promise<void>;
  loginPrivate: () => Promise<void>;
  loginFirebase: () => Promise<void>;
  loginSupabase: () => Promise<void>;
  logout: () => Promise<void>;
  
  theme: "light" | "dark";
  setTheme: (theme: "light" | "dark") => void;

  themeLightPreset: string;
  setThemeLightPreset: (val: string) => void;
  themeLightBg: string;
  setThemeLightBg: (val: string) => void;
  themeLightFg: string;
  setThemeLightFg: (val: string) => void;
  themeLightAccent: string;
  setThemeLightAccent: (val: string) => void;

  themeDarkPreset: string;
  setThemeDarkPreset: (val: string) => void;
  themeDarkBg: string;
  setThemeDarkBg: (val: string) => void;
  themeDarkFg: string;
  setThemeDarkFg: (val: string) => void;
  themeDarkAccent: string;
  setThemeDarkAccent: (val: string) => void;
  
  planMode: boolean;
  setPlanMode: (mode: boolean) => void;
  
  selectedModel: string;
  setSelectedModel: (model: string) => void;
  
  usageOptimizer: boolean;
  setUsageOptimizer: (enabled: boolean) => void;
  optimizationMode: "disabled" | "balanced" | "cost_saver";
  setOptimizationMode: (mode: "disabled" | "balanced" | "cost_saver") => void;
  verificationMode: "off" | "standard" | "deep";
  setVerificationMode: (mode: "off" | "standard" | "deep") => void;
  modelMode: "fast" | "balanced" | "best" | "deep_verify";
  setModelMode: (mode: "fast" | "balanced" | "best" | "deep_verify") => void;

  fileReferences: boolean;
  setFileReferences: (enabled: boolean) => void;

  selectedProjectId: string;
  setSelectedProjectId: (id: string) => void;
  selectedThreadId: string;
  setSelectedThreadId: (id: string) => void;
  
  selectedProject: Project | undefined;
  threads: Thread[];
  messages: AiMessage[];
  changeSets: ChangeSet[];
  snapshot: ProjectSnapshot | undefined;
  linkedSession: StudioSession | undefined;
  pending: ChangeSet[];
  approved: ChangeSet[];
  nodeCount: number;
  scriptCount: number;
  isPluginOnline: boolean;
  lastSyncLabel: string;
  
  approveChange: (id: string) => Promise<void>;
  undoChange: (id: string) => Promise<void>;
  dismissChange: (id: string) => Promise<{ changeSet?: ChangeSet; refundIssued?: boolean; refundAmount?: number } | null>;
  createThread: () => Promise<string | undefined>;
  deleteThread: (id: string) => Promise<void>;
  deleteThreads: (ids: string[]) => Promise<string[]>;
  renameThread: (id: string, name: string) => Promise<void>;
  sendPrompt: (prompt: string, model: string, planMode: boolean, usageOptimizer: boolean, verificationMode: "off" | "standard" | "deep", attachmentIds?: string[], intent?: "general" | "console_fix", modelMode?: "fast" | "balanced" | "best" | "deep_verify") => Promise<void>;
  editMessage: (messageId: string, prompt: string, model: string, planMode: boolean, usageOptimizer: boolean, verificationMode: "off" | "standard" | "deep", attachmentIds?: string[], intent?: "general" | "console_fix", modelMode?: "fast" | "balanced" | "best" | "deep_verify") => Promise<void>;
  retryPrompt: (messageId: string) => Promise<void>;
  dismissFailedMessage: (messageId: string) => void;
  cancelChatRequest: () => void;
  editTaskPlan: (planId: string, updates: Partial<TaskPlan>) => Promise<void>;
  approveTaskPlan: (planId: string, options?: { model?: string }) => Promise<void>;
  supersedeTaskPlan: (planId: string) => Promise<void>;
  addComment: (changeSetId: string, commentText: string, filePath?: string) => Promise<void>;
  resolveComment: (commentId: string) => Promise<void>;

  uploadAttachment: (file: File, threadId?: string) => Promise<Attachment>;
  deleteAttachment: (attachmentId: string) => Promise<void>;
  generateIcon: (prompt: string, threadId?: string) => Promise<Attachment>;
  statusTextForChangeSet: (cs: ChangeSet) => string;
  
  claim: (code: string) => Promise<void>;
  unlink: (sessionId: string) => Promise<boolean>;
  clearLocalData: () => Promise<void>;
  deleteAccount: () => Promise<void>;
  startCheckout: (plan?: Exclude<PlanName, "free">, billingCycle?: BillingCycle) => Promise<void>;
  buyTopUp: (pack: TopUpPack["id"]) => Promise<void>;
  buyCustomTopUp: (usagePercent: number) => Promise<void>;
  openBillingPortal: () => Promise<void>;
  savePreferencePatch: (patch: UserPreferences) => void;
  creditEstimate: number;
  fetchEvaluations: () => Promise<{ runs: ModelEvaluationRun[]; scenarios: EvaluationScenario[]; leaderboard: ModelEvaluationLeaderboardEntry[] }>;
  runEvaluation: (input: { promptId: "leaderstats" | "sprint" | "shop" | "custom" | "all"; customPromptText?: string; models?: string[]; judgeEnabled?: boolean }) => Promise<{ run: ModelEvaluationRun; runs: ModelEvaluationRun[]; totalCostCredits: number; estimatedCostCredits: number; estimatedProviderCostUsd: number; creditBalance: number }>;
  deleteEvaluation: (runId: string) => Promise<void>;
  clearEvaluations: () => Promise<void>;
}

interface ChatProgress {
  threadId: string;
  stage: string;
  label: string;
  detail?: string;
  elapsedMs: number;
  model?: string;
  thinkingLevel?: string;
  planning?: "running" | "skipped" | "completed";
  timestamp?: number;
}

interface ProgressStep {
  stage: string;
  label: string;
  timestamp: number;
}

const VectisContext = createContext<VectisContextType | null>(null);
const RECENT_SERVER_STATE_TTL_MS = 30 * 60_000;
const CHAT_RECOVERY_MAX_WAIT_MS = 10 * 60_000;

function chatRecoveryPollDelayMs(elapsedMs: number) {
  if (elapsedMs < 30_000) return 1_000;
  if (elapsedMs < 2 * 60_000) return 2_500;
  return 5_000;
}

function mergePendingMessages(
  next: BootstrapData,
  prev: BootstrapData | null,
  activeOptimisticIds: Set<string>,
  protectedMessageIds: Set<string>,
  protectedChangeSetIds: Set<string>,
  deletedMessageIds: Set<string>,
  deletedChangeSetIds: Set<string>
): BootstrapData {
  const cleanNext = {
    ...next,
    messages: next.messages.filter((message) => !deletedMessageIds.has(message.id)),
    changeSets: next.changeSets.filter((changeSet) => !deletedChangeSetIds.has(changeSet.id))
  };

  if (!prev) return cleanNext;

  const pending = prev.messages.filter((message) => {
    if (!message.id.startsWith("opt_")) return false;
    if (!activeOptimisticIds.has(message.id)) return false;
    if (deletedMessageIds.has(message.id)) return false;
    const matchingSynced = cleanNext.messages.some((synced) =>
      synced.id === message.id ||
      (
        synced.role === message.role &&
        synced.projectId === message.projectId &&
        synced.threadId === message.threadId &&
        synced.content === message.content
      )
    );
    return !matchingSynced;
  });

  const protectedMessages = prev.messages.filter((message) =>
    !message.id.startsWith("opt_")
    && protectedMessageIds.has(message.id)
    && !deletedMessageIds.has(message.id)
    && cleanNext.threads.some((thread) => thread.id === message.threadId)
    && cleanNext.projects.some((project) => project.id === message.projectId)
    && !cleanNext.messages.some((synced) => synced.id === message.id)
  );
  const protectedChangeSets = prev.changeSets.filter((changeSet) =>
    protectedChangeSetIds.has(changeSet.id)
    && !deletedChangeSetIds.has(changeSet.id)
    && cleanNext.threads.some((thread) => thread.id === changeSet.threadId)
    && cleanNext.projects.some((project) => project.id === changeSet.projectId)
    && !cleanNext.changeSets.some((synced) => synced.id === changeSet.id)
  );

  if (pending.length === 0 && protectedMessages.length === 0 && protectedChangeSets.length === 0) return cleanNext;
  return {
    ...cleanNext,
    messages: [...cleanNext.messages, ...pending, ...protectedMessages],
    changeSets: [...cleanNext.changeSets, ...protectedChangeSets]
  };
}

function preserveActiveThreadState(
  prev: BootstrapData,
  next: BootstrapData,
  activeThreadId: string,
  deletedMessageIds: Set<string>,
  deletedChangeSetIds: Set<string>
): BootstrapData {
  if (!activeThreadId || activeThreadId.startsWith("draft_")) return next;
  if (!next.threads.some((thread) => thread.id === activeThreadId)) return next;

  const nextMessageIds = new Set(next.messages.map((message) => message.id));
  const nextChangeSetIds = new Set(next.changeSets.map((changeSet) => changeSet.id));
  const preservedMessages = prev.messages.filter((message) =>
    message.threadId === activeThreadId
    && !message.id.startsWith("opt_")
    && !deletedMessageIds.has(message.id)
    && !nextMessageIds.has(message.id)
  );
  const preservedChangeSets = prev.changeSets.filter((changeSet) =>
    changeSet.threadId === activeThreadId
    && !deletedChangeSetIds.has(changeSet.id)
    && !nextChangeSetIds.has(changeSet.id)
  );

  if (preservedMessages.length === 0 && preservedChangeSets.length === 0) return next;
  return {
    ...next,
    messages: [...next.messages, ...preservedMessages],
    changeSets: [...next.changeSets, ...preservedChangeSets]
  };
}

function adjustHexBrightness(hex: string, percent: number): string {
  if (!hex || typeof hex !== "string") {
    return "#3F3525";
  }
  hex = hex.replace(/^\s*#|\s*$/g, '');
  if (hex.length === 3) hex = hex.replace(/(.)/g, '$1$1');
  let r = parseInt(hex.substring(0, 2), 16),
      g = parseInt(hex.substring(2, 4), 16),
      b = parseInt(hex.substring(4, 6), 16);
  if (isNaN(r) || isNaN(g) || isNaN(b)) {
    return "#3F3525";
  }
  r = Math.max(0, Math.min(255, Math.round(r * (1 + percent))));
  g = Math.max(0, Math.min(255, Math.round(g * (1 + percent))));
  b = Math.max(0, Math.min(255, Math.round(b * (1 + percent))));
  const rs = r.toString(16).padStart(2, '0');
  const gs = g.toString(16).padStart(2, '0');
  const bs = b.toString(16).padStart(2, '0');
  return `#${rs}${gs}${bs}`;
}

function hexToRgbString(hex: string): string {
  if (!hex || typeof hex !== "string") {
    return "201, 120, 34";
  }
  const cleanHex = hex.replace(/^\s*#|\s*$/g, '');
  let formatted = cleanHex;
  if (cleanHex.length === 3) formatted = cleanHex.replace(/(.)/g, '$1$1');
  const r = parseInt(formatted.substring(0, 2), 16),
        g = parseInt(formatted.substring(2, 4), 16),
        b = parseInt(formatted.substring(4, 6), 16);
  if (isNaN(r) || isNaN(g) || isNaN(b)) {
    return "201, 120, 34";
  }
  return `${r}, ${g}, ${b}`;
}

export function VectisProvider({ children }: { children: ReactNode }) {
  useState(() => {
    const migrated = localStorage.getItem("vectis-theme-migrated-v9");
    if (!migrated) {
      if (!localStorage.getItem("vectis-theme")) {
        const prefersDark = window.matchMedia?.("(prefers-color-scheme: dark)").matches;
        localStorage.setItem("vectis-theme", prefersDark ? "dark" : "light");
      }
      localStorage.setItem("vectis-theme-light-preset", "vectis-light");
      localStorage.setItem("vectis-theme-light-bg", "#FDF6E3");
      localStorage.setItem("vectis-theme-light-fg", "#3F3525");
      localStorage.setItem("vectis-theme-light-accent", "#C97822");

      localStorage.setItem("vectis-theme-dark-preset", "vectis-dark");
      localStorage.setItem("vectis-theme-dark-bg", "#1d1811");
      localStorage.setItem("vectis-theme-dark-fg", "#f5ead8");
      localStorage.setItem("vectis-theme-dark-accent", "#d79a45");
      localStorage.setItem("vectis-theme-migrated-v9", "true");
    }
  });

  const [authConfig, setAuthConfig] = useState<AuthConfig | null>(null);
  const [data, setData] = useState<BootstrapData | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [isLoggingOut, setIsLoggingOut] = useState(false);
  const [thinkingStartedAt, setThinkingStartedAt] = useState<number | null>(null);
  const [activeChatRequestId, setActiveChatRequestId] = useState<string | null>(null);
  const [activeChatRequestModel, setActiveChatRequestModel] = useState<string | null>(null);
  const [chatProgress, setChatProgress] = useState<ChatProgress | null>(null);
  const [progressSteps, setProgressSteps] = useState<ProgressStep[]>([]);
  const [streamingContent, setStreamingContent] = useState("");
  const [reasoningPreview, setReasoningPreview] = useState("");
  const [reasoningPreviewDone, setReasoningPreviewDone] = useState(false);
  const [error, setError] = useState("");
  const [failedMessages, setFailedMessages] = useState<AiMessage[]>([]);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [isSocketConnected, setIsSocketConnected] = useState(false);
  
  const [selectedProjectId, setSelectedProjectId] = useState("");
  const [selectedThreadId, setSelectedThreadId] = useState("");
  const selectedThreadIdRef = useRef("");
  const dataRef = useRef<BootstrapData | null>(null);
  const activeOptimisticIdsRef = useRef<Set<string>>(new Set());
  const activeChatRequestIdRef = useRef<string | null>(null);
  const thinkingStartedAtRef = useRef<number | null>(null);
  const chatFinishTimersRef = useRef<Map<string, number>>(new Map());
  const backgroundRefreshTimerRef = useRef<number | null>(null);
  const protectedMessageIdsRef = useRef<Map<string, number>>(new Map());
  const protectedChangeSetIdsRef = useRef<Map<string, number>>(new Map());
  const deletedMessageIdsRef = useRef<Map<string, number>>(new Map());
  const deletedChangeSetIdsRef = useRef<Map<string, number>>(new Map());
  const loadEpochRef = useRef(0);
  const postChatRefreshTimersRef = useRef<number[]>([]);

  const [theme, setThemeState] = useState<"light" | "dark">(() => {
    const stored = localStorage.getItem("vectis-theme");
    if (stored === "dark" || stored === "light") return stored;
    return window.matchMedia?.("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  });

  const [themeLightPreset, setThemeLightPresetState] = useState(() => {
    const saved = localStorage.getItem("vectis-theme-light-preset");
    if (!saved || saved === "claude-beige" || saved === "warm-beige" || saved === "solarized-light") return "vectis-light";
    return saved;
  });
  const [themeLightBg, setThemeLightBgState] = useState(() => {
    const saved = localStorage.getItem("vectis-theme-light-bg");
    if (!saved || ["#F4F3EE", "#faf8f5", "#F5F2EB", "#f8f2e8"].includes(saved)) return "#FDF6E3";
    return saved;
  });
  const [themeLightFg, setThemeLightFgState] = useState(() => {
    const saved = localStorage.getItem("vectis-theme-light-fg");
    if (!saved || ["#1D1816", "#2B2523", "#2c261f", "#586E75", "#657B83", "#073642"].includes(saved)) return "#3F3525";
    return saved;
  });
  const [themeLightAccent, setThemeLightAccentState] = useState(() => {
    const saved = localStorage.getItem("vectis-theme-light-accent");
    if (!saved || ["#C15F3C", "#31291F", "#D8845F", "#CB4B16"].includes(saved)) return "#C97822";
    return saved;
  });

  const [themeDarkPreset, setThemeDarkPresetState] = useState(() => {
    const saved = localStorage.getItem("vectis-theme-dark-preset");
    if (!saved || saved === "monokai" || saved === "claude-dark") return "vectis-dark";
    return saved;
  });
  const [themeDarkBg, setThemeDarkBgState] = useState(() => {
    const saved = localStorage.getItem("vectis-theme-dark-bg");
    if (!saved || saved === "#272822" || saved === "#1D1816" || saved === "#191919" || saved === "#1C1917" || saved === "#1D1811" || saved === "#191918") return "#1d1811";
    return saved;
  });
  const [themeDarkFg, setThemeDarkFgState] = useState(() => {
    const saved = localStorage.getItem("vectis-theme-dark-fg");
    if (!saved || saved === "#F8F8F2" || saved === "#F4F3EE" || saved === "#e0dcd3" || saved === "#EDE9E6" || saved === "#F3EFE7") return "#f5ead8";
    return saved;
  });
  const [themeDarkAccent, setThemeDarkAccentState] = useState(() => {
    const saved = localStorage.getItem("vectis-theme-dark-accent");
    if (!saved || saved === "#F92672" || saved === "#C15F3C" || saved === "#d97706" || saved === "#D79A45" || saved === "#D97757") return "#d79a45";
    return saved;
  });

  const setStoredThemeValue = (key: string, setter: (value: string) => void) => (value: string) => {
    localStorage.setItem(key, value);
    setter(value);
  };
  const setThemeLightPreset = setStoredThemeValue("vectis-theme-light-preset", setThemeLightPresetState);
  const setThemeLightBg = setStoredThemeValue("vectis-theme-light-bg", setThemeLightBgState);
  const setThemeLightFg = setStoredThemeValue("vectis-theme-light-fg", setThemeLightFgState);
  const setThemeLightAccent = setStoredThemeValue("vectis-theme-light-accent", setThemeLightAccentState);
  const setThemeDarkPreset = setStoredThemeValue("vectis-theme-dark-preset", setThemeDarkPresetState);
  const setThemeDarkBg = setStoredThemeValue("vectis-theme-dark-bg", setThemeDarkBgState);
  const setThemeDarkFg = setStoredThemeValue("vectis-theme-dark-fg", setThemeDarkFgState);
  const setThemeDarkAccent = setStoredThemeValue("vectis-theme-dark-accent", setThemeDarkAccentState);

  const [planMode, setPlanMode] = useState(() => {
    return localStorage.getItem("vectis-plan-mode") === "true";
  });

  const [usageOptimizer, setUsageOptimizerState] = useState(() => {
    const s = localStorage.getItem("vectis-usage-optimizer");
    return s === null ? true : s === "true";
  });

  const [optimizationMode, setOptimizationModeState] = useState<"disabled" | "balanced" | "cost_saver">(() => {
    const s = localStorage.getItem("vectis-optimization-mode");
    if (s === "disabled" || s === "balanced" || s === "cost_saver") return s;
    const legacy = localStorage.getItem("vectis-usage-optimizer");
    return legacy === "false" ? "disabled" : "balanced";
  });

  const [fileReferences, setFileReferencesState] = useState(() => {
    const s = localStorage.getItem("vectis-file-references");
    return s === null ? true : s === "true";
  });

  const [verificationMode, setVerificationModeState] = useState<"off" | "standard" | "deep">(() => {
    const s = localStorage.getItem("vectis-verification-mode");
    if (s === "standard" || s === "deep") return s;
    return "off";
  });

  const localPreferencesRef = useRef<UserPreferences>({
    theme,
    usageOptimizer,
    optimizationMode,
    verificationMode,
    fileReferences
  });
  const pendingPreferencePatchRef = useRef<UserPreferences>({});
  const preferenceSaveRunningRef = useRef(false);
  const lastLocalPreferenceChangeAtRef = useRef(0);

  const [selectedModel, setSelectedModel] = useState("gemini-3.5-flash");

  const [modelMode, setModelModeState] = useState<"fast" | "balanced" | "best" | "deep_verify">(() => {
    const s = localStorage.getItem("vectis-model-mode");
    if (s === "fast" || s === "balanced" || s === "best" || s === "deep_verify") return s;
    return "balanced";
  });

  const setModelMode = (mode: "fast" | "balanced" | "best" | "deep_verify") => {
    setModelModeState(mode);
    localStorage.setItem("vectis-model-mode", mode);
    if (mode === "fast") {
      setSelectedModel("deepseek-v4-flash");
      setVerificationModeState("off");
      setOptimizationMode("cost_saver");
    } else if (mode === "balanced") {
      setSelectedModel("gemini-3.5-flash");
      setVerificationModeState("standard");
      setOptimizationMode("balanced");
    } else if (mode === "best") {
      setSelectedModel("gemini-3.1-pro-preview");
      setVerificationModeState("standard");
      setOptimizationMode("disabled");
    } else if (mode === "deep_verify") {
      setSelectedModel("claude-opus-4-8");
      setVerificationModeState("deep");
      setOptimizationMode("disabled");
    }
  };

  const rememberRecentServerState = (input: { messages?: Array<AiMessage | undefined>; changeSets?: Array<ChangeSet | undefined> }) => {
    const expiresAt = Date.now() + RECENT_SERVER_STATE_TTL_MS;
    for (const message of input.messages ?? []) {
      if (message?.id) protectedMessageIdsRef.current.set(message.id, expiresAt);
    }
    for (const changeSet of input.changeSets ?? []) {
      if (changeSet?.id) protectedChangeSetIdsRef.current.set(changeSet.id, expiresAt);
    }
  };

  const beginChatRequest = (requestId: string, model: string) => {
    for (const timer of chatFinishTimersRef.current.values()) {
      window.clearTimeout(timer);
    }
    chatFinishTimersRef.current.clear();
    const startedAt = Date.now();
    activeChatRequestIdRef.current = requestId;
    thinkingStartedAtRef.current = startedAt;
    setActiveChatRequestId(requestId);
    setThinkingStartedAt(startedAt);
    setActiveChatRequestModel(model);
    setChatProgress(null);
    setProgressSteps([]);
    setStreamingContent("");
    setReasoningPreview("");
    setReasoningPreviewDone(false);
    setBusy(true);
  };

  const clearChatRequestUi = () => {
    activeChatRequestIdRef.current = null;
    thinkingStartedAtRef.current = null;
    setActiveChatRequestId(null);
    setThinkingStartedAt(null);
    setActiveChatRequestModel(null);
    setChatProgress(null);
    setProgressSteps([]);
    setStreamingContent("");
    setReasoningPreview("");
    setReasoningPreviewDone(false);
    setBusy(false);
  };

  const findInFlightAssistantMessage = (startedAt: number | null, threadIdHint?: string, clientRequestId?: string) => {
    if (!startedAt) return undefined;
    const expectedThreadId = threadIdHint || selectedThreadIdRef.current;
    return dataRef.current?.messages.find((message) => {
      if (message.role !== "assistant") return false;
      if (expectedThreadId && message.threadId !== expectedThreadId) return false;
      if (clientRequestId && message.clientRequestId) return message.clientRequestId === clientRequestId;
      const created = Date.parse(message.createdAt);
      return Number.isFinite(created) && created >= startedAt - 2000;
    });
  };

  const finishChatRequest = (
    requestId: string,
    delayMs = 200,
    requireAssistantMessage = true,
    _retryCount = 0,
    threadIdHint?: string,
    options?: {
      maxRetries?: number;
      maxWaitMs?: number;
      waitStartedAt?: number;
      onMissing?: "silent" | "failed";
      failedPrompt?: string;
      failedAttachmentIds?: string[];
    }
  ) => {
    const existingTimer = chatFinishTimersRef.current.get(requestId);
    if (existingTimer) window.clearTimeout(existingTimer);

    const maxRetries = options?.maxRetries ?? 90;
    const onMissing = options?.onMissing ?? "silent";
    const waitStartedAt = options?.waitStartedAt ?? Date.now();
    const timer = window.setTimeout(() => {
      chatFinishTimersRef.current.delete(requestId);
      if (activeChatRequestIdRef.current !== requestId) return;

      const startedAt = thinkingStartedAtRef.current;
      const expectedThreadId = threadIdHint || selectedThreadIdRef.current;
      const found = findInFlightAssistantMessage(startedAt, expectedThreadId, requestId);
      const hasAssistantMessage = !requireAssistantMessage || Boolean(found);
      const recoveryElapsedMs = Date.now() - waitStartedAt;
      const canKeepWaiting = options?.maxWaitMs !== undefined
        ? recoveryElapsedMs < options.maxWaitMs
        : _retryCount < maxRetries;
      if (!hasAssistantMessage && canKeepWaiting) {
        void load(true);
        const nextDelayMs = options?.maxWaitMs !== undefined
          ? chatRecoveryPollDelayMs(recoveryElapsedMs)
          : 400;
        finishChatRequest(requestId, nextDelayMs, requireAssistantMessage, _retryCount + 1, threadIdHint, {
          ...options,
          waitStartedAt
        });
        return;
      }

      if (!hasAssistantMessage && onMissing === "failed" && startedAt) {
        const lastUser = [...(dataRef.current?.messages ?? [])]
          .reverse()
          .find((message) =>
            message.role === "user"
            && (!expectedThreadId || message.threadId === expectedThreadId)
            && Date.parse(message.createdAt) >= startedAt - 5000
          );
        const recoveryPrompt = options?.failedPrompt || lastUser?.content;
        if (recoveryPrompt) {
          const failedMsg: AiMessage = {
            id: `opt_recover_${requestId}`,
            projectId: lastUser?.projectId || selectedProjectId,
            threadId: lastUser?.threadId || expectedThreadId,
            role: "assistant",
            content: "",
            clientRequestId: requestId,
            createdAt: new Date().toISOString(),
            attachmentIds: options?.failedAttachmentIds || lastUser?.attachmentIds,
            status: "failed",
            error: "Vectis could not confirm a saved response after reconnecting. Your message is safe and was not sent twice.",
            errorCode: "chat_connection_recovering",
            errorTitle: "Response unavailable",
            errorAction: "retry",
            errorActionLabel: "Try again",
            errorCanRetry: true,
            retryPrompt: recoveryPrompt
          };
          setFailedMessages((prev) => [...prev.filter((message) => message.id !== failedMsg.id), failedMsg]);
        }
      }

      clearChatRequestUi();
    }, delayMs);

    chatFinishTimersRef.current.set(requestId, timer);
  };

  const cancelChatRequest = () => {
    for (const timer of chatFinishTimersRef.current.values()) {
      window.clearTimeout(timer);
    }
    chatFinishTimersRef.current.clear();
    clearChatRequestUi();
  };

  const pruneProtectedServerState = () => {
    const now = Date.now();
    for (const [id, expiresAt] of protectedMessageIdsRef.current) {
      if (expiresAt <= now) protectedMessageIdsRef.current.delete(id);
    }
    for (const [id, expiresAt] of protectedChangeSetIdsRef.current) {
      if (expiresAt <= now) protectedChangeSetIdsRef.current.delete(id);
    }
    for (const [id, expiresAt] of deletedMessageIdsRef.current) {
      if (expiresAt <= now) deletedMessageIdsRef.current.delete(id);
    }
    for (const [id, expiresAt] of deletedChangeSetIdsRef.current) {
      if (expiresAt <= now) deletedChangeSetIdsRef.current.delete(id);
    }
  };

  useEffect(() => {
    document.documentElement.dataset.theme = "dark";
    document.documentElement.style.colorScheme = "dark";
    localStorage.setItem("vectis-theme", "dark");
    document.documentElement.style.setProperty("--bg-app", "#08090b");
    document.documentElement.style.setProperty("--bg-chat", "#08090b");
    document.documentElement.style.setProperty("--bg-sidebar", "#0b0c0f");
    document.documentElement.style.setProperty("--bg-card", "#0e1014");
    document.documentElement.style.setProperty("--bg-panel", "#0b0c0f");
    document.documentElement.style.setProperty("--bg-tertiary", "#16181d");
    document.documentElement.style.setProperty("--bg-hover", "#1a1d22");
    document.documentElement.style.setProperty("--bg-hover-strong", "#23272f");
    document.documentElement.style.setProperty("--bg-bubble-ai", "#0e1014");
    document.documentElement.style.setProperty("--bg-bubble-user", "#ff6846");
    document.documentElement.style.setProperty("--text-primary", "#f2f1ec");
    document.documentElement.style.setProperty("--text-bright", "#fffef8");
    document.documentElement.style.setProperty("--text-secondary", "#b8bbc2");
    document.documentElement.style.setProperty("--text-muted", "#797e87");
    document.documentElement.style.setProperty("--border-default", "#252830");
    document.documentElement.style.setProperty("--border-color", "#252830");
    document.documentElement.style.setProperty("--border-focus", "#ff6846");
    document.documentElement.style.setProperty("--accent", "#ff6846");
    document.documentElement.style.setProperty("--accent-hover", "#ff8468");
    document.documentElement.style.setProperty("--accent-rgb", "255, 104, 70");
  }, [theme]);

  useEffect(() => {
    localStorage.setItem("vectis-plan-mode", planMode ? "true" : "false");
  }, [planMode]);

  useEffect(() => {
    const plan = data?.organization.plan;
    if (plan && plan !== "pro" && plan !== "studio" && planMode) {
      setPlanMode(false);
    }
    if (plan && plan !== "studio" && verificationMode !== "off") {
      setVerificationModeState("off");
    }
    if (plan && plan !== "pro" && plan !== "studio") {
      const selected = authConfig?.models?.find((model) => model.id === selectedModel);
      if (selected?.tier === "premium") {
        setSelectedModel(authConfig?.defaultModel || "gemini-3.5-flash");
      }
    }
    const selected = authConfig?.models?.find((model) => model.id === selectedModel);
    if (selected?.status === "soon") {
      setSelectedModel(authConfig?.defaultModel || "gemini-3.5-flash");
    }
  }, [authConfig, data?.organization.plan, planMode, selectedModel, verificationMode]);

  useEffect(() => {
    localStorage.setItem("vectis-usage-optimizer", usageOptimizer ? "true" : "false");
  }, [usageOptimizer]);

  useEffect(() => {
    localStorage.setItem("vectis-optimization-mode", optimizationMode);
  }, [optimizationMode]);

  useEffect(() => {
    localStorage.setItem("vectis-file-references", fileReferences ? "true" : "false");
  }, [fileReferences]);

  useEffect(() => {
    localStorage.setItem("vectis-verification-mode", verificationMode);
  }, [verificationMode]);

  const hasQueuedPreferenceSave = () =>
    preferenceSaveRunningRef.current || Object.keys(pendingPreferencePatchRef.current).length > 0;

  const mergePreferencesIntoData = (patch: UserPreferences) => {
    setData(prev => prev ? {
      ...prev,
      user: {
        ...prev.user,
        preferences: { ...(prev.user.preferences ?? {}), ...patch }
      }
    } : prev);
  };

  const applyPreferencePatch = (patch: UserPreferences) => {
    const nextTheme = patch.theme === "dark" || patch.theme === "light"
      ? patch.theme
      : localPreferencesRef.current.theme ?? "light";
    localPreferencesRef.current = { ...localPreferencesRef.current, ...patch, theme: nextTheme };
    setThemeState(nextTheme);
    if (typeof patch.usageOptimizer === "boolean") setUsageOptimizerState(patch.usageOptimizer);
    if (patch.optimizationMode) setOptimizationModeState(patch.optimizationMode);
    if (typeof patch.luauGuard === "boolean") setVerificationModeState(patch.luauGuard ? "standard" : "off");
    if (patch.verificationMode) setVerificationModeState(patch.verificationMode);
    if (typeof patch.fileReferences === "boolean") setFileReferencesState(patch.fileReferences);
  };

  useEffect(() => {
    dataRef.current = data;
  }, [data]);

  const flushPreferenceSaves = async () => {
    if (preferenceSaveRunningRef.current) return;
    if (!data?.user.id) return;

    preferenceSaveRunningRef.current = true;
    try {
      while (Object.keys(pendingPreferencePatchRef.current).length > 0) {
        const patch = pendingPreferencePatchRef.current;
        pendingPreferencePatchRef.current = {};

        try {
          const result = await api.updateUserPreferences(patch);
          if (Object.keys(pendingPreferencePatchRef.current).length === 0) {
            applyPreferencePatch(result.preferences);
            mergePreferencesIntoData(result.preferences);
          }
        } catch (e) {
          pendingPreferencePatchRef.current = { ...patch, ...pendingPreferencePatchRef.current };
          setError(e instanceof Error ? e.message : "Could not save settings");
          break;
        }
      }
    } finally {
      preferenceSaveRunningRef.current = false;
      if (Object.keys(pendingPreferencePatchRef.current).length > 0) {
        void flushPreferenceSaves();
      }
    }
  };

  const savePreferencePatch = (patch: UserPreferences) => {
    const forcedPatch = { ...patch };
    lastLocalPreferenceChangeAtRef.current = Date.now();
    pendingPreferencePatchRef.current = { ...pendingPreferencePatchRef.current, ...forcedPatch };
    applyPreferencePatch(forcedPatch);
    mergePreferencesIntoData(forcedPatch);
    void flushPreferenceSaves();
  };

  const setTheme = (nextTheme: "light" | "dark") => {
    void savePreferencePatch({ theme: nextTheme });
  };

  const setUsageOptimizer = (enabled: boolean) => {
    void savePreferencePatch({
      usageOptimizer: enabled,
      optimizationMode: enabled ? "balanced" : "disabled"
    });
  };

  const setOptimizationMode = (mode: "disabled" | "balanced" | "cost_saver") => {
    void savePreferencePatch({
      optimizationMode: mode,
      usageOptimizer: mode !== "disabled"
    });
  };

  const setFileReferences = (enabled: boolean) => {
    void savePreferencePatch({ fileReferences: enabled });
  };

  const setVerificationMode = (mode: "off" | "standard" | "deep") => {
    void savePreferencePatch({ verificationMode: mode });
  };

  const fetchEvaluations = async () => {
    return api.adminEvaluations();
  };

  const runEvaluation = async (input: { promptId: "leaderstats" | "sprint" | "shop" | "custom" | "all"; customPromptText?: string; models?: string[]; judgeEnabled?: boolean }) => {
    return api.adminRunEvaluation(input);
  };

  const deleteEvaluation = async (runId: string) => {
    await api.adminDeleteEvaluation(runId);
  };

  const clearEvaluations = async () => {
    await api.adminClearEvaluations();
  };

  const load = async (isBackground = false) => {
    const loadStartedAt = Date.now();
    const thisEpoch = ++loadEpochRef.current;
    if (!isBackground && !data && !authConfig) setLoading(true);
    if (!isBackground) setError("");

    const fetchAuthConfigWithRetry = async (retries = 3, delay = 1000): Promise<AuthConfig> => {
      try {
        return await api.authConfig();
      } catch (err) {
        if (retries > 0) {
          await new Promise((resolve) => setTimeout(resolve, delay));
          return fetchAuthConfigWithRetry(retries - 1, delay * 1.5);
        }
        throw err;
      }
    };

    try {
      const [cfg, me] = await Promise.all([
        authConfig ? Promise.resolve(authConfig) : fetchAuthConfigWithRetry(),
        api.me().catch((err) => {
          if (err instanceof ApiError && err.status === 401) {
            return { user: null };
          }
          throw err;
        })
      ]);

      if (!authConfig) {
        setAuthConfig(cfg);
        if (!cfg.models.some(m => m.id === selectedModel)) {
          setSelectedModel(cfg.defaultModel);
        }
      }

      let currentMe = me;
      if (!currentMe.user && !cfg.firebaseConfigured && cfg.supabaseConfigured && cfg.supabase) {
        try {
          const { completeSupabaseOAuth } = await import("../supabaseClient");
          const token = await completeSupabaseOAuth(cfg.supabase);
          if (token) {
            await api.supabaseLogin(token);
            localStorage.setItem("vectis_just_logged_in", "true");
            currentMe = await api.me();
          }
        } catch (error) {
          setError(error instanceof Error ? error.message : "Could not finish sign-in");
        }
      }

      if (!currentMe.user) {
        if (loadEpochRef.current === thisEpoch) {
          setData(null);
        }
        return;
      }

      const exclude = isBackground ? ["snapshots", "logs"] : undefined;
      const b = await api.bootstrap(exclude);

      if (loadEpochRef.current !== thisEpoch) return;
      
      const serverPreferences = b.user.preferences ?? {};
      const shouldKeepLocalPreferences = hasQueuedPreferenceSave()
        || loadStartedAt < lastLocalPreferenceChangeAtRef.current
        || Date.now() - lastLocalPreferenceChangeAtRef.current < 8_000;
      const effectivePreferences = shouldKeepLocalPreferences
        ? { ...serverPreferences, ...localPreferencesRef.current, ...pendingPreferencePatchRef.current }
        : serverPreferences;
      const bootstrapData = {
        ...b,
        attachments: b.attachments ?? [],
        user: {
          ...b.user,
          preferences: effectivePreferences
        }
      };
      applyPreferencePatch(effectivePreferences);
      
      pruneProtectedServerState();
      setData(prev => {
        const merged = mergePendingMessages(
          bootstrapData,
          prev,
          activeOptimisticIdsRef.current,
          new Set(protectedMessageIdsRef.current.keys()),
          new Set(protectedChangeSetIdsRef.current.keys()),
          new Set(deletedMessageIdsRef.current.keys()),
          new Set(deletedChangeSetIdsRef.current.keys())
        );
        const nextState = (!prev || !activeChatRequestIdRef.current)
          ? merged
          : preserveActiveThreadState(
              prev,
              merged,
              selectedThreadIdRef.current,
              new Set(deletedMessageIdsRef.current.keys()),
              new Set(deletedChangeSetIdsRef.current.keys())
            );
        return {
          ...nextState,
          snapshots: bootstrapData.snapshots !== undefined ? nextState.snapshots : (prev?.snapshots ?? []),
          logs: bootstrapData.logs !== undefined ? nextState.logs : (prev?.logs ?? []),
          taskPlans: bootstrapData.taskPlans !== undefined ? nextState.taskPlans : (prev?.taskPlans ?? []),
          patchComments: bootstrapData.patchComments !== undefined ? nextState.patchComments : (prev?.patchComments ?? [])
        };
      });
      setFailedMessages(prev => prev.filter((message) => {
        if (message.errorCode !== "chat_connection_recovering") return true;
        const messageCreatedAt = Date.parse(message.createdAt);
        if (!Number.isFinite(messageCreatedAt)) return true;
        return !bootstrapData.messages.some((synced) =>
          synced.role === "assistant"
          && synced.threadId === message.threadId
          && Date.parse(synced.createdAt) >= messageCreatedAt - 1000
        );
      }));

      const first = bootstrapData.projects[0]?.id ?? "";
      setSelectedProjectId(c => bootstrapData.projects.some(p => p.id === c) ? c : first);
    } catch (e) {
      if (!isBackground && loadEpochRef.current === thisEpoch) {
        setError(e instanceof Error ? e.message : "Could not load workspace");
      }
    } finally {
      if (loadEpochRef.current === thisEpoch) {
        setLoading(false);
      }
    }
  };

  const schedulePostChatRefresh = () => {
    for (const t of postChatRefreshTimersRef.current) window.clearTimeout(t);
    postChatRefreshTimersRef.current = [
      window.setTimeout(() => void load(true), 900),
      window.setTimeout(() => void load(true), 3500)
    ];
  };

  useEffect(() => {
    load();
    const quickPoll = window.setTimeout(() => void load(true), 2000);
    return () => window.clearTimeout(quickPoll);
  }, []);

  useEffect(() => {
    return () => {
      for (const timer of chatFinishTimersRef.current.values()) {
        window.clearTimeout(timer);
      }
      chatFinishTimersRef.current.clear();
    };
  }, []);

  useEffect(() => {
    selectedThreadIdRef.current = selectedThreadId;
  }, [selectedThreadId]);

  useEffect(() => {
    const intervalMs = activeChatRequestId ? 1000 : 5000;
    const timer = window.setInterval(() => setNowMs(Date.now()), intervalMs);
    return () => window.clearInterval(timer);
  }, [activeChatRequestId]);

  useEffect(() => {
    if (!data?.user.id) return;
    const hasAnySession = data.sessions.some(s => s.projectId === selectedProjectId);
    const intervalTime = isSocketConnected
      ? (hasAnySession ? 30000 : 60000)
      : (hasAnySession ? 10000 : 20000);
    const refresh = window.setInterval(() => {
      if (document.visibilityState === "hidden") return;
      load(true);
    }, intervalTime);
    return () => window.clearInterval(refresh);
  }, [data?.user.id, data?.sessions, selectedProjectId, isSocketConnected]);

  useEffect(() => {
    if (!data?.user.id) return;

    let socket: WebSocket | null = null;
    let retryCount = 0;
    let shouldReconnect = true;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    const scheduleBackgroundRefresh = () => {
      if (document.visibilityState === "hidden") return;
      if (backgroundRefreshTimerRef.current) window.clearTimeout(backgroundRefreshTimerRef.current);
      backgroundRefreshTimerRef.current = window.setTimeout(() => {
        backgroundRefreshTimerRef.current = null;
        void load(true);
      }, 250);
    };

    const connect = () => {
      const wsUrl = import.meta.env.VITE_WS_URL;
      const url = wsUrl
        ? wsUrl
        : `${window.location.protocol === 'https:' ? 'wss:' : 'ws:'}//${window.location.host}/ws`;
      socket = new WebSocket(url);

      socket.onopen = () => {
        retryCount = 0;
        setIsSocketConnected(true);
        scheduleBackgroundRefresh();
      };

      socket.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);
          if (msg.type === 'update' || msg.type === 'agent_run_event') {
            scheduleBackgroundRefresh();
          } else if (msg.type === 'chat_content' && msg.payload?.threadId) {
            if (!activeChatRequestIdRef.current) return;
            const activeThread = selectedThreadIdRef.current;
            if (!activeThread || activeThread === msg.payload.threadId) {
              setStreamingContent(prev => prev + (msg.payload.content || ""));
            }
          } else if (msg.type === 'chat_reasoning' && msg.payload?.threadId) {
            if (!activeChatRequestIdRef.current) return;
            const activeThread = selectedThreadIdRef.current;
            if (!activeThread || activeThread === msg.payload.threadId) {
              if (msg.payload.done) {
                setReasoningPreviewDone(true);
                return;
              }
              const next = String(msg.payload.content || "").replace(/<\/?think(?:ing)?>/gi, "").trim();
              if (next) {
                setReasoningPreview(prev => {
                  const joined = `${prev}${prev && !prev.endsWith(" ") && !prev.endsWith("\n") ? " " : ""}${next}`;
                  return joined.length > 1600 ? joined.slice(joined.length - 1600) : joined;
                });
              }
            }
          } else if (msg.type === 'chat_progress' && msg.payload?.threadId) {
            if (!activeChatRequestIdRef.current) return;
            const progress = msg.payload as ChatProgress;
            const activeThread = selectedThreadIdRef.current;
            if (!activeThread || activeThread === progress.threadId) {
              const elapsedMs = Math.max(0, Number(progress.elapsedMs) || 0);
              const startedAt = Date.now() - elapsedMs;
              if (!thinkingStartedAtRef.current) {
                thinkingStartedAtRef.current = startedAt;
                setThinkingStartedAt(startedAt);
              }
              setChatProgress({ ...progress, elapsedMs });
              setProgressSteps(prev => {
                if (!progress.label) return prev;
                const exists = prev.some(step => step.label === progress.label);
                if (exists) return prev;
                return [...prev, { stage: progress.stage, label: progress.label, timestamp: Date.now() }];
              });
              setBusy(true);
            }
          }
        } catch (e) { console.error("WS parse error", e); }
      };

      socket.onclose = () => {
        setIsSocketConnected(false);
        if (!shouldReconnect) return;
        const baseDelay = Math.min(30_000, Math.pow(2, retryCount) * 1000);
        const jitter = baseDelay * 0.3 * Math.random();
        const delay = baseDelay + jitter;
        reconnectTimer = setTimeout(connect, delay);
        retryCount++;
      };

      socket.onerror = () => {};
    };

    connect();
    return () => {
      shouldReconnect = false;
      setIsSocketConnected(false);
      if (reconnectTimer) clearTimeout(reconnectTimer);
      if (backgroundRefreshTimerRef.current) {
        window.clearTimeout(backgroundRefreshTimerRef.current);
        backgroundRefreshTimerRef.current = null;
      }
      socket?.close();
    };
  }, [data?.user.id]);

  useEffect(() => {
    if (error) {
      const timer = setTimeout(() => setError(""), 5000);
      return () => clearTimeout(timer);
    }
  }, [error]);

  const selectedProject = useMemo(() => (data?.projects ?? []).find(p => p.id === selectedProjectId), [data, selectedProjectId]);
  const threads = useMemo(() => (data?.threads ?? []).filter(t => t.projectId === selectedProjectId).sort((a, b) => {
    const bTime = b.updatedAt || b.createdAt || "";
    const aTime = a.updatedAt || a.createdAt || "";
    const diff = bTime.localeCompare(aTime);
    return diff !== 0 ? diff : (b.id ?? "").localeCompare(a.id ?? "");
  }), [data, selectedProjectId]);

  useEffect(() => {
    if (!selectedThreadId || selectedThreadId.startsWith("draft_")) return;
    if (activeChatRequestIdRef.current) return;
    if (data?.threads && !data.threads.some(thread => thread.id === selectedThreadId)) {
      selectedThreadIdRef.current = "";
      setSelectedThreadId("");
    }
  }, [selectedThreadId, data?.threads]);

  useEffect(() => {
    if (!selectedThreadId || selectedThreadId.startsWith("draft_") || !data?.threads) return;
    const matchingThread = data.threads.find(thread => thread.id === selectedThreadId);
    if (matchingThread && matchingThread.projectId !== selectedProjectId) {
      setSelectedProjectId(matchingThread.projectId);
    }
  }, [selectedThreadId, data?.threads, selectedProjectId]);
  const activeMessageThreadId = selectedThreadId || "temp_new_thread";
  const messages = useMemo(() => {
    const raw = (data?.messages ?? []).filter(m => {
      if (m.threadId !== activeMessageThreadId && (selectedThreadId || m.threadId !== "temp_new_thread")) {
        return false;
      }
      if (activeChatRequestId && thinkingStartedAt && m.role === "assistant") {
        const mTime = Date.parse(m.createdAt);
        if (!isNaN(mTime) && mTime >= thinkingStartedAt - 3000) {
          return false;
        }
      }
      return true;
    }) ?? [];

    const threadFailed = failedMessages.filter(m => {
      if (m.threadId === activeMessageThreadId) return true;
      if (!selectedThreadId && m.threadId === "temp_new_thread") return true;
      return false;
    });

    const optimisticKeys = new Set(
      raw
        .filter(m => m.id.startsWith("opt_"))
        .map(m => `${m.role}:${m.threadId}:${m.content}`)
    );
    const visible = raw.filter(m => {
      if (m.id.startsWith("opt_")) return true;
      return !optimisticKeys.has(`${m.role}:${m.threadId}:${m.content}`);
    });
    
    const combined = [...visible];
    for (const fm of threadFailed) {
      if (!combined.some(m => m.id === fm.id)) {
        combined.push(fm);
      }
    }

    return combined.sort((a, b) => {
      const timeDiff = (a.createdAt ?? "").localeCompare(b.createdAt ?? "");
      if (timeDiff !== 0) return timeDiff;
      if (a.role !== b.role) return a.role === "user" ? -1 : 1;
      return (a.id ?? "").localeCompare(b.id ?? "");
    });
  }, [data, selectedThreadId, activeMessageThreadId, failedMessages, activeChatRequestId, thinkingStartedAt]);

  useEffect(() => {
    const requestId = activeChatRequestIdRef.current;
    const startedAt = thinkingStartedAtRef.current;
    if (!requestId || !startedAt || !data) return;
    const found = findInFlightAssistantMessage(startedAt, selectedThreadIdRef.current, requestId);
    if (!found) return;
    finishChatRequest(requestId, 60, false, 0, selectedThreadIdRef.current);
  }, [data?.messages, activeChatRequestId, thinkingStartedAt]);

  const changeSets = useMemo(() => (data?.changeSets ?? []).filter(c => c.projectId === selectedProjectId), [data, selectedProjectId]);
  const snapshot = useMemo(() => (data?.snapshots ?? []).filter(s => s.projectId === selectedProjectId).sort((a, b) => (b.createdAt ?? "").localeCompare(a.createdAt ?? ""))[0], [data, selectedProjectId]);
  const linkedSession = useMemo(() => (data?.sessions ?? []).find(s => s.projectId === selectedProjectId && (s.status === "connected" || s.status === "paired")), [data, selectedProjectId]);
  const pending = useMemo(() => changeSets.filter(c => c.status === "ready_for_review"), [changeSets]);
  const approved = useMemo(() => changeSets.filter(c => c.status === "approved_for_studio"), [changeSets]);
  const nodeCount = snapshot?.nodes.length ?? 0;
  const scriptCount = snapshot?.nodes.filter((n: any) => ["Script", "LocalScript", "ModuleScript"].includes(n.className)).length ?? 0;
  
  const isPluginOnline = useMemo(() => {
    if (!linkedSession?.lastSeenAt) return false;
    const lastSeen = new Date(linkedSession.lastSeenAt).getTime();
    if (!Number.isFinite(lastSeen)) return false;
    return (Date.now() - lastSeen) < 50_000;
  }, [linkedSession, nowMs]);

  const lastSyncLabel = linkedSession?.lastSeenAt ? new Date(linkedSession.lastSeenAt).toLocaleTimeString() : "Never";

  const approveChange = async (id: string) => {
    setBusy(true);
    try {
      await api.approveChangeSet(id);
      await load();
    }
    catch (e) {
      const apiError = e instanceof ApiError ? e : undefined;
      if (apiError?.code === "snapshot_conflict") {
        try {
          await api.approveChangeSet(id, true);
          await load();
          return;
        } catch (retryError) {
          setError(retryError instanceof Error ? retryError.message : "Failed");
        }
      } else {
        setError(e instanceof Error ? e.message : "Failed");
      }
      load();
    }
    finally { setBusy(false); }
  };

  const undoChange = async (id: string) => {
    if (data) {
      const newChangeSets = data.changeSets.map(cs => cs.id === id ? { ...cs, undoRequestedAt: new Date().toISOString() } : cs);
      setData({ ...data, changeSets: newChangeSets as any });
    }
    setBusy(true);
    try { await api.undoChangeSet(id); await load(); }
    catch (e) { setError(e instanceof Error ? e.message : "Failed"); load(); }
    finally { setBusy(false); }
  };

  const dismissChange = async (id: string) => {
    if (data) {
      const newChangeSets = data.changeSets.map(cs => cs.id === id ? { ...cs, status: "rejected" } : cs);
      setData({ ...data, changeSets: newChangeSets as any });
    }
    setBusy(true);
    try { 
      const result = await api.dismissChangeSet(id); 
      await load(); 
      return result;
    }
    catch (e) { setError(e instanceof Error ? e.message : "Failed"); load(); return null; }
    finally { setBusy(false); }
  };

  const editTaskPlan = async (planId: string, updates: Partial<TaskPlan>) => {
    if (!selectedProjectId) return;
    setBusy(true);
    try {
      await api.editTaskPlan(selectedProjectId, planId, updates);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to edit task plan");
    } finally {
      setBusy(false);
    }
  };

  const approveTaskPlan = async (planId: string, options?: { model?: string }) => {
    if (!selectedProjectId) return;
    setBusy(true);
    try {
      await api.approveTaskPlan(selectedProjectId, planId, options || {});
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to approve task plan");
    } finally {
      setBusy(false);
    }
  };

  const supersedeTaskPlan = async (planId: string) => {
    if (!selectedProjectId) return;
    setBusy(true);
    try {
      await api.supersedeTaskPlan(selectedProjectId, planId);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to supersede task plan");
    } finally {
      setBusy(false);
    }
  };

  const addComment = async (changeSetId: string, commentText: string, filePath?: string) => {
    if (!selectedProjectId) return;
    setBusy(true);
    try {
      await api.createComment(selectedProjectId, changeSetId, commentText, filePath);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to add comment");
    } finally {
      setBusy(false);
    }
  };

  const resolveComment = async (commentId: string) => {
    if (!selectedProjectId) return;
    setBusy(true);
    try {
      await api.resolveComment(selectedProjectId, commentId);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to resolve comment");
    } finally {
      setBusy(false);
    }
  };


  const createThread = async () => {
    if (!selectedProjectId) return undefined;

    const draftId = `draft_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    selectedThreadIdRef.current = draftId;
    setSelectedThreadId(draftId);
    return draftId;
  };

  const deleteThread = async (id: string) => {
    const projectIdForThread = data?.threads.find(thread => thread.id === id)?.projectId || selectedProjectId;
    const isDraft = id.startsWith("draft_");
    if (data) {
      const newThreads = data.threads.filter(t => t.id !== id);
      for (const message of data.messages) {
        if (message.threadId === id) protectedMessageIdsRef.current.delete(message.id);
      }
      for (const changeSet of data.changeSets) {
        if (changeSet.threadId === id) protectedChangeSetIdsRef.current.delete(changeSet.id);
      }
      setData({
        ...data,
        threads: newThreads as any,
        messages: data.messages.filter(message => message.threadId !== id),
        changeSets: data.changeSets.filter(changeSet => changeSet.threadId !== id),
        attachments: (data.attachments ?? []).filter(attachment => attachment.source === "generated_icon" || attachment.threadId !== id)
      });
      if (selectedThreadId === id) {
        setSelectedThreadId("");
        selectedThreadIdRef.current = "";
      }
    }
    if (isDraft) return;
    setBusy(true);
    try {
      if (!projectIdForThread) throw new Error("No project found for this chat.");
      await api.deleteThread(projectIdForThread, id);
      await load(true);
    }
    catch (e) {
      setError(e instanceof Error ? e.message : "Failed to delete chat");
      await load(true);
    } finally {
      setBusy(false);
    }
  };

  const deleteThreads = async (ids: string[]) => {
    const uniqueIds = [...new Set(ids)].filter(Boolean);
    if (uniqueIds.length === 0) return [];
    const idSet = new Set(uniqueIds);
    const serverIds = uniqueIds.filter(id => !id.startsWith("draft_"));
    const groups = new Map<string, string[]>();
    for (const id of serverIds) {
      const projectId = data?.threads.find(thread => thread.id === id)?.projectId || selectedProjectId;
      if (!projectId) continue;
      groups.set(projectId, [...(groups.get(projectId) ?? []), id]);
    }
    if (groups.size === 0) return [];
    if (data) {
      for (const message of data.messages) {
        if (idSet.has(message.threadId)) protectedMessageIdsRef.current.delete(message.id);
      }
      for (const changeSet of data.changeSets) {
        if (idSet.has(changeSet.threadId)) protectedChangeSetIdsRef.current.delete(changeSet.id);
      }
      setData({
        ...data,
        threads: data.threads.filter(thread => !idSet.has(thread.id)),
        messages: data.messages.filter(message => !idSet.has(message.threadId)),
        changeSets: data.changeSets.filter(changeSet => !idSet.has(changeSet.threadId)),
        attachments: (data.attachments ?? []).filter(attachment => attachment.source === "generated_icon" || !attachment.threadId || !idSet.has(attachment.threadId))
      });
      if (idSet.has(selectedThreadId)) {
        setSelectedThreadId("");
        selectedThreadIdRef.current = "";
      }
    }
    if (groups.size === 0) return uniqueIds;
    setBusy(true);
    try {
      const results = await Promise.all(
        [...groups.entries()].map(([projectId, threadIds]) => api.deleteThreads(projectId, threadIds))
      );
      await load(true);
      return [...uniqueIds.filter(id => id.startsWith("draft_")), ...results.flatMap(result => result.deleted)];
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to delete chats");
      await load(true);
      return [];
    } finally {
      setBusy(false);
    }
  };

  const renameThread = async (id: string, name: string) => {
    if (data) {
      const newThreads = data.threads.map(t => t.id === id ? { ...t, name } : t);
      setData({ ...data, threads: newThreads as any });
    }
    setBusy(true);
    try { await api.renameThread(selectedProjectId, id, name); await load(); }
    catch (e) { setError(e instanceof Error ? e.message : "Failed"); load(); }
    finally { setBusy(false); }
  };

  const uploadAttachment = async (file: File, threadId?: string) => {
    if (!selectedProjectId) throw new Error("Select a project before uploading.");
    const activeThreadId = threadId || selectedThreadId || undefined;
    const sanitizedThreadId = (activeThreadId && activeThreadId.startsWith("draft_")) ? undefined : activeThreadId;
    const result = await api.uploadAttachment(selectedProjectId, file, sanitizedThreadId);
    setData(prev => prev ? {
      ...prev,
      attachments: [...(prev.attachments ?? []).filter(attachment => attachment.id !== result.attachment.id), result.attachment]
    } : prev);
    return result.attachment;
  };

  const deleteAttachment = async (attachmentId: string) => {
    if (!selectedProjectId) return;
    setData(prev => prev ? {
      ...prev,
      attachments: (prev.attachments ?? []).filter(attachment => attachment.id !== attachmentId)
    } : prev);
    try {
      await api.deleteAttachment(selectedProjectId, attachmentId);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
      await load(true);
    }
  };

  const generateIcon = async (iconPrompt: string, threadId?: string) => {
    if (!selectedProjectId) throw new Error("Select a project before generating an icon.");
    const activeThreadId = threadId || selectedThreadId || undefined;
    const sanitizedThreadId = (activeThreadId && activeThreadId.startsWith("draft_")) ? undefined : activeThreadId;
    const result = await api.generateIcon(selectedProjectId, iconPrompt, sanitizedThreadId);
    setData(prev => prev ? {
      ...prev,
      creditBalance: result.creditBalance,
      attachments: [...(prev.attachments ?? []).filter(attachment => attachment.id !== result.attachment.id), result.attachment]
    } : prev);
    return result.attachment;
  };

  const sendPrompt = async (prompt: string, model: string, planMode: boolean, usageOptimizer: boolean, verificationMode: "off" | "standard" | "deep", attachmentIds: string[] = [], intent?: "general" | "console_fix", modelMode?: "fast" | "balanced" | "best" | "deep_verify") => {
    if (!selectedProjectId || !prompt.trim()) return;
    if (activeChatRequestIdRef.current) return;
    
    let threadId = selectedThreadId;
    const draftThreadId = threadId && threadId.startsWith("draft_") ? threadId : "";
    const initialThreadId = threadId || `draft_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    if (!threadId) {
      selectedThreadIdRef.current = initialThreadId;
      setSelectedThreadId(initialThreadId);
    }
    
    const requestId = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const optimisticId = `opt_user_${requestId}`;
    activeOptimisticIdsRef.current.add(optimisticId);
    beginChatRequest(requestId, model);
    const createdAt = new Date().toISOString();
    const optimisticMsg: AiMessage = {
      id: optimisticId,
      projectId: selectedProjectId,
      threadId: initialThreadId,
      role: "user",
      content: prompt.trim(),
      attachmentIds,
      createdAt
    };
    setData(prev => prev ? { ...prev, messages: [...prev.messages, optimisticMsg] } : prev);

    let finishDelayMs = 200;
    let requireAssistantMessage = true;
    let finishThreadId = threadId || initialThreadId;
    let keepOptimisticMessage = false;
    let recoveryFinishScheduled = false;
    try {
      if (!threadId || draftThreadId) {
        const r = await api.createThread(selectedProjectId, chatTitleFromPrompt(prompt));
        const newThreadId = r.thread.id;
        
        setData(prev => {
          if (!prev) return prev;
          const updatedMessages = prev.messages.map(m => 
            m.threadId === initialThreadId ? { ...m, threadId: newThreadId } : m
          );
          const hasThread = prev.threads.some(t => t.id === r.thread.id);
          const next = { ...prev, threads: hasThread ? prev.threads : [...prev.threads, r.thread], messages: updatedMessages };
          dataRef.current = next;
          return next;
        });
        
        if (selectedThreadIdRef.current === initialThreadId) {
          selectedThreadIdRef.current = newThreadId;
          setSelectedThreadId(newThreadId);
        }
        threadId = newThreadId;
        finishThreadId = newThreadId;
      }
      const mode = intent === "console_fix" ? "changeset" : (shouldGenerateChangeSet(prompt) ? "changeset" : "explain");
      const response: any = await api.generate(selectedProjectId, threadId, prompt.trim(), model, mode, planMode, usageOptimizer, optimizationMode, verificationMode, attachmentIds, intent, modelMode, requestId);
      if (activeChatRequestIdRef.current !== requestId) return;

      if (response.assistantMessage?.status === "failed") {
        const failedFromServer: AiMessage = {
          ...response.assistantMessage,
          error: response.assistantMessage.error || "Generation stopped before Vectis could save a complete response.",
          errorCanRetry: response.assistantMessage.errorCanRetry !== false,
          retryPrompt: response.assistantMessage.retryPrompt || prompt.trim()
        };
        rememberRecentServerState({
          messages: [response.userMessage, failedFromServer].filter(Boolean),
          changeSets: [response.changeSet]
        });
        setData(prev => {
          if (!prev) return prev;
          let newMessages = prev.messages.filter(m => m.id !== optimisticId);
          const upsert = (message?: AiMessage) => {
            if (!message?.id) return;
            const index = newMessages.findIndex(m => m.id === message.id);
            if (index >= 0) newMessages = newMessages.map(m => m.id === message.id ? message : m);
            else newMessages = [...newMessages, message];
          };
          upsert(response.userMessage);
          upsert(failedFromServer);
          const next = {
            ...prev,
            messages: newMessages,
            creditBalance: response.creditBalance ?? prev.creditBalance
          };
          dataRef.current = next;
          return next;
        });
        setFailedMessages(prev => [...prev.filter(m => m.id !== failedFromServer.id && m.id !== optimisticId), failedFromServer]);
        setError(failedFromServer.errorTitle || failedFromServer.error || "Generation failed");
        finishDelayMs = 180;
        requireAssistantMessage = false;
        schedulePostChatRefresh();
        return;
      }

      rememberRecentServerState({
        messages: [response.userMessage, response.assistantMessage],
        changeSets: [response.changeSet]
      });

      const responseThreadId = response.userMessage?.threadId ?? response.assistantMessage?.threadId ?? threadId;
      finishThreadId = responseThreadId || finishThreadId;
      if (responseThreadId && (!selectedThreadIdRef.current || selectedThreadIdRef.current === initialThreadId || selectedThreadIdRef.current === draftThreadId)) {
        selectedThreadIdRef.current = responseThreadId;
        setSelectedThreadId(responseThreadId);
      }
      
      setData(prev => {
        if (!prev) return prev;

        let newMessages = prev.messages.filter(m => m.id !== optimisticId);
        const upsertMessage = (message: AiMessage | undefined | null) => {
          if (!message?.id) return;
          const index = newMessages.findIndex(m => m.id === message.id);
          if (index >= 0) {
            newMessages = newMessages.map(m => m.id === message.id ? message : m);
          } else {
            newMessages = [...newMessages, message];
          }
        };

        upsertMessage(response.userMessage);
        upsertMessage(response.assistantMessage);

        const hasChangeSet = response.changeSet
          ? prev.changeSets.some(cs => cs.id === response.changeSet.id)
          : false;
        const newChangeSets = response.changeSet && !hasChangeSet
          ? [...prev.changeSets, response.changeSet]
          : prev.changeSets.map((cs) => response.changeSet && cs.id === response.changeSet.id ? response.changeSet : cs);
        const responseThreadName = response.thread?.name || chatTitleFromPrompt(prompt);
        const responseThreadUpdatedAt = response.userMessage?.createdAt || new Date().toISOString();
        const newThreads = responseThreadId
          ? prev.threads.map(thread => thread.id === responseThreadId && isDefaultThreadName(thread.name)
            ? { ...thread, name: responseThreadName, updatedAt: responseThreadUpdatedAt }
            : thread)
          : prev.threads;

        const next = {
          ...prev,
          threads: newThreads,
          messages: newMessages,
          changeSets: newChangeSets,
          creditBalance: response.creditBalance ?? prev.creditBalance
        };
        dataRef.current = next;
        return next;
      });
      finishDelayMs = 180;
      requireAssistantMessage = false;
      schedulePostChatRefresh();
    } catch (e) {
      const errMsg = e instanceof Error ? e.message : "Failed";
      const apiError = e instanceof ApiError ? e : undefined;
      const errorPayload = apiError?.payload;
      const isUsageLimit = apiError?.code === "usage_limit_reached";
      const isConnectionDrop = apiError?.code === "chat_connection_recovering"
        || apiError?.code === "chat_request_in_progress"
        || apiError?.status === 0;
      const errorAction = errorPayload?.action;
      finishDelayMs = isConnectionDrop ? 250 : 1800;
      requireAssistantMessage = isConnectionDrop;
      if (isConnectionDrop) {
        keepOptimisticMessage = true;
        recoveryFinishScheduled = true;
        setChatProgress({
          threadId: threadId || initialThreadId,
          stage: "recovering",
          label: "Reconnecting",
          detail: "Recovering your response",
          elapsedMs: thinkingStartedAtRef.current ? Date.now() - thinkingStartedAtRef.current : 0,
          model
        });
        schedulePostChatRefresh();
        setTimeout(() => void load(true), 1_200);
        setTimeout(() => void load(true), 4_000);
        setTimeout(() => void load(true), 10_000);
        setTimeout(() => void load(true), 20_000);
        setTimeout(() => {
          activeOptimisticIdsRef.current.delete(optimisticId);
          void load(true);
        }, 55_000);
        await load(true);
        finishChatRequest(requestId, 250, true, 0, finishThreadId, {
          maxWaitMs: CHAT_RECOVERY_MAX_WAIT_MS,
          onMissing: "failed",
          failedPrompt: prompt.trim(),
          failedAttachmentIds: attachmentIds
        });
        return;
      }
      const failedMsg: AiMessage = {
        ...optimisticMsg,
        threadId,
        status: "failed",
        error: errMsg,
        errorCode: apiError?.code,
        errorTitle: typeof errorPayload?.title === "string" ? errorPayload.title : undefined,
        errorAction: errorAction === "top_up" || errorAction === "upgrade" || errorAction === "retry" || errorAction === "none"
          ? errorAction
          : undefined,
        errorActionLabel: typeof errorPayload?.actionLabel === "string" ? errorPayload.actionLabel : undefined,
        errorCanRetry: !isUsageLimit && !isConnectionDrop,
        errorPayload
      };
      setFailedMessages(prev => [...prev.filter(m => m.id !== optimisticId), failedMsg]);

      reportClientError({
        kind: "api_error",
        message: `Prompt generation failed: ${errMsg}`,
        apiPath: `/projects/${selectedProjectId}/chat`,
        statusCode: (e as any)?.status,
        metadata: {
          prompt: prompt.trim(),
          model,
          planMode,
          usageOptimizer
        }
      });

      setError(isUsageLimit ? (failedMsg.errorTitle || errMsg) : errMsg);
      await load(true);
    }
    finally {
      if (!keepOptimisticMessage) activeOptimisticIdsRef.current.delete(optimisticId);
      if (!recoveryFinishScheduled) {
        finishChatRequest(requestId, finishDelayMs, requireAssistantMessage, 0, finishThreadId);
      }
    }
  };

  const editMessage = async (messageId: string, prompt: string, model: string, planMode: boolean, usageOptimizer: boolean, verificationMode: "off" | "standard" | "deep", attachmentIds: string[] = [], intent?: "general" | "console_fix", modelMode?: "fast" | "balanced" | "best" | "deep_verify") => {
    if (activeChatRequestIdRef.current) return;
    const requestId = `edit_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    beginChatRequest(requestId, model);
    let finishDelayMs = 200;
    let requireAssistantMessage = true;
    let recoveryFinishScheduled = false;
    try {
      const mode = intent === "console_fix" ? "changeset" : (shouldGenerateChangeSet(prompt) ? "changeset" : "explain");
      const response: any = await api.editMessage(selectedProjectId, selectedThreadId, messageId, prompt.trim(), model, mode, planMode, usageOptimizer, optimizationMode, verificationMode, attachmentIds, intent, modelMode, requestId);
      if (activeChatRequestIdRef.current !== requestId) return;

      if (response.assistantMessage?.status === "failed") {
        const failedFromServer: AiMessage = {
          ...response.assistantMessage,
          error: response.assistantMessage.error || "Generation stopped before Vectis could save a complete response.",
          errorCanRetry: response.assistantMessage.errorCanRetry !== false,
          retryPrompt: response.assistantMessage.retryPrompt || prompt.trim()
        };
        rememberRecentServerState({
          messages: [response.userMessage, failedFromServer].filter(Boolean),
          changeSets: [response.changeSet]
        });
        setData(prev => {
          if (!prev) return prev;
          let newMessages = prev.messages.slice();
          const upsert = (message?: AiMessage) => {
            if (!message?.id) return;
            const index = newMessages.findIndex(m => m.id === message.id);
            if (index >= 0) newMessages = newMessages.map(m => m.id === message.id ? message : m);
            else newMessages = [...newMessages, message];
          };
          upsert(response.userMessage);
          upsert(failedFromServer);
          const next = {
            ...prev,
            messages: newMessages,
            creditBalance: response.creditBalance ?? prev.creditBalance
          };
          dataRef.current = next;
          return next;
        });
        setFailedMessages(prev => [...prev.filter(m => m.id !== failedFromServer.id), failedFromServer]);
        setError(failedFromServer.errorTitle || failedFromServer.error || "Generation failed");
        finishDelayMs = 180;
        requireAssistantMessage = false;
        schedulePostChatRefresh();
        return;
      }

      rememberRecentServerState({
        messages: [response.userMessage, response.assistantMessage],
        changeSets: [response.changeSet]
      });
      setData(prev => {
        if (!prev) return prev;

        const threadId = response.userMessage?.threadId ?? selectedThreadId;
        const threadMessages = [...prev.messages]
          .filter(m => m.threadId === threadId)
          .sort((a, b) => {
            const timeDiff = (a.createdAt ?? "").localeCompare(b.createdAt ?? "");
            if (timeDiff !== 0) return timeDiff;
            if (a.role !== b.role) return a.role === "user" ? -1 : 1;
            return (a.id ?? "").localeCompare(b.id ?? "");
          });
        const messageIndex = threadMessages.findIndex(m => m.id === messageId);
        const messagesToReplace = messageIndex >= 0 ? threadMessages.slice(messageIndex) : threadMessages.filter(m => m.id === messageId);
        const removedMessageIds = new Set(messagesToReplace.map(m => m.id));
        const removedChangeSetIds = new Set(messagesToReplace.map(m => m.changeSetId).filter(Boolean) as string[]);
        const tombstoneUntil = Date.now() + RECENT_SERVER_STATE_TTL_MS;
        for (const id of removedMessageIds) {
          protectedMessageIdsRef.current.delete(id);
          if (id !== response.userMessage?.id && id !== response.assistantMessage?.id) {
            deletedMessageIdsRef.current.set(id, tombstoneUntil);
          }
        }
        for (const id of removedChangeSetIds) {
          protectedChangeSetIdsRef.current.delete(id);
          if (id !== response.changeSet?.id) {
            deletedChangeSetIdsRef.current.set(id, tombstoneUntil);
          }
        }
        let newMessages = prev.messages.filter(m => !removedMessageIds.has(m.id));

        const upsertMessage = (message?: AiMessage) => {
          if (!message) return;
          const index = newMessages.findIndex(m => m.id === message.id);
          if (index >= 0) {
            newMessages = newMessages.map(m => m.id === message.id ? message : m);
          } else {
            newMessages = [...newMessages, message];
          }
        };

        upsertMessage(response.userMessage);
        upsertMessage(response.assistantMessage);

        let newChangeSets = prev.changeSets.filter(cs => !removedChangeSetIds.has(cs.id));
        if (response.changeSet && !newChangeSets.some(cs => cs.id === response.changeSet.id)) {
          newChangeSets = [...newChangeSets, response.changeSet];
        }

        const next = {
          ...prev,
          messages: newMessages,
          changeSets: newChangeSets,
          creditBalance: response.creditBalance ?? prev.creditBalance
        };
        dataRef.current = next;
        return next;
      });
      finishDelayMs = 180;
      requireAssistantMessage = false;
      await load(true);
      schedulePostChatRefresh();
    } catch (e) {
      const errMsg = e instanceof Error ? e.message : "Failed";
      const apiError = e instanceof ApiError ? e : undefined;
      const isConnectionDrop = apiError?.code === "chat_connection_recovering"
        || apiError?.code === "chat_request_in_progress"
        || apiError?.status === 0;
      finishDelayMs = isConnectionDrop ? 250 : 1800;
      requireAssistantMessage = isConnectionDrop;
      if (isConnectionDrop) {
        recoveryFinishScheduled = true;
        setChatProgress({
          threadId: selectedThreadId,
          stage: "recovering",
          label: "Reconnecting",
          detail: "Recovering your response",
          elapsedMs: thinkingStartedAtRef.current ? Date.now() - thinkingStartedAtRef.current : 0,
          model
        });
        schedulePostChatRefresh();
        await load(true);
        finishChatRequest(requestId, 250, true, 0, selectedThreadId, {
          maxWaitMs: CHAT_RECOVERY_MAX_WAIT_MS,
          onMissing: "failed",
          failedPrompt: prompt.trim(),
          failedAttachmentIds: attachmentIds
        });
        return;
      }
      setError(errMsg);
    }
    finally {
      if (!recoveryFinishScheduled) {
        finishChatRequest(requestId, finishDelayMs, requireAssistantMessage, 0, selectedThreadId);
      }
    }
  };

  const retryPrompt = async (failedId: string) => {
    const failedMsg = failedMessages.find(m => m.id === failedId);
    if (!failedMsg) return;
    if (failedMsg.errorCanRetry === false) return;
    setFailedMessages(prev => prev.filter(m => m.id !== failedId));
    await sendPrompt(failedMsg.retryPrompt || failedMsg.content, selectedModel, planMode, usageOptimizer, verificationMode, failedMsg.attachmentIds, undefined, modelMode);
  };

  const dismissFailedMessage = (failedId: string) => {
    setFailedMessages(prev => prev.filter(m => m.id !== failedId));
  };

  const claim = async (code: string) => {
    const normalizedCode = normalizePairingCode(code);
    const pairingCode = formatPairingCode(normalizedCode);
    if (!selectedProject || normalizedCode.length !== 12) {
      setError("Enter the full 12-character pairing code shown in the Studio plugin.");
      throw new Error("Invalid pairing code length");
    }
    setBusy(true);
    try {
      await api.claimPairing(selectedProject.id, pairingCode);
      await load();
    } catch (e) {
      const apiError = e instanceof ApiError ? e : undefined;
      const errorCode = apiError?.code;
      let message = "Failed to link Studio. Please try again.";
      if (errorCode === "pairing_code_invalid") {
        message = "That pairing code is invalid. Please check the code and try again.";
      } else if (errorCode === "pairing_code_expired") {
        message = "That pairing code has expired. Generate a new one in Studio and try again.";
      } else if (errorCode === "pairing_code_claimed") {
        message = "That pairing code was already claimed. Generate a new one in Studio.";
      } else if (errorCode === "project_not_found") {
        message = "Project not found. Please refresh and try again.";
      } else if (apiError?.message) {
        message = apiError.message;
      }
      setError(message);
      throw new Error(message);
    } finally { setBusy(false); }
  };

  const unlink = async (sid: string): Promise<boolean> => {
    setBusy(true);
    try { await api.disconnectStudio(sid); await load(); return true; }
    catch (e) { setError(e instanceof Error ? e.message : "Failed"); return false; }
    finally { setBusy(false); }
  };

  const clearLocalData = async () => {
    if (!confirm("Clear synced snapshots, chats, attachments, change sets, and Studio logs for this workspace?")) return;
    setBusy(true); setError("");
    try {
      await api.clearLocalData();
      setSelectedThreadId("");
      await load();
    } catch (e) { setError(e instanceof Error ? e.message : "Failed to clear local data"); }
    finally { setBusy(false); }
  };

  const deleteAccount = async () => {
    setBusy(true);
    setError("");
    try {
      await api.deleteAccount();
      setData(null);
      setSelectedProjectId("");
      setSelectedThreadId("");
      window.location.assign("/");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to delete account");
      throw e;
    } finally {
      setBusy(false);
    }
  };

  const startCheckout = async (plan: Exclude<PlanName, "free"> = "pro", billingCycle: BillingCycle = "annual") => {
    setBusy(true);
    setError("");
    try {
      const session = await api.createCheckoutSession(plan, billingCycle);
      window.location.assign(session.url);
    } catch (e) { setError(e instanceof Error ? e.message : "Could not start checkout"); }
    finally { setBusy(false); }
  };

  const buyTopUp = async (pack: TopUpPack["id"]) => {
    setBusy(true);
    setError("");
    try {
      const session = await api.createTopUpSession(pack);
      window.location.assign(session.url);
    } catch (e) { setError(e instanceof Error ? e.message : "Could not start checkout"); }
    finally { setBusy(false); }
  };

  const buyCustomTopUp = async (usagePercent: number) => {
    setBusy(true);
    setError("");
    try {
      const session = await api.createTopUpSession({ usagePercent });
      window.location.assign(session.url);
    } catch (e) { setError(e instanceof Error ? e.message : "Could not start checkout"); }
    finally { setBusy(false); }
  };

  const openBillingPortal = async () => {
    setBusy(true);
    setError("");
    try {
      const session = await api.createBillingPortalSession();
      window.location.assign(session.url);
    } catch (e) { setError(e instanceof Error ? e.message : "Could not open billing portal"); }
    finally { setBusy(false); }
  };

  const loginPrivate = async () => {
    setBusy(true);
    try { 
      await api.privateOwnerLogin(); 
      localStorage.setItem("vectis_just_logged_in", "true");
      await load(); 
    }
    catch (e) { setError(e instanceof Error ? e.message : "Login failed"); }
    finally { setBusy(false); }
  };

  const loginFirebase = async () => {
    if (busy) return;
    if (!authConfig?.firebaseConfigured) return;
    setBusy(true);
    try {
      const { signInWithFirebaseGoogle } = await import("../firebaseClient");
      const token = await signInWithFirebaseGoogle(authConfig.firebase);
      await api.firebaseLogin(token);
      localStorage.setItem("vectis_just_logged_in", "true");
      await load();
    } catch (e) { setError(e instanceof Error ? e.message : "Login failed"); }
    finally { setBusy(false); }
  };

  const loginSupabase = async () => {
    if (busy) return;
    if (!authConfig?.supabaseConfigured || !authConfig.supabase) {
      setError("Google sign-in is not configured yet.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const { signInWithSupabaseGoogle } = await import("../supabaseClient");
      await signInWithSupabaseGoogle(authConfig.supabase);
    } catch (e) { setError(e instanceof Error ? e.message : "Login failed"); }
    finally { setBusy(false); }
  };

  const logout = async () => {
    setIsLoggingOut(true);
    try {
      await api.logout();
    } catch (e) {
      console.warn("Sign out request failed", e);
    }
    if (authConfig?.supabaseConfigured && authConfig.supabase) {
      try {
        const { clearSupabaseSession } = await import("../supabaseClient");
        await clearSupabaseSession(authConfig.supabase);
      } catch (e) {
        console.warn("Supabase sign out cleanup failed", e);
      }
    }
    setData(null);
    setSelectedProjectId("");
    setSelectedThreadId("");
    window.location.assign("/");
  };

  const statusTextForChangeSet = (cs: ChangeSet) => {
    if (cs.undoFailedAt && cs.status === "applied") return "Undo failed";
    if (cs.undoRequestedAt && cs.status === "applied") return "Undoing in Studio";
    const labels: Record<ChangeSet["status"], string> = {
      draft: "Draft",
      ready_for_review: "Needs review",
      approved_for_studio: "Waiting in Studio",
      applied: "Applied",
      failed: "Failed",
      rejected: "Rejected",
      undone: "Rolled back"
    };
    return labels[cs.status];
  };

  const creditEstimate = useMemo(() => {
    if (!linkedSession || !selectedModel) return 0;

    const fallbackCosts: Record<string, { chat: number; changeset: number }> = {
      "gemini-3.5-flash": { chat: 8, changeset: 24 },
      "gemini-3-flash": { chat: 8, changeset: 32 },
      "gemini-3-flash-preview": { chat: 8, changeset: 32 },
      "gemini-3.1-pro-preview": { chat: 30, changeset: 120 },
      "deepseek-v4-flash": { chat: 1, changeset: 4 },
      "qwen3.7-max": { chat: 18, changeset: 72 },
      "gpt-5.5": { chat: 18, changeset: 72 },
      "claude-opus-4-8": { chat: 40, changeset: 160 },
      "kimi-k2.7-code": { chat: 10, changeset: 40 }
    };

    const prefs = data?.user?.preferences ?? {};
    const isFreePlan = data?.organization?.plan === "free";
    const selectedThinkingMode = authConfig?.models?.find((model) => model.id === selectedModel)?.thinkingControlMode ?? "none";
    let tuningLevel = "none";
    if (selectedThinkingMode === "none") {
      tuningLevel = "none";
    } else if (selectedModel === "gemini-3.5-flash") {
      tuningLevel = prefs.thinkingGemini35Flash ?? "high";
    } else if (selectedModel === "gemini-3-flash-preview" || selectedModel === "gemini-3-flash") {
      tuningLevel = prefs.thinkingGemini3Flash ?? "high";
    } else if (selectedModel === "gemini-3.1-pro-preview") {
      tuningLevel = prefs.thinkingGemini31Pro ?? "high";
    } else if (selectedModel === "deepseek-v4-flash") {
      tuningLevel = deepSeekThinkingLevel(prefs.thinkingDeepSeekV4Flash, "high");
    } else if (selectedModel === "deepseek-v4-pro") {
      tuningLevel = deepSeekThinkingLevel(prefs.thinkingDeepSeekV4Flash, "high");
    } else if (selectedModel === "gpt-5.5") {
      tuningLevel = prefs.thinkingGpt55 ?? "medium";
    } else if (selectedModel === "qwen3.7-max") {
      tuningLevel = prefs.thinkingQwen ?? "high";
    } else if (selectedModel === "claude-opus-4-8") {
      tuningLevel = prefs.thinkingOpus ?? "high";
    } else if (selectedModel === "kimi-k2.7-code") {
      tuningLevel = "high";
    } else if (selectedModel === "glm-5.2") {
      tuningLevel = prefs.thinkingGlm52 ?? "high";
    }

    if (isFreePlan && selectedModel !== "kimi-k2.7-code" && ["high", "xhigh", "max"].includes(tuningLevel)) {
      if (selectedModel === "deepseek-v4-flash" || selectedModel === "deepseek-v4-pro") {
        if (tuningLevel === "max") tuningLevel = "high";
      } else {
        tuningLevel = "medium";
      }
    }
    let tuningScaler = 1.0;
    if (isAlwaysThinkingModel(selectedModel)) {
      tuningScaler = 1.0;
    } else if (isFreePlan && (selectedModel === "deepseek-v4-flash" || selectedModel === "deepseek-v4-pro")) {
      tuningScaler = 1.0;
    } else if (isFreePlan) {
      tuningScaler = tuningLevel === "none" ? 1.0 : 1.5;
    } else if (selectedModel === "deepseek-v4-flash" || selectedModel === "deepseek-v4-pro") {
      tuningScaler = tuningLevel === "none" ? 1.0 : tuningLevel === "high" ? 1.5 : 2.0;
    } else if (isBinaryThinkingModel(selectedModel)) {
      tuningScaler = tuningLevel === "none" ? 1.0 : 1.5;
    } else if (tuningLevel === "low") {
      tuningScaler = 1.2;
    } else if (tuningLevel === "medium") {
      tuningScaler = 1.5;
    } else if (tuningLevel === "high") {
      tuningScaler = 2.0;
    } else if (tuningLevel === "xhigh") {
      tuningScaler = 2.5;
    } else if (tuningLevel === "max") {
      tuningScaler = 3.0;
    }

    const baseCost = fallbackCosts[selectedModel] ?? fallbackCosts["gemini-3.5-flash"];
    let estimate = (planMode ? baseCost.chat : baseCost.changeset) * tuningScaler;
    if (usageOptimizer) estimate *= 0.85;
    if (verificationMode !== "off") estimate *= 1.1;

    return Math.max(1, Math.round(estimate));
  }, [authConfig?.models, data?.organization?.plan, data?.user?.preferences, linkedSession, selectedModel, planMode, usageOptimizer, verificationMode]);

  const value = {
    authConfig,
    data,
    loading,
    busy,
    isLoggingOut,
    thinkingStartedAt,
    activeChatRequestId,
    activeChatRequestModel,
    chatProgress,
    progressSteps,
    streamingContent,
    reasoningPreview,
    reasoningPreviewDone,
    error,
    setError,
    setBusy,
    load,
    loginPrivate,
    loginFirebase,
    loginSupabase,
    logout,
    theme,
    setTheme,
    themeLightPreset,
    setThemeLightPreset,
    themeLightBg,
    setThemeLightBg,
    themeLightFg,
    setThemeLightFg,
    themeLightAccent,
    setThemeLightAccent,
    themeDarkPreset,
    setThemeDarkPreset,
    themeDarkBg,
    setThemeDarkBg,
    themeDarkFg,
    setThemeDarkFg,
    themeDarkAccent,
    setThemeDarkAccent,
    planMode,
    setPlanMode,
    selectedModel,
    setSelectedModel,
    usageOptimizer,
    setUsageOptimizer,
    optimizationMode,
    setOptimizationMode,
    verificationMode,
    setVerificationMode,
    modelMode,
    setModelMode,
    fileReferences,
    setFileReferences,
    selectedProjectId,
    setSelectedProjectId,
    selectedThreadId,
    setSelectedThreadId,
    selectedProject,
    threads,
    messages,
    changeSets,
    snapshot,
    linkedSession,
    pending,
    approved,
    nodeCount,
    scriptCount,
    isPluginOnline,
    lastSyncLabel,
    approveChange,
    undoChange,
    dismissChange,
    createThread,
    deleteThread,
    deleteThreads,
    renameThread,
    uploadAttachment,
    deleteAttachment,
    generateIcon,
    sendPrompt,
    editMessage,
    retryPrompt,
    dismissFailedMessage,
    cancelChatRequest,
    statusTextForChangeSet,
    claim,
    unlink,
    clearLocalData,
    deleteAccount,
    startCheckout,
    buyTopUp,
    buyCustomTopUp,
    openBillingPortal,
    savePreferencePatch,
    creditEstimate,
    fetchEvaluations,
    runEvaluation,
    deleteEvaluation,
    clearEvaluations,
    editTaskPlan,
    approveTaskPlan,
    supersedeTaskPlan,
    addComment,
    resolveComment
  };


  return (
    <VectisContext.Provider value={value}>
      {children}
    </VectisContext.Provider>
  );
}

export function useVectis() {
  const context = useContext(VectisContext);
  if (!context) throw new Error("useVectis must be used within a VectisProvider");
  return context;
}