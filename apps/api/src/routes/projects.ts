import express from "express";
import { createHash, randomUUID } from "node:crypto";
import {
  createProjectSchema,
  generatedIconSchema,
  createThreadSchema,
  deleteThreadsSchema,
  marketplaceSearchSchema,
  updateProjectSchema,
  updateThreadSchema,
  editTaskPlanSchema,
  approveTaskPlanSchema,
  createCommentSchema
} from "../schemas.js";
import { generateSafeChangeSet } from "../services/aiProvider.js";
import { generateDeterministicReviewReport } from "../services/reviewReport.js";
import { currentUser, requireUser } from "../services/auth.js";
import { createLogger } from "../services/logger.js";
import {
  config,
  GENERATED_ICON_COST_CREDITS,
  defaultAiModel
} from "../services/config.js";
import { publicAiMessages } from "../services/publicMessages.js";
import { planFor } from "../services/plans.js";
import { searchRobloxMarketplace } from "../services/marketplace.js";
import {
  generateTransparentIcon,
  getAttachmentSignedUrl,
  isAttachmentStorageUnavailableError,
  persistAttachmentBytes,
  readAttachmentBytes,
  validateUploadedAsset
} from "../services/assets.js";
import type { RouteContext } from "../routeContext.js";
import type { AiMessage, Attachment, ChangeSet, ProjectSnapshot, SnapshotNode, StudioObservation, StudioSession, StudioTaskRun, Thread, TaskPlan, PatchComment } from "../types.js";

const STUDIO_SESSION_STALE_MS = 300 * 1000;

function generatedIconCapacityPayload(planName: string | undefined, creditBalance: number) {
  const plan = planFor(planName);
  const canTopUp = plan.topUps;
  return {
    error: "Usage limit reached",
    code: "usage_limit_reached",
    title: "Usage limit reached",
    message: canTopUp
      ? "Not enough weekly usage for a generated transparent icon. Wait for the next refill or add a Studio usage pack."
      : "Not enough weekly usage for a generated transparent icon. Wait for the next refill or upgrade for more weekly usage.",
    plan: plan.name,
    planLabel: plan.label,
    canTopUp,
    action: canTopUp ? "top_up" : "upgrade",
    actionLabel: canTopUp ? "Add Studio usage" : "Upgrade plan",
    creditBalance: Math.max(0, creditBalance),
    requiredCredits: GENERATED_ICON_COST_CREDITS
  };
}

const CHAT_TITLE_STOP_WORDS = new Set([
  "a",
  "an",
  "and",
  "are",
  "can",
  "for",
  "from",
  "i",
  "in",
  "is",
  "it",
  "me",
  "my",
  "of",
  "on",
  "please",
  "the",
  "this",
  "to",
  "with",
  "you",
  "what",
  "how",
  "why",
  "should",
  "would",
  "do"
]);

const periodicEvidenceLastSeen = new Map<string, number>();

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

async function expireStaleStudioSessions(sessions: StudioSession[], ctx: RouteContext) {
  // Let the session status remain connected/paired. We only expire sessions when their 7-day expiresAt TTL is reached.
  return sessions;
}

function shouldRecordPeriodicEvidence(key: string, intervalMs = 5 * 60 * 1000) {
  const nowMs = Date.now();
  const lastSeen = periodicEvidenceLastSeen.get(key) ?? 0;
  if (nowMs - lastSeen < intervalMs) return false;
  periodicEvidenceLastSeen.set(key, nowMs);
  return true;
}

async function reuseBlankThreadIfAvailable(projectId: string, userId: string, ctx: RouteContext) {
  const threads = await ctx.store.fetchThreadsForProject(projectId);
  const defaultThreads = threads.filter((thread) => thread.userId === userId && isDefaultThreadName(thread.name));
  const checked = await Promise.all(
    defaultThreads.map(async (thread) => ({
      thread,
      messages: await ctx.store.fetchMessagesForThread(thread.id)
    }))
  );

  const emptyThreads: Thread[] = [];
  for (const item of checked) {
    const firstUserMessage = item.messages.find((message) => message.role === "user" && message.content.trim());
    if (firstUserMessage) {
      item.thread.name = chatNameFromPrompt(firstUserMessage.content);
      await ctx.store.saveThread(item.thread);
    } else {
      emptyThreads.push(item.thread);
    }
  }

  emptyThreads.sort((a, b) => {
    const bTime = b.updatedAt || b.createdAt;
    const aTime = a.updatedAt || a.createdAt;
    const diff = bTime.localeCompare(aTime);
    return diff !== 0 ? diff : b.id.localeCompare(a.id);
  });

  const [reusable, ...duplicates] = emptyThreads;
  await Promise.all(duplicates.map((thread) => ctx.store.deleteThread(thread.id)));
  return reusable;
}

function promptDigest(prompt: string) {
  return createHash("sha256").update(prompt).digest("hex");
}

function isAdminUser(user: { email?: string; authProvider?: string }) {
  return Boolean(
    (user.email && config.adminEmails.includes(user.email.toLowerCase().trim()))
    || (process.env.VECTIS_VISUAL_ADMIN === "true" && config.allowPrivateOwnerLogin && user.authProvider === "private")
  );
}

function visibleWorkspaceAttachments(attachments: Attachment[]) {
  return attachments.filter((attachment) => attachment.source !== "studio_screenshot");
}

function publicProjectSnapshots(snapshots: ProjectSnapshot[]): ProjectSnapshot[] {
  if (process.env.NODE_ENV === "test") {
    return snapshots;
  }
  return snapshots.map((s) => ({
    ...s,
    nodes: s.nodes.map((n: SnapshotNode) => ({
      path: n.path,
      className: n.className
    }))
  }));
}

function userProjectRecords(input: {
  userId: string;
  threads: Thread[];
  changeSets: ChangeSet[];
  messages: AiMessage[];
  attachments: Attachment[];
  studioTaskRuns: StudioTaskRun[];
  studioObservations: StudioObservation[];
}) {
  const threads = input.threads.filter((thread) => thread.userId === input.userId);
  const visibleThreadIds = new Set(threads.map((thread) => thread.id));
  const changeSets = input.changeSets.filter((changeSet) => visibleThreadIds.has(changeSet.threadId));
  const visibleChangeSetIds = new Set(changeSets.map((changeSet) => changeSet.id));
  const messages = input.messages.filter((message) => visibleThreadIds.has(message.threadId));
  const attachments = input.attachments.filter((attachment) =>
    attachment.userId === input.userId
    && (!attachment.threadId || visibleThreadIds.has(attachment.threadId))
  );
  const studioTaskRuns = input.studioTaskRuns.filter((taskRun) =>
    visibleThreadIds.has(taskRun.threadId) || visibleChangeSetIds.has(taskRun.changeSetId)
  );
  const visibleTaskRunIds = new Set(studioTaskRuns.map((taskRun) => taskRun.id));
  const studioObservations = input.studioObservations.filter((observation) => visibleTaskRunIds.has(observation.taskRunId));

  return { threads, changeSets, messages, attachments, studioTaskRuns, studioObservations };
}

export function registerProjectRoutes(app: express.Express, ctx: RouteContext) {
  app.get("/bootstrap", async (_req, res) => {
    await ctx.store.ready();
    const user = await currentUser(_req);
    const exclude = typeof _req.query.exclude === "string" ? _req.query.exclude.split(",") : [];
    const excludeSnapshots = exclude.includes("snapshots");
    const excludeLogs = exclude.includes("logs");
    if (!user) {
      res.status(401).json({ error: "Authentication required" });
      return;
    }

    const organization = await ctx.store.fetchOrganizationForUser(user.id);
    if (!organization) {
      res.status(500).json({ error: "No organization found for user" });
      return;
    }

    await ctx.store.checkWeeklyRefill(organization.id);

    const [projects, rawSessions] = await Promise.all([
      ctx.store.fetchProjectsForOrganization(organization.id),
      ctx.store.fetchSessionsForUser(user.id)
    ]);
    const sessions = await expireStaleStudioSessions(rawSessions, ctx);

    const projectPromises = projects.map(async (project) => {
      const [pThreads, pChangeSets, pMessages, pSnapshot, pAttachments, pStudioTaskRuns, pStudioObservations, pTaskPlans, pComments] = await Promise.all([
        ctx.store.fetchThreadsForProject(project.id),
        ctx.store.fetchChangeSetsForProject(project.id),
        ctx.store.fetchMessagesForProject(project.id),
        excludeSnapshots ? Promise.resolve(null) : ctx.store.fetchLatestSnapshot(project.id),
        ctx.store.fetchAttachmentsForProject(project.id),
        ctx.store.fetchStudioTaskRunsForProject(project.id),
        ctx.store.fetchStudioObservationsForProject(project.id),
        ctx.store.fetchAllDocs<any>("taskPlans"),
        ctx.store.fetchAllDocs<any>("patchComments")
      ]);
      const scoped = userProjectRecords({
        userId: user.id,
        threads: pThreads,
        changeSets: pChangeSets,
        messages: pMessages,
        attachments: pAttachments,
        studioTaskRuns: pStudioTaskRuns,
        studioObservations: pStudioObservations
      });
      return {
        pThreads: scoped.threads,
        pChangeSets: scoped.changeSets,
        pMessages: scoped.messages,
        pSnapshot,
        pAttachments: scoped.attachments,
        pStudioTaskRuns: scoped.studioTaskRuns,
        pStudioObservations: scoped.studioObservations,
        pTaskPlans: pTaskPlans.filter((p: any) => p.projectId === project.id),
        pComments: pComments.filter((c: any) => c.projectId === project.id)
      };
    });

    const sessionPromises = sessions.map(async (session) => {
      if (excludeLogs) return [];
      const sLogs = await ctx.store.fetchLogsForSession(session.id);
      return sLogs;
    });

    const [
      projectResults,
      sessionResults,
      ledger,
      creditBalance,
      usage
    ] = await Promise.all([
      Promise.all(projectPromises),
      Promise.all(sessionPromises),
      ctx.store.fetchLedgerForOrganization(organization.id),
      ctx.store.getCreditBalance(organization.id),
      ctx.store.getUsageStats(organization.id)
    ]);

    const threads: Thread[] = [];
    const changeSets: ChangeSet[] = [];
    const messages: AiMessage[] = [];
    const snapshots: NonNullable<Awaited<ReturnType<typeof ctx.store.fetchLatestSnapshot>>>[] = [];
    const attachments: Attachment[] = [];
    const studioTaskRuns: StudioTaskRun[] = [];
    const studioObservations: StudioObservation[] = [];
    const taskPlans: any[] = [];
    const patchComments: any[] = [];
    for (const res of projectResults) {
      threads.push(...res.pThreads);
      changeSets.push(...res.pChangeSets);
      messages.push(...res.pMessages);
      attachments.push(...res.pAttachments);
      studioTaskRuns.push(...res.pStudioTaskRuns);
      studioObservations.push(...res.pStudioObservations);
      if (res.pSnapshot) snapshots.push(res.pSnapshot);
      taskPlans.push(...res.pTaskPlans);
      patchComments.push(...res.pComments);
    }

    const logs = [];
    for (const res of sessionResults) {
      logs.push(...res);
    }

    const deletedBlankThreadIds = new Set<string>();
    await Promise.all(
      threads.map(async (thread) => {
        if (!isDefaultThreadName(thread.name)) return;
        const firstUserMessage = messages.find((message) => message.threadId === thread.id && message.role === "user" && message.content.trim());
        if (!firstUserMessage) return;
        thread.name = chatNameFromPrompt(firstUserMessage.content);
        await ctx.store.saveThread(thread);
      })
    );

    for (const project of projects) {
      const blankThreads = threads
        .filter((thread) => thread.projectId === project.id && isDefaultThreadName(thread.name))
        .filter((thread) => !messages.some((message) => message.threadId === thread.id));
      blankThreads.sort((a, b) => {
        const bTime = b.updatedAt || b.createdAt;
        const aTime = a.updatedAt || a.createdAt;
        const diff = bTime.localeCompare(aTime);
        return diff !== 0 ? diff : b.id.localeCompare(a.id);
      });
      for (const blankThread of blankThreads) {
        deletedBlankThreadIds.add(blankThread.id);
        await ctx.store.deleteThread(blankThread.id);
      }
    }

    const visibleThreads = threads.filter((thread) => !deletedBlankThreadIds.has(thread.id));
    const visibleMessages = messages.filter((message) => !deletedBlankThreadIds.has(message.threadId));
    const visibleChangeSets = changeSets.filter((changeSet) => !changeSet.threadId || !deletedBlankThreadIds.has(changeSet.threadId));
    const visibleAttachments = visibleWorkspaceAttachments(attachments)
      .filter((attachment) => !attachment.threadId || !deletedBlankThreadIds.has(attachment.threadId));

    if (shouldRecordPeriodicEvidence(`${user.id}:workspace_bootstrap`)) {
      void ctx.recordEvidence(_req, {
        userId: user.id,
        organizationId: organization.id,
        type: "usage",
        action: "workspace_bootstrap",
        status: "ok",
        stripeCustomerId: organization.stripeCustomerId,
        stripeSubscriptionId: organization.stripeSubscriptionId,
        metadata: {
          plan: organization.plan,
          creditBalance,
          weeklyAllowance: usage.weekly.allowance,
          weeklyRemaining: usage.weekly.remaining,
          monthlyAllowance: usage.monthly.allowance,
          monthlyUsed: usage.monthly.used,
          monthlyRemaining: usage.monthly.remaining,
          projectCount: projects.length,
          threadCount: visibleThreads.length,
          messageCount: visibleMessages.length,
          attachmentCount: visibleAttachments.length,
          studioSessionCount: sessions.length,
          activeStudioSessions: sessions.filter((session) => session.status === "connected" || session.status === "paired").length
        }
      }).catch((error) => {
        const log = createLogger({ service: "projects" });
        log.warn("Could not record bootstrap evidence", { error: String(error) });
      });
    }

    res.json({
      user,
      organization,
      creditBalance,
      usage,
      projects,
      sessions,
      threads: visibleThreads,
      changeSets: visibleChangeSets,
      messages: publicAiMessages(visibleMessages),
      attachments: visibleAttachments,
      snapshots: excludeSnapshots ? undefined : publicProjectSnapshots(snapshots),
      logs: excludeLogs ? undefined : logs,
      studioTaskRuns,
      studioObservations,
      ledger,
      isAdmin: isAdminUser(user),
      users: [],
      taskPlans,
      patchComments
    });
  });

  app.get("/roblox/marketplace/search", ctx.marketplaceLimiter, async (req, res, next) => {
    try {
      const user = await requireUser(req, res);
      if (!user) return;

      const input = marketplaceSearchSchema.parse(req.query);
      const results = await searchRobloxMarketplace(input);
      res.json({
        results,
        note: "Use these reviewed asset IDs as inputs for import_asset operations, then generate custom code around them."
      });
    } catch (error) {
      next(error);
    }
  });

  app.post("/projects", async (req, res) => {
    const user = await requireUser(req, res);
    if (!user) return;

    const input = createProjectSchema.parse(req.body);
    const organization = await ctx.store.fetchOrganizationForUser(user.id);
    if (!organization) {
      res.status(500).json({ error: "No organization found for user" });
      return;
    }
    const projects = await ctx.store.fetchProjectsForOrganization(organization.id);

    const plan = planFor(organization.plan);
    if (projects.length >= plan.maxProjects) {
      res.status(402).json({
        error: `${plan.label} includes ${plan.maxProjects} project${plan.maxProjects === 1 ? "" : "s"}. Upgrade for more projects.`
      });
      return;
    }

    const project = await ctx.store.saveProject({
      id: await ctx.store.createUniqueId("projects", "project_", 18),
      organizationId: organization.id,
      ...input,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    });
    res.status(201).json({ project });
  });

  app.patch("/projects/:projectId", async (req, res) => {
    const user = await requireUser(req, res);
    if (!user) return;

    const input = updateProjectSchema.parse(req.body);
    const project = await ctx.store.fetchProject(req.params.projectId);
    const org = await ctx.store.fetchOrganizationForUser(user.id);
    
    if (!project || project.organizationId !== org?.id) {
      res.status(404).json({ error: "Project not found" });
      return;
    }

    if (input.name !== undefined) project.name = input.name;
    if (input.description !== undefined) project.description = input.description;
    const updated = await ctx.store.saveProject(project);
    res.json({ project: updated });
  });

  app.delete("/projects/:projectId", async (req, res) => {
    const user = await requireUser(req, res);
    if (!user) return;

    const project = await ctx.store.fetchProject(req.params.projectId);
    const org = await ctx.store.fetchOrganizationForUser(user.id);
    
    if (!project || project.organizationId !== org?.id) {
      res.status(404).json({ error: "Project not found" });
      return;
    }

    await ctx.store.deleteProject(project.id);
    res.json({ ok: true });
  });

  app.get("/projects/:projectId", async (req, res) => {
    const user = await requireUser(req, res);
    if (!user) return;

    const project = await ctx.store.fetchProject(req.params.projectId);
    const org = await ctx.store.fetchOrganizationForUser(user.id);
    
    if (!project || project.organizationId !== org?.id) {
      res.status(404).json({ error: "Project not found" });
      return;
    }

    const [threads, changeSets, messages, attachments, studioTaskRuns, studioObservations] = await Promise.all([
      ctx.store.fetchThreadsForProject(project.id),
      ctx.store.fetchChangeSetsForProject(project.id),
      ctx.store.fetchMessagesForProject(project.id),
      ctx.store.fetchAttachmentsForProject(project.id),
      ctx.store.fetchStudioTaskRunsForProject(project.id),
      ctx.store.fetchStudioObservationsForProject(project.id)
    ]);
    const scoped = userProjectRecords({
      userId: user.id,
      threads,
      changeSets,
      messages,
      attachments,
      studioTaskRuns,
      studioObservations
    });

    const latestSnapshot = await ctx.store.fetchLatestSnapshot(project.id);
    res.json({
      project,
      latestSnapshot: latestSnapshot ? publicProjectSnapshots([latestSnapshot])[0] : undefined,
      threads: scoped.threads,
      changeSets: scoped.changeSets,
      messages: publicAiMessages(scoped.messages),
      attachments: visibleWorkspaceAttachments(scoped.attachments),
      studioTaskRuns: scoped.studioTaskRuns,
      studioObservations: scoped.studioObservations
    });
  });

  app.get("/projects/:projectId/attachments", async (req, res) => {
    const user = await requireUser(req, res);
    if (!user) return;

    const owned = await ctx.requireOwnedProject(user.id, String(req.params.projectId), res);
    if (!owned) return;

    const attachments = await ctx.store.fetchAttachmentsForProject(owned.project.id);
    res.json({ attachments: visibleWorkspaceAttachments(attachments.filter((attachment) => attachment.userId === user.id)) });
  });

  app.post("/projects/:projectId/attachments", express.raw({ type: "*/*", limit: "10mb" }), async (req, res, next) => {
    try {
      const user = await requireUser(req, res);
      if (!user) return;

      const owned = await ctx.requireOwnedProject(user.id, String(req.params.projectId), res);
      if (!owned) return;

      const fileNameHeader = String(req.headers["x-file-name"] ?? "attachment");
      const fileName = decodeURIComponent(fileNameHeader);
      const threadId = typeof req.headers["x-thread-id"] === "string" && req.headers["x-thread-id"].trim()
        ? req.headers["x-thread-id"].trim()
        : undefined;
      if (threadId) {
        const thread = await ctx.store.fetchThread(threadId);
        if (!thread || thread.projectId !== owned.project.id || thread.userId !== user.id) {
          res.status(404).json({ error: "Thread not found" });
          return;
        }
      }

      const bytes = Buffer.isBuffer(req.body) ? req.body : Buffer.from([]);
      let validated: ReturnType<typeof validateUploadedAsset>;
      try {
        validated = validateUploadedAsset({
          fileName,
          mimeType: req.headers["content-type"] ? String(req.headers["content-type"]) : "application/octet-stream",
          bytes
        });
      } catch (error) {
        res.status(400).json({ error: error instanceof Error ? error.message : "Unsupported attachment." });
        return;
      }
      let attachment: Attachment;
      try {
        attachment = await persistAttachmentBytes({
          organizationId: owned.organization.id,
          projectId: owned.project.id,
          threadId,
          userId: user.id,
          source: "upload",
          fileName: validated.fileName,
          mimeType: validated.mimeType,
          bytes,
          inlineText: validated.kind === "text" ? bytes.toString("utf8").slice(0, 80_000) : undefined
        });
      } catch (error) {
        if (isAttachmentStorageUnavailableError(error)) {
          res.status(503).json({ error: error.message });
          return;
        }
        throw error;
      }
      await ctx.store.saveAttachment(attachment);
      await ctx.recordEvidence(req, {
        userId: user.id,
        organizationId: owned.organization.id,
        projectId: owned.project.id,
        threadId,
        type: "attachment",
        action: "upload",
        status: "ok",
        metadata: {
          attachmentId: attachment.id,
          fileName: attachment.fileName,
          mimeType: attachment.mimeType,
          sizeBytes: attachment.sizeBytes
        }
      });
      res.status(201).json({ attachment });
    } catch (error) {
      next(error);
    }
  });

  app.get("/projects/:projectId/attachments/:attachmentId/content", async (req, res, next) => {
    try {
      const user = await requireUser(req, res);
      if (!user) return;

      const owned = await ctx.requireOwnedProject(user.id, String(req.params.projectId), res);
      if (!owned) return;

      const attachment = await ctx.store.fetchAttachment(req.params.attachmentId);
      if (!attachment || attachment.organizationId !== owned.organization.id || attachment.projectId !== owned.project.id || attachment.userId !== user.id) {
        res.status(404).json({ error: "Attachment not found" });
        return;
      }

      if (attachment.storagePath && attachment.storagePath.startsWith("supabase://")) {
        const signedUrl = await getAttachmentSignedUrl(attachment, 300);
        if (signedUrl) {
          res.setHeader("Cache-Control", "no-store");
          res.redirect(307, signedUrl);
          return;
        }
      }

      const bytes = await readAttachmentBytes(attachment);
      if (!bytes) {
        res.status(404).json({ error: "Attachment content not found" });
        return;
      }

      const disposition = req.query.download === "1" ? "attachment" : "inline";
      res.setHeader("Content-Type", attachment.mimeType);
      res.setHeader("Content-Disposition", `${disposition}; filename="${attachment.fileName.replace(/"/g, "")}"`);
      res.setHeader("Cache-Control", "private, no-store");
      res.send(bytes);
    } catch (error) {
      next(error);
    }
  });

  app.delete("/projects/:projectId/attachments/:attachmentId", async (req, res, next) => {
    try {
      const user = await requireUser(req, res);
      if (!user) return;

      const owned = await ctx.requireOwnedProject(user.id, String(req.params.projectId), res);
      if (!owned) return;

      const attachment = await ctx.store.fetchAttachment(req.params.attachmentId);
      if (!attachment || attachment.organizationId !== owned.organization.id || attachment.projectId !== owned.project.id || attachment.userId !== user.id) {
        res.status(404).json({ error: "Attachment not found" });
        return;
      }

      await ctx.store.deleteAttachment(attachment.id);
      await ctx.recordEvidence(req, {
        userId: user.id,
        organizationId: owned.organization.id,
        projectId: owned.project.id,
        threadId: attachment.threadId,
        type: "attachment",
        action: "delete",
        status: "ok",
        metadata: {
          attachmentId: attachment.id,
          fileName: attachment.fileName
        }
      });
      res.json({ ok: true });
    } catch (error) {
      next(error);
    }
  });

  app.post("/projects/:projectId/generated-icons", ctx.aiLimiter, async (req, res, next) => {
    try {
      const user = await requireUser(req, res);
      if (!user) return;

      const input = generatedIconSchema.parse(req.body);
      const owned = await ctx.requireOwnedProject(user.id, String(req.params.projectId), res);
      if (!owned) return;

      if (!["pro", "studio"].includes(owned.organization.plan)) {
        res.status(403).json({ error: "Generated transparent icons require Pro or Studio." });
        return;
      }

      if (input.threadId) {
        const thread = await ctx.store.fetchThread(input.threadId);
        if (!thread || thread.projectId !== owned.project.id || thread.userId !== user.id) {
          res.status(404).json({ error: "Thread not found" });
          return;
        }
      }

      const currentBalance = await ctx.store.getCreditBalance(owned.organization.id);
      if (currentBalance < GENERATED_ICON_COST_CREDITS) {
        res.status(402).json(generatedIconCapacityPayload(owned.organization.plan, currentBalance));
        return;
      }

      const debit = await ctx.store.tryDeductCredits(
        owned.organization.id,
        GENERATED_ICON_COST_CREDITS,
        `Generated transparent icon: ${promptDigest(input.prompt).slice(0, 12)}`
      );
      if (!debit.ok) {
        const latestBalance = await ctx.store.getCreditBalance(owned.organization.id);
        res.status(402).json(generatedIconCapacityPayload(owned.organization.plan, latestBalance));
        return;
      }

      let charged = true;
      try {
        const imageBytes = await generateTransparentIcon(input.prompt);
        const safeStem = input.prompt.replace(/[^a-z0-9]+/gi, "-").replace(/^-+|-+$/g, "").slice(0, 42) || "generated-icon";
        const attachment = await persistAttachmentBytes({
          organizationId: owned.organization.id,
          projectId: owned.project.id,
          threadId: input.threadId,
          userId: user.id,
          source: "generated_icon",
          fileName: `${safeStem}.png`,
          mimeType: "image/png",
          bytes: imageBytes,
          prompt: input.prompt,
          creditsCharged: GENERATED_ICON_COST_CREDITS
        });
        await ctx.store.saveAttachment(attachment);
        await ctx.recordEvidence(req, {
          userId: user.id,
          organizationId: owned.organization.id,
          projectId: owned.project.id,
          threadId: input.threadId,
          type: "image_generation",
          action: "generated_transparent_icon",
          status: "ok",
          amountCredits: GENERATED_ICON_COST_CREDITS,
          metadata: {
            attachmentId: attachment.id,
            promptHash: promptDigest(input.prompt),
            promptPreview: input.prompt.slice(0, 120)
          }
        });
        res.status(201).json({
          attachment,
          creditsCharged: GENERATED_ICON_COST_CREDITS,
          creditBalance: await ctx.store.getCreditBalance(owned.organization.id)
        });
      } catch (error) {
        if (charged) {
          await ctx.store.addCredits(owned.organization.id, GENERATED_ICON_COST_CREDITS, "Refund for failed generated transparent icon");
        }
        const message = error instanceof Error ? error.message : "Image generation failed.";
        await ctx.recordEvidence(req, {
          userId: user.id,
          organizationId: owned.organization.id,
          projectId: owned.project.id,
          threadId: input.threadId,
          type: "image_generation",
          action: "generated_transparent_icon",
          status: "failed",
          metadata: {
            promptHash: promptDigest(input.prompt),
            promptPreview: input.prompt.slice(0, 120),
            error: message.slice(0, 500)
          }
        });
        const storageUnavailable = isAttachmentStorageUnavailableError(error);
        const status = storageUnavailable ? 503 : /transparent/i.test(message) ? 422 : 502;
        res.status(status).json({
          error: storageUnavailable
            ? message
            : status === 422
            ? "The generated image was not transparent enough to save. Try a simpler subject with clear cutout wording."
            : "Image generation did not finish successfully. Please retry with a shorter icon prompt."
        });
        return;
      }
    } catch (error) {
      next(error);
    }
  });

  app.post("/projects/:projectId/threads", async (req, res) => {
    const user = await requireUser(req, res);
    if (!user) return;

    const input = createThreadSchema.parse(req.body);
    const project = await ctx.store.fetchProject(req.params.projectId);
    const org = await ctx.store.fetchOrganizationForUser(user.id);
    
    if (!project || project.organizationId !== org?.id) {
      res.status(404).json({ error: "Project not found" });
      return;
    }

    if (!input.name) {
      const reusable = await reuseBlankThreadIfAvailable(project.id, user.id, ctx);
      if (reusable) {
        res.status(200).json({ thread: reusable });
        return;
      }
    }

    let threadId = randomUUID();
    while (await ctx.store.fetchThread(threadId)) {
      threadId = randomUUID();
    }

    const thread = await ctx.store.saveThread({
      id: threadId,
      projectId: project.id,
      userId: user.id,
      name: input.name ?? "New chat",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    });
    res.status(201).json({ thread });
  });

  app.patch("/projects/:projectId/threads/:threadId", async (req, res) => {
    const user = await requireUser(req, res);
    if (!user) return;

    const input = updateThreadSchema.parse(req.body);
    const owned = await ctx.requireOwnedProject(user.id, String(req.params.projectId), res);
    if (!owned) return;

    const thread = await ctx.store.fetchThread(String(req.params.threadId));
    if (!thread || thread.projectId !== owned.project.id || thread.userId !== user.id) {
      res.status(404).json({ error: "Thread not found" });
      return;
    }

    thread.name = input.name;
    thread.updatedAt = new Date().toISOString();
    const updated = await ctx.store.saveThread(thread);
    res.json({ thread: updated });
  });

  async function deleteThreadForRequest(req: express.Request, res: express.Response) {
    const user = await requireUser(req, res);
    if (!user) return;

    const owned = await ctx.requireOwnedProject(user.id, String(req.params.projectId), res);
    if (!owned) return;

    const thread = await ctx.store.fetchThread(String(req.params.threadId));
    if (!thread || thread.projectId !== owned.project.id || thread.userId !== user.id) {
      res.status(404).json({ error: "Thread not found" });
      return;
    }

    await ctx.store.deleteThread(thread.id);
    await ctx.recordEvidence(req, {
      userId: user.id,
      organizationId: owned.organization.id,
      projectId: owned.project.id,
      threadId: thread.id,
      type: "deletion",
      action: "delete_thread",
      status: "ok"
    });
    res.json({ ok: true });
  }

  app.delete("/projects/:projectId/threads/:threadId", async (req, res, next) => {
    try {
      await deleteThreadForRequest(req, res);
    } catch (error) {
      next(error);
    }
  });

  app.post("/projects/:projectId/threads/:threadId/delete", async (req, res, next) => {
    try {
      await deleteThreadForRequest(req, res);
    } catch (error) {
      next(error);
    }
  });

  app.post("/projects/:projectId/threads/delete", async (req, res, next) => {
    try {
      const user = await requireUser(req, res);
      if (!user) return;

      const owned = await ctx.requireOwnedProject(user.id, String(req.params.projectId), res);
      if (!owned) return;

      const input = deleteThreadsSchema.parse(req.body);
      const deleted: string[] = [];
      for (const threadId of [...new Set(input.threadIds)]) {
        const thread = await ctx.store.fetchThread(threadId);
        if (!thread || thread.projectId !== owned.project.id || thread.userId !== user.id) continue;
        await ctx.store.deleteThread(thread.id);
        deleted.push(thread.id);
      }

      await ctx.recordEvidence(req, {
        userId: user.id,
        organizationId: owned.organization.id,
        projectId: owned.project.id,
        type: "deletion",
        action: "delete_threads_bulk",
        status: "ok",
        metadata: {
          requested: input.threadIds.length,
          deleted
        }
      });
      res.json({ ok: true, deleted });
    } catch (error) {
      next(error);
    }
  });

  // --- Task Plan Routes ---
  app.patch("/projects/:projectId/task-plans/:planId", async (req, res, next) => {
    try {
      const user = await requireUser(req, res);
      if (!user) return;

      const owned = await ctx.requireOwnedProject(user.id, String(req.params.projectId), res);
      if (!owned) return;

      const input = editTaskPlanSchema.parse(req.body);
      const planId = String(req.params.planId);

      const doc = await ctx.store.getDoc("taskPlans", planId);
      if (!doc || (doc as any).projectId !== owned.project.id) {
        res.status(404).json({ error: "Task Plan not found" });
        return;
      }
      const taskPlan = doc as any;

      if (taskPlan.status !== "draft") {
        res.status(400).json({ error: `Cannot edit a plan that is already ${taskPlan.status}` });
        return;
      }

      if (input.goal !== undefined) taskPlan.goal = input.goal;
      if (input.assumptions !== undefined) taskPlan.assumptions = input.assumptions;
      if (input.targetInstances !== undefined) taskPlan.targetInstances = input.targetInstances;
      if (input.steps !== undefined) taskPlan.steps = input.steps;
      if (input.acceptanceCriteria !== undefined) taskPlan.acceptanceCriteria = input.acceptanceCriteria;
      if (input.risks !== undefined) taskPlan.risks = input.risks;
      if (input.estimatedComplexity !== undefined) taskPlan.estimatedComplexity = input.estimatedComplexity;

      taskPlan.updatedAt = new Date().toISOString();
      await ctx.store.saveDoc("taskPlans", taskPlan);

      res.json({ taskPlan });
    } catch (error) {
      next(error);
    }
  });

  app.post("/projects/:projectId/task-plans/:planId/approve", async (req, res, next) => {
    try {
      const user = await requireUser(req, res);
      if (!user) return;

      const owned = await ctx.requireOwnedProject(user.id, String(req.params.projectId), res);
      if (!owned) return;

      const input = approveTaskPlanSchema.parse(req.body);
      const planId = String(req.params.planId);
      const modelId = input.model || defaultAiModel();
      // Credit check: using a standard changeset generation estimate
      const cost = 10;

      let taskPlan: any;
      let shouldGenerate = false;

      // Claim the plan under the org lock so concurrent approves cannot double-charge.
      await ctx.orgLocks.run(owned.organization.id, async () => {
        const doc = await ctx.store.getDoc("taskPlans", planId);
        if (!doc || (doc as any).projectId !== owned.project.id) {
          res.status(404).json({ error: "Task Plan not found" });
          return;
        }
        taskPlan = doc as any;

        if (taskPlan.status === "generating") {
          const generatingStartedMs = Date.parse(taskPlan.updatedAt || taskPlan.createdAt || "");
          const generatingAgeMs = Number.isFinite(generatingStartedMs) ? Date.now() - generatingStartedMs : 0;
          // Recover abandoned claims after provider timeout window so plans do not stay stuck forever.
          if (generatingAgeMs < 15 * 60 * 1000) {
            res.status(409).json({ error: "This plan is already being generated into a patch." });
            return;
          }
          taskPlan.status = "draft";
        }
        if (taskPlan.status !== "draft") {
          res.status(400).json({ error: `Cannot approve a plan that is already ${taskPlan.status}` });
          return;
        }

        const balance = await ctx.store.getCreditBalance(owned.organization.id);
        if (balance < cost) {
          res.status(402).json({ error: "Insufficient credits to generate patch from plan." });
          return;
        }

        const debit = await ctx.store.tryDeductCredits(owned.organization.id, cost, `Approved Task Plan implementation (${modelId})`);
        if (!debit.ok) {
          res.status(402).json({ error: "Insufficient credits to generate patch from plan." });
          return;
        }

        taskPlan.status = "generating";
        taskPlan.updatedAt = new Date().toISOString();
        await ctx.store.saveDoc("taskPlans", taskPlan);
        shouldGenerate = true;
      });

      if (!shouldGenerate || !taskPlan) return;

      const restoreDraftAndRefund = async (reason: string) => {
        await ctx.store.addCredits(owned.organization.id, cost, reason);
        taskPlan.status = "draft";
        taskPlan.updatedAt = new Date().toISOString();
        await ctx.store.saveDoc("taskPlans", taskPlan);
      };

      // Generate changeset from the plan
      const latestSnapshot = await ctx.store.fetchLatestSnapshot(owned.project.id);
      const priorMessages = await ctx.store.fetchMessagesForThread(taskPlan.threadId);

      const prompt = `Implementation Plan approved by creator:
Goal: ${taskPlan.goal}
Steps:
${taskPlan.steps.map((s: any) => `- ${s.description} (Target: ${s.targetFile ?? "N/A"})`).join("\n")}
Assumptions:
${taskPlan.assumptions.map((a: any) => `- ${a}`).join("\n")}
Target Instances:
${taskPlan.targetInstances.join(", ")}

Please implement this exact plan. Generate the complete Roblox change set files.`;

      let generated: Awaited<ReturnType<typeof generateSafeChangeSet>>;
      try {
        generated = await generateSafeChangeSet({
          project: owned.project,
          prompt,
          model: modelId,
          planMode: false,
          snapshot: latestSnapshot,
          history: priorMessages,
          preferences: user.preferences,
          plan: owned.organization.plan,
          providerTimeoutMs: 120_000
        });
      } catch (error) {
        await restoreDraftAndRefund("Refund unused Task Plan reservation (generation failed)");
        throw error;
      }

      if (!generated || generated.files.length === 0) {
        await restoreDraftAndRefund("Refund unused Task Plan reservation (no reviewable operations)");
        res.status(422).json({ error: "No reviewable operations were generated from the plan." });
        return;
      }

      const reviewReport = config.features.reviewReportEnabled
        ? generateDeterministicReviewReport(
            generated.files,
            generated.safety,
            prompt,
            latestSnapshot?.nodes.length ?? 0
          )
        : undefined;

      const changeSet = await ctx.store.saveChangeSet({
        id: await ctx.store.createUniqueId("changeSets", "cs_", 18),
        projectId: owned.project.id,
        threadId: taskPlan.threadId,
        aiMessageId: "",
        title: generated.title,
        summary: generated.summary,
        status: "ready_for_review",
        files: generated.files,
        safety: generated.safety,
        reviewReport,
        requestedByUserId: user.id,
        createdAt: new Date().toISOString()
      });

      const assistantMessage = await ctx.store.saveMessage({
        id: await ctx.store.createUniqueId("messages", "msg_", 18),
        projectId: owned.project.id,
        threadId: taskPlan.threadId,
        role: "assistant",
        content: `Generated a Roblox patch with ${changeSet.files.length} operations based on your approved plan: "${generated.title}".`,
        modelUsed: modelId,
        createdAt: new Date().toISOString(),
        changeSetId: changeSet.id
      });

      changeSet.aiMessageId = assistantMessage.id;
      await ctx.store.saveChangeSet(changeSet);

      taskPlan.status = "approved";
      taskPlan.approvedAt = new Date().toISOString();
      taskPlan.changeSetId = changeSet.id;
      taskPlan.updatedAt = new Date().toISOString();
      await ctx.store.saveDoc("taskPlans", taskPlan);

      res.json({ taskPlan, changeSet, assistantMessage });
    } catch (error) {
      next(error);
    }
  });

  app.post("/projects/:projectId/task-plans/:planId/supersede", async (req, res, next) => {
    try {
      const user = await requireUser(req, res);
      if (!user) return;

      const owned = await ctx.requireOwnedProject(user.id, String(req.params.projectId), res);
      if (!owned) return;

      const planId = String(req.params.planId);
      const doc = await ctx.store.getDoc("taskPlans", planId);
      if (!doc || (doc as any).projectId !== owned.project.id) {
        res.status(404).json({ error: "Task Plan not found" });
        return;
      }
      const taskPlan = doc as any;

      if (taskPlan.status !== "draft") {
        res.status(400).json({ error: `Cannot supersede a plan that is already ${taskPlan.status}` });
        return;
      }

      taskPlan.status = "superseded";
      taskPlan.supersededAt = new Date().toISOString();
      taskPlan.updatedAt = new Date().toISOString();
      await ctx.store.saveDoc("taskPlans", taskPlan);

      res.json({ taskPlan });
    } catch (error) {
      next(error);
    }
  });

  // --- Patch Comment Routes ---
  app.post("/projects/:projectId/changesets/:changeSetId/comments", async (req, res, next) => {
    try {
      const user = await requireUser(req, res);
      if (!user) return;

      const owned = await ctx.requireOwnedProject(user.id, String(req.params.projectId), res);
      if (!owned) return;

      const changeSetId = String(req.params.changeSetId);
      const changeSet = await ctx.store.fetchChangeSet(changeSetId);
      if (!changeSet || changeSet.projectId !== owned.project.id) {
        res.status(404).json({ error: "Changeset not found" });
        return;
      }

      const input = createCommentSchema.parse(req.body);
      const commentId = await ctx.store.createUniqueId("patchComments", "cmt_", 18);

      const comment: PatchComment = {
        id: commentId,
        changeSetId,
        projectId: owned.project.id,
        filePath: input.filePath,
        userId: user.id,
        userName: user.name || "Anonymous",
        commentText: input.commentText,
        resolved: false,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };

      await ctx.store.savePatchComment(comment);

      // Increment reviewCommentCount on changeset
      changeSet.reviewCommentCount = (changeSet.reviewCommentCount || 0) + 1;
      await ctx.store.saveChangeSet(changeSet);

      res.json({ comment });
    } catch (error) {
      next(error);
    }
  });

  app.post("/projects/:projectId/comments/:commentId/resolve", async (req, res, next) => {
    try {
      const user = await requireUser(req, res);
      if (!user) return;

      const owned = await ctx.requireOwnedProject(user.id, String(req.params.projectId), res);
      if (!owned) return;

      const commentId = String(req.params.commentId);
      const comment = await ctx.store.fetchPatchComment(commentId);
      if (!comment || comment.projectId !== owned.project.id) {
        res.status(404).json({ error: "Comment not found" });
        return;
      }

      comment.resolved = true;
      comment.resolvedByUserId = user.id;
      comment.resolvedAt = new Date().toISOString();
      comment.updatedAt = new Date().toISOString();

      await ctx.store.savePatchComment(comment);

      res.json({ comment });
    } catch (error) {
      next(error);
    }
  });
}
