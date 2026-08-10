import { z } from "zod";
import { aiModelIds } from "./services/config.js";

const aiModelSchema = z.enum(aiModelIds);

export const studioPairSchema = z.object({
  pluginVersion: z.string().min(1).max(80).default("dev"),
  placeId: z.string().max(80).optional(),
  placeName: z.string().max(160).optional()
});

export const claimPairSchema = z.object({
  pairingCode: z.string()
    .min(4)
    .max(32)
    .transform((value) => value.replace(/[^a-z0-9]/gi, "").toUpperCase())
    .refine((value) => value.length === 12, {
      message: "Pairing code must be 12 characters"
    })
});

export const snapshotSchema = z.object({
  sessionId: z.string().min(1).max(80),
  connectorToken: z.string().min(1).max(128).optional(),
  mode: z.enum(["full", "delta"]).default("full"),
  chunk: z.object({
    id: z.string().min(1).max(80).regex(/^[A-Za-z0-9_-]+$/),
    index: z.number().int().min(1).max(100),
    total: z.number().int().min(1).max(100),
    totalNodeCount: z.number().int().min(0).max(10_000).optional()
  }).optional(),
  nodes: z
    .array(
      z.object({
        path: z.string().min(1).max(500),
        className: z.string().min(1).max(80),
        source: z.string().max(120_000).optional(),
        properties: z.record(z.string().max(80), z.unknown())
          .refine((value) => Object.keys(value).length <= 40, {
            message: "Snapshot node properties are limited to 40 entries"
          })
          .optional(),
        deleted: z.boolean().optional()
      })
    )
    .max(1_500)
    .default([])
});

export const createProjectSchema = z.object({
  name: z.string().min(2).max(80),
  description: z.string().max(500).default(""),
  template: z.enum([
    "obby",
    "simulator",
    "tycoon",
    "fighting_arena",
    "horror",
    "roleplay",
    "inventory_shop"
  ])
});

export const chatSchema = z.object({
  threadId: z.string().min(1),
  clientRequestId: z.string().min(8).max(80).regex(/^[A-Za-z0-9_-]+$/).optional(),
  prompt: z.string().min(3).max(12000),
  attachmentIds: z.array(z.string().min(1).max(80)).max(8).default([]),
  mode: z.enum(["explain", "changeset"]).default("explain"),
  model: aiModelSchema.optional(),
  planMode: z.boolean().default(false),
  usageOptimizer: z.boolean().default(false),
  luauGuard: z.boolean().default(false),
  verificationMode: z.enum(["off", "standard", "deep"]).optional(),
  optimizationMode: z.enum(["disabled", "balanced", "cost_saver"]).optional(),
  intent: z.enum(["general", "console_fix"]).optional(),
  modelMode: z.enum(["fast", "balanced", "best", "deep_verify"]).optional()
});

export const editMessageSchema = z.object({
  threadId: z.string().min(1),
  clientRequestId: z.string().min(8).max(80).regex(/^[A-Za-z0-9_-]+$/).optional(),
  prompt: z.string().min(3).max(12000),
  attachmentIds: z.array(z.string().min(1).max(80)).max(8).default([]),
  mode: z.enum(["explain", "changeset"]).default("explain"),
  model: aiModelSchema.optional(),
  planMode: z.boolean().default(false),
  usageOptimizer: z.boolean().default(false),
  luauGuard: z.boolean().default(false),
  verificationMode: z.enum(["off", "standard", "deep"]).optional(),
  optimizationMode: z.enum(["disabled", "balanced", "cost_saver"]).optional(),
  intent: z.enum(["general", "console_fix"]).optional(),
  modelMode: z.enum(["fast", "balanced", "best", "deep_verify"]).optional()
});

export const applyResultSchema = z.object({
  sessionId: z.string().min(1).max(80),
  connectorToken: z.string().min(1).max(128).optional(),
  status: z.enum(["applied", "failed"]),
  details: z.string().max(2000).default(""),
  verificationSummary: z.object({
    passed: z.number().int().min(0),
    warnings: z.number().int().min(0),
    failed: z.number().int().min(0),
    skipped: z.number().int().min(0),
    failureReasons: z.array(z.string().max(500)).max(50)
  }).optional()
});

export const approveChangeSetSchema = z.object({
  ignoreSnapshotConflict: z.boolean().default(false)
}).strict();

export const undoResultSchema = z.object({
  sessionId: z.string().min(1).max(80),
  connectorToken: z.string().min(1).max(128).optional(),
  status: z.enum(["undone", "failed"]),
  details: z.string().max(2000).default("")
});

export const studioLogSchema = z.object({
  sessionId: z.string().min(1).max(80),
  connectorToken: z.string().min(1).max(128).optional(),
  taskRunId: z.string().min(1).max(100).optional(),
  level: z.enum(["info", "warn", "error"]).default("info"),
  message: z.string().min(1).max(2000)
});

export const studioObservationSchema = z.object({
  sessionId: z.string().min(1).max(80),
  connectorToken: z.string().min(1).max(128).optional(),
  kind: z.enum([
    "apply_result",
    "rollback_result",
    "runtime_log",
    "snapshot",
    "screenshot",
    "playtest_result",
    "validation_probe"
  ]),
  status: z.enum(["info", "passed", "warning", "failed"]).default("info"),
  summary: z.string().min(1).max(2000),
  details: z.record(z.string().max(80), z.unknown()).optional()
});

export const studioCommandResultSchema = z.object({
  sessionId: z.string().min(1).max(80),
  connectorToken: z.string().min(1).max(128).optional(),
  commandId: z.string().min(1).max(80),
  status: z.enum(["ok", "error"]).default("ok"),
  result: z.record(z.string().max(80), z.unknown()).default({}),
  error: z.string().max(2000).optional()
});

export const studioCommandSchema = z.object({
  id: z.string().min(1).max(80),
  type: z.enum(["read_output", "set_breakpoint", "clear_breakpoints", "script_read", "script_search", "script_grep", "query_tree", "inspect_instance", "insert_asset", "start_play", "stop_play"]),
  arguments: z.record(z.string().max(80), z.unknown()).default({})
});

export const studioTaskStatusSchema = z.object({
  sessionId: z.string().min(1).max(80),
  connectorToken: z.string().min(1).max(128).optional(),
  status: z.enum(["queued", "applying", "validating", "repairing", "passed", "passed_with_warnings", "failed", "cancelled", "rolled_back"])
});

export const clientErrorSchema = z.object({
  kind: z.enum(["runtime_error", "unhandled_rejection", "console_error", "api_error", "api_unreachable", "render_error"]).default("runtime_error"),
  message: z.string().min(1).max(2000),
  name: z.string().max(120).optional(),
  stack: z.string().max(8000).optional(),
  source: z.string().max(1000).optional(),
  line: z.number().int().min(0).max(1_000_000).optional(),
  column: z.number().int().min(0).max(1_000_000).optional(),
  route: z.string().max(500).optional(),
  componentStack: z.string().max(8000).optional(),
  apiPath: z.string().max(500).optional(),
  statusCode: z.number().int().min(0).max(599).optional(),
  metadata: z.record(z.string().max(80), z.unknown()).optional()
}).strict();

export const adminCreditsSchema = z.object({
  delta: z.number().int().min(-100_000).max(100_000),
  reason: z.string().min(3).max(240)
});

export const adminUsageAdjustmentSchema = z.object({
  deltaPercent: z.number().int().min(-100).max(100),
  reason: z.string().min(3).max(240)
});

export const adminStatusSchema = z.object({
  status: z.enum(["active", "banned"])
});

export const adminPlanSchema = z.object({
  plan: z.enum(["free", "starter", "pro", "studio"])
});

export const checkoutSchema = z.object({
  plan: z.enum(["starter", "pro", "studio"]),
  billingCycle: z.enum(["monthly", "annual"]).default("annual"),
  immediateAccessRequested: z.literal(true),
  withdrawalAcknowledged: z.literal(true)
});

export const topUpSchema = z.union([
  z.object({
    pack: z.enum(["small", "large"]),
    immediateAccessRequested: z.literal(true),
    withdrawalAcknowledged: z.literal(true)
  }),
  z.object({
    usagePercent: z.number().int().min(10).max(100).refine((value) => value % 10 === 0, {
      message: "Usage percentage must use 10% steps"
    }),
    immediateAccessRequested: z.literal(true),
    withdrawalAcknowledged: z.literal(true)
  }),
  z.object({
    credits: z.number().int().min(1000).max(100000).refine((value) => value % 1000 === 0, {
      message: "Credits must be in increments of 1000"
    }),
    immediateAccessRequested: z.literal(true),
    withdrawalAcknowledged: z.literal(true)
  })
]);

export const createThreadSchema = z.object({
  name: z.string().min(1).max(100).optional()
});

export const updateThreadSchema = z.object({
  name: z.string().min(1).max(100)
});

export const deleteThreadsSchema = z.object({
  threadIds: z.array(z.string().min(1).max(100)).min(1).max(50)
});

export const generatedIconSchema = z.object({
  prompt: z.string().min(3).max(600),
  threadId: z.string().min(1).max(100).optional()
});

export const updateProjectSchema = z.object({
  name: z.string().min(1).max(80).optional(),
  description: z.string().max(500).optional()
});

export const userPreferencesSchema = z.object({
  theme: z.enum(["light", "dark"]).optional(),
  usageOptimizer: z.boolean().optional(),
  optimizationMode: z.enum(["disabled", "balanced", "cost_saver"]).optional(),
  luauGuard: z.boolean().optional(),
  verificationMode: z.enum(["off", "standard", "deep"]).optional(),
  fileReferences: z.boolean().optional(),
  thinkingGemini35Flash: z.enum(["none", "low", "medium", "high"]).optional(),
  thinkingGemini3Flash: z.enum(["none", "low", "medium", "high"]).optional(),
  thinkingGemini31Pro: z.enum(["low", "medium", "high"]).optional(),
  thinkingGemini31FlashLite: z.enum(["none", "low", "medium", "high"]).optional(),
  thinkingDeepSeekV4Flash: z.enum(["none", "high", "max"]).optional(),
  thinkingDeepSeekV4Pro: z.enum(["none", "high", "max"]).optional(),
  thinkingGlm51: z.enum(["none", "high"]).optional(),
  thinkingGlm52: z.enum(["none", "low", "medium", "high", "xhigh", "max"]).optional(),
  thinkingGpt55: z.enum(["none", "low", "medium", "high", "xhigh"]).optional(),
  thinkingQwen: z.enum(["none", "high"]).optional(),
  thinkingOpus: z.enum(["none", "low", "medium", "high", "xhigh", "max"]).optional(),
  thinkingMiMoPro: z.enum(["none", "high"]).optional(),
  thinkingKimi: z.enum(["none", "high"]).optional(),
  contextCachingEnabled: z.boolean().optional(),
  semanticChecksEnabled: z.boolean().optional(),
  robloxCartoonyUi: z.boolean().optional(),
  robloxUiGeneration: z.enum(["structural", "programmatic"]).optional(),
  robloxUiFont: z.enum(["FredokaOne", "LuckiestGuy", "ComicNeue", "GothamBold"]).optional(),
  robloxUiOutlineThickness: z.enum(["thin", "medium", "thick"]).optional(),
  robloxUiCornerRadius: z.number().int().min(0).max(40).optional(),
  robloxUiThemeColor: z.enum(["colorful", "pastel", "neon", "studio"]).optional()
}).strict();

export const firebaseLoginSchema = z.object({
  idToken: z.string().min(20)
});

export const marketplaceSearchSchema = z.object({
  query: z.string().min(2).max(80),
  assetType: z.enum(["model", "image", "mesh", "audio", "plugin", "video", "font"]).default("model"),
  limit: z.coerce.number().int().min(1).max(12).default(6)
});

export const runEvaluationSchema = z.object({
  promptId: z.enum(["leaderstats", "sprint", "shop", "custom", "all"]),
  customPromptText: z.string().max(2000).optional(),
  models: z.array(aiModelSchema).min(1).max(6).default(["gemini-3.5-flash", "gemini-3.1-pro-preview"]),
  judgeEnabled: z.boolean().default(true)
});

export const emailSubscribeSchema = z.object({
  email: z.string().email().max(320)
});

export const editTaskPlanSchema = z.object({
  goal: z.string().min(3).max(1000).optional(),
  assumptions: z.array(z.string().max(500)).max(30).optional(),
  targetInstances: z.array(z.string().max(500)).max(50).optional(),
  steps: z.array(
    z.object({
      id: z.string().min(1).max(80),
      description: z.string().min(1).max(500),
      targetFile: z.string().max(500).optional(),
      completedAt: z.string().optional()
    })
  ).max(50).optional(),
  acceptanceCriteria: z.array(z.string().max(500)).max(30).optional(),
  risks: z.array(z.string().max(500)).max(30).optional(),
  estimatedComplexity: z.enum(["low", "medium", "high"]).optional()
}).strict();

export const approveTaskPlanSchema = z.object({
  model: aiModelSchema.optional(),
  usageOptimizer: z.boolean().optional(),
  luauGuard: z.boolean().optional(),
  verificationMode: z.enum(["off", "standard", "deep"]).optional()
}).strict();

export const createCommentSchema = z.object({
  commentText: z.string().min(1).max(1000),
  filePath: z.string().max(500).optional()
}).strict();
