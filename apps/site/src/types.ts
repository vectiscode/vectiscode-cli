export type ProjectTemplate =
  | "obby"
  | "simulator"
  | "tycoon"
  | "fighting_arena"
  | "horror"
  | "roleplay"
  | "inventory_shop";

export interface Project {
  id: string;
  organizationId: string;
  name: string;
  template: ProjectTemplate;
  description: string;
  createdAt: string;
  updatedAt: string;
}

export interface ChangeFile {
  id: string;
  action: "create" | "update" | "delete" | "import_asset";
  instancePath: string;
  className:
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
  source?: string;
  properties?: Record<string, unknown>;
  assetId?: number;
  assetType?: "model" | "animation" | "mesh" | "image" | "audio";
  reason: string;
}

export interface AgentActivityStep {
  id: string;
  kind: "inspect" | "search" | "create" | "edit" | "validate" | "blocked";
  label: string;
  status: "running" | "success" | "warning" | "failed" | "blocked";
  detail?: string;
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
  title: string;
  summary: string;
  status: "draft" | "ready_for_review" | "approved_for_studio" | "applied" | "failed" | "rejected" | "undone";
  files: ChangeFile[];
  safety: {
    ok: boolean;
    blockedPatterns: string[];
  };
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
  threadId: string;
  studioTaskRunId?: string;
  agentRunId?: string;
  verificationMode?: "off" | "standard" | "deep";
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


export interface StudioTaskRun {
  id: string;
  projectId: string;
  studioSessionId?: string;
  changeSetId: string;
  threadId: string;
  status: "queued" | "applying" | "validating" | "repairing" | "passed" | "passed_with_warnings" | "failed" | "cancelled" | "rolled_back";
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
  verificationSummary?: {
    passed: number;
    warnings: number;
    failed: number;
    skipped: number;
    failureReasons: string[];
  };
}

export interface StudioObservation {
  id: string;
  taskRunId: string;
  studioSessionId: string;
  projectId: string;
  kind: "apply_result" | "rollback_result" | "runtime_log" | "snapshot" | "screenshot" | "playtest_result" | "validation_probe";
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

export interface StudioSession {
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
  createdAt: string;
}

export interface AiMessage {
  id: string;
  projectId: string;
  role: "user" | "assistant";
  content: string;
  createdAt: string;
  threadId: string;
  clientRequestId?: string;
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
  mode: "answer" | "changeset" | "verification" | "repair";
  status: "queued" | "preparing_context" | "running" | "awaiting_review" | "verifying" | "completed" | "cancelled" | "failed";
  workloadBudget: { maxReadCalls: number; maxRepairAttempts: number; maxParallelReads: number };
  contextDigest?: string;
  queuedSteering?: string[];
  queuedSuccessorPrompts?: string[];
  steps: AgentStep[];
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
  cancelledAt?: string;
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
  creditsCharged?: number;
  prompt?: string;
  createdAt: string;
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
  organization: Organization & { lastRefillAt?: string };
  creditBalance: number;
  usage: UsageStats;
  projects: Project[];
  sessions: StudioSession[];
  changeSets: ChangeSet[];
  messages: AiMessage[];
  attachments: Attachment[];
  threads: Thread[];
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
  taskPlans?: TaskPlan[];
  patchComments?: PatchComment[];
}

export interface AuthConfig {
  robloxOAuthConfigured: boolean;
  googleOAuthConfigured: boolean;
  firebaseConfigured: boolean;
  firebase: {
    apiKey: string;
    authDomain: string;
    projectId: string;
    appId: string;
    storageBucket?: string;
    messagingSenderId?: string;
  };
  supabaseConfigured?: boolean;
  supabase?: {
    url: string;
    anonKey: string;
  };
  robloxApiKeyConfigured: boolean;
  billing: {
    stripeConfigured: boolean;
    proPriceConfigured: boolean;
    currency?: string;
    customCreditPricePerThousand?: number;
    customCreditDiscountedForStudio?: boolean;
    fixedTopUpPricePerThousand?: number;
    annualEconomicsCopy?: string;
    plans?: PlanCatalogItem[];
    topUpPacks?: TopUpPack[];
  };
  imageGeneration: {
    model: string;
    outputSize: string;
    costCredits: number;
    estimatedProviderCostUsd: number;
  };
  visualInspection: {
    available: boolean;
    model?: string;
  };
  privateOwnerLoginEnabled: boolean;
  aiConfigured: boolean;
  aiProvider: "google-vertex" | "yunwu" | "xiaomi" | "deepseek" | "local-fallback";
  defaultModel: string;
  models: Array<{
    id: string;
    label: string;
    tier: string;
    description: string;
    usageMultiplier?: number;
    speedScore?: number;
    intelligenceScore?: number;
    benchmarkIq?: number;
    tokensPerSecond?: number;
    inputUsdPerMillion?: number;
    outputUsdPerMillion?: number;
    bestFor?: string;
    routingNote?: string;
    status?: "available" | "soon";
    thinkingControlMode?: "none" | "binary" | "tiered" | "always";
    thinkingMultiplier?: number;
    capabilities?: {
      text: true;
      imageInput: boolean;
      structuredOutput: boolean;
      preferredForVisualQa: boolean;
    };
    pricingEvent?: {
      id: string;
      label: string;
      discountPercent: number;
      badgeText?: string;
    };
  }>;
  pricingEvents?: Array<{
    id: string;
    label: string;
    discountPercent: number;
    badgeText?: string;
    modelIds: string[] | "all";
  }>;
}

export interface AdminUser {
  id: string;
  name: string;
  email?: string;
  avatarUrl?: string;
  googleUserIds?: string[];
  supabaseUserId?: string;
  authProvider: "private" | "roblox" | "google" | "firebase" | "supabase";
  status?: "active" | "banned";
  registrationSource?: "vectis_app" | "supabase_auth";
  authOnly?: boolean;
  plan: PlanName;
  credits: number;
  projects: number;
  organizationId?: string;
  stripeCustomerId?: string;
  stripeSubscriptionId?: string;
  stripeSubscriptionStatus?: string;
  stripePriceId?: string;
  billingCycle?: BillingCycle;
  billingCurrentPeriodEnd?: string;
  location: string;
  lastSeen: string;
  lastIp?: string;
  lastUserAgent?: string;
  evidenceCount?: number;
  usageEvents?: number;
  attachmentCount?: number;
  generatedIconCount?: number;
  usage?: UsageStats;
}

export type PlanName = "free" | "starter" | "pro" | "studio";
export type BillingCycle = "monthly" | "annual";

export interface PlanCatalogItem {
  name: PlanName;
  label: string;
  priceUsd: number;
  monthlyPriceCents?: number;
  annualPriceCents?: number;
  creditsPerWeek: number;
  creditsPerMonth: number;
  maxProjects: number;
  premiumModels: boolean;
  planMode: boolean;
  usageOptimizer: boolean;
  luauGuard: boolean;
  topUps: boolean;
  description: string;
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

export interface TopUpPack {
  id: "small" | "large";
  label: string;
  credits: number;
  priceUsd: number;
  priceCents?: number;
}

export interface CustomerEvidenceEvent {
  id: string;
  userId?: string;
  organizationId?: string;
  projectId?: string;
  threadId?: string;
  type: "auth" | "billing" | "usage" | "admin" | "attachment" | "image_generation" | "studio" | "deletion" | "client_error";
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

export interface CustomerEvidenceExport {
  generatedAt: string;
  user?: BootstrapData["user"];
  organization?: BootstrapData["organization"];
  snapshot?: {
    userId?: string;
    email?: string;
    authProvider?: string;
    organizationId?: string;
    plan?: string;
    creditBalance?: number;
    weeklyAllowance?: number;
    weeklyRemaining?: number;
    monthlyAllowance?: number;
    monthlyUsed?: number;
    monthlyRemaining?: number;
    adminGrantedCredits?: number;
    paidExtraCredits?: number;
    projectCount?: number;
    threadCount?: number;
    messageCount?: number;
    attachmentCount?: number;
    generatedIconCount?: number;
    ledgerEntryCount?: number;
    studioSessionCount?: number;
    activeStudioSessions?: number;
    latestStudioPluginVersion?: string;
    latestPlaceId?: string;
    latestPlaceName?: string;
    latestSnapshotAt?: string;
    latestSnapshotNodes?: number;
    latestSnapshotScripts?: number;
    lastIp?: string;
    lastCountry?: string;
    lastUserAgent?: string;
    lastEvidenceAt?: string;
    lastSeenAt?: string;
    stripeCustomerId?: string;
    stripeSubscriptionId?: string;
    stripeSubscriptionStatus?: string;
    stripePriceId?: string;
    billingCurrentPeriodEnd?: string;
  };
  counts: {
    total: number;
    usage: number;
    billing: number;
    attachments: number;
    generatedIcons: number;
  };
  events: CustomerEvidenceEvent[];
}

export interface BillingStatus {
  plan: PlanName;
  stripeConfigured: boolean;
  hasCustomer: boolean;
  hasSubscription: boolean;
  subscriptionStatus: string;
  currentPeriodEnd?: string;
  billingCycle?: BillingCycle;
  stripePriceId?: string;
  canManageBilling: boolean;
  canCancel: boolean;
  cancelAtPeriodEnd: boolean;
}

export interface AdminPaymentOverview {
  generatedAt: string;
  configured: boolean;
  account?: {
    id: string;
    country?: string;
    defaultCurrency?: string;
    chargesEnabled: boolean;
    payoutsEnabled: boolean;
    detailsSubmitted: boolean;
  } | null;
  sale?: {
    percentOff: number;
    appliesTo: string;
    annualAlsoIncludes: string;
  };
  checkout?: {
    planMode: "subscription";
    monthlyMode: "subscription";
    annualMode: "subscription";
    topUpMode: "payment";
    dynamicPaymentMethods: boolean;
    paymentMethodCollection: string;
    paymentMethodConfigurationId: string | null;
    checkoutUsesConfiguredPriceIds?: boolean;
    missingConfiguredPriceIds?: string[];
    inlinePriceFallbackActive?: boolean;
    checkoutCurrency?: string;
  };
  security: {
    secretConfigured: boolean;
    webhookSecretConfigured: boolean;
    secretExposedToClient: boolean;
    webhookSignatureRequired: boolean;
    checkoutCreatedServerSide: boolean;
    secretStorage: string;
    keyKind: string;
  };
  prices?: Array<{
    key: string;
    label: string;
    plan?: PlanName;
    cycle: BillingCycle | "one_time";
    expectedCheckoutMode: "subscription" | "payment";
    priceId: string;
    configured: boolean;
    active?: boolean;
    livemode?: boolean;
    currency?: string;
    unitAmount?: number;
    baseAmountCents: number;
    saleAmountCents: number;
    type?: string;
    recurringInterval?: string;
    lookupKey?: string;
    productId?: string;
    productName?: string;
    matchesExpectedAmount?: boolean;
    monthlyIsSubscription?: boolean;
    salePercent?: number;
  }>;
  webhooks?: Array<{
    id: string;
    url: string;
    status: string;
    apiVersion?: string | null;
    enabledEvents: string[];
    livemode: boolean;
    createdAt?: string;
  }>;
  paymentMethodConfigurations?: Array<{
    id: string;
    name: string;
    active: boolean;
    isDefault: boolean;
    livemode: boolean;
    application: string | null;
    parent: string | null;
    usedByCheckout: boolean;
    counts: {
      active: number;
      requested: number;
      off: number;
      total: number;
    };
    methods: Array<{
      method: string;
      available: boolean;
      preference: string;
      value: string;
      status: "active" | "requested" | "off";
    }>;
  }>;
  subscriptions?: {
    total: number;
    statusCounts: Record<string, number>;
    estimatedMrrCents: number;
    estimatedArrCents: number;
    rows: Array<{
      id: string;
      customerId: string;
      status: string;
      cancelAtPeriodEnd: boolean;
      priceId?: string;
      billingCycle?: BillingCycle;
      amount?: number;
      currency?: string;
      interval?: string;
      currentPeriodEnd?: string;
      createdAt?: string;
      metadataPlan?: string;
    }>;
  };
  webhookProcessing?: {
    processedEventCount: number;
    duplicateIgnoredCount: number;
    latestDuplicateIgnoredEvent: {
      id: string;
      stripeEventId?: string;
      stripeSessionId?: string;
      eventType: string;
      action: string;
      status: string;
      duplicateIgnoredAt?: string;
    } | null;
  };
  economics?: {
    fullUsageMargins: Array<{
      plan: PlanName;
      billingCycle: BillingCycle;
      monthlyRevenueUsd: number;
      creditValueUsd: number;
      targetMargin: number;
      estimatedStripeFeeUsd: number;
      estimatedProviderCostUsd: number;
      estimatedFullUsageMargin: number;
    }>;
    topUps: {
      fixedPricePerThousandUsd: number;
      studioCustomPricePerThousandUsd: number;
      studioCustomDiscountedForStudio: boolean;
    };
  };
  checkoutSessions?: Array<{
    id: string;
    mode: string;
    status?: string | null;
    paymentStatus: string;
    customerId?: string;
    subscriptionId?: string;
    amountTotal?: number | null;
    currency?: string | null;
    createdAt?: string;
    plan?: string;
    billingCycle?: string;
  }>;
  customers?: {
    sampled: number;
    rows: Array<{
      id: string;
      email?: string | null;
      name?: string | null;
      createdAt?: string;
      delinquent: boolean;
    }>;
  };
  localWorkspaces: Array<Pick<AdminUser, "id" | "name" | "email" | "plan" | "credits" | "projects" | "organizationId" | "stripeCustomerId" | "stripeSubscriptionId" | "stripeSubscriptionStatus" | "stripePriceId" | "billingCycle" | "billingCurrentPeriodEnd">>;
  localWorkspacesTotal: number;
  localWorkspacesTruncated: boolean;
  errors: string[];
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

export interface Diagnostics {
  ok: boolean;
  product: string;
  service: string;
  webAppUrl: string;
  apiBaseUrl: string;
  uptimeSeconds: number;
  auth: {
    firebaseConfigured: boolean;
    googleOAuthConfigured: boolean;
    robloxOAuthConfigured: boolean;
    privateOwnerLoginEnabled: boolean;
  };
  billing: {
    stripeConfigured: boolean;
    proPriceConfigured: boolean;
    webhookConfigured: boolean;
  };
  ai: {
    configured: boolean;
    provider: "google-vertex" | "yunwu" | "xiaomi" | "deepseek" | "local-fallback";
    project: string;
    location: string;
    defaultModel: string;
    imageGenerationModel?: string;
    generatedIconCostCredits?: number;
    generatedIconOutputSize?: string;
    estimatedGeneratedIconProviderCostUsd?: number;
    models: AuthConfig["models"];
  };
  roblox: {
    openCloudApiKeyConfigured: boolean;
  };
  storage: {
    mode: string;
    users: number;
    projects: number;
    studioSessions: number;
    snapshots: number;
    changeSets: number;
  };
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
  thinkingLevel?: string;
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
  promptId: string;
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

export interface EvaluationScenario {
  id: string;
  name: string;
  promptText: string;
  estimatedCostCredits: number;
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
