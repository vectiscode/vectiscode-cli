export type PlanName = "free" | "starter" | "pro" | "studio";
export type BillingCycle = "monthly" | "annual";

export type ProjectTemplate =
  | "obby"
  | "simulator"
  | "tycoon"
  | "fighting_arena"
  | "horror"
  | "roleplay"
  | "inventory_shop";

export type ChangeAction = "create" | "update" | "delete" | "import_asset";

export type StudioCommandType =
  | "read_output"
  | "set_breakpoint"
  | "clear_breakpoints"
  | "script_read"
  | "script_search"
  | "script_grep"
  | "query_tree"
  | "inspect_instance"
  | "insert_asset"
  | "start_play"
  | "stop_play";

export interface StudioCommand {
  id: string;
  type: StudioCommandType;
  arguments: Record<string, unknown>;
}

export interface StudioCommandResult {
  commandId: string;
  status: "ok" | "error";
  result?: Record<string, unknown>;
  error?: string;
}

export type StudioClassName =
  | "Script"
  | "LocalScript"
  | "ModuleScript"
  | "Folder"
  | "RemoteEvent"
  | "RemoteFunction"
  | "Tool"
  | "Part"
  | "WedgePart"
  | "CornerWedgePart"
  | "TrussPart"
  | "SpawnLocation"
  | "Model"
  | "Animation"
  | "PointLight"
  | "SpotLight"
  | "SurfaceLight"
  | "Attachment"
  | "WeldConstraint"
  | "ProximityPrompt"
  | "ClickDetector"
  | "SurfaceGui"
  | "BillboardGui"
  | "ScreenGui"
  | "Frame"
  | "ScrollingFrame"
  | "CanvasGroup"
  | "TextLabel"
  | "TextButton"
  | "ImageLabel"
  | "ImageButton"
  | "UIListLayout"
  | "UIGridLayout"
  | "UIPadding"
  | "UICorner"
  | "UIStroke"
  | "UIGradient"
  | "UIAspectRatioConstraint"
  | "UIScale"
  | "UITextSizeConstraint"
  | "UIPageLayout";

export type StudioPropertyValue =
  | string
  | number
  | boolean
  | { type: "Vector3"; value: [number, number, number] }
  | { type: "Vector2"; value: [number, number] }
  | { type: "Color3"; value: [number, number, number] }
  | { type: "UDim"; value: [number, number] }
  | { type: "UDim2"; value: [number, number, number, number] }
  | { type: "CFrame"; value: [number, number, number, number, number, number, number, number, number, number, number, number] }
  | { type: "Enum"; enumType: string; value: string };

export interface AgentActivityStep {
  id: string;
  kind: "inspect" | "search" | "create" | "edit" | "validate" | "blocked";
  label: string;
  status: "running" | "success" | "warning" | "failed" | "blocked";
  detail?: string;
}

export interface User {
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
}

export type OptimizationMode = "disabled" | "balanced" | "cost_saver";

export interface UserPreferences {
  theme?: "light" | "dark";
  usageOptimizer?: boolean;
  optimizationMode?: OptimizationMode;
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
  robloxUiGeneration?: "structural" | "programmatic";
  robloxCartoonyUi?: boolean;
  robloxUiOutlineThickness?: "thin" | "medium" | "thick";
  robloxUiCornerRadius?: number;
  robloxUiThemeColor?: "colorful" | "pastel" | "neon" | "studio";
  robloxUiFont?: "FredokaOne" | "LuckiestGuy" | "ComicNeue" | "GothamBold";
}

export interface BootstrapData {
  user: User;
  organization: Organization;
  creditBalance: number;
  usage: UsageStats;
  projects: Project[];
  sessions: StudioSession[];
  threads: Thread[];
  changeSets: ChangeSet[];
  messages: AiMessage[];
  attachments: Attachment[];
  snapshots?: ProjectSnapshot[];
  logs?: StudioLog[];
  studioTaskRuns: StudioTaskRun[];
  studioObservations: StudioObservation[];
  ledger: CreditLedger[];
  users?: User[];
}

export interface Organization {
  id: string;
  name: string;
  plan: PlanName;
  stripeCustomerId?: string;
  stripeSubscriptionId?: string;
  stripeSubscriptionStatus?: string;
  stripePriceId?: string;
  billingCycle?: BillingCycle;
  billingCurrentPeriodEnd?: string;
  lastRefillAt?: string;
  createdAt: string;
}

export interface ProjectMember {
  id: string;
  organizationId: string;
  userId: string;
  role: "owner" | "developer" | "viewer";
}

export interface Project {
  id: string;
  organizationId: string;
  name: string;
  template: ProjectTemplate;
  description: string;
  createdAt: string;
  updatedAt: string;
}

export interface StudioSession {
  id: string;
  userId?: string;
  projectId?: string;
  pairingCode?: string;
  connectorToken: string;
  previousConnectorToken?: string;
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
}

export interface AuthSession {
  id: string;
  userId: string;
  createdAt: string;
  expiresAt: string;
}

export interface SnapshotNode {
  path: string;
  className: string;
  source?: string;
  properties?: Record<string, unknown>;
}

export interface ProjectSnapshot {
  id: string;
  projectId: string;
  studioSessionId: string;
  nodes: SnapshotNode[];
  createdAt: string;
}

export interface StudioSnapshotChunk {
  id: string;
  uploadId: string;
  sessionId: string;
  projectId: string;
  mode: "full" | "delta";
  index: number;
  total: number;
  totalNodeCount?: number;
  nodes: Array<SnapshotNode & { deleted?: boolean }>;
  createdAt: string;
  expiresAt: string;
}

export interface ChangeFile {
  id: string;
  action: ChangeAction;
  instancePath: string;
  className: StudioClassName;
  source?: string;
  properties?: Record<string, StudioPropertyValue>;
  assetId?: number;
  assetType?: "model" | "animation" | "mesh" | "image" | "audio";
  reason: string;
}

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
  status: "draft" | "generating" | "approved" | "superseded";
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

export interface Thread {
  id: string;
  projectId: string;
  userId: string;
  name: string;
  createdAt: string;
  updatedAt: string;
}

export interface Attachment {
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
  inlineBase64?: string;
  creditsCharged?: number;
  prompt?: string;
  createdAt: string;
}

export interface ApplyResult {
  id: string;
  changeSetId: string;
  studioSessionId: string;
  status: "applied" | "failed";
  details: string;
  createdAt: string;
}

export interface AiMessage {
  id: string;
  projectId: string;
  threadId: string;
  clientRequestId?: string;
  role: "user" | "assistant";
  content: string;
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
  createdAt: string;
  changeSetId?: string;
  attachmentIds?: string[];
  agentRunId?: string;
  status?: "failed";
  error?: string;
  errorCode?: string;
  errorTitle?: string;
  errorAction?: "top_up" | "upgrade" | "retry" | "none";
  errorActionLabel?: string;
  errorCanRetry?: boolean;
  errorPayload?: Record<string, unknown>;
  retryPrompt?: string;
}
export interface ProjectContextIndexEntry {
  path: string;
  className: string;
  parentPath?: string;
  childCount: number;
  symbols: string[];
  services: string[];
  remoteReferences: string[];
  requires: string[];
  ownership: "server" | "client" | "shared";
  uiAncestry: boolean;
  worldAnchor: boolean;
}
export interface ProjectContextIndex {
  id: string;
  projectId: string;
  snapshotId: string;
  digest: string;
  entries: ProjectContextIndexEntry[];
  createdAt: string;
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
export type AgentRunEvent =
  | { type: "run_started" | "run_completed" | "run_failed" | "run_cancelled"; runId: string; at: string; detail?: string }
  | { type: "stage_started" | "tool_called" | "tool_completed" | "tool_failed" | "validation_completed" | "awaiting_review" | "verification_completed" | "steer_queued"; runId: string; at: string; step?: AgentStep; detail?: string };
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

export interface CreditLedger {
  id: string;
  organizationId: string;
  delta: number;
  reason: string;
  createdAt: string;
}

export interface UsageStats {
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
}

export interface CustomerEvidenceEvent {
  id: string;
  userId?: string;
  organizationId?: string;
  projectId?: string;
  threadId?: string;
  type:
    | "auth"
    | "billing"
    | "usage"
    | "admin"
    | "attachment"
    | "image_generation"
    | "studio"
    | "deletion"
    | "client_error";
  action: string;
  route: string;
  method: string;
  ip?: string;
  country?: string;
  userAgent?: string;
  status?: string;
  amountCredits?: number;
  stripeCustomerId?: string;
  stripeSubscriptionId?: string;
  stripeSessionId?: string;
  metadata?: Record<string, unknown>;
  createdAt: string;
}

export interface StudioLog {
  id: string;
  studioSessionId: string;
  level: "info" | "warn" | "error";
  message: string;
  createdAt: string;
}

export interface SafetyReport {
  ok: boolean;
  blockedPatterns: string[];
}

export interface AiCache {
  id: string;
  snapshotId: string;
  modelId: string;
  cacheName: string;
  summary?: string;
  snapshotSizeChars?: number;
  ttlSeconds?: number;
  expiresAt: string;
  createdAt: string;
}

export interface StripeProcessedEvent {
  id: string;
  stripeEventId?: string;
  stripeSessionId?: string;
  eventType: string;
  action: string;
  status: "processing" | "processed" | "duplicate_ignored";
  organizationId?: string;
  amountCredits?: number;
  metadata?: Record<string, unknown>;
  createdAt: string;
  processedAt?: string;
  duplicateIgnoredAt?: string;
}

export interface ModelEvaluationRunResult {
  modelId: string;
  success: boolean;
  latencyMs: number;
  costCredits: number;
  generationCostCredits?: number;
  judgeCostCredits?: number;
  estimatedProviderCostUsd?: number;
  safetyOk: boolean;
  blockedPatterns: string[];
  syntaxOk: boolean;
  syntaxErrors?: string[];
  score: number;
  reasoning: string;
  changeSetId?: string;
  thinkingLevel?: "none" | "low" | "medium" | "high" | "xhigh" | "max";
  thinkingMultiplier?: number;
  usageMultiplier?: number;
  repairAttempts?: number;
  generatedTitle?: string;
  generatedSummary?: string;
  generatedFiles?: ChangeFile[];
  requirementChecks?: Array<{ label: string; ok: boolean; detail?: string }>;
  valueScore?: number;
  rankScore?: number;
  outputTruncated?: boolean;
}

export interface ModelEvaluationRun {
  id: string;
  promptId: string; // "leaderstats" | "sprint" | "shop" | "custom" | "all"
  promptText: string;
  startedAt: string;
  completedAt: string;
  totalCostCredits?: number;
  estimatedProviderCostUsd?: number;
  runs: ModelEvaluationRunResult[];
}

export interface ModelEvaluationLeaderboardEntry {
  modelId: string;
  runCount: number;
  successCount: number;
  successRate: number;
  averageScore: number;
  bestScore: number;
  worstScore: number;
  averageLatencyMs: number;
  averageCostCredits: number;
  totalCostCredits: number;
  averageValueScore: number;
  averageRankScore: number;
  syntaxPassRate: number;
  safetyPassRate: number;
  slowRunCount: number;
  latestRunAt?: string;
  bestPromptId?: string;
  bestPromptName?: string;
  bestRunId?: string;
  strengths: string[];
  weaknesses: string[];
}

export interface AdminProductInsights {
  generatedAt: string;
  sample: {
    perCollectionLimit: number;
    truncatedCollections: string[];
  };
  patches: {
    total: number;
    reviewable: number;
    applied: number;
    failed: number;
    rejected: number;
    successRate: number;
    applyFailures: number;
    conflictsBypassed: number;
  };
  ai: {
    assistantMessages: number;
    timeoutCount: number;
    timeoutRate: number;
    averageLatencyMs: number;
    modelCostPerSuccessfulPatch: Array<{
      modelId: string;
      successfulPatches: number;
      totalCostCredits: number;
      averageCostCredits: number;
    }>;
  };
  credits: {
    debitedCredits: number;
    refundedCredits: number;
    refundRate: number;
    refundEvents: number;
  };
  studio: {
    sessions: number;
    activeSessions: number;
    onlineSessions: number;
    expiredSessions: number;
    recentSnapshotSyncs: number;
    recentRuntimeErrors: number;
    recentRuntimeWarnings: number;
    connectorVersions: Array<{ version: string; count: number }>;
  };
  recentFailures: Array<{
    id: string;
    createdAt: string;
    source: "task" | "log" | "message";
    label: string;
    detail: string;
    projectId?: string;
    modelId?: string;
  }>;
}
