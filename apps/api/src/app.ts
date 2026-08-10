import * as Sentry from "@sentry/node";
import cors from "cors";
import express from "express";
import compression from "compression";
import { customAlphabet } from "nanoid";
import { z } from "zod";
import pg from "pg";
const { Client } = pg;
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { createLogger } from "./services/logger.js";
import {
  chatSchema,
  editMessageSchema,
  clientErrorSchema
} from "./schemas.js";
import {
  currentUser,
  readCookie,
  csrfCookieName,
  sessionCookieName,
  requireUser
} from "./services/auth.js";
import {
  aiConfigured,
  config,
  firebaseConfigured,
  supabaseConfigured,
  isAllowedOrigin,
  allowedOrigins as configuredAllowedOrigins,
  robloxApiKeyConfigured,
  robloxOAuthConfigured,
  defaultAiModel,
  modelConfigFor,
  modelIsAvailable,
  modelIsPremium,
  resolveAiModel,
  runtimeAiModels,
  GENERATED_ICON_COST_CREDITS,
  GENERATED_ICON_OUTPUT_SIZE,
  ESTIMATED_GENERATED_ICON_PROVIDER_COST_USD
} from "./services/config.js";
import { store } from "./services/store.js";
import { socketService } from "./services/socket.js";
import { releaseReadinessChecks } from "./services/releaseReadiness.js";
import { clientIpForRequest, createFixedWindowLimiter, KeyedMutex } from "./services/limits.js";
import { requestContext, accessLog } from "./requestContext.js";
import { getApiSecurityHeaders } from "./csp.js";
import {
  handleStripeWebhook,
  stripeConfigured
} from "./services/billing.js";
import { planAllowsPremiumModels, planCatalog, topUpPacks } from "./services/plans.js";
import { registerBillingRoutes } from "./routes/billing.js";
import { registerAuthRoutes } from "./routes/auth.js";
import { registerAdminRoutes } from "./routes/admin.js";
import { registerStudioRoutes } from "./routes/studio.js";
import { registerProjectRoutes } from "./routes/projects.js";
import { registerChatRoutes } from "./routes/chat.js";
import { registerDiscordRoutes } from "./routes/discord.js";
import { discordBot } from "./services/discordBot.js";
import { discordConfigured } from "./services/config.js";

const nanoid = customAlphabet("23456789ABCDEFGHJKLMNPQRSTUVWXYZ", 12);
const log = createLogger({ service: "app" });
const orgLocks = new KeyedMutex();
let maintenanceTimerStarted = false;
const WEAK_UI_PATCH_MODELS = new Set(["gemini-3-flash-preview", "gemini-3-flash", "deepseek-v4-flash"]);
const SECRET_VALUE_PATTERNS = [
  /\b(cfk|ghp|github_pat|sbp|rnd|sk_live|sk_test|rk_live|rk_test)_[A-Za-z0-9_=-]{12,}\b/g,
  /\bAIza[0-9A-Za-z_-]{20,}\b/g
];

function redactSensitiveText(value: string) {
  return SECRET_VALUE_PATTERNS.reduce((text, pattern) => text.replace(pattern, "[redacted]"), value);
}

function safeUsageLimitPayload(payload: unknown) {
  if (!payload || typeof payload !== "object") return undefined;
  const input = payload as Record<string, unknown>;
  if (input.code !== "usage_limit_reached") return undefined;
  const result: Record<string, unknown> = {
    error: "Usage limit reached",
    code: "usage_limit_reached"
  };
  for (const key of [
    "title",
    "message",
    "plan",
    "planLabel",
    "action",
    "actionLabel",
    "nextRefillAt"
  ]) {
    if (typeof input[key] === "string") result[key] = input[key];
  }
  for (const key of ["creditBalance", "requiredCredits", "weeklyRemaining", "weeklyAllowance"]) {
    if (typeof input[key] === "number" && Number.isFinite(input[key])) result[key] = input[key];
  }
  if (typeof input.canTopUp === "boolean") result.canTopUp = input.canTopUp;
  return result;
}

function safeClientStatus(statusCode: unknown) {
  if (typeof statusCode !== "number") return undefined;
  if ([400, 401, 403, 404, 409, 413, 422, 429].includes(statusCode)) return statusCode;
  return undefined;
}

async function dispatchDiscordNotification(input: {
  userId?: string;
  organizationId?: string;
  type: string;
  action: string;
  status?: string;
  amountCredits?: number;
  metadata?: Record<string, unknown>;
}) {
  if (!discordBot.isReady()) return;

  if (input.type === "auth" && input.action === "signup") {
    await discordBot.postMilestone(
      "New Creator Joined",
      "A new developer just signed up for Vectis Code!"
    );
  } else if (input.type === "billing" && input.action === "subscription_created") {
    const plan = input.metadata?.plan as string | undefined;
    await discordBot.postMilestone(
      "New Subscriber",
      `Someone just upgraded to **${plan ?? "a paid plan"}**!`
    );
  } else if (input.type === "billing" && input.action === "subscription_upgraded") {
    const newPlan = input.metadata?.newPlan as string | undefined;
    await discordBot.postMilestone(
      "Plan Upgrade",
      `A creator just upgraded to **${newPlan ?? "a higher plan"}**!`
    );
  }
}

export function saferModelForPatch(input: {
  mode: "explain" | "changeset";
  selectedModel: string;
  prompt: string;
  plan?: string;
  optimizationMode?: "disabled" | "balanced" | "cost_saver";
}) {
  if (input.optimizationMode === "disabled") return undefined;
  if (input.mode !== "changeset") return undefined;
  if (!WEAK_UI_PATCH_MODELS.has(input.selectedModel)) return undefined;
  if (/\b(ui|gui|hud|button|screen|menu|modal|panel|image|icon|picture|mobile|touch|interface|layout|shop|inventory|sprint|shoot|blaster|weapon|combat|movement|controller)\b/i.test(input.prompt)) {
    if (planAllowsPremiumModels(input.plan)) {
      if (modelIsAvailable("qwen3.7-max")) return "qwen3.7-max";
      if (modelIsAvailable("gpt-5.5")) return "gpt-5.5";
    }
    if (modelIsAvailable("deepseek-v4-flash")) return "deepseek-v4-flash";
  }
  return undefined;
}

export function stableAnswerModelFor(input: {
  needsAnswer: boolean;
  selectedModel: string;
  optimizationMode?: "disabled" | "balanced" | "cost_saver";
}) {
  return undefined;
}

async function applyDatabaseSchemaIfNeeded() {
  if (!config.useSupabase) {
    log.info("Supabase database mode is off. Skipping schema migration check.");
    return;
  }

  const connectionString = process.env.SUPABASE_DB_URL;
  if (!connectionString) {
    const message = "SUPABASE_DB_URL is not configured. Cannot reconcile the database schema.";
    if (config.isProduction) throw new Error(message);
    log.warn(message);
    return;
  }
  let parsedHost: string;
  try {
    parsedHost = new URL(connectionString).host;
  } catch {
    log.warn("SUPABASE_DB_URL is not a valid URL. Skipping schema migration check.");
    return;
  }
  log.info("Initializing migration check", { host: parsedHost });

  const client = new Client({
    connectionString,
    ssl: {
      rejectUnauthorized: process.env.SUPABASE_DB_SSL_REJECT_UNAUTHORIZED === "true"
    }
  });

  try {
    await client.connect();

    const checkTable = await client.query("select to_regclass('public.vectis_collections') as table_name");
    const tableExists = checkTable.rows[0]?.table_name;

    let sql = "";
    const localSchemaPath = path.resolve(process.cwd(), "supabase", "schema.sql");
    const relativeSchemaPath = path.resolve(process.cwd(), "..", "supabase", "schema.sql");
    const parentSchemaPath = path.resolve(process.cwd(), "..", "..", "supabase", "schema.sql");

    if (existsSync(localSchemaPath)) {
      sql = readFileSync(localSchemaPath, "utf8");
    } else if (existsSync(relativeSchemaPath)) {
      sql = readFileSync(relativeSchemaPath, "utf8");
    } else if (existsSync(parentSchemaPath)) {
      sql = readFileSync(parentSchemaPath, "utf8");
    } else if (!tableExists) {
      log.warn("Schema file not found. Using fallback SQL schema.");
      sql = `
        create table if not exists public.vectis_collections (
          collection_name text not null,
          id text not null,
          data jsonb not null,
          created_at timestamptz not null default now(),
          updated_at timestamptz not null default now(),
          primary key (collection_name, id)
        );
        create unique index if not exists vectis_collections_id_collection_name_key
          on public.vectis_collections (id, collection_name);
        create index if not exists vectis_collections_collection_name_idx
          on public.vectis_collections (collection_name);
        alter table public.vectis_collections enable row level security;
        revoke all on public.vectis_collections from anon;
        revoke all on public.vectis_collections from authenticated;
        grant select, insert, update, delete on public.vectis_collections to service_role;
        insert into storage.buckets (id, name, public, file_size_limit)
        values ('vectis-attachments', 'vectis-attachments', false, 10485760)
        on conflict (id) do nothing;
      `;
    }

    if (sql) {
      if (!tableExists) {
        log.info("Table does not exist. Applying database schema...");
      } else {
        log.info("Reconciling idempotent schema statements (indexes, functions, triggers)...");
      }
      await client.query("begin");
      await client.query(sql);
      await client.query("commit");
      await client.query("notify pgrst, 'reload schema'");
      log.info("Database schema applied successfully.");
    } else {
      log.info("Table already exists. No migration needed.");
    }
  } catch (err) {
    log.error("Error during startup database migration", { error: String(err instanceof Error ? err.message : err) });
    throw err;
  } finally {
    await client.end().catch(() => undefined);
  }
}

function startMaintenanceCleanupJob() {
  if (maintenanceTimerStarted || config.nodeEnv === "test") return;
  maintenanceTimerStarted = true;
  const runCleanup = () => {
    void store.runMaintenanceCleanup().catch((error) => {
      log.warn("Maintenance cleanup failed", { error: String(error) });
    });
  };
  runCleanup();
  const timer = setInterval(runCleanup, config.retention.maintenanceIntervalMinutes * 60 * 1000);
  timer.unref?.();
}

export async function createApp() {
  if (config.isProduction || config.applyDatabaseSchemaOnStartup) {
    await applyDatabaseSchemaIfNeeded();
  } else {
    log.info("Startup schema reconciliation is disabled. Run scripts/supabase-apply-schema.mjs during deployment when schema changes.");
  }
  await store.ready();
  store.onUpdate = (userId) => socketService.notifyUpdate(userId);
  startMaintenanceCleanupJob();

  const app = express();
  app.set("trust proxy", config.trustProxyHeaders ? 1 : false);
  app.disable("x-powered-by");

  app.use(compression());
  app.use(requestContext());
  app.use(accessLog());

  const apiSecurityHeaders = getApiSecurityHeaders(config.isProduction);
  app.use((_req, res, next) => {
    for (const [k, v] of Object.entries(apiSecurityHeaders)) {
      res.setHeader(k, v);
    }
    next();
  });

  const globalLimiter = createFixedWindowLimiter({
    namespace: "global",
    windowMs: 60_000,
    max: config.requestLimits.globalPerMinute
  });
  const authLimiter = createFixedWindowLimiter({
    namespace: "auth",
    windowMs: 60_000,
    max: config.requestLimits.authPerMinute,
    message: "Too many sign-in attempts. Please wait a moment and try again."
  });
  const studioLimiter = createFixedWindowLimiter({
    namespace: "studio",
    windowMs: 60_000,
    max: config.requestLimits.studioPerMinute,
    message: "Studio is sending too many requests. Please wait a moment and try again."
  });
  const studioPairLimiter = createFixedWindowLimiter({
    namespace: "studio-pair",
    windowMs: 60_000,
    max: config.isProduction ? 20 : 500,
    message: "Too many Studio pairing requests. Please wait a moment and try again."
  });
  const studioClaimLimiter = createFixedWindowLimiter({
    namespace: "studio-claim",
    windowMs: 60_000,
    max: config.isProduction ? 12 : 500,
    message: "Too many Studio pairing attempts. Please wait a moment and try again."
  });
  const aiLimiter = createFixedWindowLimiter({
    namespace: "ai",
    windowMs: 60_000,
    max: config.requestLimits.aiPerMinute,
    message: "Too many AI requests. Please wait a moment and try again."
  });
  const clientErrorLimiter = createFixedWindowLimiter({
    namespace: "client-errors",
    windowMs: 60_000,
    max: config.requestLimits.clientErrorsPerMinute,
    message: "Too many client error reports. Please slow down."
  });
  const billingLimiter = createFixedWindowLimiter({
    namespace: "billing",
    windowMs: 60_000,
    max: config.isProduction ? 5 : 500,
    message: "Too many billing requests. Please wait a moment and try again."
  });
  const subscribeLimiter = createFixedWindowLimiter({
    namespace: "subscribe",
    windowMs: 60_000,
    max: config.isProduction ? 3 : 500,
    key: (req) => clientIpForRequest(req),
    message: "Too many subscription requests from this address."
  });
  const marketplaceLimiter = createFixedWindowLimiter({
    namespace: "marketplace",
    windowMs: 60_000,
    max: 30,
    message: "Too many marketplace searches. Please wait a moment and try again."
  });

  app.use((req, res, next) => {
    if (req.path === "/health") {
      next();
      return;
    }
    globalLimiter(req, res, next);
  });

  app.get("/health", (_req, res) => {
    res.json({
      ok: true,
      release: {
        sha: process.env.SOURCE_COMMIT_SHA || process.env.GITHUB_SHA || process.env.COMMIT_SHA || "",
        version: process.env.npm_package_version || ""
      }
    });
  });

  const allowedOrigins = configuredAllowedOrigins();

  app.use(cors({
    origin: (origin, callback) => {
      if (!origin || isAllowedOrigin(origin)) {
        callback(null, true);
      } else {
        callback(null, false);
      }
    },
    credentials: true
  }));

  const csrfAllowedOrigins = new Set(
    [config.webAppUrl, config.apiBaseUrl, ...allowedOrigins]
      .filter(Boolean)
      .map((origin) => {
        try {
          return new URL(origin).origin;
        } catch {
          return origin;
        }
      })
  );
  const csrfExemptPaths = new Set(["/stripe/webhook"]);
  const authSessionCreationPaths = new Set(["/auth/private-owner", "/auth/firebase", "/auth/supabase"]);
  const sessionRecoveryPaths = new Set([...authSessionCreationPaths, "/auth/logout"]);
  function requestHasAllowedOrigin(req: express.Request) {
    const origin = typeof req.headers.origin === "string" ? req.headers.origin : "";
    if (origin) {
      return csrfAllowedOrigins.has(origin) || isAllowedOrigin(origin);
    }

    const referer = typeof req.headers.referer === "string" ? req.headers.referer : "";
    if (!referer) return false;
    try {
      const refOrigin = new URL(referer).origin;
      return csrfAllowedOrigins.has(refOrigin) || isAllowedOrigin(refOrigin);
    } catch {
      return false;
    }
  }

  app.use((req, res, next) => {
    const unsafeMethod = req.method === "POST" || req.method === "PUT" || req.method === "PATCH" || req.method === "DELETE";
    if (!config.isProduction || !unsafeMethod) {
      next();
      return;
    }
    if (csrfExemptPaths.has(req.path)) {
      next();
      return;
    }
    if (sessionRecoveryPaths.has(req.path)) {
      if (!requestHasAllowedOrigin(req)) {
        res.status(403).json({ error: "Blocked cross-site request" });
        return;
      }
      next();
      return;
    }
    const sessionCookie = readCookie(req, sessionCookieName);
    if (!sessionCookie) {
      if (authSessionCreationPaths.has(req.path) && !requestHasAllowedOrigin(req)) {
        res.status(403).json({ error: "Blocked cross-site request" });
        return;
      }
      next();
      return;
    }

    if (!requestHasAllowedOrigin(req)) {
      res.status(403).json({ error: "Blocked cross-site request" });
      return;
    }

    const csrfCookie = readCookie(req, csrfCookieName);
    const csrfHeader = typeof req.headers["x-csrf-token"] === "string" ? req.headers["x-csrf-token"] : "";
    if (!csrfCookie || !csrfHeader || csrfCookie !== csrfHeader) {
      res.status(403).json({ error: "Blocked cross-site request" });
      return;
    }

    next();
  });
  app.use("/studio", studioLimiter);
  app.use(async (_req, _res, next) => {
    try {
      await store.ready();
      next();
    } catch (error) {
      next(error);
    }
  });

  app.post("/stripe/webhook", express.raw({ type: "application/json" }), async (req, res) => {
    try {
      const result = await handleStripeWebhook(req.headers["stripe-signature"] as string | undefined, req.body as Buffer);
      res.json(result);
    } catch (error) {
      Sentry.captureException(error);
      const message = error instanceof Error ? error.message : "Webhook failed";
      res.status(400).json({ error: message });
    }
  });

  app.use(express.json({ limit: config.requestLimits.jsonBodyLimit }));

  function isAdminUser(user: { email?: string; authProvider?: string }) {
    if (user.email && config.adminEmails.includes(user.email.toLowerCase().trim())) {
      return true;
    }
    if (config.isProduction) {
      return false;
    }
    return Boolean(
      process.env.VECTIS_VISUAL_ADMIN === "true"
      && config.allowPrivateOwnerLogin
      && user.authProvider === "private"
    );
  }

  async function requireAdmin(req: express.Request, res: express.Response) {
    const user = await currentUser(req);
    if (!user) {
      res.status(404).json({ error: "Not found" });
      return undefined;
    }
    if (!isAdminUser(user)) {
      res.status(404).json({ error: "Not found" });
      return undefined;
    }
    return user;
  }

  async function requireOwnedProject(userId: string, projectId: string, res: express.Response) {
    const organization = await store.fetchOrganizationForUser(userId);
    if (!organization) {
      res.status(500).json({ error: "No organization found for user" });
      return undefined;
    }
    const project = await store.fetchProject(projectId);
    if (!project || project.organizationId !== organization.id) {
      res.status(404).json({ error: "Project not found" });
      return undefined;
    }
    return { organization, project };
  }

  async function requireOwnedChangeSet(userId: string, changeSetId: string, res: express.Response) {
    const organization = await store.fetchOrganizationForUser(userId);
    if (!organization) {
      res.status(500).json({ error: "No organization found for user" });
      return undefined;
    }
    const changeSet = await store.fetchChangeSet(changeSetId);
    if (!changeSet) {
      res.status(404).json({ error: "Change set not found" });
      return undefined;
    }
    const project = await store.fetchProject(changeSet.projectId);
    if (!project || project.organizationId !== organization.id) {
      res.status(403).json({ error: "Change set does not belong to this workspace" });
      return undefined;
    }
    return { organization, project, changeSet };
  }

  function requestIp(req: express.Request) {
    return clientIpForRequest(req);
  }

  async function recordEvidence(
    req: express.Request,
    input: {
      userId?: string;
      organizationId?: string;
      projectId?: string;
      threadId?: string;
      type: "auth" | "billing" | "usage" | "admin" | "attachment" | "image_generation" | "studio" | "deletion" | "client_error";
      action: string;
      status?: string;
      amountCredits?: number;
      stripeCustomerId?: string;
      stripeSubscriptionId?: string;
      stripeSessionId?: string;
      metadata?: Record<string, unknown>;
    }
  ) {
    await store.saveCustomerEvidence({
      id: `evidence_${nanoid()}`,
      userId: input.userId,
      organizationId: input.organizationId,
      projectId: input.projectId,
      threadId: input.threadId,
      type: input.type,
      action: input.action,
      route: req.path,
      method: req.method,
      ip: requestIp(req),
      country: typeof req.headers["cf-ipcountry"] === "string" ? req.headers["cf-ipcountry"] : undefined,
      userAgent: req.headers["user-agent"],
      status: input.status,
      amountCredits: input.amountCredits,
      stripeCustomerId: input.stripeCustomerId,
      stripeSubscriptionId: input.stripeSubscriptionId,
      stripeSessionId: input.stripeSessionId,
      metadata: input.metadata,
      createdAt: new Date().toISOString()
    });

    if (discordConfigured() && discordBot.isReady()) {
      void dispatchDiscordNotification(input).catch(() => undefined);
    }
  }

  const routeCtx: import("./routeContext.js").RouteContext = {
    nanoid,
    store,
    socketService,
    orgLocks,
    authLimiter,
    aiLimiter,
    billingLimiter,
    subscribeLimiter,
    studioPairLimiter,
    studioClaimLimiter,
    marketplaceLimiter,
    recordEvidence,
    requireAdmin,
    requireOwnedProject,
    requireOwnedChangeSet,
    requestIp
  };

  registerBillingRoutes(app, routeCtx);
  registerAuthRoutes(app, routeCtx);
  registerAdminRoutes(app, routeCtx);
  registerStudioRoutes(app, routeCtx);
  registerProjectRoutes(app, routeCtx);
  registerChatRoutes(app, routeCtx);
  registerDiscordRoutes(app, routeCtx);

  app.delete("/local-data", async (req, res, next) => {
    try {
      const user = await requireUser(req, res);
      if (!user) return;
      const organization = await store.fetchOrganizationForUser(user.id);
      if (!organization) {
        res.status(500).json({ error: "No organization found" });
        return;
      }
      const projects = await store.fetchProjectsForOrganization(organization.id);
      for (const p of projects) {
        await store.clearRuntimeDataForProject(p.id);
      }
      res.json({ ok: true });
    } catch (e) {
      next(e);
    }
  });

  app.get("/diagnostics", async (req, res, next) => {
    try {
      if (config.isProduction) {
        const admin = await requireAdmin(req, res);
        if (!admin) return;
      }

      const [userCount, projectCount, sessionCount, snapshotCount, changeSetCount] = await Promise.all([
        store.countDocs("users").catch(() => 0),
        store.countDocs("projects").catch(() => 0),
        store.countDocs("sessions").catch(() => 0),
        store.countDocs("snapshots").catch(() => 0),
        store.countDocs("changeSets").catch(() => 0)
      ]);

      res.json({
        ok: true,
        product: "vectiscode",
        service: "vectis-code-api",
        webAppUrl: config.webAppUrl,
        apiBaseUrl: config.apiBaseUrl,
        uptimeSeconds: Math.floor(process.uptime()),
        auth: {
          firebaseConfigured: firebaseConfigured(),
          supabaseConfigured: supabaseConfigured(),
          googleOAuthConfigured: false,
          robloxOAuthConfigured: robloxOAuthConfigured(),
          privateOwnerLoginEnabled: config.allowPrivateOwnerLogin
        },
        billing: {
          stripeConfigured: stripeConfigured(),
          proPriceConfigured: Boolean(config.stripe.proPriceId),
          webhookConfigured: Boolean(config.stripe.webhookSecret)
        },
        ai: {
          configured: aiConfigured(),
          provider: config.googleVertex.projectId ? "google-vertex" : config.yunwu.apiKey ? "yunwu" : config.xiaomi.apiKey ? "xiaomi" : config.deepseek.apiKey ? "deepseek" : "local-fallback",
          defaultModel: defaultAiModel(),
          models: runtimeAiModels()
        },
        roblox: {
          openCloudApiKeyConfigured: robloxApiKeyConfigured()
        },
        storage: {
          mode: config.useSupabase ? "supabase" : "local-json",
          users: userCount,
          projects: projectCount,
          studioSessions: sessionCount,
          snapshots: snapshotCount,
          changeSets: changeSetCount
        },
        release: {
          checks: releaseReadinessChecks()
        }
      });
    } catch (e) {
      next(e);
    }
  });

  app.get("/readiness", async (_req, res) => {
    const checks = releaseReadinessChecks();
    try {
      await store.ping();
    } catch {
      checks.push({ id: "db-connectivity", severity: "error", message: "Database is not reachable" });
    }
    const errors = checks.filter((check) => check.severity === "error");
    // Strip diagnostic messages from the public response in production to avoid leaking config details
    const publicChecks = config.isProduction
      ? checks.map(({ id, severity }) => ({ id, severity }))
      : checks;
    res.status(errors.length > 0 ? 503 : 200).json({
      ok: errors.length === 0,
      checks: publicChecks
    });
  });

  app.post("/client-errors", clientErrorLimiter, async (req, res, next) => {
    try {
      const input = clientErrorSchema.parse(req.body);
      const user = await currentUser(req).catch(() => undefined);
      const organization = user ? await store.fetchOrganizationForUser(user.id).catch(() => undefined) : undefined;
      await recordEvidence(req, {
        userId: user?.id,
        organizationId: organization?.id,
        type: "client_error",
        action: input.kind,
        status: input.message,
        metadata: {
          route: input.route,
          apiPath: input.apiPath,
          statusCode: input.statusCode
        }
      });
      res.status(202).json({ ok: true });
    } catch (e) {
      next(e);
    }
  });

  if (config.nodeEnv === "test") {
    app.post("/__test/unsafe-error", (req, _res, next) => {
      next(Object.assign(new Error(String(req.body?.message ?? "test error")), {
        statusCode: typeof req.body?.statusCode === "number" ? req.body.statusCode : undefined,
        payload: req.body?.payload
      }));
    });
  }

  app.use((error: unknown, req: express.Request, res: express.Response, _next: express.NextFunction) => {
    if (error instanceof z.ZodError) {
      res.status(400).json({ error: "Invalid request", issues: error.issues });
      return;
    }
    log.error("Unhandled error", { error: String(error), path: req.path });
    Sentry.captureException(error);
    const rawMessage = error instanceof Error ? error.message : "Unexpected server error";
    const message = redactSensitiveText(rawMessage);
    void (async () => {
      const user = await currentUser(req).catch(() => undefined);
      const organization = user ? await store.fetchOrganizationForUser(user.id).catch(() => undefined) : undefined;
      await recordEvidence(req, {
        userId: user?.id,
        organizationId: organization?.id,
        type: "client_error",
        action: "server_error",
        status: message.slice(0, 240),
        metadata: config.isProduction ? undefined : { stack: error instanceof Error ? redactSensitiveText(error.stack ?? "") : undefined }
      });
    })().catch((recordError) => log.warn("Could not record server error evidence", { error: String(recordError) }));
    const statusCode = (error as { statusCode?: number } | undefined)?.statusCode;
    const payload = (error as { payload?: unknown } | undefined)?.payload;
    if (statusCode === 402) {
      const usagePayload = safeUsageLimitPayload(payload);
      if (usagePayload) {
        res.status(402).json(usagePayload);
        return;
      }
      res.status(402).json({ error: "Usage limit reached", code: "usage_limit_reached", message: "Usage capacity is unavailable for this request." });
      return;
    }
    if (message.startsWith("Usage limit reached") || message.startsWith("Usage capacity reached")) {
      res.status(402).json({ error: "Usage limit reached", code: "usage_limit_reached", message });
      return;
    }
    if (/timed out|operation was aborted|aborted/i.test(message)) {
      res.status(504).json({ error: "The provider did not return before the server timeout. Retry with a narrower request, or lower thinking if it is enabled for that model." });
      return;
    }
    const clientStatus = safeClientStatus(statusCode);
    if (clientStatus) {
      res.status(clientStatus).json({ error: message });
      return;
    }
    res.status(500).json({ error: config.isProduction ? "Unexpected server error" : message });
  });

  return app;
}
