import dotenv from "dotenv";
import { existsSync, writeFileSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import type { UserPreferences } from "../types.js";
import {
  CREDIT_VALUE_USD,
  CREDIT_VALUE_USD_RETAIL,
  MODEL_CREDIT_MARGIN_MULTIPLIER,
  monthlyPlanAmountCents
} from "./pricing.js";

const candidateEnvFiles = [
  path.resolve(process.cwd(), ".env"),
  path.resolve(process.cwd(), "..", "..", ".env")
];

if (process.env.NODE_ENV !== "test") {
  const envFile = candidateEnvFiles.find((file) => existsSync(file));
  if (envFile) dotenv.config({ path: envFile, quiet: true });
}

// Support raw JSON Google credentials in environment variables by writing them to a temp file.
const rawCreds = process.env.GOOGLE_APPLICATION_CREDENTIALS || process.env.GOOGLE_SERVICE_ACCOUNT_JSON || process.env.GOOGLE_CREDENTIALS || process.env.GOOGLE_CREDS || process.env.GCP_CREDENTIALS || process.env.VERTEX_CREDENTIALS || process.env.GCP_SERVICE_ACCOUNT;
if (rawCreds && rawCreds.trim().startsWith("{")) {
  try {
    const tempDir = os.tmpdir();
    const tempFilePath = path.join(tempDir, "google_vertex_credentials.json");
    const trimmedCreds = rawCreds.trim();
    writeFileSync(tempFilePath, trimmedCreds, "utf8");
    process.env.GOOGLE_APPLICATION_CREDENTIALS = tempFilePath;

    // Auto-extract project_id if GOOGLE_CLOUD_PROJECT is not explicitly configured
    const parsed = JSON.parse(trimmedCreds);
    if (parsed.project_id && !process.env.GOOGLE_CLOUD_PROJECT) {
      process.env.GOOGLE_CLOUD_PROJECT = parsed.project_id;
    }
  } catch (error) {
    console.error("Failed to write Google Vertex raw credentials to temp file", error);
  }
}

export const isProduction = process.env.NODE_ENV === "production";
const webAppUrl = process.env.WEB_APP_URL ?? "https://vectiscode.com";
const apiBaseUrl = process.env.API_BASE_URL ?? "https://api.vectiscode.com";
const freeTierMode = process.env.FREE_TIER_MODE
  ? process.env.FREE_TIER_MODE === "true"
  : true;

function positiveIntegerEnv(name: string, fallback: number) {
  const parsed = Number(process.env[name]);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.floor(parsed);
}

function stringEnv(name: string, fallback: string) {
  const value = process.env[name]?.trim();
  return value || fallback;
}

function firstNonEmptyEnv(...values: Array<string | undefined>) {
  return values.map(value => value?.trim()).find(Boolean) ?? "";
}

function booleanEnv(name: string, fallback: boolean) {
  const value = process.env[name]?.trim().toLowerCase();
  if (value === "true" || value === "1" || value === "yes") return true;
  if (value === "false" || value === "0" || value === "no") return false;
  return fallback;
}

function inferredCookieDomain() {
  if (process.env.COOKIE_DOMAIN?.trim()) return process.env.COOKIE_DOMAIN.trim();
  if (!isProduction) return undefined;
  try {
    const webHost = new URL(webAppUrl).hostname.toLowerCase().replace(/^www\./, "");
    const apiHost = new URL(apiBaseUrl).hostname.toLowerCase();
    if (webHost && apiHost !== webHost && apiHost.endsWith(`.${webHost}`)) {
      return `.${webHost}`;
    }
  } catch {
    return undefined;
  }
  return undefined;
}

export const config = {
  nodeEnv: process.env.NODE_ENV ?? "development",
  isProduction,
  freeTierMode,
  webAppUrl,
  apiBaseUrl,
  cookieSecure: process.env.COOKIE_SECURE
    ? process.env.COOKIE_SECURE === "true"
    : (webAppUrl.startsWith("https://") && process.env.NODE_ENV !== "test"),
  cookieDomain: inferredCookieDomain(),
  allowPrivateOwnerLogin: process.env.ALLOW_PRIVATE_OWNER_LOGIN
    ? process.env.ALLOW_PRIVATE_OWNER_LOGIN === "true"
    : process.env.NODE_ENV === "test",
  privateOwnerLoginSecret: process.env.PRIVATE_OWNER_LOGIN_SECRET ?? "",
  publicSignupsEnabled: process.env.PUBLIC_SIGNUPS_ENABLED
    ? process.env.PUBLIC_SIGNUPS_ENABLED === "true"
    : !isProduction,
  allowLocalFileStore: process.env.ALLOW_LOCAL_FILE_STORE
    ? process.env.ALLOW_LOCAL_FILE_STORE === "true"
    : !isProduction,
  durableRateLimits: booleanEnv("DURABLE_RATE_LIMITS", false),
  trustProxyHeaders: booleanEnv("TRUST_PROXY_HEADERS", false),
  features: {
    reviewReportEnabled: booleanEnv("REVIEW_REPORT_ENABLED", true),
    taskPlanFlowEnabled: booleanEnv("TASK_PLAN_FLOW_ENABLED", true),
    consoleFixerEnabled: booleanEnv("CONSOLE_FIXER_ENABLED", true),
    studioValidationProbesEnabled: booleanEnv("STUDIO_VALIDATION_PROBES_ENABLED", true),
    simplifiedModelModesEnabled: booleanEnv("SIMPLIFIED_MODEL_MODES_ENABLED", true),
    teamReviewEnabled: booleanEnv("TEAM_REVIEW_ENABLED", true),
    onboardingGuideEnabled: booleanEnv("ONBOARDING_GUIDE_ENABLED", true)
  },
  requestLimits: {
    jsonBodyLimit: stringEnv("JSON_BODY_LIMIT", freeTierMode ? "2mb" : "8mb"),
    globalPerMinute: positiveIntegerEnv("RATE_LIMIT_GLOBAL_PER_MINUTE", isProduction ? (freeTierMode ? 180 : 600) : 6_000),
    authPerMinute: positiveIntegerEnv("RATE_LIMIT_AUTH_PER_MINUTE", isProduction ? (freeTierMode ? 30 : 100) : 2_000),
    studioPerMinute: positiveIntegerEnv("RATE_LIMIT_STUDIO_PER_MINUTE", isProduction ? (freeTierMode ? 420 : 1_200) : 4_000),
    aiPerMinute: positiveIntegerEnv("RATE_LIMIT_AI_PER_MINUTE", isProduction ? (freeTierMode ? 8 : 20) : 1_000),
    clientErrorsPerMinute: positiveIntegerEnv("RATE_LIMIT_CLIENT_ERRORS_PER_MINUTE", isProduction ? (freeTierMode ? 20 : 60) : 1_000)
  },
  retention: {
    maxSnapshotsPerProject: positiveIntegerEnv("MAX_SNAPSHOTS_PER_PROJECT", freeTierMode ? 2 : 5),
    maxStudioLogAgeDays: positiveIntegerEnv("MAX_STUDIO_LOG_AGE_DAYS", freeTierMode ? 7 : 30),
    authSessionRetentionDays: positiveIntegerEnv("AUTH_SESSION_RETENTION_DAYS", 45),
    rateLimitRetentionHours: positiveIntegerEnv("RATE_LIMIT_RETENTION_HOURS", 24),
    maintenanceIntervalMinutes: positiveIntegerEnv("MAINTENANCE_INTERVAL_MINUTES", 360)
  },
  databaseUrl: process.env.DATABASE_URL ?? "",
  databaseMode: process.env.DATABASE_MODE ?? 
    (process.env.SUPABASE_URL ? "supabase" : "local"),
  useSupabase: (process.env.DATABASE_MODE ?? "") === "supabase" || 
    (!(process.env.DATABASE_MODE) && Boolean(process.env.SUPABASE_URL)),
  applyDatabaseSchemaOnStartup: process.env.APPLY_DATABASE_SCHEMA_ON_STARTUP
    ? process.env.APPLY_DATABASE_SCHEMA_ON_STARTUP === "true"
    : true,
  supabase: {
    url: process.env.SUPABASE_URL ?? "",
    serviceKey: process.env.SUPABASE_SERVICE_ROLE_KEY ?? "",
    anonKey: process.env.SUPABASE_ANON_KEY ?? "",
    storageBucket: process.env.SUPABASE_STORAGE_BUCKET ?? "vectis-attachments"
  },
  defaultAiModel: process.env.AI_DEFAULT_MODEL ?? "gemini-3.5-flash",
  stripe: {
    secretKey: process.env.STRIPE_SECRET_KEY ?? "",
    webhookSecret: process.env.STRIPE_WEBHOOK_SECRET ?? "",
    starterPriceId: process.env.STRIPE_STARTER_PRICE_ID ?? "",
    starterAnnualPriceId: process.env.STRIPE_STARTER_ANNUAL_PRICE_ID ?? "",
    starterAmountCents: Number(process.env.STRIPE_STARTER_AMOUNT_CENTS ?? monthlyPlanAmountCents.starter),
    proPriceId: process.env.STRIPE_PRO_PRICE_ID ?? "",
    proAnnualPriceId: process.env.STRIPE_PRO_ANNUAL_PRICE_ID ?? "",
    proAmountCents: Number(process.env.STRIPE_PRO_AMOUNT_CENTS ?? monthlyPlanAmountCents.pro),
    studioPriceId: process.env.STRIPE_STUDIO_PRICE_ID ?? "",
    studioAnnualPriceId: process.env.STRIPE_STUDIO_ANNUAL_PRICE_ID ?? "",
    studioAmountCents: Number(process.env.STRIPE_STUDIO_AMOUNT_CENTS ?? monthlyPlanAmountCents.studio),
    topUpSmallPriceId: process.env.STRIPE_TOP_UP_SMALL_PRICE_ID ?? "",
    topUpLargePriceId: process.env.STRIPE_TOP_UP_LARGE_PRICE_ID ?? "",
    topUpSmallAmountCents: Number(process.env.STRIPE_TOP_UP_SMALL_AMOUNT_CENTS ?? 200),
    topUpLargeAmountCents: Number(process.env.STRIPE_TOP_UP_LARGE_AMOUNT_CENTS ?? 700),
    proCurrency: process.env.STRIPE_PRO_CURRENCY ?? "usd",
    paymentMethodConfigurationId: process.env.STRIPE_PAYMENT_METHOD_CONFIGURATION_ID ?? "",
    successUrl: process.env.STRIPE_SUCCESS_URL ?? `${webAppUrl}/profile?billing=success`,
    cancelUrl: process.env.STRIPE_CANCEL_URL ?? `${webAppUrl}/profile?billing=cancelled`,
    portalReturnUrl: process.env.STRIPE_PORTAL_RETURN_URL ?? `${webAppUrl}/profile`
  },
  adminEmails: (process.env.ADMIN_EMAILS ?? "")
    .split(",")
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean),
  roblox: {
    clientId: process.env.ROBLOX_OAUTH_CLIENT_ID ?? "",
    clientSecret: process.env.ROBLOX_OAUTH_CLIENT_SECRET ?? "",
    redirectUri:
      process.env.ROBLOX_OAUTH_REDIRECT_URI ?? "https://api.vectiscode.com/auth/roblox/callback"
  },
  firebase: {
    projectId: process.env.FIREBASE_PROJECT_ID ?? "",
    apiKey: process.env.FIREBASE_API_KEY ?? "",
    authDomain: process.env.FIREBASE_AUTH_DOMAIN ?? "",
    appId: process.env.FIREBASE_APP_ID ?? "",
    storageBucket: process.env.FIREBASE_STORAGE_BUCKET ?? "",
    messagingSenderId: process.env.FIREBASE_MESSAGING_SENDER_ID ?? ""
  },
  robloxOpenCloud: {
    apiKey: process.env.ROBLOX_OPEN_CLOUD_API_KEY ?? ""
  },
  deepseek: {
    apiKey: firstNonEmptyEnv(process.env.DEEPSEEK_API_KEY, process.env.DEEPSEEK_API_KEYS),
    baseUrl: process.env.DEEPSEEK_BASE_URL ?? "https://api.deepseek.com"
  },
  moonshot: {
    apiKey: firstNonEmptyEnv(process.env.MOONSHOT_API_KEY, process.env.KIMI_API_KEY),
    baseUrl: process.env.MOONSHOT_BASE_URL ?? "https://api.moonshot.ai/v1"
  },
  zai: {
    apiKey: firstNonEmptyEnv(process.env.ZAI_API_KEY, process.env.ZHIPU_API_KEY, process.env.GLM_API_KEY),
    baseUrl: process.env.ZAI_BASE_URL ?? "https://api.z.ai/api/paas/v4"
  },
  xiaomi: {
    apiKey: process.env.XIAOMI_API_KEY ?? ""
  },
  googleVertex: {
    projectId: process.env.GOOGLE_CLOUD_PROJECT ?? "",
    location: process.env.GOOGLE_CLOUD_LOCATION ?? "global"
  },
  yunwu: {
    apiKey: firstNonEmptyEnv(process.env.YUNWU_API_KEY, process.env.YUNWU_API_KEYS),
    baseUrl: process.env.YUNWU_BASE_URL ?? "https://yunwu.ai/v1",
    prefer: process.env.YUNWU_PREFER !== "false"
  },
  discord: {
    botToken: process.env.DISCORD_BOT_TOKEN ?? "",
    appId: process.env.DISCORD_APP_ID ?? "",
    guildId: process.env.DISCORD_GUILD_ID ?? "",
    announcementsChannelId: process.env.DISCORD_ANNOUNCEMENTS_CHANNEL_ID ?? "",
    suggestionsChannelId: process.env.DISCORD_SUGGESTIONS_CHANNEL_ID ?? "",
    changelogChannelId: process.env.DISCORD_CHANGELOG_CHANNEL_ID ?? "",
    statusChannelId: process.env.DISCORD_STATUS_CHANNEL_ID ?? ""
  },
  aiTimeouts: {
    chatAnswerMs: positiveIntegerEnv("CHAT_ANSWER_TIMEOUT_MS", 600_000),
    chatChangeSetMs: positiveIntegerEnv("CHAT_CHANGESET_TIMEOUT_MS", 600_000)
  }
};

export const aiModelIds = [
  "gemini-3-flash-preview",
  "deepseek-v4-flash",
  "kimi-k2.7-code",
  "gemini-3.5-flash",
  "gemini-3.1-pro-preview",
  "qwen3.7-max",
  "gpt-5.5",
  "claude-opus-4-8",
  "glm-5.2",
  "gemini-3.5-flash-yunwu",
  "gemini-3.5-flash-google",
  "gemini-3.1-pro-preview-yunwu",
  "gemini-3.1-pro-preview-google"
] as const;

export type AiModelId = typeof aiModelIds[number];
export type BillableAiModelId = AiModelId | "gemini-3-flash";
export type AiCostMode = "chat" | "changeset";
export type ThinkingControlMode = "none" | "binary" | "tiered" | "always";

export const yunwuAiModelIds = [
  "gemini-3-flash-preview",
  "gemini-3.1-pro-preview",
  "gemini-3.5-flash",
  "deepseek-v4-flash",
  "claude-opus-4-8",
  "kimi-k2.7-code",
  "qwen3.7-max",
  "gpt-5.5",
  "glm-5.2"
] as const;

const yunwuOnlyAiModelIds = [
  "qwen3.7-max",
  "gpt-5.5"
] as const;

const googleVertexGeminiModelIds = [
  "gemini-3-flash-preview",
  "gemini-3.5-flash",
  "gemini-3.1-pro-preview"
] as const;

const evalOnlyGeminiModelIds = [
  "gemini-3.5-flash-yunwu",
  "gemini-3.5-flash-google",
  "gemini-3.1-pro-preview-yunwu",
  "gemini-3.1-pro-preview-google"
] as const;

export function resolvedProviderOverride(modelId?: string): "google-vertex" | "yunwu" | null {
  if (modelId?.endsWith("-google")) return "google-vertex";
  if (modelId?.endsWith("-yunwu")) return "yunwu";
  return null;
}

export function googleVertexModelName(modelId: string): string {
  const map: Record<string, string> = {
    "gemini-3-flash-preview": "gemini-3-flash-preview",
    "gemini-3.5-flash": "gemini-3.5-flash",
    "gemini-3.1-pro-preview": "gemini-3.1-pro-preview"
  };
  return map[modelId] || modelId;
}

const tieredThinkingModelIds = [
  "gemini-3.5-flash",
  "gemini-3-flash-preview",
  "gemini-3.1-pro-preview",
  "deepseek-v4-flash",
  "gpt-5.5",
  "claude-opus-4-8",
  "glm-5.2"
] as const;

export const aiModels = [
  {
    id: "gemini-3-flash-preview",
    label: "Gemini 3 Flash",
    tier: "entry",
    description: "",
    usageMultiplier: 2.3,
    speedScore: 8.1,
    intelligenceScore: 7.5,
    benchmarkIq: 46,
    tokensPerSecond: 154,
    inputUsdPerMillion: 0.5,
    outputUsdPerMillion: 3,
    bestFor: "Fast free-tier chat, lightweight project inspection, and simple Roblox guidance.",
    routingNote: "Free-tier fast model with visible credit limits.",
    status: "available"
  },
  {
    id: "deepseek-v4-flash",
    label: "DeepSeek V4 Flash",
    tier: "entry",
    description: "",
    usageMultiplier: 1.0,
    speedScore: 7.5,
    intelligenceScore: 6.7,
    benchmarkIq: 40,
    tokensPerSecond: 108,
    inputUsdPerMillion: 0.14,
    outputUsdPerMillion: 0.28,
    bestFor: "Low-cost DeepSeek coding and evaluation.",
    routingNote: "Routes through a secure provider relay and powers balanced routine optimization.",
    status: "available"
  },
  {
    id: "kimi-k2.7-code",
    label: "Kimi K2.7 Code",
    tier: "premium",
    description: "",
    usageMultiplier: 5.5,
    speedScore: 5.4,
    intelligenceScore: 7.0,
    benchmarkIq: 42,
    tokensPerSecond: 56,
    inputUsdPerMillion: 0.95,
    outputUsdPerMillion: 4.00,
    bestFor: "Frontier agentic coding and multi-turn Roblox engineering tasks with always-on thinking.",
    routingNote: "Routes through Moonshot Kimi API or an active provider relay.",
    status: "available"
  },
  {
    id: "gemini-3.5-flash",
    label: "Gemini 3.5 Flash",
    tier: "entry",
    description: "",
    usageMultiplier: 4.1,
    speedScore: 9.1,
    intelligenceScore: 8.0,
    benchmarkIq: 48,
    tokensPerSecond: 159,
    inputUsdPerMillion: 1.5,
    outputUsdPerMillion: 9,
    bestFor: "Free-visible high-quality coding, review, and project inspection with credit limits.",
    routingNote: "Uses Gemini 3.x provider-default sampling, tiered thinking, multimodal references, and reviewable UI preference profiles.",
    status: "available"
  },
  {
    id: "gemini-3.1-pro-preview",
    label: "Gemini 3.1 Pro",
    tier: "premium",
    description: "",
    usageMultiplier: 4.9,
    speedScore: 7.8,
    intelligenceScore: 7.0,
    benchmarkIq: 42,
    tokensPerSecond: 116,
    inputUsdPerMillion: 2,
    outputUsdPerMillion: 12,
    bestFor: "Hard multi-file Roblox systems and careful architecture.",
    routingNote: "Premium baseline for complex Studio patches.",
    status: "available"
  },
  {
    id: "qwen3.7-max",
    label: "Qwen3.7 Max",
    tier: "premium",
    description: "",
    usageMultiplier: 8.5,
    speedScore: 10.0,
    intelligenceScore: 7.7,
    benchmarkIq: 46,
    tokensPerSecond: 193,
    inputUsdPerMillion: 2.50,
    outputUsdPerMillion: 7.50,
    bestFor: "Fast high-intelligence agentic coding and complex Roblox patches through Yunwu.",
    routingNote: "Routes through a secure provider relay when configured.",
    status: "available"
  },
  {
    id: "gpt-5.5",
    label: "GPT-5.5",
    tier: "premium",
    description: "",
    usageMultiplier: 7.3,
    speedScore: 5.7,
    intelligenceScore: 9.5,
    benchmarkIq: 57,
    tokensPerSecond: 63,
    inputUsdPerMillion: 5.0,
    outputUsdPerMillion: 30.0,
    bestFor: "Frontier coding, hard debugging, and premium fallback reasoning.",
    routingNote: "Routes through a secure provider relay when configured.",
    status: "available"
  },
  {
    id: "claude-opus-4-8",
    label: "Claude Opus 4.8",
    tier: "premium",
    description: "",
    usageMultiplier: 16.0,
    speedScore: 5.5,
    intelligenceScore: 10.0,
    benchmarkIq: 60,
    tokensPerSecond: 58,
    inputUsdPerMillion: 5.0,
    outputUsdPerMillion: 25,
    bestFor: "Highest-depth coding review when latency is acceptable.",
    routingNote: "Routes through a secure provider relay when configured.",
    status: "available"
  },
  {
    id: "gemini-3.5-flash-yunwu",
    label: "Gemini 3.5 Flash (Yunwu)",
    tier: "entry",
    description: "",
    usageMultiplier: 4.1,
    speedScore: 9.1,
    intelligenceScore: 8.0,
    benchmarkIq: 48,
    tokensPerSecond: 159,
    inputUsdPerMillion: 1.5,
    outputUsdPerMillion: 9,
    bestFor: "Eval-only: routes Gemini 3.5 Flash through Yunwu relay for comparison.",
    routingNote: "Eval-only. Routes through Yunwu relay.",
    status: "available"
  },
  {
    id: "gemini-3.5-flash-google",
    label: "Gemini 3.5 Flash (Google)",
    tier: "entry",
    description: "",
    usageMultiplier: 4.1,
    speedScore: 9.1,
    intelligenceScore: 8.0,
    benchmarkIq: 48,
    tokensPerSecond: 159,
    inputUsdPerMillion: 1.5,
    outputUsdPerMillion: 9,
    bestFor: "Eval-only: routes Gemini 3.5 Flash directly through Google Vertex AI.",
    routingNote: "Eval-only. Routes through Google Vertex AI.",
    status: "available"
  },
  {
    id: "gemini-3.1-pro-preview-yunwu",
    label: "Gemini 3.1 Pro (Yunwu)",
    tier: "premium",
    description: "",
    usageMultiplier: 4.9,
    speedScore: 7.8,
    intelligenceScore: 7.0,
    benchmarkIq: 42,
    tokensPerSecond: 116,
    inputUsdPerMillion: 2,
    outputUsdPerMillion: 12,
    bestFor: "Eval-only: routes Gemini 3.1 Pro through Yunwu relay for comparison.",
    routingNote: "Eval-only. Routes through Yunwu relay.",
    status: "available"
  },
  {
    id: "gemini-3.1-pro-preview-google",
    label: "Gemini 3.1 Pro (Google)",
    tier: "premium",
    description: "",
    usageMultiplier: 4.9,
    speedScore: 7.8,
    intelligenceScore: 7.0,
    benchmarkIq: 42,
    tokensPerSecond: 116,
    inputUsdPerMillion: 2,
    outputUsdPerMillion: 12,
    bestFor: "Eval-only: routes Gemini 3.1 Pro directly through Google Vertex AI.",
    routingNote: "Eval-only. Routes through Google Vertex AI.",
    status: "available"
  },
  {
    id: "glm-5.2",
    label: "GLM 5.2",
    tier: "premium",
    description: "",
    usageMultiplier: 3.8,
    speedScore: 7.0,
    intelligenceScore: 9.0,
    benchmarkIq: 54,
    tokensPerSecond: 95,
    inputUsdPerMillion: 1.40,
    outputUsdPerMillion: 4.40,
    bestFor: "Advanced reasoning, long-context coding, and complex Roblox systems.",
    routingNote: "Routes through a secure provider relay when configured.",
    status: "available"
  }
] as const;

// ===== Pricing Events (global discounts, togglable per-model) =====
export interface PricingEvent {
  id: string;
  label: string;
  enabled: boolean;
  discountPercent: number;          // 0-100, e.g. 50 = 50% off
  modelIds: AiModelId[] | "all";    // which models the discount applies to
  badgeText?: string;               // e.g. "50% OFF" shown on model cards
  startsAt?: string;                // ISO date, optional scheduled start
  endsAt?: string;                  // ISO date, optional scheduled end
}

export const pricingEvents: PricingEvent[] = [
  {
    id: "google-summer-2026",
    label: "Google Summer Sale",
    enabled: true,
    discountPercent: 50,
    modelIds: [
      "gemini-3-flash-preview",
      "gemini-3.5-flash",
      "gemini-3.1-pro-preview"
    ],
    badgeText: "50% OFF"
  }
];

/** Returns the active discount multiplier (0-1 scale) for a given model. 1.0 = no discount. */
export function eventDiscountMultiplier(modelId: string | undefined): number {
  if (!modelId) return 1;
  if (process.env.NODE_ENV === "test") return 1;
  const now = new Date();
  let bestDiscount = 0;
  for (const event of pricingEvents) {
    if (!event.enabled) continue;
    if (event.startsAt && new Date(event.startsAt) > now) continue;
    if (event.endsAt && new Date(event.endsAt) < now) continue;
    const applies = event.modelIds === "all" || event.modelIds.includes(modelId as AiModelId);
    if (applies && event.discountPercent > bestDiscount) {
      bestDiscount = event.discountPercent;
    }
  }
  return 1 - (bestDiscount / 100);
}

/** Returns the active pricing events that apply to a given model (for frontend badges). */
export function activeEventsForModel(modelId: string | undefined): Array<{ id: string; label: string; discountPercent: number; badgeText?: string }> {
  if (!modelId) return [];
  if (process.env.NODE_ENV === "test") return [];
  const now = new Date();
  const results: Array<{ id: string; label: string; discountPercent: number; badgeText?: string }> = [];
  for (const event of pricingEvents) {
    if (!event.enabled) continue;
    if (event.startsAt && new Date(event.startsAt) > now) continue;
    if (event.endsAt && new Date(event.endsAt) < now) continue;
    const applies = event.modelIds === "all" || event.modelIds.includes(modelId as AiModelId);
    if (applies) {
      results.push({ id: event.id, label: event.label, discountPercent: event.discountPercent, badgeText: event.badgeText });
    }
  }
  return results;
}

/** Returns all currently-active pricing events (for passing to the frontend). */
export function activePricingEvents(): Array<{ id: string; label: string; discountPercent: number; badgeText?: string; modelIds: string[] | "all" }> {
  if (process.env.NODE_ENV === "test") return [];
  const now = new Date();
  const results: Array<{ id: string; label: string; discountPercent: number; badgeText?: string; modelIds: string[] | "all" }> = [];
  for (const event of pricingEvents) {
    if (!event.enabled) continue;
    if (event.startsAt && new Date(event.startsAt) > now) continue;
    if (event.endsAt && new Date(event.endsAt) < now) continue;
    results.push({ id: event.id, label: event.label, discountPercent: event.discountPercent, badgeText: event.badgeText, modelIds: event.modelIds === "all" ? "all" : [...event.modelIds] });
  }
  return results;
}

const defaultAiModelCandidates: AiModelId[] = [
  "gemini-3.5-flash",
  "qwen3.7-max",
  "deepseek-v4-flash",
  "kimi-k2.7-code",
  "gpt-5.5",
  "gemini-3.1-pro-preview"
];

function rawResolveAiModel(modelId?: string) {
  const id = (modelId ?? config.defaultAiModel).replace(/-(yunwu|google)$/, "");
  const map: Record<string, string> = {
    "gemini-3-flash": "gemini-3-flash-preview",
    "gemini-3-flash-preview": "gemini-3-flash-preview",
    "gemini-3.1-flash-lite": "gemini-3-flash-preview",
    "deepseek-v4-flash": "deepseek-v4-flash",
    "deepseek-v4-pro": "deepseek-v4-flash",
    "gemini-3.1-pro-preview": "gemini-3.1-pro-preview",
    "gemini-3.5-flash": "gemini-3.5-flash",
    "qwen3.7-max": "qwen3.7-max",
    "qwen-3.7-max": "qwen3.7-max",
    "gpt-5.5": "gpt-5.5",
    "gpt-5.5-high": "gpt-5.5",
    "claude-opus-4-7": "claude-opus-4-8",
    "claude-opus-4-8": "claude-opus-4-8",
    "kimi-k2.6": "kimi-k2.7-code",
    "kimi-k2.7": "kimi-k2.7-code",
    "kimi-k2.7-code": "kimi-k2.7-code",
    "glm-5.2": "glm-5.2"
  };
  return map[id] || id;
}

function rawModelSupportsYunwu(modelId?: string) {
  const resolved = rawResolveAiModel(modelId);
  if (resolved.startsWith("gemini-") && process.env.NODE_ENV !== "test") return false;
  const supports = yunwuAiModelIds.includes(resolved as typeof yunwuAiModelIds[number]);
  if (!supports) return false;
  return true;
}

function rawModelRequiresYunwu(modelId?: string) {
  const resolved = rawResolveAiModel(modelId);
  return yunwuOnlyAiModelIds.includes(resolved as typeof yunwuOnlyAiModelIds[number]);
}

function rawModelRequiresConfiguredProvider(modelId?: string) {
  const resolved = rawResolveAiModel(modelId);
  return aiModelIds.includes(resolved as typeof aiModelIds[number]);
}

export function configuredProviderForModel(modelId?: string) {
  const override = resolvedProviderOverride(modelId);
  const resolved = rawResolveAiModel(modelId);

  if (override === "google-vertex" && config.googleVertex.projectId) {
    return "Google Vertex";
  }
  if (override === "yunwu" && config.yunwu.apiKey) {
    return "Yunwu API";
  }

  if (config.googleVertex.projectId && googleVertexGeminiModelIds.includes(resolved as typeof googleVertexGeminiModelIds[number])) {
    return "Google Vertex";
  }
  if (config.yunwu.apiKey && config.yunwu.prefer && rawModelSupportsYunwu(resolved)) {
    return "Yunwu API";
  }
  if (resolved === "deepseek-v4-flash" && config.deepseek.apiKey) {
    return "DeepSeek API";
  }
  if (resolved === "kimi-k2.7-code" && config.moonshot.apiKey) {
    return "Moonshot API";
  }
  return "";
}

function rawModelProviderConfigured(modelId?: string) {
  const resolved = rawResolveAiModel(modelId);
  if (process.env.NODE_ENV === "test") {
    if (!aiConfigured()) return true;
    if (rawModelRequiresConfiguredProvider(resolved)) return Boolean(configuredProviderForModel(resolved));
    return true;
  }
  if (rawModelRequiresConfiguredProvider(resolved)) return Boolean(configuredProviderForModel(resolved));
  return true;
}

function rawModelIsAvailable(modelId?: string) {
  const resolved = rawResolveAiModel(modelId);
  const model = aiModels.find((entry) => entry.id === resolved);
  if (!model || model.status !== "available") return false;
  return rawModelProviderConfigured(resolved);
}

export function defaultAiModel() {
  const configured = rawResolveAiModel(config.defaultAiModel);
  if (rawModelIsAvailable(configured)) return configured;
  return defaultAiModelCandidates.find(rawModelIsAvailable) ?? "gemini-3.5-flash";
}

export function resolveAiModel(modelId?: string) {
  return rawResolveAiModel(modelId ?? defaultAiModel());
}

export function modelConfigFor(modelId?: string) {
  const resolved = resolveAiModel(modelId);
  return aiModels.find((model) => model.id === resolved);
}

export function modelSupportsYunwu(modelId?: string) {
  return rawModelSupportsYunwu(modelId);
}

export function modelRequiresYunwu(modelId?: string) {
  return rawModelRequiresYunwu(modelId);
}

export interface ModelCapabilities {
  text: true;
  imageInput: boolean;
  structuredOutput: boolean;
  preferredForVisualQa: boolean;
}

export function modelCapabilitiesFor(modelId?: string): ModelCapabilities {
  const resolved = resolveAiModel(modelId);
  const imageInput = resolved === "gemini-3.5-flash"
    || resolved === "gemini-3-flash-preview"
    || resolved === "gemini-3.1-pro-preview"
    || resolved === "gpt-5.5"
    || resolved === "claude-opus-4-8"
    || resolved === "qwen3.7-max"
    || resolved === "glm-5.2";
  return {
    text: true,
    imageInput,
    structuredOutput: true,
    preferredForVisualQa: imageInput && resolved === "gemini-3.5-flash"
  };
}

export function defaultVisualInspectionModel() {
  return ["gemini-3.5-flash", "gemini-3-flash-preview", "gemini-3.1-pro-preview"]
    .find((modelId) => modelIsAvailable(modelId) && modelCapabilitiesFor(modelId).imageInput);
}

export function runtimeAiModels() {
  return aiModels
    .filter((model) => model.id !== "gemini-3-flash-preview")
    .filter((model) => !model.id.endsWith("-yunwu") && !model.id.endsWith("-google"))
    .map((model) => {
    const provider = configuredProviderForModel(model.id);
    const needsProvider = rawModelRequiresConfiguredProvider(model.id);
    const billingRates = modelBillingRates(model.id);
    const discount = eventDiscountMultiplier(model.id);
    const events = activeEventsForModel(model.id);
    const baseModel = {
      ...model,
      usageMultiplier: Number((model.usageMultiplier * discount).toFixed(2)),
      inputUsdPerMillion: Number((billingRates.input * 1_000_000).toFixed(3)),
      outputUsdPerMillion: Number((billingRates.output * 1_000_000).toFixed(3)),
      thinkingControlMode: getThinkingControlMode(model.id),
      thinkingMultiplier: getThinkingMultiplier(model.id, "chat"),
      capabilities: modelCapabilitiesFor(model.id),
      ...(events.length > 0 ? { pricingEvent: events[0] } : {})
    };
    if (!needsProvider) return baseModel;
    const runtimeStatus = provider
      ? model.status
      : model.status === "available"
      ? "soon"
      : model.status;
    return {
      ...baseModel,
      status: runtimeStatus,
      routingNote: provider
        ? "Routes through a secure active provider relay."
        : rawModelRequiresYunwu(model.id)
        ? "Routes through a secure provider relay."
        : "Routes through active API provider."
    };
  });
}

export function modelIsAvailable(modelId?: string) {
  return rawModelIsAvailable(modelId ?? defaultAiModel());
}

export function modelIsPremium(modelId?: string) {
  return modelConfigFor(modelId)?.tier === "premium";
}

export function modelIsOptimizable(modelId?: string) {
  const model = modelConfigFor(modelId);
  return Boolean(
    model
      && modelIsAvailable(modelId)
      && model.status === "available"
      && model.tier === "premium"
      && (model.usageMultiplier ?? 1) > 1
  );
}

export function robloxOAuthConfigured() {
  return Boolean(config.roblox.clientId && config.roblox.clientSecret);
}

export function googleOAuthConfigured() {
  return false;
}

export function firebaseConfigured() {
  return Boolean(
    config.firebase.projectId &&
      config.firebase.apiKey &&
      config.firebase.authDomain &&
      config.firebase.appId
  );
}

export function supabaseConfigured() {
  return Boolean(config.supabase.url && config.supabase.anonKey);
}

export function aiConfigured() {
  if (config.yunwu.apiKey) return true;
  if (config.googleVertex.projectId) return true;
  if (config.deepseek.apiKey || config.moonshot.apiKey || config.zai.apiKey) return true;
  if (config.xiaomi.apiKey) return true;
  return false;
}

export function robloxApiKeyConfigured() {
  return Boolean(config.robloxOpenCloud.apiKey);
}

export function discordConfigured() {
  return Boolean(config.discord.botToken && config.discord.appId);
}

/**
 * Economic standard: the bridge between provider API costs and platform credits.
 * Usage charging keeps a conservative USD cost basis, while retail top-ups sell
 * 1,000 credits for $2.
 */
export { CREDIT_VALUE_USD, CREDIT_VALUE_USD_RETAIL, MODEL_CREDIT_MARGIN_MULTIPLIER };
export const GENERATED_ICON_COST_CREDITS = 90;
export const GENERATED_ICON_OUTPUT_SIZE = "1K";
export const ESTIMATED_GENERATED_ICON_PROVIDER_COST_USD = 0.067;

export const MODEL_COSTS: Record<BillableAiModelId, Record<AiCostMode, number>> = {
  "gemini-3-flash": { chat: 3, changeset: 32 },
  "gemini-3-flash-preview": { chat: 3, changeset: 32 },
  "deepseek-v4-flash": { chat: 1, changeset: 4 },
  "gemini-3.1-pro-preview": { chat: 30, changeset: 120 },
  "gemini-3.5-flash": { chat: 8, changeset: 24 },
  "qwen3.7-max": { chat: 18, changeset: 72 },
  "gpt-5.5": { chat: 18, changeset: 72 },
  "claude-opus-4-8": { chat: 40, changeset: 160 },
  "glm-5.2": { chat: 6, changeset: 24 },
  "kimi-k2.7-code": { chat: 10, changeset: 40 },
  "gemini-3.5-flash-yunwu": { chat: 20, changeset: 80 },
  "gemini-3.5-flash-google": { chat: 20, changeset: 80 },
  "gemini-3.1-pro-preview-yunwu": { chat: 30, changeset: 120 },
  "gemini-3.1-pro-preview-google": { chat: 30, changeset: 120 }
};

export const YUNWU_CNY_PER_CREDIT = 0.5;
export const YUNWU_CNY_PER_USD = 7.24;
export const YUNWU_USD_PER_CREDIT = YUNWU_CNY_PER_CREDIT / YUNWU_CNY_PER_USD;

function yunwuPerMillionCreditsToUsdPerToken(creditsPerMillion: number) {
  return (creditsPerMillion * YUNWU_USD_PER_CREDIT) / 1_000_000;
}

export const MODEL_RATES: Record<string, { input: number; output: number; cacheRead?: number }> = {
  "gemini-3-flash": { input: 0.00000014, output: 0.00000042 },
  "gemini-3-flash-preview": { input: 0.00000014, output: 0.00000042 },
  "deepseek-v4-flash": { input: 0.00000014, output: 0.00000028 },
  "gemini-3.1-pro-preview": { input: 0.000002, output: 0.000012 },
  "gemini-3.5-flash": { input: 0.0000015, output: 0.000009 },
  "qwen3.7-max": { input: 0.0000025, output: 0.0000075 },
  "gpt-5.5": { input: 0.000005, output: 0.00003 },
  "claude-opus-4-8": { input: 0.000005, output: 0.000025 },
  "glm-5.2": { input: 0.0000014, output: 0.0000044, cacheRead: 0.00000026 },
  "kimi-k2.7-code": { input: 0.00000095, output: 0.000004 },
  "gemini-3.5-flash-yunwu": { input: 0.0000015, output: 0.000009 },
  "gemini-3.5-flash-google": { input: 0.0000015, output: 0.000009 },
  "gemini-3.1-pro-preview-yunwu": { input: 0.000002, output: 0.000012 },
  "gemini-3.1-pro-preview-google": { input: 0.000002, output: 0.000012 }
};

export const YUNWU_MODEL_RATES: Record<string, { input: number; output: number; cacheRead?: number }> = {
  "gemini-3-flash-preview": {
    input: yunwuPerMillionCreditsToUsdPerToken(0.75),
    output: yunwuPerMillionCreditsToUsdPerToken(4.5),
    cacheRead: yunwuPerMillionCreditsToUsdPerToken(0.075)
  },
  "deepseek-v4-flash": {
    input: yunwuPerMillionCreditsToUsdPerToken(1),
    output: yunwuPerMillionCreditsToUsdPerToken(2),
    cacheRead: yunwuPerMillionCreditsToUsdPerToken(0.02)
  },
  "gemini-3.1-pro-preview": {
    input: yunwuPerMillionCreditsToUsdPerToken(3),
    output: yunwuPerMillionCreditsToUsdPerToken(18),
    cacheRead: yunwuPerMillionCreditsToUsdPerToken(0.3)
  },
  "gemini-3.5-flash": {
    input: yunwuPerMillionCreditsToUsdPerToken(2.25),
    output: yunwuPerMillionCreditsToUsdPerToken(13.5),
    cacheRead: yunwuPerMillionCreditsToUsdPerToken(0.225)
  },
  "qwen3.7-max": {
    input: yunwuPerMillionCreditsToUsdPerToken(6),
    output: yunwuPerMillionCreditsToUsdPerToken(18)
  },
  "gpt-5.5": {
    input: yunwuPerMillionCreditsToUsdPerToken(5),
    output: yunwuPerMillionCreditsToUsdPerToken(30),
    cacheRead: yunwuPerMillionCreditsToUsdPerToken(0.5)
  },
  "claude-opus-4-8": {
    input: yunwuPerMillionCreditsToUsdPerToken(12.5),
    output: yunwuPerMillionCreditsToUsdPerToken(62.5),
    cacheRead: yunwuPerMillionCreditsToUsdPerToken(0.5)
  },
  "kimi-k2.7-code": {
    input: yunwuPerMillionCreditsToUsdPerToken(6.5),
    output: yunwuPerMillionCreditsToUsdPerToken(27),
    cacheRead: yunwuPerMillionCreditsToUsdPerToken(1.3)
  },
  "gemini-3.5-flash-yunwu": {
    input: yunwuPerMillionCreditsToUsdPerToken(2.25),
    output: yunwuPerMillionCreditsToUsdPerToken(13.5),
    cacheRead: yunwuPerMillionCreditsToUsdPerToken(0.225)
  },
  "gemini-3.5-flash-google": {
    input: yunwuPerMillionCreditsToUsdPerToken(2.25),
    output: yunwuPerMillionCreditsToUsdPerToken(13.5),
    cacheRead: yunwuPerMillionCreditsToUsdPerToken(0.225)
  },
  "gemini-3.1-pro-preview-yunwu": {
    input: yunwuPerMillionCreditsToUsdPerToken(3),
    output: yunwuPerMillionCreditsToUsdPerToken(18),
    cacheRead: yunwuPerMillionCreditsToUsdPerToken(0.3)
  },
  "gemini-3.1-pro-preview-google": {
    input: yunwuPerMillionCreditsToUsdPerToken(3),
    output: yunwuPerMillionCreditsToUsdPerToken(18),
    cacheRead: yunwuPerMillionCreditsToUsdPerToken(0.3)
  },
  "glm-5.2": {
    input: yunwuPerMillionCreditsToUsdPerToken(8),
    output: yunwuPerMillionCreditsToUsdPerToken(28),
    cacheRead: yunwuPerMillionCreditsToUsdPerToken(2)
  }
};

export function modelBillingRates(modelId: string | undefined) {
  const resolved = resolveAiModel(modelId);
  return MODEL_RATES[resolved] || MODEL_RATES["deepseek-v4-flash"];
}

export function modelFixedCost(modelId: string | undefined, mode: AiCostMode) {
  const resolved = resolveAiModel(modelId) as BillableAiModelId;
  const costs = MODEL_COSTS[resolved] || MODEL_COSTS["deepseek-v4-flash"];
  return costs[mode];
}

export function calculateUsageCostCredits(
  modelId: string,
  inputTokens: number,
  outputTokens: number,
  effectiveCreditCost?: number,
  targetMargin?: number,
  cacheInputTokens = 0
) {
  const resolved = resolveAiModel(modelId);
  const rates = modelBillingRates(resolved);
  const financialCost =
    (Math.max(0, inputTokens) * rates.input) +
    (Math.max(0, outputTokens) * rates.output) +
    (Math.max(0, cacheInputTokens) * (rates.cacheRead ?? 0));
  if (effectiveCreditCost && effectiveCreditCost > 0 && targetMargin !== undefined) {
    const userPays = financialCost / Math.max(0.01, 1 - targetMargin);
    return Math.max(1, Math.ceil(userPays / effectiveCreditCost));
  }
  const costWithMargin = financialCost * MODEL_CREDIT_MARGIN_MULTIPLIER;
  return Math.max(1, Math.ceil(costWithMargin / CREDIT_VALUE_USD));
}

function deepSeekThinkingLevel(level: "none" | "high" | "max" | undefined, fallback: "none" | "high") {
  if (!level) return fallback;
  if (level === "none" || level === "high" || level === "max") return level;
  return fallback;
}

export function getThinkingControlMode(modelId: string | undefined): ThinkingControlMode {
  const resolved = resolveAiModel(modelId);
  if (resolved === "kimi-k2.7-code") return "always";
  if (resolved === "qwen3.7-max") return "binary";
  if (tieredThinkingModelIds.includes(resolved as typeof tieredThinkingModelIds[number])) return "tiered";
  return "none";
}

export function modelHasBinaryThinking(modelId: string | undefined) {
  return getThinkingControlMode(modelId) === "binary";
}

export function modelHasTieredThinking(modelId: string | undefined) {
  return getThinkingControlMode(modelId) === "tiered";
}

function clampThinkingForPlan(modelId: string | undefined, level: "none" | "low" | "medium" | "high" | "xhigh" | "max", plan?: string): "none" | "low" | "medium" | "high" | "xhigh" | "max" {
  if (config.allowPrivateOwnerLogin && config.nodeEnv !== "test") {
    return level;
  }
  if (plan === "free" && level !== "none") {
    const isDeepSeek = modelId === "deepseek-v4-flash" || modelId === "deepseek-v4-pro";
    const isBinary = getThinkingControlMode(modelId) === "binary";
    if (isDeepSeek || isBinary) {
      if (level === "max") return "high";
      return level;
    }
    const capped = ["none", "low", "medium"];
    if (!capped.includes(level)) return "medium";
  }
  return level;
}

export function getThinkingLevel(modelId: string | undefined, preferences?: UserPreferences, plan?: string): "none" | "low" | "medium" | "high" | "xhigh" | "max" {
  const resolved = resolveAiModel(modelId);
  let level: "none" | "low" | "medium" | "high" | "xhigh" | "max";
  if (resolved === "gemini-3.5-flash") {
    level = preferences?.thinkingGemini35Flash || "medium";
  } else if (resolved === "gemini-3-flash-preview") {
    level = preferences?.thinkingGemini3Flash || "high";
  } else if (resolved === "gemini-3.1-pro-preview") {
    level = preferences?.thinkingGemini31Pro || "high";
  } else if (resolved === "deepseek-v4-flash") {
    level = deepSeekThinkingLevel(preferences?.thinkingDeepSeekV4Flash, "high");
  } else if (resolved === "gpt-5.5") {
    level = preferences?.thinkingGpt55 || "medium";
  } else if (resolved === "qwen3.7-max") {
    level = preferences?.thinkingQwen || "high";
  } else if (resolved === "claude-opus-4-8") {
    level = preferences?.thinkingOpus || "high";
  } else if (resolved === "glm-5.2") {
    level = preferences?.thinkingGlm52 || "high";
  } else if (resolved === "kimi-k2.7-code") {
    level = "high";
  } else {
    level = "none";
  }
  if (resolved === "kimi-k2.7-code") return "high";
  return clampThinkingForPlan(resolved, level, plan);
}

export function getThinkingMultiplier(modelId: string | undefined, mode: "chat" | "changeset", preferences?: UserPreferences, plan?: string) {
  const level = getThinkingLevel(modelId, preferences, plan);
  const resolved = resolveAiModel(modelId);
  const isFreePlan = plan === "free";

  if (isFreePlan) {
    if (resolved === "deepseek-v4-flash" || resolved === "deepseek-v4-pro") return 1.0;
    if (getThinkingControlMode(modelId) === "always") return 1.0;
    if (level === "none") return 1.0;
    if (getThinkingControlMode(modelId) === "binary") return 1.5;
    if (level === "low") return 1.2;
    return 1.5;
  }


  if (resolved === "deepseek-v4-flash" || resolved === "deepseek-v4-pro") {
    if (level === "none") return 1.0;
    if (level === "high") return 1.5;
    if (level === "max") return 2.0;
  }
  if (getThinkingControlMode(modelId) === "always") return 1.0;
  if (getThinkingControlMode(modelId) === "binary") return level === "none" ? 1.0 : 1.5;
  if (level === "none") return 1.0;
  if (level === "low") return 1.2;
  if (level === "medium") return 1.5;
  if (level === "high") return 2.0;
  if (level === "xhigh") return 2.5;
  if (level === "max") return 3.0;
  return 1.0;
}

const ALLOWED_ORIGINS_DEV = [
  "http://localhost:5173",
  "http://localhost:5174",
  "http://127.0.0.1:5173",
  "http://127.0.0.1:5174"
];

export function allowedOrigins(): string[] {
  const origins = new Set<string>([config.webAppUrl, config.apiBaseUrl]);
  if (!config.isProduction) {
    for (const origin of ALLOWED_ORIGINS_DEV) origins.add(origin);
  }
  return [...origins].filter(Boolean);
}

export function isAllowedOrigin(origin: string | undefined | null): boolean {
  if (!origin) return false;
  if (allowedOrigins().includes(origin)) return true;
  if (origin === "https://vectiscode.pages.dev") return true;
  if (/^https:\/\/.*\.vectiscode\.pages\.dev$/.test(origin)) return true;
  return false;
}

export type ModelMode = "fast" | "balanced" | "best" | "deep_verify";

export interface ResolvedModelMode {
  model: string;
  verificationMode: "off" | "standard" | "deep";
  optimizationMode?: "disabled" | "balanced" | "cost_saver";
}

export function resolveModelMode(mode: ModelMode): ResolvedModelMode {
  switch (mode) {
    case "fast":
      return {
        model: "deepseek-v4-flash",
        verificationMode: "off",
        optimizationMode: "cost_saver"
      };
    case "balanced":
      return {
        model: "gemini-3.5-flash",
        verificationMode: "standard",
        optimizationMode: "balanced"
      };
    case "best":
      return {
        model: "gemini-3.1-pro-preview",
        verificationMode: "standard",
        optimizationMode: "disabled"
      };
    case "deep_verify":
      return {
        model: "claude-opus-4-8",
        verificationMode: "deep",
        optimizationMode: "disabled"
      };
  }
}
