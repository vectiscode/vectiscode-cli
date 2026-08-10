import express from "express";
import { customAlphabet } from "nanoid";
import {
  applyResultSchema,
  approveChangeSetSchema,
  claimPairSchema,
  snapshotSchema,
  studioCommandResultSchema,
  studioLogSchema,
  studioObservationSchema,
  studioPairSchema,
  studioTaskStatusSchema,
  undoResultSchema,
} from "../schemas.js";
import { requireUser } from "../services/auth.js";
import { createLogger } from "../services/logger.js";
import { isAttachmentStorageUnavailableError, persistAttachmentBytes, validateUploadedAsset } from "../services/assets.js";
import { calculateUsageCostCredits, config, defaultVisualInspectionModel, getThinkingMultiplier, modelFixedCost, resolveAiModel } from "../services/config.js";
import { planCreditEconomics } from "../services/pricing.js";
import { store } from "../services/store.js";
import { socketService } from "../services/socket.js";
import { snapshotFingerprint } from "../services/snapshots.js";
import type { AiUsageAccumulator } from "../services/usageAccounting.js";
import type { AgentActivityStep, ChangeSet, SnapshotNode, StudioCommand, StudioCommandResult, StudioObservation, StudioSession, StudioTaskRun, UserPreferences } from "../types.js";
import type { RouteContext } from "../routeContext.js";

const nanoid = customAlphabet("23456789ABCDEFGHJKLMNPQRSTUVWXYZ", 12);

const STUDIO_SYNC_FREE_KB = 64;
const STUDIO_SYNC_CHARGE_INTERVAL_MS = 10 * 60 * 1000;
const STUDIO_SYNC_DAILY_CREDIT_CAP = 100;
const STUDIO_SYNC_KB_PER_CREDIT = 128;
const STUDIO_SYNC_MAX_CREDITS_PER_CHARGE = 10;
const STUDIO_SESSION_STALE_MS = 300 * 1000;
const CONNECTOR_TOKEN_ROTATION_MS = 24 * 60 * 60 * 1000;
const PREVIOUS_CONNECTOR_TOKEN_GRACE_MS = 5 * 60 * 1000;
const SNAPSHOT_CHUNK_TTL_MS = 30 * 60 * 1000;
const MAX_SNAPSHOT_UPLOAD_NODES = 10_000;
const MAX_STUDIO_SCREENSHOT_BYTES = 5 * 1024 * 1024;
const PAIRING_CLAIM_WINDOW_MS = 10 * 60 * 1000;
const PAIRING_CLAIM_MAX_MISSES = 6;

const failedPairingClaims = new Map<string, { count: number; resetAt: number }>();

// Periodically remove expired pairing claim entries so the Map does not grow unbounded
// over the process lifetime with keys from buggy or malicious clients that never succeed.
setInterval(() => {
  const nowMs = Date.now();
  for (const [key, entry] of failedPairingClaims) {
    if (entry.resetAt <= nowMs) failedPairingClaims.delete(key);
  }
}, PAIRING_CLAIM_WINDOW_MS).unref();

interface PendingCommand extends StudioCommand {
  resolve: (result: Record<string, unknown>) => void;
  reject: (error: Error) => void;
  createdAt: number;
  dispatchedAt?: number;
}

const pendingCommands = new Map<string, PendingCommand[]>();
export const STUDIO_COMMAND_TIMEOUT_MS = 25_000;

export function queueStudioCommand(sessionId: string, command: StudioCommand): Promise<StudioCommandResult["result"]> {
  return new Promise((resolve, reject) => {
    const list = pendingCommands.get(sessionId) || [];
    const pending: PendingCommand = {
      ...command,
      resolve: (result) => resolve(result ?? {}),
      reject,
      createdAt: Date.now()
    };
    list.push(pending);
    pendingCommands.set(sessionId, list);

    setTimeout(() => {
      const current = pendingCommands.get(sessionId);
      if (!current) return;
      const index = current.findIndex((c) => c.id === command.id);
      if (index === -1) return;
      current.splice(index, 1);
      if (current.length === 0) pendingCommands.delete(sessionId);
      reject(new Error("Studio command timed out waiting for the plugin"));
    }, STUDIO_COMMAND_TIMEOUT_MS);
  });
}

function takePendingCommands(sessionId: string): StudioCommand[] {
  const list = pendingCommands.get(sessionId);
  if (!list || list.length === 0) return [];
  const now = Date.now();
  const fresh = list.filter((c) => now - c.createdAt < STUDIO_COMMAND_TIMEOUT_MS);
  const expired = list.filter((c) => now - c.createdAt >= STUDIO_COMMAND_TIMEOUT_MS);
  for (const cmd of expired) {
    cmd.reject(new Error("Studio command expired before the plugin picked it up"));
  }
  if (fresh.length === 0) {
    pendingCommands.delete(sessionId);
    return [];
  }
  pendingCommands.set(sessionId, fresh);
  const undispatched = fresh.filter((c) => !c.dispatchedAt);
  for (const cmd of undispatched) {
    cmd.dispatchedAt = now;
  }
  return undispatched.map(({ id, type, arguments: args }) => ({ id, type, arguments: args }));
}

function resolveCommandResult(sessionId: string, result: StudioCommandResult) {
  const list = pendingCommands.get(sessionId);
  if (!list) return false;
  const index = list.findIndex((c) => c.id === result.commandId);
  if (index === -1) return false;
  const [cmd] = list.splice(index, 1);
  if (list.length === 0) pendingCommands.delete(sessionId);
  if (result.status === "error") {
    cmd.reject(new Error(result.error || "Studio command failed"));
  } else {
    cmd.resolve(result.result ?? {});
  }
  return true;
}

function dayWindow(reference = new Date()) {
  const start = new Date(Date.UTC(reference.getUTCFullYear(), reference.getUTCMonth(), reference.getUTCDate()));
  const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);
  return { start, end };
}

export async function expireStaleStudioSessions(sessions: StudioSession[]) {
  // Let the session status remain connected/paired. We only expire sessions when their 7-day expiresAt TTL is reached.
  return sessions;
}

function activityStep(
  kind: AgentActivityStep["kind"],
  label: string,
  status: AgentActivityStep["status"],
  detail?: string
): AgentActivityStep {
  return { id: `act_${nanoid()}`, kind, label, status, detail };
}

function mergeApplyValidationActivity(changeSet: ChangeSet, status: "applied" | "failed", details: string) {
  const existing = changeSet.activity ?? [];
  const withoutOldStudioValidation = existing.filter((step) => step.label !== "Studio validation result");
  changeSet.activity = [
    ...withoutOldStudioValidation,
    activityStep(
      "validate",
      "Studio validation result",
      status === "applied" ? "success" : "failed",
      details || (status === "applied" ? "Studio reported the patch was applied." : "Studio reported the patch failed.")
    )
  ];
}

function mergeSnapshotNodes(previous: SnapshotNode[] | undefined, incoming: Array<SnapshotNode & { deleted?: boolean }>, mode: "full" | "delta") {
  if (mode === "full" || !previous?.length) {
    return incoming
      .filter((node) => !node.deleted)
      .map(({ path, className, source, properties }) => ({ path, className, source, properties }));
  }

  const merged = new Map(previous.map((node) => [node.path, node]));
  for (const node of incoming) {
    if (node.deleted) {
      merged.delete(node.path);
    } else {
      merged.set(node.path, { path: node.path, className: node.className, source: node.source, properties: node.properties });
    }
  }

  return [...merged.values()].sort((a, b) => a.path.localeCompare(b.path));
}

function snapshotPayloadSize(nodes: Array<SnapshotNode & { deleted?: boolean }>) {
  return nodes.reduce((acc, node) => acc + (node.source?.length ?? 0) + node.path.length + JSON.stringify(node.properties ?? {}).length, 0);
}

function supportsNativeStudioBridge(pluginVersion: string) {
  if (process.env.NODE_ENV === "test" && pluginVersion === "test") return true;
  const match = pluginVersion.match(/(\d+)\.(\d+)\.(\d+)/);
  if (!match) return false;
  const [, majorRaw, minorRaw, patchRaw] = match;
  const major = Number(majorRaw);
  const minor = Number(minorRaw);
  const patch = Number(patchRaw);
  if (major > 1) return true;
  if (major < 1) return false;
  if (minor > 18) return true;
  if (minor < 18) return false;
  return patch >= 1;
}

function connectorTokenMatches(token: string | undefined, session: StudioSession) {
  if (!token) return false;
  const t = token.trim();
  const dbToken = session.connectorToken.trim();
  const dbPrevToken = session.previousConnectorToken?.trim();
  if (t === dbToken) return true;
  if (!dbPrevToken || t !== dbPrevToken) return false;

  const explicitExpiry = session.previousConnectorTokenExpiresAt
    ? new Date(session.previousConnectorTokenExpiresAt).getTime()
    : NaN;
  const legacyExpiry = session.connectorTokenRotatedAt
    ? new Date(session.connectorTokenRotatedAt).getTime() + PREVIOUS_CONNECTOR_TOKEN_GRACE_MS
    : NaN;
  const expiry = Number.isFinite(explicitExpiry) ? explicitExpiry : legacyExpiry;
  return Number.isFinite(expiry) && expiry > Date.now();
}

function connectorTokenFromRequest(req: express.Request, fallback?: unknown) {
  const rawHeader = req.headers["x-vectis-connector-token"];
  const headerToken = Array.isArray(rawHeader) ? rawHeader[0] : rawHeader;
  if (typeof headerToken === "string" && headerToken.trim()) return headerToken.trim();
  return typeof fallback === "string" ? fallback.trim() : "";
}

function activeConnectorTokenMatches(token: string | undefined, session: StudioSession) {
  return session.status !== "expired" && connectorTokenMatches(token, session);
}

async function expireStudioSessionIfNeeded(session: StudioSession | undefined) {
  if (!session || session.status === "expired" || !session.expiresAt) return session;
  if (new Date(session.expiresAt).getTime() > Date.now()) return session;

  session.status = "expired";
  session.disconnectedAt = new Date().toISOString();
  session.disconnectedBy = "timeout";
  session.disconnectReason = "Studio Bridge session expired. Link Studio again.";
  await store.saveStudioSession(session);
  if (session.userId) socketService.notifyUpdate(session.userId);
  return session;
}

async function ensureStudioTaskRun(changeSet: ChangeSet, session?: StudioSession) {
  const existing = changeSet.studioTaskRunId
    ? await store.fetchStudioTaskRun(changeSet.studioTaskRunId)
    : undefined;
  if (existing) {
    if (session && existing.studioSessionId !== session.id) {
      existing.studioSessionId = session.id;
      existing.updatedAt = new Date().toISOString();
      await store.saveStudioTaskRun(existing);
    }
    return existing;
  }

  const nowIso = new Date().toISOString();
  const taskRun: StudioTaskRun = {
    id: `studio_task_${nanoid()}`,
    projectId: changeSet.projectId,
    studioSessionId: session?.id,
    changeSetId: changeSet.id,
    threadId: changeSet.threadId,
    status: "queued",
    repairRound: 0,
    maxRepairRounds: 2,
    verificationProfile: changeSet.verificationMode === "deep" ? "deep" : "standard",
    visualQa: "not_requested",
    createdAt: nowIso,
    updatedAt: nowIso
  };
  changeSet.studioTaskRunId = taskRun.id;
  await store.saveStudioTaskRun(taskRun);
  await store.saveChangeSet(changeSet);
  return taskRun;
}

async function saveStudioObservation(input: Omit<StudioObservation, "id" | "createdAt">) {
  return store.saveStudioObservation({
    ...input,
    id: `studio_obs_${nanoid()}`,
    createdAt: new Date().toISOString()
  });
}

function studioScreenshotAsset(bytes: Buffer) {
  const pngSignature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  if (bytes.length >= pngSignature.length && bytes.subarray(0, pngSignature.length).equals(pngSignature)) {
    return { extension: "png", mimeType: "image/png" };
  }
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return { extension: "jpg", mimeType: "image/jpeg" };
  }
  throw new Error("Studio screenshots must contain PNG or JPEG image bytes.");
}

async function latestAppliedChangeSetForProject(projectId: string) {
  const changeSets = await store.fetchChangeSetsForProject(projectId);
  return changeSets
    .filter((cs) => cs.status === "applied")
    .sort((a, b) => (b.appliedAt ?? b.createdAt).localeCompare(a.appliedAt ?? a.createdAt))[0];
}

function getCost(model: string | undefined, mode: "chat" | "changeset", usage?: AiUsageAccumulator, preferences?: UserPreferences, plan?: string, billingCycle?: string) {
  const activeModel = resolveAiModel(model || config.defaultAiModel);

  if (usage && usage.inputTokens + usage.outputTokens > 0) {
    const economics = planCreditEconomics(plan, billingCycle);
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

export function registerStudioRoutes(app: express.Express, ctx: RouteContext) {
  function nanoid(size?: number) {
    return ctx.nanoid(size);
  }

  function rotateConnectorToken(session: StudioSession, keepPrevious = true) {
    const previousToken = session.connectorToken;
    session.connectorToken = nanoid(32);
    session.connectorTokenRotatedAt = new Date().toISOString();
    if (keepPrevious) {
      session.previousConnectorToken = previousToken;
      session.previousConnectorTokenExpiresAt = new Date(Date.now() + PREVIOUS_CONNECTOR_TOKEN_GRACE_MS).toISOString();
    } else {
      session.previousConnectorToken = undefined;
      session.previousConnectorTokenExpiresAt = undefined;
    }
  }

  function pairingClaimKey(req: express.Request, pairingCode: string) {
    return `${ctx.requestIp(req) ?? "unknown"}:${pairingCode.slice(0, 4)}`;
  }

  function pairingClaimLocked(req: express.Request, pairingCode: string) {
    const key = pairingClaimKey(req, pairingCode);
    const nowMs = Date.now();
    const existing = failedPairingClaims.get(key);
    if (!existing || existing.resetAt <= nowMs) {
      failedPairingClaims.delete(key);
      return false;
    }
    return existing.count >= PAIRING_CLAIM_MAX_MISSES;
  }

  function recordPairingClaimMiss(req: express.Request, pairingCode: string) {
    const key = pairingClaimKey(req, pairingCode);
    const nowMs = Date.now();
    const existing = failedPairingClaims.get(key);
    const entry = existing && existing.resetAt > nowMs
      ? existing
      : { count: 0, resetAt: nowMs + PAIRING_CLAIM_WINDOW_MS };
    entry.count += 1;
    failedPairingClaims.set(key, entry);
  }

  function clearPairingClaimMisses(req: express.Request, pairingCode: string) {
    failedPairingClaims.delete(pairingClaimKey(req, pairingCode));
  }

  app.post("/studio/pair", ctx.studioPairLimiter, async (req, res) => {
    const input = studioPairSchema.parse(req.body);
    const rawCode = nanoid();
    const formattedCode = `${rawCode.slice(0, 4)}-${rawCode.slice(4, 8)}-${rawCode.slice(8, 12)}`.toUpperCase();
    
    const session = await store.saveStudioSession({
      id: `session_${nanoid(12)}`,
      pairingCode: formattedCode,
      connectorToken: nanoid(32),
      pluginVersion: input.pluginVersion,
      placeId: input.placeId,
      placeName: input.placeName,
      status: "waiting",
      createdAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 15 * 60 * 1000).toISOString()
    });

    res.status(201).json({
      sessionId: session.id,
      connectorToken: session.connectorToken,
      pairingCode: session.pairingCode,
      expiresInSeconds: 900
    });
  });

  app.post("/studio/connect", ctx.studioPairLimiter, async (req, res) => {
    req.log.info("Studio connect request");
    const input = studioPairSchema.parse(req.body);
    
    const rawCode = nanoid();
    const formattedCode = `${rawCode.slice(0, 4)}-${rawCode.slice(4, 8)}-${rawCode.slice(8, 12)}`.toUpperCase();

    const session = await store.saveStudioSession({
      id: `session_${nanoid(12)}`,
      pairingCode: formattedCode,
      connectorToken: nanoid(32),
      pluginVersion: input.pluginVersion,
      placeId: input.placeId,
      placeName: input.placeName,
      status: "waiting",
      createdAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 15 * 60 * 1000).toISOString()
    });

    res.status(201).json({
      mode: "pairing-required",
      sessionId: session.id,
      connectorToken: session.connectorToken,
      pairingCode: session.pairingCode,
      status: session.status,
      session
    });
  });

  app.get("/studio/session/:sessionId", async (req, res) => {
    const connectorToken = connectorTokenFromRequest(req, req.query.connectorToken);
    const session = await expireStudioSessionIfNeeded(await store.fetchStudioSession(req.params.sessionId));
    
    if (!session) {
      res.status(403).json({ error: "Invalid session" });
      return;
    }

    const tokenMatches = connectorTokenMatches(connectorToken, session);
    if (!tokenMatches) {
      res.status(403).json({ error: "Invalid connector token" });
      return;
    }

    if (session.status !== "expired") {
      const rotatedAtMs = new Date(session.connectorTokenRotatedAt ?? session.pairedAt ?? session.createdAt).getTime();
      let needsSave = false;
      if (session.status !== "waiting" && (!Number.isFinite(rotatedAtMs) || Date.now() - rotatedAtMs >= CONNECTOR_TOKEN_ROTATION_MS)) {
        rotateConnectorToken(session);
        needsSave = true;
      }
      const lastSeenMs = session.lastSeenAt ? new Date(session.lastSeenAt).getTime() : 0;
      if (needsSave || !Number.isFinite(lastSeenMs) || Date.now() - lastSeenMs >= 15_000) {
        session.lastSeenAt = new Date().toISOString();
        if (session.status === "connected" || session.status === "paired") {
          session.expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
        }
        await store.saveStudioSession(session);
        if (session.userId) socketService.notifyUpdate(session.userId);
      }
    }

    const user = session.userId ? await store.fetchUser(session.userId) : undefined;

    res.json({
      session: {
        ...session,
        pairingCode: session.status === "waiting" ? session.pairingCode : undefined,
        vectisId: user?.id,
        vectisEmail: user?.email || user?.robloxUsername,
        vectisName: user?.name
      }
    });
  });

  app.post("/studio/sessions/:sessionId/rotate-token", async (req, res) => {
    const user = await requireUser(req, res);
    if (!user) return;

    const session = await expireStudioSessionIfNeeded(await store.fetchStudioSession(req.params.sessionId));
    if (!session || session.userId !== user.id) {
      res.status(404).json({ error: "Session not found" });
      return;
    }

    if (session.status === "expired") {
      res.status(409).json({ error: "Session is expired" });
      return;
    }

    rotateConnectorToken(session, false);
    await store.saveStudioSession(session);

    req.log.info("Connector token rotated", { sessionId: session.id, userId: user.id });
    res.json({
      connectorToken: session.connectorToken,
      rotatedAt: session.connectorTokenRotatedAt
    });
  });

  app.get("/studio/session/:sessionId/pending-patches", async (req, res) => {
    const session = await expireStudioSessionIfNeeded(await store.fetchStudioSession(req.params.sessionId));
    const token = connectorTokenFromRequest(req, req.query.connectorToken);
    
    if (!session || !activeConnectorTokenMatches(token, session)) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }

    if (!["paired", "connected"].includes(session.status) || !session.projectId) {
      res.status(409).json({
        error: "Studio session is not connected",
        session: {
          status: session.status,
          disconnectReason: session.disconnectReason
        }
      });
      return;
    }

    if (!supportsNativeStudioBridge(session.pluginVersion)) {
      res.json({
        patches: [],
        updateRequired: true,
        message: "Update the Vectis Studio plugin before applying web-approved patches."
      });
      return;
    }

    const changeSets = await store.fetchChangeSetsForProject(session.projectId || "");
    const patches = changeSets.filter(cs => cs.status === "approved_for_studio");
    for (const patch of patches) {
      await ensureStudioTaskRun(patch, session);
    }

    res.json({ patches });
  });

  app.get("/studio/session/:sessionId/pending-undos", async (req, res) => {
    const session = await expireStudioSessionIfNeeded(await store.fetchStudioSession(req.params.sessionId));
    const token = connectorTokenFromRequest(req, req.query.connectorToken);
    
    if (!session || !activeConnectorTokenMatches(token, session)) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }

    if (!["paired", "connected"].includes(session.status) || !session.projectId) {
      res.status(409).json({
        error: "Studio session is not connected",
        session: {
          status: session.status,
          disconnectReason: session.disconnectReason
        }
      });
      return;
    }

    const changeSets = await store.fetchChangeSetsForProject(session.projectId || "");
    const undos = changeSets
      .filter(cs => cs.status === "applied" && Boolean(cs.undoRequestedAt) && !cs.undoFailedAt)
      .sort((a, b) => (a.undoRequestedAt ?? "").localeCompare(b.undoRequestedAt ?? ""));

    res.json({ undos });
  });

  app.get("/studio/session/:sessionId/poll", async (req, res) => {
    const session = await expireStudioSessionIfNeeded(await store.fetchStudioSession(req.params.sessionId));
    const token = connectorTokenFromRequest(req, req.query.connectorToken);
    
    if (!session || !activeConnectorTokenMatches(token, session)) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }

    if (session.status !== "expired") {
      const rotatedAtMs = new Date(session.connectorTokenRotatedAt ?? session.pairedAt ?? session.createdAt).getTime();
      let needsSave = false;
      if (session.status !== "waiting" && (!Number.isFinite(rotatedAtMs) || Date.now() - rotatedAtMs >= CONNECTOR_TOKEN_ROTATION_MS)) {
        rotateConnectorToken(session);
        needsSave = true;
      }
      const lastSeenMs = session.lastSeenAt ? new Date(session.lastSeenAt).getTime() : 0;
      if (needsSave || !Number.isFinite(lastSeenMs) || Date.now() - lastSeenMs >= 15_000) {
        session.lastSeenAt = new Date().toISOString();
        if (session.status === "connected" || session.status === "paired") {
          session.expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
        }
        await store.saveStudioSession(session);
        if (session.userId) socketService.notifyUpdate(session.userId);
      }
    }

    const user = session.userId ? await store.fetchUser(session.userId) : undefined;

    let patches: ChangeSet[] = [];
    let updateRequired = false;
    let updateMessage = "";
    let undos: ChangeSet[] = [];

    if (["paired", "connected"].includes(session.status) && session.projectId) {
      const changeSets = await store.fetchChangeSetsForProject(session.projectId || "");
      if (!supportsNativeStudioBridge(session.pluginVersion)) {
        updateRequired = true;
        updateMessage = "Update the Vectis Studio plugin before applying web-approved patches.";
      } else {
        patches = changeSets.filter(cs => cs.status === "approved_for_studio");
        for (const patch of patches) {
          await ensureStudioTaskRun(patch, session);
        }
      }

      undos = changeSets
        .filter(cs => cs.status === "applied" && Boolean(cs.undoRequestedAt) && !cs.undoFailedAt)
        .sort((a, b) => (a.undoRequestedAt ?? "").localeCompare(b.undoRequestedAt ?? ""));
    }

    res.json({
      session: {
        ...session,
        pairingCode: session.status === "waiting" ? session.pairingCode : undefined,
        vectisId: user?.id,
        vectisEmail: user?.email || user?.robloxUsername,
        vectisName: user?.name
      },
      patches: updateRequired ? [] : patches,
      updateRequired,
      message: updateMessage,
      undos,
      commands: takePendingCommands(session.id)
    });
  });

  app.post("/studio/session/:sessionId/command-result", async (req, res) => {
    const session = await expireStudioSessionIfNeeded(await store.fetchStudioSession(req.params.sessionId));
    const token = connectorTokenFromRequest(req, req.body.connectorToken);

    if (!session || !activeConnectorTokenMatches(token, session)) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }

    const input = studioCommandResultSchema.parse(req.body);
    if (resolveCommandResult(session.id, input)) {
      res.json({ ok: true });
    } else {
      res.status(409).json({ error: "Command was not pending or already timed out" });
    }
  });

  app.post("/studio/snapshot", async (req, res) => {
    const input = snapshotSchema.parse(req.body);
    const session = await expireStudioSessionIfNeeded(await store.fetchStudioSession(input.sessionId));
    
    if (!session || !activeConnectorTokenMatches(connectorTokenFromRequest(req, input.connectorToken), session)) {
      res.status(403).json({ error: "Invalid connector token" });
      return;
    }

    if (!["paired", "connected"].includes(session.status) || !session.projectId) {
      res.status(409).json({ error: "Studio session is not connected" });
      return;
    }

    let incomingNodes: Array<SnapshotNode & { deleted?: boolean }> = input.nodes;
    let incomingMode = input.mode;
    let chunkInfo: { uploadId: string; index: number; total: number; received: number } | undefined;

    if (input.chunk) {
      if (input.chunk.index > input.chunk.total) {
        res.status(400).json({ error: "Snapshot chunk index cannot exceed total chunks" });
        return;
      }
      if ((input.chunk.totalNodeCount ?? 0) > MAX_SNAPSHOT_UPLOAD_NODES) {
        res.status(413).json({ error: `Snapshot upload is limited to ${MAX_SNAPSHOT_UPLOAD_NODES} nodes` });
        return;
      }

      await store.deleteExpiredSnapshotChunks().catch((error) => req.log.warn("Could not prune snapshot chunks", { error: String(error) }));
      await store.saveSnapshotChunk({
        id: `snapshot_chunk_${session.id}_${input.chunk.id}_${input.chunk.index}`,
        uploadId: input.chunk.id,
        sessionId: session.id,
        projectId: session.projectId,
        mode: input.mode,
        index: input.chunk.index,
        total: input.chunk.total,
        totalNodeCount: input.chunk.totalNodeCount,
        nodes: input.nodes,
        createdAt: new Date().toISOString(),
        expiresAt: new Date(Date.now() + SNAPSHOT_CHUNK_TTL_MS).toISOString()
      });

      const chunks = await store.fetchSnapshotChunks(input.chunk.id, session.id, session.projectId);
      const byIndex = new Map<number, typeof chunks[number]>();
      for (const chunk of chunks) {
        if (chunk.total === input.chunk.total) byIndex.set(chunk.index, chunk);
      }

      if (byIndex.size < input.chunk.total) {
        session.lastSeenAt = new Date().toISOString();
        await store.saveStudioSession(session);
        res.status(202).json({
          pending: true,
          uploadId: input.chunk.id,
          receivedChunks: byIndex.size,
          totalChunks: input.chunk.total,
          session: { connectorToken: session.connectorToken }
        });
        return;
      }

      const orderedChunks = Array.from({ length: input.chunk.total }, (_, index) => byIndex.get(index + 1));
      if (orderedChunks.some((chunk) => !chunk)) {
        res.status(409).json({ error: "Snapshot upload is missing one or more chunks" });
        return;
      }
      if (orderedChunks.some((chunk) => chunk!.mode !== input.mode)) {
        await store.deleteSnapshotChunks(input.chunk.id, session.id, session.projectId);
        res.status(409).json({ error: "Snapshot upload chunks do not agree on mode" });
        return;
      }

      const totalNodes = orderedChunks.reduce((acc, chunk) => acc + chunk!.nodes.length, 0);
      if (totalNodes > MAX_SNAPSHOT_UPLOAD_NODES) {
        await store.deleteSnapshotChunks(input.chunk.id, session.id, session.projectId);
        res.status(413).json({ error: `Snapshot upload is limited to ${MAX_SNAPSHOT_UPLOAD_NODES} nodes` });
        return;
      }

      incomingNodes = orderedChunks.flatMap((chunk) => chunk!.nodes);
      incomingMode = orderedChunks[0]?.mode ?? input.mode;
      chunkInfo = {
        uploadId: input.chunk.id,
        index: input.chunk.index,
        total: input.chunk.total,
        received: byIndex.size
      };
      await store.deleteSnapshotChunks(input.chunk.id, session.id, session.projectId);
    }

    const previousSnapshot = await store.fetchLatestSnapshot(session.projectId);
    const nodes = mergeSnapshotNodes(previousSnapshot?.nodes, incomingNodes, incomingMode);
    const snapshot = {
      id: `snapshot_${nanoid(12)}`,
      projectId: session.projectId,
      studioSessionId: session.id,
      nodes,
      createdAt: new Date().toISOString()
    };
    
    const prevFingerprint = previousSnapshot ? snapshotFingerprint(previousSnapshot) : undefined;
    const newFingerprint = snapshotFingerprint(snapshot);
    const isIdentical = previousSnapshot && prevFingerprint === newFingerprint;

    if (!isIdentical) {
      await store.saveSnapshot(snapshot);
    } else {
      req.log.info("Skipped saving identical snapshot", { projectId: session.projectId });
    }

    const org = await store.fetchOrganizationForUser(session.userId || "");
    let syncCharge = 0;
    let syncStatus = "free";
    let syncReason = "Small or routine sync update.";
    const totalChars = snapshotPayloadSize(incomingNodes);
    const syncKb = Math.ceil(totalChars / 1024);
    const rawSyncCredits = syncKb <= STUDIO_SYNC_FREE_KB
      ? 0
      : Math.min(
          STUDIO_SYNC_MAX_CREDITS_PER_CHARGE,
          Math.max(1, Math.ceil(syncKb / STUDIO_SYNC_KB_PER_CREDIT))
        );

    if (org && rawSyncCredits > 0) {
      const ledger = await store.fetchLedgerForOrganization(org.id);
      const { start, end } = dayWindow();
      const todaySyncEntries = ledger.filter((entry) => {
        const createdAt = new Date(entry.createdAt).getTime();
        return Number.isFinite(createdAt)
          && createdAt >= start.getTime()
          && createdAt < end.getTime()
          && entry.delta < 0
          && /^Studio sync metering\b/i.test(entry.reason);
      });
      const todaySyncCredits = todaySyncEntries.reduce((sum, entry) => sum + Math.abs(entry.delta), 0);
      const latestSyncChargeAt = todaySyncEntries
        .map((entry) => new Date(entry.createdAt).getTime())
        .filter(Number.isFinite)
        .sort((a, b) => b - a)[0];
      const elapsedSinceCharge = latestSyncChargeAt ? Date.now() - latestSyncChargeAt : Number.POSITIVE_INFINITY;
      const remainingDailyCap = Math.max(0, STUDIO_SYNC_DAILY_CREDIT_CAP - todaySyncCredits);

      if (remainingDailyCap <= 0) {
        syncStatus = "capped";
        syncReason = `Daily sync cap reached at ${STUDIO_SYNC_DAILY_CREDIT_CAP} credits.`;
      } else if (elapsedSinceCharge < STUDIO_SYNC_CHARGE_INTERVAL_MS) {
        syncStatus = "throttled";
        syncReason = "Recent sync charge already covered this burst.";
      } else {
        syncCharge = Math.min(rawSyncCredits, remainingDailyCap);
        const debit = await store.tryDeductCredits(org.id, syncCharge, `Studio sync metering (${syncKb}KB)`);
        if (debit.ok) {
          syncStatus = "charged";
          syncReason = `Charged ${syncCharge} credit${syncCharge === 1 ? "" : "s"} for a larger Studio sync.`;
        } else {
          syncCharge = 0;
          syncStatus = "insufficient_capacity";
          syncReason = "Sync remained available, but there was no capacity for the metered charge.";
        }
      }
    } else if (rawSyncCredits === 0) {
      syncReason = `Under the ${STUDIO_SYNC_FREE_KB}KB free sync threshold.`;
    }

    if (org) {
      await ctx.recordEvidence(req, {
        userId: session.userId,
        organizationId: org.id,
        projectId: session.projectId,
        type: "studio",
        action: "snapshot_sync",
        status: syncStatus,
        amountCredits: syncCharge || undefined,
        metadata: {
          mode: input.mode,
          inputNodeCount: incomingNodes.length,
          mergedNodeCount: nodes.length,
          changedKb: syncKb,
          rawSyncCredits,
          chargedCredits: syncCharge,
          freeThresholdKb: STUDIO_SYNC_FREE_KB,
          chargeIntervalSeconds: Math.round(STUDIO_SYNC_CHARGE_INTERVAL_MS / 1000),
          dailyCapCredits: STUDIO_SYNC_DAILY_CREDIT_CAP,
          chunked: Boolean(chunkInfo),
          uploadId: chunkInfo?.uploadId,
          chunkCount: chunkInfo?.total,
          reason: syncReason
        }
      });
    }

    const lastSeenMs = session.lastSeenAt ? new Date(session.lastSeenAt).getTime() : 0;
    if (!Number.isFinite(lastSeenMs) || Date.now() - lastSeenMs >= 15_000) {
      session.lastSeenAt = new Date().toISOString();
      if (session.status === "connected" || session.status === "paired") {
        session.expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
      }
      await store.saveStudioSession(session);
      if (session.userId) socketService.notifyUpdate(session.userId);
    }

    res.status(201).json({ 
      snapshot: {
        id: isIdentical && previousSnapshot ? previousSnapshot.id : snapshot.id,
        projectId: snapshot.projectId,
        studioSessionId: snapshot.studioSessionId,
        createdAt: isIdentical && previousSnapshot ? previousSnapshot.createdAt : snapshot.createdAt
      },
      sync: {
        status: syncStatus,
        chargedCredits: syncCharge,
        changedKb: syncKb,
        dailyCapCredits: STUDIO_SYNC_DAILY_CREDIT_CAP,
        reason: syncReason
      },
      upload: chunkInfo ? {
        id: chunkInfo.uploadId,
        chunks: chunkInfo.total,
        nodes: incomingNodes.length
      } : undefined,
      session: { connectorToken: session.connectorToken }
    });
  });

  app.get("/studio/changes/pending", async (req, res) => {
    const sessionId = String(req.query.sessionId ?? "");
    const token = connectorTokenFromRequest(req, req.query.connectorToken);
    const session = await expireStudioSessionIfNeeded(await store.fetchStudioSession(sessionId));
    
    if (!session || !activeConnectorTokenMatches(token, session)) {
      res.status(403).json({ error: "Invalid connector token" });
      return;
    }

    if (!["paired", "connected"].includes(session.status) || !session.projectId) {
      res.status(409).json({ error: "Studio session is not connected" });
      return;
    }

    const lastSeenMs = session.lastSeenAt ? new Date(session.lastSeenAt).getTime() : 0;
    if (!Number.isFinite(lastSeenMs) || Date.now() - lastSeenMs >= 15_000) {
      session.lastSeenAt = new Date().toISOString();
      if (session.status === "connected" || session.status === "paired") {
        session.expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
      }
      await store.saveStudioSession(session);
      if (session.userId) socketService.notifyUpdate(session.userId);
    }
    
    const changeSets = await store.fetchChangeSetsForProject(session.projectId);
    const pending = changeSets.filter(cs => cs.status === "ready_for_review");
    
    res.json({ changeSets: pending });
  });

  app.post("/studio/changes/:changeSetId/approve", async (req, res) => {
    const user = await requireUser(req, res);
    if (!user) return;
    const input = approveChangeSetSchema.parse(req.body ?? {});

    const owned = await ctx.requireOwnedChangeSet(user.id, req.params.changeSetId, res);
    if (!owned) return;

    const { organization, changeSet } = owned;
    let taskRun: StudioTaskRun | undefined;
    let approved = false;

    await ctx.orgLocks.run(organization.id, async () => {
      const latest = await store.fetchChangeSet(changeSet.id);
      if (!latest || latest.projectId !== changeSet.projectId) {
        res.status(404).json({ error: "Change set not found" });
        return;
      }
      if (latest.status !== "ready_for_review") {
        res.status(409).json({ error: "Only ready changes can be approved" });
        return;
      }

      const latestSnapshot = await store.fetchLatestSnapshot(latest.projectId);
      const latestFingerprint = snapshotFingerprint(latestSnapshot);
      const hasSnapshotConflict = Boolean(
        latest.baseSnapshotFingerprint
        && latestFingerprint
        && latest.baseSnapshotFingerprint !== latestFingerprint
      );
      if (hasSnapshotConflict && !input.ignoreSnapshotConflict) {
        res.status(409).json({
          error: "Studio changed since this patch was generated. Review the latest sync before applying.",
          code: "snapshot_conflict",
          message: "Studio has a newer synced state than the snapshot used for this patch.",
          changeSetId: latest.id,
          baseSnapshotId: latest.baseSnapshotId,
          baseSnapshotCreatedAt: latest.baseSnapshotCreatedAt,
          latestSnapshotId: latestSnapshot?.id,
          latestSnapshotCreatedAt: latestSnapshot?.createdAt,
          latestSnapshotNodeCount: latestSnapshot?.nodes.length,
          action: "regenerate_or_apply_anyway",
          actionLabel: "Review latest sync"
        });
        return;
      }

      latest.status = "approved_for_studio";
      latest.approvedWithSnapshotConflict = hasSnapshotConflict || undefined;
      latest.approvedByUserId = user.id;
      const session = (await store.fetchSessionsForProject(latest.projectId))
        .find((candidate) => candidate.status === "connected" || candidate.status === "paired");
      taskRun = await ensureStudioTaskRun(latest, session);
      await store.saveChangeSet(latest);
      Object.assign(changeSet, latest);
      approved = true;

      if (session) {
        await store.saveLog({
          id: `log_${nanoid()}`,
          studioSessionId: session.id,
          level: "info",
          message: `Change set approved for Studio: ${latest.title}`,
          createdAt: new Date().toISOString()
        });
      }
    });

    if (!approved) return;
    socketService.notifyUpdate(user.id);
    res.json({ changeSet, taskRun });
  });

  app.post("/studio/changes/:changeSetId/undo", async (req, res) => {
    const user = await requireUser(req, res);
    if (!user) return;

    const owned = await ctx.requireOwnedChangeSet(user.id, req.params.changeSetId, res);
    if (!owned) return;

    const { changeSet } = owned;
    if (changeSet.status !== "applied") {
      res.status(409).json({ error: "Only applied changes can be undone" });
      return;
    }

    const latestApplied = await latestAppliedChangeSetForProject(changeSet.projectId);
    if (!latestApplied || latestApplied.id !== changeSet.id) {
      res.status(409).json({ error: "Rollback newer applied changes first" });
      return;
    }

    changeSet.undoRequestedAt = new Date().toISOString();
    changeSet.undoFailedAt = undefined;
    await store.saveChangeSet(changeSet);
    socketService.notifyUpdate(user.id);

    const session = (await store.fetchSessionsForUser(user.id))[0];
    if (session) {
      await store.saveLog({
        id: `log_${nanoid()}`,
        studioSessionId: session.id,
        level: "info",
        message: `Undo requested for change set: ${changeSet.title}`,
        createdAt: new Date().toISOString()
      });
    }

    res.json({ changeSet });
  });

  app.post("/studio/changes/:changeSetId/dismiss", async (req, res) => {
    const user = await requireUser(req, res);
    if (!user) return;

    const owned = await ctx.requireOwnedChangeSet(user.id, req.params.changeSetId, res);
    if (!owned) return;

    const { organization, changeSet } = owned;
    let refundAmount = 0;
    let claimed = false;

    // Claim rejection under the org lock so concurrent dismissals cannot double-refund.
    await ctx.orgLocks.run(organization.id, async () => {
      const latest = await store.fetchChangeSet(changeSet.id);
      if (!latest || latest.projectId !== changeSet.projectId) {
        res.status(404).json({ error: "Change set not found" });
        return;
      }
      if (latest.status !== "ready_for_review") {
        res.status(409).json({ error: "Only ready changes can be dismissed" });
        return;
      }

      latest.status = "rejected";
      latest.dismissedByUserId = user.id;
      await store.saveChangeSet(latest);
      Object.assign(changeSet, latest);
      claimed = true;

      const assistantMsg = await store.fetchMessage(changeSet.aiMessageId);
      if (assistantMsg && assistantMsg.modelUsed) {
        const originalCost = assistantMsg.usageCostCredits ?? getCost(assistantMsg.modelUsed, "changeset", undefined, user.preferences, organization.plan, organization.billingCycle);
        refundAmount = Math.floor(originalCost * 0.5);
        if (refundAmount > 0) {
          await store.addCredits(organization.id, refundAmount, `Refund for rejected change set: ${changeSet.title}`);
        }
      }
    });

    if (!claimed) return;

    socketService.notifyUpdate(user.id);
    res.json({ changeSet, refundIssued: true, refundAmount });
  });

  app.post("/studio/sessions/:sessionId/resync", async (req, res) => {
    const user = await requireUser(req, res);
    if (!user) return;

    const session = await store.fetchStudioSession(req.params.sessionId);
    if (!session || session.userId !== user.id) {
      res.status(404).json({ error: "Studio session not found" });
      return;
    }

    session.resyncRequestedAt = new Date().toISOString();
    await store.saveStudioSession(session);
    res.json({ session });
  });

  app.post("/studio/task-runs/:taskRunId/cancel", async (req, res) => {
    const user = await requireUser(req, res);
    if (!user) return;

    const taskRun = await store.fetchStudioTaskRun(req.params.taskRunId);
    if (!taskRun) {
      res.status(404).json({ error: "Studio task run not found" });
      return;
    }
    const owned = await ctx.requireOwnedChangeSet(user.id, taskRun.changeSetId, res);
    if (!owned) return;
    if (["passed", "failed", "rolled_back", "cancelled"].includes(taskRun.status)) {
      res.status(409).json({ error: "Only active Studio tasks can be cancelled" });
      return;
    }

    const nowIso = new Date().toISOString();
    taskRun.status = "cancelled";
    taskRun.cancelledAt = nowIso;
    taskRun.updatedAt = nowIso;
    owned.changeSet.status = "rejected";
    await store.saveStudioTaskRun(taskRun);
    await store.saveChangeSet(owned.changeSet);
    socketService.notifyUpdate(user.id);
    res.json({ taskRun, changeSet: owned.changeSet });
  });

  app.post("/studio/sessions/:sessionId/disconnect", async (req, res) => {
    const user = await requireUser(req, res);
    if (!user) return;

    const session = await store.fetchStudioSession(req.params.sessionId);
    if (!session || session.userId !== user.id) {
      res.status(404).json({ error: "Studio session not found" });
      return;
    }

    session.status = "expired";
    session.disconnectedAt = new Date().toISOString();
    session.disconnectedBy = "web";
    session.disconnectReason = "Disconnected from Studio Bridge.";
    await store.saveStudioSession(session);
    socketService.notifyUpdate(user.id);

    await store.saveLog({
      id: `log_${nanoid()}`,
      studioSessionId: session.id,
      level: "info",
      message: "Studio session disconnected from web",
      createdAt: new Date().toISOString()
    });
    res.json({ session });
  });

  app.post("/studio/session/:sessionId/plugin-disconnect", async (req, res) => {
    const session = await expireStudioSessionIfNeeded(await store.fetchStudioSession(req.params.sessionId));
    const token = connectorTokenFromRequest(req, req.body?.connectorToken);
    
    if (!session || !activeConnectorTokenMatches(token, session)) {
      res.status(403).json({ error: "Invalid connector token" });
      return;
    }

    const nowIso = new Date().toISOString();
    session.status = "expired";
    session.lastSeenAt = nowIso;
    session.disconnectedAt = nowIso;
    session.disconnectedBy = "plugin";
    session.disconnectReason = "Plugin unlinked from Roblox Studio.";
    await store.saveStudioSession(session);
    if (session.userId) {
      socketService.notifyUpdate(session.userId);
    }
    await store.saveLog({
      id: `log_${nanoid()}`,
      studioSessionId: session.id,
      level: "info",
      message: "Studio session disconnected from plugin",
      createdAt: nowIso
    });
    res.json({ ok: true });
  });

  app.post("/studio/changes/:changeSetId/apply-result", async (req, res) => {
    const input = applyResultSchema.parse(req.body);
    const session = await expireStudioSessionIfNeeded(await store.fetchStudioSession(input.sessionId));
    const changeSet = await store.fetchChangeSet(req.params.changeSetId);

    if (!session || !activeConnectorTokenMatches(connectorTokenFromRequest(req, input.connectorToken), session)) {
      res.status(403).json({ error: "Invalid connector token" });
      return;
    }
    if (!changeSet || session.projectId !== changeSet.projectId) {
      res.status(404).json({ error: "Session or change set not found" });
      return;
    }

    // Serialize apply-result handling per project so concurrent plugin reports cannot
    // race past sticky terminal checks and flip applied <-> failed.
    let responseSent = false;
    await ctx.orgLocks.run(`changeset-apply:${changeSet.projectId}`, async () => {
      const latest = await store.fetchChangeSet(changeSet.id);
      if (!latest || latest.projectId !== changeSet.projectId) {
        res.status(404).json({ error: "Session or change set not found" });
        responseSent = true;
        return;
      }
      Object.assign(changeSet, latest);

      // Terminal apply states are sticky. Replayed or out-of-order reports must not
      // overwrite a successful apply with a later failure (or reverse a rejection).
      if (changeSet.status === "applied") {
        res.status(200).json({ duplicate: true, changeSet });
        responseSent = true;
        return;
      }
      if (changeSet.status === "failed" && input.status !== "applied") {
        res.status(200).json({ duplicate: true, changeSet });
        responseSent = true;
        return;
      }
      if (changeSet.status === "rejected" || changeSet.status === "undone") {
        res.status(409).json({
          error: `Cannot record apply result for a ${changeSet.status} change set`,
          changeSet
        });
        responseSent = true;
        return;
      }

      const result = {
        id: `res_${nanoid()}`,
        changeSetId: changeSet.id,
        studioSessionId: session.id,
        status: input.status,
        details: input.details,
        createdAt: new Date().toISOString()
      };
      await store.saveApplyResult(result);

      const taskRun = await ensureStudioTaskRun(changeSet, session);
      taskRun.status = input.status === "applied" ? "passed" : "failed";
      taskRun.updatedAt = new Date().toISOString();
      taskRun.completedAt = taskRun.updatedAt;
      if (input.status === "applied") taskRun.appliedAt = taskRun.updatedAt;
      if (input.verificationSummary) {
        taskRun.verificationSummary = input.verificationSummary;
      }
      await store.saveStudioTaskRun(taskRun);
      await saveStudioObservation({
        taskRunId: taskRun.id,
        studioSessionId: session.id,
        projectId: changeSet.projectId,
        kind: "apply_result",
        status: input.status === "applied" ? "passed" : "failed",
        summary: input.details || `Studio reported ${input.status}.`,
        details: { changeSetId: changeSet.id }
      });

      await store.saveLog({
        id: `log_${nanoid()}`,
        studioSessionId: session.id,
        level: input.status === "applied" ? "info" : "error",
        message: `Studio reported ${input.status} for change set: ${changeSet.title}`,
        createdAt: new Date().toISOString()
      });

      mergeApplyValidationActivity(changeSet, input.status, input.details);
      if (input.status === "applied") {
        changeSet.status = "applied";
        changeSet.appliedAt = new Date().toISOString();
      } else {
        changeSet.status = "failed";
      }
      await store.saveChangeSet(changeSet);

      if (changeSet.agentRunId) {
        const agentRun = await store.fetchAgentRun(changeSet.agentRunId);
        if (agentRun) {
          const at = new Date().toISOString();
          agentRun.studioTaskRunId = taskRun.id;
          agentRun.status = input.status === "applied" ? "completed" : "failed";
          agentRun.updatedAt = at;
          agentRun.completedAt = at;
          agentRun.steps.push({
            index: agentRun.steps.length,
            kind: "verification",
            status: input.status === "applied" ? "completed" : "failed",
            title: input.status === "applied" ? "Studio apply and verification completed" : "Studio apply failed",
            detail: input.details,
            completedAt: at
          });
          await store.saveAgentRun(agentRun);
          if (session.userId) {
            socketService.notifyAgentRunEvent(session.userId, changeSet.threadId, {
              type: input.status === "applied" ? "verification_completed" : "run_failed",
              runId: agentRun.id,
              at,
              detail: input.details
            });
          }
        }
      }
      if (session.userId) {
        socketService.notifyUpdate(session.userId);
      }

      res.status(201).json({ result, changeSet });
      responseSent = true;
    });

    if (!responseSent) {
      res.status(500).json({ error: "Failed to record apply result" });
    }
  });

  app.post("/studio/changes/:changeSetId/undo-result", async (req, res) => {
    const input = undoResultSchema.parse(req.body);
    const session = await expireStudioSessionIfNeeded(await store.fetchStudioSession(input.sessionId));
    const changeSet = await store.fetchChangeSet(req.params.changeSetId);

    if (!session || !activeConnectorTokenMatches(connectorTokenFromRequest(req, input.connectorToken), session)) {
      res.status(403).json({ error: "Invalid connector token" });
      return;
    }
    if (!changeSet || session.projectId !== changeSet.projectId) {
      res.status(404).json({ error: "Session or change set not found" });
      return;
    }

    await store.saveLog({
      id: `log_${nanoid()}`,
      studioSessionId: session.id,
      level: input.status === "undone" ? "info" : "error",
      message: `Studio reported ${input.status} for undo: ${changeSet.title}`,
      createdAt: new Date().toISOString()
    });

    if (input.status === "undone") {
      const taskRun = await ensureStudioTaskRun(changeSet, session);
      taskRun.status = "rolled_back";
      taskRun.updatedAt = new Date().toISOString();
      taskRun.rolledBackAt = taskRun.updatedAt;
      await store.saveStudioTaskRun(taskRun);
      await saveStudioObservation({
        taskRunId: taskRun.id,
        studioSessionId: session.id,
        projectId: changeSet.projectId,
        kind: "rollback_result",
        status: "passed",
        summary: input.details || "Studio restored the previous local state.",
        details: { changeSetId: changeSet.id }
      });
      changeSet.status = "undone";
      changeSet.undoneAt = new Date().toISOString();
      changeSet.undoRequestedAt = undefined;
      changeSet.undoFailedAt = undefined;
      changeSet.activity = [
        ...(changeSet.activity ?? []),
        {
          id: `act_${nanoid()}`,
          kind: "validate",
          label: "Rollback confirmed",
          status: "success",
          detail: input.details || "Studio restored the previous local state."
        }
      ];
      await store.saveChangeSet(changeSet);
      if (session.userId) {
        socketService.notifyUpdate(session.userId);
      }
      res.status(201).json({ ok: true, changeSet });
      return;
    }

    changeSet.undoFailedAt = new Date().toISOString();
    const taskRun = await ensureStudioTaskRun(changeSet, session);
    taskRun.updatedAt = new Date().toISOString();
    await store.saveStudioTaskRun(taskRun);
    await saveStudioObservation({
      taskRunId: taskRun.id,
      studioSessionId: session.id,
      projectId: changeSet.projectId,
      kind: "rollback_result",
      status: "failed",
      summary: input.details || "Studio could not complete the rollback.",
      details: { changeSetId: changeSet.id }
    });
    changeSet.activity = [
      ...(changeSet.activity ?? []),
      {
        id: `act_${nanoid()}`,
        kind: "validate",
        label: "Rollback failed",
        status: "failed",
        detail: input.details || "Studio could not complete the rollback."
      }
    ];
    await store.saveChangeSet(changeSet);
    if (session.userId) {
      socketService.notifyUpdate(session.userId);
    }
    res.status(201).json({ ok: false, changeSet });
  });

  app.post("/studio/logs", async (req, res) => {
    const isArray = Array.isArray(req.body);
    const bodyArray = isArray ? req.body : [req.body];
    
    if (bodyArray.length === 0) {
      res.json({ logs: [] });
      return;
    }

    const firstLog = bodyArray[0];
    const session = await expireStudioSessionIfNeeded(await store.fetchStudioSession(firstLog.sessionId));
    
    if (!session || !activeConnectorTokenMatches(connectorTokenFromRequest(req, firstLog.connectorToken), session)) {
      res.status(403).json({ error: "Invalid connector token" });
      return;
    }

    const savedLogs = [];
    for (const logInput of bodyArray) {
      const input = studioLogSchema.parse(logInput);
      const log = await store.saveLog({
        id: `log_${nanoid()}`,
        studioSessionId: session.id,
        level: input.level,
        message: input.message,
        createdAt: new Date().toISOString()
      });
      savedLogs.push(log);
      
      if (input.taskRunId) {
        const taskRun = await store.fetchStudioTaskRun(input.taskRunId);
        if (taskRun && taskRun.projectId === session.projectId) {
          await saveStudioObservation({
            taskRunId: taskRun.id,
            studioSessionId: session.id,
            projectId: taskRun.projectId,
            kind: "runtime_log",
            status: input.level === "error" ? "failed" : input.level === "warn" ? "warning" : "info",
            summary: input.message,
            details: { level: input.level }
          });
        }
      }
    }
    
    res.status(201).json(isArray ? { logs: savedLogs } : { log: savedLogs[0] });
  });

  app.post("/studio/task-runs/:taskRunId/observations", async (req, res) => {
    const input = studioObservationSchema.parse(req.body);
    const session = await expireStudioSessionIfNeeded(await store.fetchStudioSession(input.sessionId));
    const taskRun = await store.fetchStudioTaskRun(req.params.taskRunId);

    if (!session || !activeConnectorTokenMatches(connectorTokenFromRequest(req, input.connectorToken), session)) {
      res.status(403).json({ error: "Invalid connector token" });
      return;
    }
    if (!taskRun || taskRun.projectId !== session.projectId) {
      res.status(404).json({ error: "Studio task run not found" });
      return;
    }

    const observation = await saveStudioObservation({
      taskRunId: taskRun.id,
      studioSessionId: session.id,
      projectId: taskRun.projectId,
      kind: input.kind,
      status: input.status,
      summary: input.summary,
      details: input.details
    });
    taskRun.updatedAt = new Date().toISOString();
    await store.saveStudioTaskRun(taskRun);
    if (session.userId) socketService.notifyUpdate(session.userId);
    res.status(201).json({ observation, taskRun });
  });

  app.post("/studio/task-runs/:taskRunId/screenshots", express.raw({ type: "*/*", limit: "5mb" }), async (req, res, next) => {
    try {
      const sessionId = String(req.query.sessionId ?? "");
      const token = connectorTokenFromRequest(req, req.query.connectorToken);
      const session = await expireStudioSessionIfNeeded(await store.fetchStudioSession(sessionId));
      const taskRun = await store.fetchStudioTaskRun(req.params.taskRunId);

      if (!session || !activeConnectorTokenMatches(token, session)) {
        res.status(403).json({ error: "Invalid connector token" });
        return;
      }
      if (!taskRun || !session.projectId || taskRun.projectId !== session.projectId) {
        res.status(404).json({ error: "Studio task run not found" });
        return;
      }
      if (!session.userId || ["cancelled", "rolled_back"].includes(taskRun.status)) {
        res.status(409).json({ error: "Studio task run is no longer available for visual QA" });
        return;
      }

      const organization = await store.fetchOrganizationForUser(session.userId);
      if (!organization) {
        res.status(409).json({ error: "Studio session is not linked to an organization" });
        return;
      }

      const bytes = Buffer.isBuffer(req.body) ? req.body : Buffer.from([]);
      if (bytes.length > MAX_STUDIO_SCREENSHOT_BYTES) {
        res.status(413).json({ error: "Studio screenshots are limited to 5 MB." });
        return;
      }
      const detected = studioScreenshotAsset(bytes);
      const validated = validateUploadedAsset({
        fileName: `studio-${taskRun.id}-${Date.now()}.${detected.extension}`,
        mimeType: detected.mimeType,
        bytes
      });
      const attachment = await persistAttachmentBytes({
        organizationId: organization.id,
        projectId: taskRun.projectId,
        userId: session.userId,
        source: "studio_screenshot",
        fileName: validated.fileName,
        mimeType: validated.mimeType,
        bytes
      });
      await store.saveAttachment(attachment);

      const visualInspectionModel = defaultVisualInspectionModel();
      const observation = await saveStudioObservation({
        taskRunId: taskRun.id,
        studioSessionId: session.id,
        projectId: taskRun.projectId,
        kind: "screenshot",
        status: "info",
        summary: "Studio Bridge captured a viewport screenshot for optional visual QA.",
        details: {
          attachmentId: attachment.id,
          mimeType: attachment.mimeType,
          sizeBytes: attachment.sizeBytes,
          captureFormat: String(req.headers["x-screenshot-format"] ?? ""),
          visualInspectionModel
        }
      });
      taskRun.studioSessionId = session.id;
      taskRun.visualQa = visualInspectionModel ? "available" : "skipped_no_provider";
      taskRun.updatedAt = new Date().toISOString();
      await store.saveStudioTaskRun(taskRun);
      socketService.notifyUpdate(session.userId);
      await ctx.recordEvidence(req, {
        userId: session.userId,
        organizationId: organization.id,
        projectId: taskRun.projectId,
        threadId: taskRun.threadId,
        type: "studio",
        action: "screenshot_capture",
        status: "ok",
        metadata: {
          taskRunId: taskRun.id,
          attachmentId: attachment.id,
          mimeType: attachment.mimeType,
          sizeBytes: attachment.sizeBytes,
          visualInspectionModel
        }
      });
      res.status(201).json({
        attachment: {
          id: attachment.id,
          fileName: attachment.fileName,
          mimeType: attachment.mimeType,
          sizeBytes: attachment.sizeBytes
        },
        observation,
        taskRun
      });
    } catch (error) {
      if (isAttachmentStorageUnavailableError(error)) {
        res.status(503).json({ error: error.message });
        return;
      }
      if (error instanceof Error && error.message === "Studio screenshots must contain PNG or JPEG image bytes.") {
        res.status(400).json({ error: error.message });
        return;
      }
      next(error);
    }
  });

  app.post("/studio/task-runs/:taskRunId/status", async (req, res) => {
    const input = studioTaskStatusSchema.parse(req.body);
    const session = await expireStudioSessionIfNeeded(await store.fetchStudioSession(input.sessionId));
    const taskRun = await store.fetchStudioTaskRun(req.params.taskRunId);

    if (!session || !activeConnectorTokenMatches(connectorTokenFromRequest(req, input.connectorToken), session)) {
      res.status(403).json({ error: "Invalid connector token" });
      return;
    }
    if (!taskRun || taskRun.projectId !== session.projectId) {
      res.status(404).json({ error: "Studio task run not found" });
      return;
    }
    if (taskRun.status === "cancelled" || taskRun.status === "rolled_back") {
      res.status(409).json({ error: "Studio task run is no longer active" });
      return;
    }

    taskRun.status = input.status;
    taskRun.studioSessionId = session.id;
    taskRun.updatedAt = new Date().toISOString();
    await store.saveStudioTaskRun(taskRun);
    if (session.userId) socketService.notifyUpdate(session.userId);
    res.json({ taskRun });
  });

  app.post("/projects/:projectId/studio/pair-project", ctx.studioClaimLimiter, async (req, res) => {
    const user = await requireUser(req, res);
    if (!user) return;

    const input = claimPairSchema.parse(req.body);
    if (pairingClaimLocked(req, input.pairingCode)) {
      res.status(404).json({ error: "Pairing code not found or already claimed" });
      return;
    }
    const projectId = String(req.params.projectId);
    const project = await store.fetchProject(projectId);
    const org = await store.fetchOrganizationForUser(user.id);
    
    if (!project || project.organizationId !== org?.id) {
      res.status(404).json({ error: "Project not found" });
      return;
    }

    const session = await store.findStudioSessionByPairingCode(input.pairingCode);
    if (!session) {
      recordPairingClaimMiss(req, input.pairingCode);
      res.status(404).json({ error: "Pairing code not found or already claimed" });
      return;
    }
    clearPairingClaimMisses(req, input.pairingCode);

    session.projectId = project.id;
    session.userId = user.id;
    session.status = "connected";
    session.pairingCode = undefined;
    session.pairedAt = new Date().toISOString();
    session.lastSeenAt = new Date().toISOString();
    session.expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
    session.disconnectedAt = undefined;
    session.disconnectedBy = undefined;
    session.disconnectReason = undefined;
    rotateConnectorToken(session, true);
    
    await store.saveStudioSession(session);
    socketService.notifyUpdate(user.id);
    
    res.json({ session });
  });
}
