// Shared API Contracts for Vectis Code

export type ProjectTemplate =
  | "obby"
  | "simulator"
  | "tycoon"
  | "fighting_arena"
  | "horror"
  | "roleplay"
  | "inventory_shop";

export type ChangeAction = "create" | "update" | "delete" | "import_asset";

export interface ChangeFile {
  id: string;
  action: ChangeAction;
  instancePath: string;
  className: string;
  source?: string;
  properties?: Record<string, unknown>;
  assetId?: number;
  assetType?: "model" | "animation" | "mesh" | "image" | "audio";
  reason: string;
}

export interface SafetyReport {
  ok: boolean;
  blockedPatterns: string[];
}

export interface AgentActivityStep {
  id: string;
  kind: "inspect" | "search" | "create" | "edit" | "validate" | "blocked";
  label: string;
  status: "running" | "success" | "warning" | "failed" | "blocked";
  detail?: string;
}

export type AgentRunMode = "answer" | "changeset" | "verification" | "repair";
export type AgentRunStatus = "queued" | "preparing_context" | "running" | "awaiting_review" | "verifying" | "completed" | "cancelled" | "failed";

export interface AgentStep {
  index: number;
  kind: "context" | "model" | "tool" | "validation" | "review" | "apply" | "verification" | "repair";
  status: "queued" | "running" | "completed" | "failed" | "cancelled";
  title: string;
  detail?: string;
  toolName?: string;
  toolCallId?: string;
  artifactId?: string;
  durationMs?: number;
  inputTokens?: number;
  outputTokens?: number;
  startedAt?: string;
  completedAt?: string;
}

export interface AgentRun {
  id: string;
  projectId: string;
  threadId: string;
  userId: string;
  userMessageId: string;
  assistantMessageId?: string;
  changeSetId?: string;
  parentRunId?: string;
  studioTaskRunId?: string;
  requestedModel: string;
  actualModel: string;
  provider: string;
  mode: AgentRunMode;
  status: AgentRunStatus;
  workloadBudget: { maxReadCalls: number; maxRepairAttempts: number; maxParallelReads: number };
  usage?: { inputTokens: number; outputTokens: number; costCredits?: number };
  contextDigest?: string;
  queuedSteering?: string[];
  queuedSuccessorPrompts?: string[];
  steps: AgentStep[];
  error?: { code?: string; message: string; retryable?: boolean };
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
  cancelledAt?: string;
}

export interface ToolResultEnvelope<T = unknown> {
  ok: boolean;
  callId: string;
  tool: string;
  summary: string;
  data: T;
  artifactId?: string;
  truncated: boolean;
  nextCursor?: string;
  durationMs: number;
}

export interface AgentArtifact {
  id: string;
  projectId: string;
  runId: string;
  tool: string;
  mimeType: string;
  content: string;
  summary: string;
  createdAt: string;
  expiresAt: string;
}

export interface DesignProfile {
  id: string;
  projectId: string;
  referenceAttachmentIds: string[];
  palette: string[];
  typography: string[];
  borders?: string;
  corners?: string;
  spacing?: string;
  texture?: string;
  composition?: string;
  iconDirection?: string;
  forbiddenPatterns: string[];
  extractedAt: string;
  updatedAt: string;
}

export type AgentRunEvent =
  | { type: "run_started" | "run_completed" | "run_failed" | "run_cancelled"; runId: string; at: string; detail?: string }
  | { type: "stage_started" | "tool_called" | "tool_completed" | "tool_failed" | "validation_completed" | "awaiting_review" | "verification_completed" | "steer_queued"; runId: string; at: string; step?: AgentStep; detail?: string };

export interface ReviewReport {
  riskLevel: "safe" | "medium" | "high" | "blocked";
  confidenceScore: number;
  affectedInstances: string[];
  securityFindings: string[];
  dataStoreFindings: string[];
  remoteEventFindings: string[];
  uiFindings: string[];
  rollbackNotes: string;
  validationChecklist: string[];
  testPlan: string;
  summaryForCreator: string;
  source?: "general" | "console_fix";
}

export interface ChangeSet {
  id: string;
  projectId: string;
  threadId: string;
  aiMessageId: string;
  title: string;
  summary: string;
  status: "draft" | "ready_for_review" | "approved_for_studio" | "applied" | "failed" | "rejected" | "undone";
  files: ChangeFile[];
  safety: SafetyReport;
  activity?: AgentActivityStep[];
  baseSnapshotId?: string;
  baseSnapshotCreatedAt?: string;
  baseSnapshotNodeCount?: number;
  baseSnapshotFingerprint?: string;
  approvedWithSnapshotConflict?: boolean;
  createdAt: string;
  appliedAt?: string;
  undoRequestedAt?: string;
  undoFailedAt?: string;
  undoneAt?: string;
  studioTaskRunId?: string;
  agentRunId?: string;
  verificationMode?: "off" | "standard" | "deep";
  
  // Team Review & Auditing (Step 1 & Step 9)
  reviewReport?: ReviewReport;
  requestedByUserId?: string;
  assignedReviewerUserId?: string;
  approvedByUserId?: string;
  dismissedByUserId?: string;
  approvalPolicy?: string;
  reviewCommentCount?: number;
}

export interface TaskPlanStep {
  id: string;
  description: string;
  targetFile?: string;
  completedAt?: string;
}

export interface TaskPlan {
  id: string;
  projectId: string;
  threadId: string;
  userMessageId: string;
  status: "draft" | "approved" | "superseded";
  goal: string;
  assumptions: string[];
  targetInstances: string[];
  steps: TaskPlanStep[];
  acceptanceCriteria: string[];
  risks: string[];
  estimatedComplexity: "low" | "medium" | "high";
  createdAt: string;
  updatedAt: string;
  approvedAt?: string;
  supersededAt?: string;
  changeSetId?: string;
}

export interface PatchComment {
  id: string;
  changeSetId: string;
  projectId: string;
  filePath?: string;
  userId: string;
  userName: string;
  commentText: string;
  resolved: boolean;
  resolvedByUserId?: string;
  resolvedAt?: string;
  createdAt: string;
  updatedAt: string;
}

export type StudioTaskStatus =
  | "queued"
  | "applying"
  | "validating"
  | "repairing"
  | "passed"
  | "passed_with_warnings"
  | "failed"
  | "cancelled"
  | "rolled_back";

export interface StudioTaskRun {
  id: string;
  projectId: string;
  studioSessionId?: string;
  changeSetId: string;
  threadId: string;
  status: StudioTaskStatus;
  repairRound: number;
  maxRepairRounds: number;
  verificationProfile: "standard" | "deep";
  visualQa: "not_requested" | "available" | "skipped_no_permission" | "skipped_no_provider" | "completed";
  createdAt: string;
  updatedAt: string;
  appliedAt?: string;
  completedAt?: string;
  cancelledAt?: string;
  rolledBackAt?: string;
  
  // Verification Summary (Step 4)
  verificationSummary?: {
    passed: number;
    warnings: number;
    failed: number;
    skipped: number;
    failureReasons: string[];
  };
}

export type StudioObservationKind =
  | "apply_result"
  | "rollback_result"
  | "runtime_log"
  | "snapshot"
  | "screenshot"
  | "playtest_result"
  | "validation_probe";

export interface StudioObservation {
  id: string;
  taskRunId: string;
  studioSessionId: string;
  projectId: string;
  kind: StudioObservationKind;
  status: "info" | "passed" | "warning" | "failed";
  summary: string;
  details?: Record<string, unknown>;
  createdAt: string;
}

export interface UserPreferences {
  theme?: "light" | "dark";
  usageOptimizer?: boolean;
  optimizationMode?: "disabled" | "balanced" | "cost_saver";
  luauGuard?: boolean;
  verificationMode?: "off" | "standard" | "deep";
  fileReferences?: boolean;
  thinkingGemini35Flash?: "none" | "low" | "medium" | "high";
  thinkingGemini3Flash?: "none" | "low" | "medium" | "high";
  thinkingGemini31Pro?: "low" | "medium" | "high";
  thinkingGemini31FlashLite?: "none" | "low" | "medium" | "high";
  thinkingDeepSeekV4Flash?: "none" | "high" | "max";
  thinkingDeepSeekV4Pro?: "none" | "high" | "max";
  thinkingGlm51?: "none" | "high";
  thinkingGlm52?: "none" | "low" | "medium" | "high" | "xhigh" | "max";
  thinkingGpt55?: "none" | "low" | "medium" | "high" | "xhigh";
  thinkingQwen?: "none" | "high";
  thinkingOpus?: "none" | "low" | "medium" | "high" | "xhigh" | "max";
  thinkingMiMoPro?: "none" | "high";
  thinkingKimi?: "none" | "high";
  contextCachingEnabled?: boolean;
  semanticChecksEnabled?: boolean;
  robloxCartoonyUi?: boolean;
  robloxUiGeneration?: "structural" | "programmatic";
  robloxUiFont?: "FredokaOne" | "LuckiestGuy" | "ComicNeue" | "GothamBold";
  robloxUiOutlineThickness?: "thin" | "medium" | "thick";
  robloxUiCornerRadius?: number;
  robloxUiThemeColor?: "colorful" | "pastel" | "neon" | "studio";
}

export interface BootstrapData {
  user: {
    id: string;
    name: string;
    email?: string;
    avatarUrl?: string;
    googleUserId?: string;
    googleUserIds?: string[];
    supabaseUserId?: string;
    robloxUserId?: string;
    robloxUsername?: string;
    authProvider: "private" | "roblox" | "google" | "firebase" | "supabase";
    status?: "active" | "banned";
    preferences?: UserPreferences;
    createdAt: string;
  };
  organization: {
    id: string;
    name: string;
    plan: string;
    stripeCustomerId?: string;
    stripeSubscriptionId?: string;
    stripeSubscriptionStatus?: string;
    stripePriceId?: string;
    billingCycle?: string;
    billingCurrentPeriodEnd?: string;
    lastRefillAt?: string;
    createdAt: string;
  };
  creditBalance: number;
  usage: {
    weekly: {
      allowance: number;
      remaining: number;
      used: number;
      nextRefillAt?: string;
    };
    monthly: {
      allowance: number;
      extraCredits: number;
      paidExtraCredits: number;
      adminGrantedCredits: number;
      adminAdjustedCredits: number;
      limit: number;
      used: number;
      remaining: number;
      periodStart: string;
      periodEnd: string;
    };
  };
  projects: Array<{
    id: string;
    organizationId: string;
    name: string;
    template: ProjectTemplate;
    description: string;
    createdAt: string;
    updatedAt: string;
    approvalPolicy?: string; // Step 9
  }>;
  sessions: Array<{
    id: string;
    userId?: string;
    projectId?: string;
    pairingCode?: string;
    connectorToken?: string;
    previousConnectorTokenExpiresAt?: string;
    connectorTokenRotatedAt?: string;
    status: "waiting" | "paired" | "connected" | "expired";
    pluginVersion: string;
    placeId?: string;
    placeName?: string;
    createdAt: string;
    pairedAt?: string;
    lastSeenAt?: string;
    expiresAt?: string;
    resyncRequestedAt?: string;
    disconnectedAt?: string;
    disconnectedBy?: "web" | "plugin" | "timeout";
    disconnectReason?: string;
  }>;
  changeSets: ChangeSet[];
  messages: Array<{
    id: string;
    projectId: string;
    role: "user" | "assistant";
    content: string;
    createdAt: string;
    threadId: string;
    modelUsed?: string;
    modelRequested?: string;
    wasOptimized?: boolean;
    usageCostCredits?: number;
    thoughtDurationMs?: number;
    providerTrace?: {
      provider?: string;
      requestedModel?: string;
      usedModel?: string;
      thinkingLevel?: "none" | "low" | "medium" | "high" | "xhigh" | "max";
      thinkingMultiplier?: number;
      timeoutMs?: number;
      fallbackNote?: string;
      runtime?: {
        version: "ai-runtime-v1" | "ai-runtime-v2";
        textChunks: number;
        reasoningChunks: number;
        usageEvents: number;
        elapsedMs?: number;
        firstTextMs?: number;
        firstReasoningMs?: number;
        lastEventMs?: number;
        lastEventType?: "text_delta" | "reasoning_delta" | "usage" | "finish" | "warning";
        warnings?: string[];
        finishReason?: string;
      };
    };
    changeSetId?: string;
    attachmentIds?: string[];
    status?: "failed";
    error?: string;
    errorCode?: string;
    errorTitle?: string;
    errorAction?: "top_up" | "upgrade" | "retry" | "none";
    errorActionLabel?: string;
    errorCanRetry?: boolean;
    errorPayload?: Record<string, unknown>;
  }>;
  attachments: Array<{
    id: string;
    organizationId: string;
    projectId: string;
    threadId?: string;
    messageId?: string;
    userId: string;
    source: "upload" | "generated_icon" | "studio_screenshot";
    fileName: string;
    mimeType: string;
    sizeBytes: number;
    storagePath?: string;
    publicUrl?: string;
    inlineText?: string;
    creditsCharged?: number;
    prompt?: string;
    createdAt: string;
  }>;
  threads: Array<{
    id: string;
    projectId: string;
    userId: string;
    name: string;
    createdAt: string;
    updatedAt: string;
  }>;
  snapshots?: Array<{
    id: string;
    projectId: string;
    studioSessionId: string;
    nodes: Array<{ path: string; className: string; source?: string; properties?: Record<string, unknown> }>;
    createdAt: string;
  }>;
  logs?: Array<{ id: string; studioSessionId?: string; level: "info" | "warn" | "error"; message: string; createdAt: string }>;
  studioTaskRuns: StudioTaskRun[];
  studioObservations: StudioObservation[];
  isAdmin?: boolean;
  ledger?: Array<{
    id: string;
    organizationId: string;
    delta: number;
    reason: string;
    createdAt: string;
  }>;
  
  // Step 2 & Step 9 extra bootstrap data
  taskPlans?: TaskPlan[];
  patchComments?: PatchComment[];
}
