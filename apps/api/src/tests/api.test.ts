import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createApp, saferModelForPatch, stableAnswerModelFor } from "../app.js";
import { redactUrlForLog } from "../requestContext.js";
import { config } from "../services/config.js";
import { persistAttachmentBytes } from "../services/assets.js";
import { store } from "../services/store.js";
import { snapshotFingerprint } from "../services/snapshots.js";
import { queueStudioCommand } from "../routes/studio.js";
import { clientIpForRequest, createFixedWindowLimiter, rateLimitIdentityForRequest } from "../services/limits.js";

describe("Vectis Code API", () => {
  beforeEach(async () => {
    await store.reset();
  });

  async function createThread(agent: ReturnType<typeof request.agent>, projectId: string, name?: string) {
    const created = await agent.post(`/projects/${projectId}/threads`).send(name ? { name } : {}).expect(201);
    return created.body.thread.id as string;
  }

  function sessionCookies(sessionId: string, csrf = "csrf_test_token") {
    return `ras_session=${sessionId}; ras_csrf=${csrf}`;
  }

  it("creates unique stable chat thread ids", async () => {
    const app = await createApp();
    const agent = request.agent(app);

    await agent.post("/auth/private-owner").send({}).expect(200);
    const bootstrap = await agent.get("/bootstrap").expect(200);
    const projectId = bootstrap.body.projects[0].id;

    const first = await createThread(agent, projectId, "First chat");
    const second = await createThread(agent, projectId, "Second chat");

    expect(first).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
    expect(second).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
    expect(second).not.toBe(first);
  });

  it("sets browser auth cookies to SameSite=Lax", async () => {
    const app = await createApp();

    const login = await request(app).post("/auth/private-owner").send({}).expect(200);
    const rawSetCookie = login.headers["set-cookie"];
    const setCookie = Array.isArray(rawSetCookie) ? rawSetCookie.join("; ") : String(rawSetCookie ?? "");

    expect(setCookie).toContain("SameSite=Lax");
    expect(setCookie).not.toContain("SameSite=None");
    expect(setCookie).toContain("ras_csrf=");
  });

  it("uses hardened request identity for rate limits and audit IPs", () => {
    const proxiedReq = {
      headers: {
        "x-forwarded-for": "203.0.113.9, 198.51.100.10"
      },
      socket: { remoteAddress: "10.0.0.5" },
      ip: "10.0.0.5"
    } as any;
    expect(clientIpForRequest(proxiedReq)).toBe("198.51.100.10");

    const directReq = {
      headers: {
        "x-forwarded-for": "203.0.113.9"
      },
      socket: { remoteAddress: "198.51.100.20" },
      ip: "198.51.100.20"
    } as any;
    expect(clientIpForRequest(directReq)).toBe("198.51.100.20");

    const sessionReq = {
      headers: {
        cookie: "ras_session=session-secret-value"
      },
      socket: { remoteAddress: "198.51.100.20" },
      ip: "198.51.100.20"
    } as any;
    const identity = rateLimitIdentityForRequest(sessionReq);
    expect(identity).toMatch(/^session:[a-f0-9]{32}$/);
    expect(identity).not.toContain("session-secret-value");
  });

  it("redacts sensitive query parameters from access log URLs", () => {
    const redacted = redactUrlForLog("/studio/session/session_1?connectorToken=secret-token&sessionId=session_1&ok=1");

    expect(redacted).toContain("ok=1");
    expect(redacted).toContain("connectorToken=%5Bredacted%5D");
    expect(redacted).not.toContain("secret-token");
  });

  it("falls back to in-memory rate limiting when durable rate limits fail", async () => {
    const original = {
      useSupabase: config.useSupabase,
      durableRateLimits: config.durableRateLimits
    };
    const incrementSpy = vi.spyOn(store, "incrementRateLimit").mockRejectedValue(new Error("rpc down"));
    config.useSupabase = true;
    config.durableRateLimits = true;

    try {
      const app = express();
      app.use(createFixedWindowLimiter({
        namespace: "test-fallback",
        windowMs: 60_000,
        max: 1
      }));
      app.get("/limited", (_req, res) => res.json({ ok: true }));

      await request(app).get("/limited").expect(200);
      await request(app).get("/limited").expect(429);
      expect(incrementSpy).toHaveBeenCalled();
    } finally {
      config.useSupabase = original.useSupabase;
      config.durableRateLimits = original.durableRateLimits;
      incrementSpy.mockRestore();
    }
  });

  it("keeps Supabase durable rate limits opt-in by default", () => {
    expect(config.durableRateLimits).toBe(false);
  });

  it("surfaces Supabase Auth registrations that have not created app workspaces yet", async () => {
    await store.ensurePrivateOwner();
    const authUsersSpy = vi.spyOn(store, "fetchSupabaseRegisteredUsers").mockResolvedValue([
      {
        supabaseUserId: "auth_user_one",
        email: "new.creator@example.com",
        name: "New Creator",
        createdAt: "2026-06-01T10:00:00.000Z",
        lastSignInAt: "2026-06-02T10:00:00.000Z"
      },
      {
        supabaseUserId: "auth_user_two",
        email: undefined,
        name: "No Email Creator",
        createdAt: "2026-06-01T11:00:00.000Z"
      }
    ]);

    try {
      const users = await store.fetchAllUsersWithStats();
      const authOnlyUsers = users.filter((user) => user.authOnly);

      expect(authOnlyUsers).toHaveLength(2);
      expect(authOnlyUsers.map((user) => user.id)).toContain("auth:auth_user_one");
      expect(authOnlyUsers[0].registrationSource).toBe("supabase_auth");
      expect(authOnlyUsers[0].projects).toBe(0);
    } finally {
      authUsersSpy.mockRestore();
    }
  });

  it("cleans expired runtime maintenance data without touching current records", async () => {
    const originalRetention = {
      maxStudioLogAgeDays: config.retention.maxStudioLogAgeDays,
      rateLimitRetentionHours: config.retention.rateLimitRetentionHours
    };
    config.retention.maxStudioLogAgeDays = 1;
    config.retention.rateLimitRetentionHours = 1;

    try {
      await store.saveAuthSession({
        id: "auth_expired",
        userId: "user_missing",
        createdAt: "2026-01-01T00:00:00.000Z",
        expiresAt: "2026-01-02T00:00:00.000Z"
      });
      await store.saveAuthSession({
        id: "auth_current",
        userId: "user_missing",
        createdAt: new Date().toISOString(),
        expiresAt: new Date(Date.now() + 60_000).toISOString()
      });
      await store.saveSnapshotChunk({
        id: "chunk_expired",
        uploadId: "upload_expired",
        sessionId: "session_1",
        projectId: "project_1",
        mode: "full",
        index: 0,
        total: 1,
        nodes: [],
        createdAt: "2026-01-01T00:00:00.000Z",
        expiresAt: "2026-01-02T00:00:00.000Z"
      });
      await store.saveLog({
        id: "log_old",
        studioSessionId: "session_1",
        level: "error",
        message: "old error",
        createdAt: "2026-01-01T00:00:00.000Z"
      });
      await store.saveLog({
        id: "log_current",
        studioSessionId: "session_1",
        level: "warn",
        message: "current warning",
        createdAt: new Date().toISOString()
      });
      await store.incrementRateLimit("old", 1);

      const result = await store.runMaintenanceCleanup();
      const remainingLogs = await store.fetchLogsForSession("session_1");

      expect(result.expiredAuthSessions).toBe(1);
      expect(result.expiredSnapshotChunks).toBe(1);
      expect(result.oldStudioLogs).toBe(1);
      expect(await store.fetchAuthSession("auth_expired")).toBeUndefined();
      expect(await store.fetchAuthSession("auth_current")).toBeDefined();
      expect(remainingLogs.map((entry) => entry.id)).toEqual(["log_current"]);
    } finally {
      config.retention.maxStudioLogAgeDays = originalRetention.maxStudioLogAgeDays;
      config.retention.rateLimitRetentionHours = originalRetention.rateLimitRetentionHours;
    }
  });

  it("blocks cross-site authenticated browser mutations in production", async () => {
    const original = {
      isProduction: config.isProduction,
      webAppUrl: config.webAppUrl,
      apiBaseUrl: config.apiBaseUrl
    };
    try {
      const user = await store.ensurePrivateOwner();
      const project = await store.ensureProjectForUser(user.id);
      const session = await store.createAuthSession(user.id);
      const csrf = "csrf_prod_test";
      const cookie = sessionCookies(session.id, csrf);
      config.isProduction = true;
      config.webAppUrl = "https://vectiscode.com";
      config.apiBaseUrl = "https://api.vectiscode.com";
      const app = await createApp();

      await request(app)
        .post(`/projects/${project.id}/threads`)
        .set("Cookie", cookie)
        .set("Origin", "https://evil.example")
        .send({ name: "Blocked by origin" })
        .expect(403);

      await request(app)
        .post(`/projects/${project.id}/threads`)
        .set("Cookie", cookie)
        .set("Origin", "https://vectiscode.com")
        .send({ name: "Blocked by missing csrf" })
        .expect(403);

      await request(app)
        .post(`/projects/${project.id}/threads`)
        .set("Cookie", cookie)
        .set("Origin", "https://vectiscode.com")
        .set("X-CSRF-Token", csrf)
        .send({ name: "Allowed origin" })
        .expect(201);
    } finally {
      config.isProduction = original.isProduction;
      config.webAppUrl = original.webAppUrl;
      config.apiBaseUrl = original.apiBaseUrl;
    }
  });

  it("allows same-site logout recovery when a stale session has no readable csrf cookie", async () => {
    const original = {
      isProduction: config.isProduction,
      webAppUrl: config.webAppUrl,
      apiBaseUrl: config.apiBaseUrl
    };
    try {
      const user = await store.ensurePrivateOwner();
      const session = await store.createAuthSession(user.id);
      config.isProduction = true;
      config.webAppUrl = "https://vectiscode.com";
      config.apiBaseUrl = "https://api.vectiscode.com";
      const app = await createApp();

      await request(app)
        .post("/auth/logout")
        .set("Cookie", `ras_session=${session.id}`)
        .set("Origin", "https://evil.example")
        .send({})
        .expect(403);

      await request(app)
        .post("/auth/logout")
        .set("Cookie", `ras_session=${session.id}`)
        .set("Origin", "https://vectiscode.com")
        .send({})
        .expect(200);
    } finally {
      config.isProduction = original.isProduction;
      config.webAppUrl = original.webAppUrl;
      config.apiBaseUrl = original.apiBaseUrl;
    }
  });

  it("does not forward arbitrary error payloads", async () => {
    const app = await createApp();

    const payment = await request(app)
      .post("/__test/unsafe-error")
      .send({
        statusCode: 402,
        message: "provider supplied payment payload",
        payload: { bypassCheckout: true, code: "not_safe" }
      })
      .expect(402);
    expect(payment.body).toMatchObject({
      error: "Usage limit reached",
      code: "usage_limit_reached"
    });
    expect(payment.body.bypassCheckout).toBeUndefined();

    await request(app)
      .post("/__test/unsafe-error")
      .send({ statusCode: 418, message: "teapot payload", payload: { secret: "leak" } })
      .expect(500);
  });

  it("requires the private owner secret when configured", async () => {
    const originalSecret = config.privateOwnerLoginSecret;
    const originalProduction = config.isProduction;
    config.privateOwnerLoginSecret = "owner-secret";
    config.isProduction = false;
    try {
      const app = await createApp();
      await request(app).post("/auth/private-owner").send({}).expect(403);
      await request(app)
        .post("/auth/private-owner")
        .set("X-Private-Owner-Secret", "owner-secret")
        .send({})
        .expect(200);
    } finally {
      config.privateOwnerLoginSecret = originalSecret;
      config.isProduction = originalProduction;
    }
  });

  it("keeps private owner login disabled in production", async () => {
    const original = {
      isProduction: config.isProduction,
      allowPrivateOwnerLogin: config.allowPrivateOwnerLogin,
      webAppUrl: config.webAppUrl,
      apiBaseUrl: config.apiBaseUrl
    };
    config.isProduction = true;
    config.allowPrivateOwnerLogin = true;
    config.webAppUrl = "https://vectiscode.com";
    config.apiBaseUrl = "https://api.vectiscode.com";
    try {
      const app = await createApp();
      await request(app)
        .post("/auth/private-owner")
        .set("Origin", "https://vectiscode.com")
        .send({})
        .expect(403);
    } finally {
      config.isProduction = original.isProduction;
      config.allowPrivateOwnerLogin = original.allowPrivateOwnerLogin;
      config.webAppUrl = original.webAppUrl;
      config.apiBaseUrl = original.apiBaseUrl;
    }
  });

  it("rejects unsupported store JSON query fields", async () => {
    const unsafeStore = store as unknown as {
      queryDocs<T>(collection: string, field: string, value: unknown): Promise<T[]>;
    };

    await expect(unsafeStore.queryDocs("users", "email", "ok@example.com")).resolves.toEqual([]);
    await expect(unsafeStore.queryDocs("users", "email) or true --", "bad@example.com")).rejects.toThrow("Unsupported query field");
  });

  it("blocks new public Firebase signups in production when signups are closed", async () => {
    const original = {
      isProduction: config.isProduction,
      publicSignupsEnabled: config.publicSignupsEnabled,
      adminEmails: [...config.adminEmails]
    };
    config.isProduction = true;
    config.publicSignupsEnabled = false;
    config.adminEmails = ["admin@example.com"];

    try {
      await expect(store.upsertFirebaseUser({
        firebaseUserId: "firebase-outsider",
        name: "Outside User",
        email: "outside@example.com"
      })).rejects.toMatchObject({ statusCode: 403 });

      const admin = await store.upsertFirebaseUser({
        firebaseUserId: "firebase-admin",
        name: "Admin User",
        email: "admin@example.com"
      });
      expect(admin.email).toBe("admin@example.com");
    } finally {
      config.isProduction = original.isProduction;
      config.publicSignupsEnabled = original.publicSignupsEnabled;
      config.adminEmails = original.adminEmails;
    }
  });

  it("keeps one blank chat and auto-names it from the first message", async () => {
    const app = await createApp();
    const agent = request.agent(app);

    await agent.post("/auth/private-owner").send({}).expect(200);
    const bootstrap = await agent.get("/bootstrap").expect(200);
    const projectId = bootstrap.body.projects[0].id;

    const first = await agent.post(`/projects/${projectId}/threads`).send({}).expect(201);
    const second = await agent.post(`/projects/${projectId}/threads`).send({}).expect(200);
    expect(second.body.thread.id).toBe(first.body.thread.id);

    await store.saveMessage({
      id: "msg_first_prompt",
      projectId,
      threadId: first.body.thread.id,
      role: "user",
      content: "Inspect my project structure and suggest what to improve first.",
      createdAt: new Date().toISOString()
    });

    const after = await agent.get("/bootstrap").expect(200);
    const thread = after.body.threads.find((item: { id: string }) => item.id === first.body.thread.id);
    expect(thread.name).toBe("Inspect project structure suggest improve");
    expect(after.body.threads.filter((item: { name: string }) => item.name === "New chat")).toHaveLength(0);
  });

  it("publishes configured credit economics and pending provider-gated routing", async () => {
    const originalCurrency = config.stripe.proCurrency;
    const originalTopUpSmallAmountCents = config.stripe.topUpSmallAmountCents;
    config.stripe.proCurrency = "eur";
    config.stripe.topUpSmallAmountCents = 250;
    const app = await createApp();
    try {
      const response = await request(app).get("/auth/config").expect(200);
      const smallTopUp = response.body.billing.topUpPacks.find((pack: { id: string }) => pack.id === "small");
      const starterPlan = response.body.billing.plans.find((plan: { name: string }) => plan.name === "starter");
      const deepseekFlash = response.body.models.find((model: { id: string }) => model.id === "deepseek-v4-flash");
      const gemini35 = response.body.models.find((model: { id: string }) => model.id === "gemini-3.5-flash");
      const qwenMax = response.body.models.find((model: { id: string }) => /qwen.*3\.7.*max/i.test(model.id));

      expect(response.body.billing.currency).toBe("eur");
      expect(response.body.billing.customCreditPricePerThousand).toBe(1.4);
      expect(response.body.billing.customCreditDiscountedForStudio).toBe(true);
      expect(response.body.billing.fixedTopUpPricePerThousand).toBe(2);
      expect(smallTopUp).toMatchObject({ credits: 1000, priceUsd: 2, priceCents: 250 });
      expect(starterPlan).toMatchObject({ priceUsd: 7.99, monthlyPriceCents: 799, annualPriceCents: 7199 });
      expect(deepseekFlash).toMatchObject({ usageMultiplier: 1.0, status: "soon" });
      expect(gemini35).toMatchObject({ label: "Gemini 3.5 Flash", tier: "entry" });
      expect(response.body.defaultModel).toBe("gemini-3.5-flash");
      expect(response.body.models.find((model: { id: string }) => model.id === "deepseek-v4-pro")).toBeUndefined();
      expect(response.body.models.map((model: { id: string }) => model.id)).not.toContain(["mini", "max", "m3"].join("-"));
      expect(qwenMax).toMatchObject({ label: "Qwen3.7 Max", status: "soon" });
    } finally {
      config.stripe.proCurrency = originalCurrency;
      config.stripe.topUpSmallAmountCents = originalTopUpSmallAmountCents;
    }
  });

  it("deletes single and multiple chats through robust deletion endpoints", async () => {
    const app = await createApp();
    const agent = request.agent(app);

    await agent.post("/auth/private-owner").send({}).expect(200);
    const bootstrap = await agent.get("/bootstrap").expect(200);
    const projectId = bootstrap.body.projects[0].id;
    const first = await createThread(agent, projectId, "Delete single");
    const second = await createThread(agent, projectId, "Delete bulk");

    await agent.post(`/projects/${projectId}/threads/${first}/delete`).send({}).expect(200);
    const bulk = await agent
      .post(`/projects/${projectId}/threads/delete`)
      .send({ threadIds: [second] })
      .expect(200);

    expect(bulk.body.deleted).toEqual([second]);
    const after = await agent.get("/bootstrap").expect(200);
    const remainingThreadIds = after.body.threads.map((thread: { id: string }) => thread.id);
    expect(remainingThreadIds).not.toContain(first);
    expect(remainingThreadIds).not.toContain(second);
  });

  it("scopes project chat records and thread mutations to the signed-in user", async () => {
    const app = await createApp();
    const agent = request.agent(app);

    await agent.post("/auth/private-owner").send({}).expect(200);
    const bootstrap = await agent.get("/bootstrap").expect(200);
    const projectId = bootstrap.body.projects[0].id;
    const organizationId = bootstrap.body.organization.id;
    const ownerThreadId = await createThread(agent, projectId, "Owner chat");

    const now = new Date().toISOString();
    const otherUser = await store.saveUser({
      id: "user_same_org_other",
      name: "Same Org Other",
      email: "same-org-other@example.com",
      authProvider: "google",
      createdAt: now
    });
    await store.saveMember({
      id: "member_same_org_other",
      organizationId,
      userId: otherUser.id,
      role: "developer"
    });
    const otherThreadId = "thread_same_org_other";
    await store.saveThread({
      id: otherThreadId,
      projectId,
      userId: otherUser.id,
      name: "Other user's chat",
      createdAt: now,
      updatedAt: now
    });
    await store.saveMessage({
      id: "msg_same_org_other",
      projectId,
      threadId: otherThreadId,
      role: "user",
      content: "This should not be visible to the owner.",
      createdAt: now
    });

    const ownerBootstrap = await agent.get("/bootstrap").expect(200);
    expect(ownerBootstrap.body.threads.map((thread: { id: string }) => thread.id)).toContain(ownerThreadId);
    expect(ownerBootstrap.body.threads.map((thread: { id: string }) => thread.id)).not.toContain(otherThreadId);
    expect(ownerBootstrap.body.messages.map((message: { id: string }) => message.id)).not.toContain("msg_same_org_other");

    const ownerProject = await agent.get(`/projects/${projectId}`).expect(200);
    expect(ownerProject.body.threads.map((thread: { id: string }) => thread.id)).not.toContain(otherThreadId);
    expect(ownerProject.body.messages.map((message: { id: string }) => message.id)).not.toContain("msg_same_org_other");

    await agent
      .patch(`/projects/${projectId}/threads/${otherThreadId}`)
      .send({ name: "Stolen rename" })
      .expect(404);
    await agent
      .post(`/projects/${projectId}/threads/delete`)
      .send({ threadIds: [otherThreadId] })
      .expect(200)
      .expect((res) => expect(res.body.deleted).toEqual([]));
    expect(await store.fetchThread(otherThreadId)).toBeTruthy();

    const otherSession = await store.createAuthSession(otherUser.id);
    const otherBootstrap = await request(app)
      .get("/bootstrap")
      .set("Cookie", `ras_session=${otherSession.id}`)
      .expect(200);
    expect(otherBootstrap.body.threads.map((thread: { id: string }) => thread.id)).toContain(otherThreadId);
    expect(otherBootstrap.body.threads.map((thread: { id: string }) => thread.id)).not.toContain(ownerThreadId);
  });

  it("allows safe attachments for every plan, blocks executables, and gates image generation", async () => {
    const app = await createApp();
    const agent = request.agent(app);

    await agent.post("/auth/private-owner").send({}).expect(200);
    const bootstrap = await agent.get("/bootstrap").expect(200);
    const projectId = bootstrap.body.projects[0].id;

    const upload = await agent
      .post(`/projects/${projectId}/attachments`)
      .set("Content-Type", "text/plain")
      .set("X-File-Name", encodeURIComponent("todo.lua"))
      .send(Buffer.from("print('safe attachment')"))
      .expect(201);
    expect(upload.body.attachment).toMatchObject({
      fileName: "todo.lua",
      mimeType: "text/plain",
      source: "upload"
    });

    await agent
      .post(`/projects/${projectId}/attachments`)
      .set("Content-Type", "application/octet-stream")
      .set("X-File-Name", encodeURIComponent("patch.exe"))
      .send(Buffer.from([0x4d, 0x5a, 0x00, 0x00]))
      .expect(400);

    await agent
      .post(`/projects/${projectId}/generated-icons`)
      .send({ prompt: "blue jump button" })
      .expect(403);

    const org = await store.fetchOrganization(bootstrap.body.organization.id);
    expect(org).toBeTruthy();
    org!.plan = "pro";
    await store.saveOrganization(org!);

    const generated = await agent
      .post(`/projects/${projectId}/generated-icons`)
      .send({ prompt: "blue jump button" })
      .expect(201);
    expect(generated.body.creditsCharged).toBe(90);
    expect(generated.body.attachment.source).toBe("generated_icon");
  });

  it("fails closed for large production attachments when object storage is not configured", async () => {
    const original = {
      isProduction: config.isProduction
    };
    config.isProduction = true;

    try {
      await expect(persistAttachmentBytes({
        organizationId: "org_storage_test",
        projectId: "project_storage_test",
        userId: "user_storage_test",
        source: "upload",
        fileName: "large-notes.txt",
        mimeType: "text/plain",
        bytes: Buffer.alloc(700 * 1024, "a")
      })).rejects.toThrow(/Supabase Storage is required/i);
    } finally {
      config.isProduction = original.isProduction;
    }
  });

  it("marks Gemini compatibility models as provider-gated without a relay", async () => {
    const app = await createApp();
    const config = await request(app).get("/auth/config").expect(200);
    const modelIds = config.body.models.map((model: { id: string }) => model.id);
    const proIndex = modelIds.indexOf("gemini-3.1-pro-preview");
    const flashIndex = modelIds.indexOf("gemini-3.5-flash");

    expect(flashIndex).toBeLessThan(proIndex);
    expect(config.body.models[flashIndex]).toMatchObject({
      id: "gemini-3.5-flash",
      tier: "entry",
      status: "soon"
    });
  });

  it("allows Free workspaces to use DeepSeek Flash within visible credit limits", async () => {
    const app = await createApp();
    const agent = request.agent(app);

    await agent.post("/auth/private-owner").send({}).expect(200);
    const bootstrap = await agent.get("/bootstrap").expect(200);
    const projectId = bootstrap.body.projects[0].id;
    const threadId = await createThread(agent, projectId);

    await agent
      .post(`/projects/${projectId}/chat`)
      .send({ threadId, prompt: "what do you see", mode: "explain", model: "deepseek-v4-flash" })
      .expect(200);
  });

  it("shows provider-gated models and uses local fallback in tests", async () => {
    const app = await createApp();
    const agent = request.agent(app);

    const config = await request(app).get("/auth/config").expect(200);
    expect(config.body.models.find((model: { id: string }) => model.id === "deepseek-v4-flash")).toMatchObject({
      tier: "entry",
      status: "soon"
    });

    await agent.post("/auth/private-owner").send({}).expect(200);
    const bootstrap = await agent.get("/bootstrap").expect(200);
    const projectId = bootstrap.body.projects[0].id;
    const threadId = await createThread(agent, projectId);

    await agent
      .post(`/projects/${projectId}/chat`)
      .send({ threadId, prompt: "what do you see", mode: "explain", model: "deepseek-v4-flash" })
      .expect(200);
  });



  it("enables Yunwu-only frontier models when Yunwu is configured", async () => {
    const originalApiKey = config.yunwu.apiKey;
    const originalPrefer = config.yunwu.prefer;
    config.yunwu.apiKey = "yunwu-test";
    config.yunwu.prefer = true;

    try {
      const app = await createApp();
      const cfg = await request(app).get("/auth/config").expect(200);
      for (const modelId of ["qwen3.7-max", "gpt-5.5"]) {
        expect(cfg.body.models.find((model: { id: string }) => model.id === modelId)).toMatchObject({
          status: "available"
        });
      }
      expect(cfg.body.models.find((model: { id: string }) => model.id === "qwen3.7-max")).toMatchObject({
        inputUsdPerMillion: 2.5,
        outputUsdPerMillion: 7.5
      });
    } finally {
      config.yunwu.apiKey = originalApiKey;
      config.yunwu.prefer = originalPrefer;
    }
  });

  it("pairs Studio, claims a project, uploads a snapshot, generates changes, and reports apply", async () => {
    const app = await createApp();
    const agent = request.agent(app);

    await agent.post("/auth/private-owner").send({}).expect(200);
    const bootstrap = await agent.get("/bootstrap").expect(200);
    const projectId = bootstrap.body.projects[0].id;

    const pair = await request(app)
      .post("/studio/pair")
      .send({ pluginVersion: "test" })
      .expect(201);

    await agent
      .post(`/projects/${projectId}/studio/pair-project`)
      .send({ pairingCode: pair.body.pairingCode })
      .expect(200);

    await request(app)
      .post("/studio/snapshot")
      .send({
        sessionId: pair.body.sessionId,
        connectorToken: pair.body.connectorToken,
        nodes: [{ path: "ServerScriptService/Main", className: "Script", source: "print('hi')" }]
      })
      .expect(201);

    const threadId = await createThread(agent, projectId);
    const chat = await agent
      .post(`/projects/${projectId}/chat`)
      .send({ threadId, prompt: "Add a checkpoint system", mode: "changeset" })
      .expect(200);

    expect(chat.body.changeSet.status).toBe("ready_for_review");
    expect(chat.body.changeSet.files.length).toBeGreaterThan(0);

    const pending = await request(app)
      .get(`/studio/changes/pending?sessionId=${pair.body.sessionId}&connectorToken=${pair.body.connectorToken}`)
      .expect(200);
    expect(pending.body.changeSets).toHaveLength(1);

    const approved = await agent
      .post(`/studio/changes/${chat.body.changeSet.id}/approve`)
      .send({})
      .expect(200);
    expect(approved.body.changeSet.status).toBe("approved_for_studio");
    expect(approved.body.taskRun).toMatchObject({
      changeSetId: chat.body.changeSet.id,
      projectId,
      studioSessionId: pair.body.sessionId,
      status: "queued",
      maxRepairRounds: 2,
      visualQa: "not_requested"
    });

    await request(app)
      .get(`/studio/session/${pair.body.sessionId}/pending-patches`)
      .expect(401);

    await request(app)
      .get(`/studio/session/${pair.body.sessionId}/pending-patches?connectorToken=wrong`)
      .expect(401);

    const patches = await request(app)
      .get(`/studio/session/${pair.body.sessionId}/pending-patches?connectorToken=${pair.body.connectorToken}`)
      .expect(200);
    expect(patches.body.patches).toHaveLength(1);

    await request(app)
      .post(`/studio/changes/${chat.body.changeSet.id}/apply-result`)
      .send({ sessionId: pair.body.sessionId, status: "applied", details: "Applied in Studio" })
      .expect(403);

    await request(app)
      .post(`/studio/changes/${chat.body.changeSet.id}/apply-result`)
      .send({
        sessionId: pair.body.sessionId,
        connectorToken: "wrong",
        status: "applied",
        details: "Applied in Studio"
      })
      .expect(403);

    await request(app)
      .post(`/studio/changes/${chat.body.changeSet.id}/apply-result`)
      .send({
        sessionId: pair.body.sessionId,
        connectorToken: pair.body.connectorToken,
        status: "applied",
        details: "Applied in Studio"
      })
      .expect(201);

    const duplicateApply = await request(app)
      .post(`/studio/changes/${chat.body.changeSet.id}/apply-result`)
      .send({
        sessionId: pair.body.sessionId,
        connectorToken: pair.body.connectorToken,
        status: "applied",
        details: "Applied in Studio again"
      })
      .expect(200);
    expect(duplicateApply.body.duplicate).toBe(true);

    // A later failure report must not overwrite a successful apply.
    const failedAfterApply = await request(app)
      .post(`/studio/changes/${chat.body.changeSet.id}/apply-result`)
      .send({
        sessionId: pair.body.sessionId,
        connectorToken: pair.body.connectorToken,
        status: "failed",
        details: "Late failure report"
      })
      .expect(200);
    expect(failedAfterApply.body.duplicate).toBe(true);
    expect(failedAfterApply.body.changeSet.status).toBe("applied");

    const afterApplyPatches = await request(app)
      .get(`/studio/session/${pair.body.sessionId}/pending-patches?connectorToken=${pair.body.connectorToken}`)
      .expect(200);
    expect(afterApplyPatches.body.patches).toHaveLength(0);

    const undo = await agent
      .post(`/studio/changes/${chat.body.changeSet.id}/undo`)
      .send({})
      .expect(200);
    expect(undo.body.changeSet.undoRequestedAt).toBeTruthy();

    const pendingUndos = await request(app)
      .get(`/studio/session/${pair.body.sessionId}/pending-undos?connectorToken=${pair.body.connectorToken}`)
      .expect(200);
    expect(pendingUndos.body.undos).toHaveLength(1);

    const undone = await request(app)
      .post(`/studio/changes/${chat.body.changeSet.id}/undo-result`)
      .send({
        sessionId: pair.body.sessionId,
        connectorToken: pair.body.connectorToken,
        status: "undone",
        details: "Restored previous Studio state"
      })
      .expect(201);
    expect(undone.body.changeSet.status).toBe("undone");
    expect(undone.body.changeSet.undoneAt).toBeTruthy();

    const afterUndo = await agent.get("/bootstrap").expect(200);
    const retainedChangeSet = afterUndo.body.changeSets.find((cs: any) => cs.id === chat.body.changeSet.id);
    expect(retainedChangeSet.status).toBe("undone");
    expect(afterUndo.body.studioTaskRuns).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: approved.body.taskRun.id,
          status: "rolled_back"
        })
      ])
    );
    expect(afterUndo.body.studioObservations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ taskRunId: approved.body.taskRun.id, kind: "apply_result", status: "passed" }),
        expect.objectContaining({ taskRunId: approved.body.taskRun.id, kind: "rollback_result", status: "passed" })
      ])
    );
  });

  it("blocks approving a patch when Studio changed after generation unless explicitly overridden", async () => {
    const app = await createApp();
    const agent = request.agent(app);

    await agent.post("/auth/private-owner").send({}).expect(200);
    const bootstrap = await agent.get("/bootstrap").expect(200);
    const projectId = bootstrap.body.projects[0].id;
    const threadId = await createThread(agent, projectId, "Snapshot conflict");

    const pair = await request(app)
      .post("/studio/pair")
      .send({ pluginVersion: "test" })
      .expect(201);

    await agent
      .post(`/projects/${projectId}/studio/pair-project`)
      .send({ pairingCode: pair.body.pairingCode })
      .expect(200);

    await request(app)
      .post("/studio/snapshot")
      .send({
        sessionId: pair.body.sessionId,
        connectorToken: pair.body.connectorToken,
        nodes: [{ path: "ServerScriptService/Main", className: "Script", source: "print('v1')" }]
      })
      .expect(201);
    const firstSnapshot = await store.fetchLatestSnapshot(projectId);
    expect(firstSnapshot).toBeDefined();

    await store.saveMessage({
      id: "msg_snapshot_conflict",
      projectId,
      threadId,
      role: "assistant",
      content: "Patch ready.",
      createdAt: new Date().toISOString()
    });
    await store.saveChangeSet({
      id: "cs_snapshot_conflict",
      projectId,
      threadId,
      aiMessageId: "msg_snapshot_conflict",
      title: "Snapshot conflict patch",
      summary: "Uses the first synced snapshot.",
      status: "ready_for_review",
      files: [],
      safety: { ok: true, blockedPatterns: [] },
      baseSnapshotId: firstSnapshot!.id,
      baseSnapshotCreatedAt: firstSnapshot!.createdAt,
      baseSnapshotNodeCount: firstSnapshot!.nodes.length,
      baseSnapshotFingerprint: snapshotFingerprint(firstSnapshot),
      createdAt: new Date().toISOString()
    });

    await request(app)
      .post("/studio/snapshot")
      .send({
        sessionId: pair.body.sessionId,
        connectorToken: pair.body.connectorToken,
        nodes: [{ path: "ServerScriptService/Main", className: "Script", source: "print('v2')" }]
      })
      .expect(201);

    const conflict = await agent
      .post("/studio/changes/cs_snapshot_conflict/approve")
      .send({})
      .expect(409);
    expect(conflict.body).toMatchObject({
      code: "snapshot_conflict",
      baseSnapshotId: firstSnapshot!.id,
      action: "regenerate_or_apply_anyway"
    });

    const override = await agent
      .post("/studio/changes/cs_snapshot_conflict/approve")
      .send({ ignoreSnapshotConflict: true })
      .expect(200);
    expect(override.body.changeSet).toMatchObject({
      status: "approved_for_studio",
      approvedWithSnapshotConflict: true
    });
  });

  it("requires the native Studio Bridge connector before serving approved patches", async () => {
    const app = await createApp();
    const agent = request.agent(app);

    await agent.post("/auth/private-owner").send({}).expect(200);
    const bootstrap = await agent.get("/bootstrap").expect(200);
    const projectId = bootstrap.body.projects[0].id;
    const threadId = await createThread(agent, projectId, "Manual confirmation gate");

    const pair = await request(app)
      .post("/studio/pair")
      .send({ pluginVersion: "vectis-connector-1.12.8" })
      .expect(201);

    await agent
      .post(`/projects/${projectId}/studio/pair-project`)
      .send({ pairingCode: pair.body.pairingCode })
      .expect(200);

    await store.saveMessage({
      id: "msg_confirmation_gate",
      projectId,
      threadId,
      role: "assistant",
      content: "Patch ready.",
      createdAt: new Date().toISOString()
    });
    await store.saveChangeSet({
      id: "cs_confirmation_gate",
      projectId,
      threadId,
      aiMessageId: "msg_confirmation_gate",
      title: "Confirmation gate",
      summary: "Do not serve this to an auto-apply connector.",
      status: "approved_for_studio",
      files: [],
      safety: { ok: true, blockedPatterns: [] },
      createdAt: new Date().toISOString()
    });

    const pending = await request(app)
      .get(`/studio/session/${pair.body.sessionId}/pending-patches?connectorToken=${pair.body.connectorToken}`)
      .expect(200);
    expect(pending.body.updateRequired).toBe(true);
    expect(pending.body.patches).toEqual([]);
  });

  it("requires connector 1.18.1 for normalized Color3 patch application", async () => {
    const app = await createApp();
    const agent = request.agent(app);

    await agent.post("/auth/private-owner").send({}).expect(200);
    const bootstrap = await agent.get("/bootstrap").expect(200);
    const projectId = bootstrap.body.projects[0].id;

    const pair = await request(app)
      .post("/studio/pair")
      .send({ pluginVersion: "vectis-connector-1.18.0" })
      .expect(201);

    await agent
      .post(`/projects/${projectId}/studio/pair-project`)
      .send({ pairingCode: pair.body.pairingCode })
      .expect(200);

    const pending = await request(app)
      .get(`/studio/session/${pair.body.sessionId}/pending-patches?connectorToken=${pair.body.connectorToken}`)
      .expect(200);

    expect(pending.body.updateRequired).toBe(true);
    expect(pending.body.patches).toEqual([]);
  });

  it("records native Studio task observations and allows queued tasks to be cancelled", async () => {
    const app = await createApp();
    const agent = request.agent(app);

    await agent.post("/auth/private-owner").send({}).expect(200);
    const bootstrap = await agent.get("/bootstrap").expect(200);
    const projectId = bootstrap.body.projects[0].id;
    const threadId = await createThread(agent, projectId, "Native Studio task");

    const pair = await request(app)
      .post("/studio/pair")
      .send({ pluginVersion: "test" })
      .expect(201);

    await agent
      .post(`/projects/${projectId}/studio/pair-project`)
      .send({ pairingCode: pair.body.pairingCode })
      .expect(200);

    await store.saveMessage({
      id: "msg_native_task",
      projectId,
      threadId,
      role: "assistant",
      content: "Native task ready.",
      createdAt: new Date().toISOString()
    });
    await store.saveChangeSet({
      id: "cs_native_task",
      projectId,
      threadId,
      aiMessageId: "msg_native_task",
      title: "Native Studio task",
      summary: "Build an editable Studio scene.",
      status: "ready_for_review",
      files: [],
      safety: { ok: true, blockedPatterns: [] },
      createdAt: new Date().toISOString()
    });

    const approved = await agent.post("/studio/changes/cs_native_task/approve").send({}).expect(200);
    const taskRunId = approved.body.taskRun.id;

    const applying = await request(app)
      .post(`/studio/task-runs/${taskRunId}/status`)
      .send({
        sessionId: pair.body.sessionId,
        connectorToken: pair.body.connectorToken,
        status: "applying"
      })
      .expect(200);
    expect(applying.body.taskRun.status).toBe("applying");

    await request(app)
      .post(`/studio/task-runs/${taskRunId}/observations`)
      .send({
        sessionId: pair.body.sessionId,
        kind: "validation_probe",
        status: "passed",
        summary: "Scene graph probe passed."
      })
      .expect(403);

    await request(app)
      .post(`/studio/task-runs/${taskRunId}/observations`)
      .send({
        sessionId: pair.body.sessionId,
        connectorToken: pair.body.connectorToken,
        kind: "validation_probe",
        status: "passed",
        summary: "Scene graph probe passed."
      })
      .expect(201);

    const screenshotBytes = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
      "base64"
    );
    await request(app)
      .post(`/studio/task-runs/${taskRunId}/screenshots?sessionId=${pair.body.sessionId}`)
      .set("Content-Type", "application/octet-stream")
      .send(screenshotBytes)
      .expect(403);

    const screenshot = await request(app)
      .post(`/studio/task-runs/${taskRunId}/screenshots?sessionId=${pair.body.sessionId}`)
      .set("Content-Type", "application/octet-stream")
      .set("X-Vectis-Connector-Token", pair.body.connectorToken)
      .set("X-Screenshot-Format", "Enum.StudioCaptureScreenshotFormat.Png")
      .send(screenshotBytes)
      .expect(201);
    expect(screenshot.body.attachment).toEqual(
      expect.objectContaining({ mimeType: "image/png", sizeBytes: screenshotBytes.length })
    );

    await agent.post(`/studio/task-runs/${taskRunId}/cancel`).send({}).expect(200);

    const patches = await request(app)
      .get(`/studio/session/${pair.body.sessionId}/pending-patches?connectorToken=${pair.body.connectorToken}`)
      .expect(200);
    expect(patches.body.patches).toHaveLength(0);

    const after = await agent.get("/bootstrap").expect(200);
    expect(after.body.studioTaskRuns).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: taskRunId, status: "cancelled" })])
    );
    expect(after.body.studioObservations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ taskRunId, kind: "validation_probe", status: "passed" }),
        expect.objectContaining({
          taskRunId,
          kind: "screenshot",
          status: "info",
          details: expect.objectContaining({ attachmentId: screenshot.body.attachment.id })
        })
      ])
    );
    expect(after.body.attachments).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ id: screenshot.body.attachment.id })])
    );
  });

  it("answers greetings without creating unsolicited code", async () => {
    const app = await createApp();
    const agent = request.agent(app);

    await agent.post("/auth/private-owner").send({}).expect(200);
    const bootstrap = await agent.get("/bootstrap").expect(200);
    const projectId = bootstrap.body.projects[0].id;
    const threadId = await createThread(agent, projectId);

    const chat = await agent
      .post(`/projects/${projectId}/chat`)
      .send({ threadId, prompt: "hello", mode: "changeset" })
      .expect(200);

    expect(chat.body.changeSet).toBeUndefined();
    expect(chat.body.assistantMessage.content).toBeTruthy();
  });

  it("skips the planning pass for direct tuning patches", async () => {
    const app = await createApp();
    const agent = request.agent(app);

    await agent.post("/auth/private-owner").send({}).expect(200);
    const bootstrap = await agent.get("/bootstrap").expect(200);
    const projectId = bootstrap.body.projects[0].id;

    const pair = await request(app)
      .post("/studio/pair")
      .send({ pluginVersion: "1.11.6" })
      .expect(201);

    await agent
      .post(`/projects/${projectId}/studio/pair-project`)
      .send({ pairingCode: pair.body.pairingCode })
      .expect(200);

    await request(app)
      .post("/studio/snapshot")
      .send({
        sessionId: pair.body.sessionId,
        connectorToken: pair.body.connectorToken,
        nodes: [
          {
            path: "ReplicatedStorage/Car/VehicleController",
            className: "ModuleScript",
            source: "return { MaxSpeed = 80, Acceleration = 20 }"
          }
        ]
      })
      .expect(201);

    const threadId = await createThread(agent, projectId);
    const chat = await agent
      .post(`/projects/${projectId}/chat`)
      .send({ threadId, prompt: "make the cars much faster", mode: "changeset", model: "gemini-3-flash-preview" })
      .expect(200);

    const labels = chat.body.changeSet.activity.map((step: { label: string }) => step.label);
    expect(labels).not.toContain("Prepared implementation route");
  });

  it("routes complex entry UI patches to non-Google safer models", async () => {
    expect(saferModelForPatch({
      mode: "changeset",
      selectedModel: "deepseek-v4-flash",
      prompt: "implement a double dash system and add top center HUD bars for dash cooldown and coins",
      plan: "starter",
      optimizationMode: "balanced"
    })).toBe("deepseek-v4-flash");

    expect(saferModelForPatch({
      mode: "changeset",
      selectedModel: "deepseek-v4-flash",
      prompt: "implement a double dash system and add top center HUD bars for dash cooldown and coins",
      plan: "pro",
      optimizationMode: "balanced"
    })).toBe("qwen3.7-max");
  });

  it("routes Gemini 3 Flash answers away from the flaky direct chat path", async () => {
    expect(stableAnswerModelFor({
      needsAnswer: true,
      selectedModel: "gemini-3-flash-preview",
      optimizationMode: "balanced"
    })).toBeUndefined();

    expect(stableAnswerModelFor({
      needsAnswer: false,
      selectedModel: "gemini-3-flash-preview",
      optimizationMode: "balanced"
    })).toBeUndefined();
  });

  it("keeps Plan Mode read only even for implementation requests", async () => {
    const app = await createApp();
    const agent = request.agent(app);

    await agent.post("/auth/private-owner").send({}).expect(200);
    const bootstrap = await agent.get("/bootstrap").expect(200);
    const projectId = bootstrap.body.projects[0].id;
    const org = await store.fetchOrganization(bootstrap.body.organization.id);
    expect(org).toBeTruthy();
    org!.plan = "pro";
    await store.saveOrganization(org!);
    const threadId = await createThread(agent, projectId);

    const chat = await agent
      .post(`/projects/${projectId}/chat`)
      .send({
        threadId,
        prompt: "Add a sprint system with stamina and a UI bar",
        mode: "changeset",
        planMode: true,
        model: "gemini-3-flash-preview"
      })
      .expect(200);

    expect(chat.body.changeSet).toBeUndefined();
    expect(chat.body.assistantMessage.changeSetId).toBeUndefined();
    expect(chat.body.assistantMessage.content).not.toContain("```");

    const after = await agent.get("/bootstrap").expect(200);
    const threadChangeSets = after.body.changeSets.filter((changeSet: { threadId: string }) => changeSet.threadId === threadId);
    expect(threadChangeSets).toHaveLength(0);
  });

  it("asks one no-cost clarification for ambiguous shop and rebirth UI backend scope", async () => {
    const app = await createApp();
    const agent = request.agent(app);

    await agent.post("/auth/private-owner").send({}).expect(200);
    const bootstrap = await agent.get("/bootstrap").expect(200);
    const projectId = bootstrap.body.projects[0].id;
    const startingCredits = bootstrap.body.creditBalance;
    const threadId = await createThread(agent, projectId);

    const clientRequestId = "visual-router-request-01";
    const chat = await agent
      .post(`/projects/${projectId}/chat`)
      .send({ threadId, clientRequestId, prompt: "create a nice rebirth and shop ui", mode: "changeset", model: "gemini-3-flash-preview" })
      .expect(200);

    expect(chat.body.changeSet).toBeUndefined();
    expect(chat.body.assistantMessage.modelUsed).toBe("vectis-router");
    expect(chat.body.userMessage.clientRequestId).toBe(clientRequestId);
    expect(chat.body.assistantMessage.clientRequestId).toBe(clientRequestId);
    expect(chat.body.assistantMessage.usageCostCredits).toBeUndefined();
    expect(chat.body.assistantMessage.content).toContain("visual-only UI");
    expect(chat.body.assistantMessage.content).toContain("player stats on the server");
    expect(chat.body.creditBalance).toBe(startingCredits);
  });

  it("uses the real AI model for shop and rebirth requests (no deterministic templates)", async () => {
    const app = await createApp();
    const agent = request.agent(app);

    await agent.post("/auth/private-owner").send({}).expect(200);
    const bootstrap = await agent.get("/bootstrap").expect(200);
    const projectId = bootstrap.body.projects[0].id;
    const threadId = await createThread(agent, projectId);

    await agent
      .post(`/projects/${projectId}/chat`)
      .send({ threadId, prompt: "create a nice rebirth and shop ui", mode: "changeset", model: "gemini-3-flash-preview" })
      .expect(200);

    const chat = await agent
      .post(`/projects/${projectId}/chat`)
      .send({ threadId, prompt: "both", mode: "explain", model: "gemini-3-flash-preview" })
      .expect(200);

    expect(chat.body.assistantMessage.modelUsed).not.toBe("vectis-recovery");
  });

  it("uses the real AI model for shop-only UI requests (no deterministic templates)", async () => {
    const app = await createApp();
    const agent = request.agent(app);

    await agent.post("/auth/private-owner").send({}).expect(200);
    const bootstrap = await agent.get("/bootstrap").expect(200);
    const projectId = bootstrap.body.projects[0].id;
    const threadId = await createThread(agent, projectId);

    const chat = await agent
      .post(`/projects/${projectId}/chat`)
      .send({ threadId, prompt: "generate a shop ui", mode: "changeset", model: "gemini-3-flash-preview" })
      .expect(200);

    expect(chat.body.assistantMessage.modelUsed).not.toBe("vectis-recovery");
  });

  it("uses the real AI model for generic UI requests (no deterministic templates)", async () => {
    const app = await createApp();
    const agent = request.agent(app);

    await agent.post("/auth/private-owner").send({}).expect(200);
    const bootstrap = await agent.get("/bootstrap").expect(200);
    const projectId = bootstrap.body.projects[0].id;
    const threadId = await createThread(agent, projectId);

    const chat = await agent
      .post(`/projects/${projectId}/chat`)
      .send({ threadId, prompt: "generate a nice looking ui", mode: "changeset", model: "gemini-3-flash-preview" })
      .expect(200);

    expect(chat.body.assistantMessage.modelUsed).not.toBe("vectis-recovery");
  });

  it("does not use the old brainrot frontend preset when capacity is gone", async () => {
    const app = await createApp();
    const agent = request.agent(app);

    await agent.post("/auth/private-owner").send({}).expect(200);
    const bootstrap = await agent.get("/bootstrap").expect(200);
    const projectId = bootstrap.body.projects[0].id;
    const startingCredits = bootstrap.body.creditBalance;
    const threadId = await createThread(agent, projectId);
    await store.tryDeductCredits(bootstrap.body.organization.id, startingCredits, "test drain - Context Tax");
    expect(await store.getCreditBalance(bootstrap.body.organization.id)).toBe(0);

    const chat = await agent
      .post(`/projects/${projectId}/chat`)
      .send({ threadId, prompt: "generate a really good looking brian rot txpe of ui", mode: "changeset", model: "gemini-3-flash-preview" })
      .expect(402);

    expect(chat.body).toMatchObject({
      error: "Usage limit reached",
      code: "usage_limit_reached",
      plan: "free",
      canTopUp: false,
      action: "upgrade"
    });
    expect(chat.body.message).toContain("Your Free weekly usage is used for now");
    expect(chat.body.message).not.toContain("Studio weekly capacity refill");
  });

  it("uses the real AI model for scenic spawn requests (no deterministic templates)", async () => {
    const app = await createApp();
    const agent = request.agent(app);

    await agent.post("/auth/private-owner").send({}).expect(200);
    const bootstrap = await agent.get("/bootstrap").expect(200);
    const projectId = bootstrap.body.projects[0].id;
    const threadId = await createThread(agent, projectId);

    const chat = await agent
      .post(`/projects/${projectId}/chat`)
      .send({ threadId, prompt: "i want you to place some trees and create a nice spawn", mode: "changeset", model: "gemini-3-flash-preview" })
      .expect(200);

    expect(chat.body.assistantMessage.modelUsed).not.toBe("vectis-recovery");
  });

  it("explains a blocked generation follow-up without charging another model turn", async () => {
    const app = await createApp();
    const agent = request.agent(app);

    await agent.post("/auth/private-owner").send({}).expect(200);
    const bootstrap = await agent.get("/bootstrap").expect(200);
    const projectId = bootstrap.body.projects[0].id;
    const startingCredits = bootstrap.body.creditBalance;
    const threadId = await createThread(agent, projectId);

    await store.saveMessage({
      id: "msg_blocked_test",
      projectId,
      threadId,
      role: "assistant",
      content: "I could not prepare a safe Studio patch.\n- quality: shop or rebirth panels need populated content",
      createdAt: new Date().toISOString()
    });

    const chat = await agent
      .post(`/projects/${projectId}/chat`)
      .send({ threadId, prompt: "what", mode: "changeset", model: "gemini-3-flash-preview" })
      .expect(200);

    expect(chat.body.changeSet).toBeUndefined();
    expect(chat.body.assistantMessage.modelUsed).toBe("vectis-router");
    expect(chat.body.assistantMessage.usageCostCredits).toBeUndefined();
    expect(chat.body.assistantMessage.content).toContain("shop or rebirth panels need populated content");
    expect(chat.body.creditBalance).toBe(startingCredits);
  });

  it("asks the user to choose one patch for broad recommendation follow-ups", async () => {
    const app = await createApp();
    const agent = request.agent(app);

    await agent.post("/auth/private-owner").send({}).expect(200);
    const bootstrap = await agent.get("/bootstrap").expect(200);
    const projectId = bootstrap.body.projects[0].id;
    const startingCredits = bootstrap.body.creditBalance;
    const threadId = await createThread(agent, projectId);

    await store.saveMessage({
      id: "msg_recommendation_test",
      projectId,
      threadId,
      role: "assistant",
      content: "The most immediate improvement I recommend is removing the giant baseplate. Also optimize parts, resolve duplicate spawn locations, and add a game manager.",
      createdAt: new Date().toISOString()
    });

    const chat = await agent
      .post(`/projects/${projectId}/chat`)
      .send({ threadId, prompt: "go ahead and implement everything you were talking about", mode: "changeset", model: "gemini-3-flash-preview" })
      .expect(200);

    expect(chat.body.changeSet).toBeUndefined();
    expect(chat.body.assistantMessage.modelUsed).toBe("vectis-router");
    expect(chat.body.assistantMessage.usageCostCredits).toBeUndefined();
    expect(chat.body.assistantMessage.content).toContain("multiple separate improvements");
    expect(chat.body.creditBalance).toBe(startingCredits);
  });

  it("answers thread usage from stored message costs", async () => {
    const app = await createApp();
    const agent = request.agent(app);

    await agent.post("/auth/private-owner").send({}).expect(200);
    const bootstrap = await agent.get("/bootstrap").expect(200);
    const projectId = bootstrap.body.projects[0].id;
    const startingCredits = bootstrap.body.creditBalance;
    const threadId = await createThread(agent, projectId);

    await store.saveMessage({
      id: "msg_cost_user",
      projectId,
      threadId,
      role: "user",
      content: "make a shop",
      createdAt: new Date().toISOString()
    });
    await store.saveMessage({
      id: "msg_cost_assistant",
      projectId,
      threadId,
      role: "assistant",
      content: "Prepared a patch.",
      usageCostCredits: 42,
      createdAt: new Date().toISOString()
    });

    const chat = await agent
      .post(`/projects/${projectId}/chat`)
      .send({ threadId, prompt: "how many credits did this chat cost me in total", mode: "changeset", model: "gemini-3-flash-preview" })
      .expect(200);

    expect(chat.body.changeSet).toBeUndefined();
    expect(chat.body.assistantMessage.modelUsed).toBe("vectis-router");
    expect(chat.body.assistantMessage.content).toContain("used 84%");
    expect(chat.body.creditBalance).toBe(startingCredits);
  });

  it("answers auto-sync status prompts without charging or asking for repeated manual sync", async () => {
    const app = await createApp();
    const agent = request.agent(app);

    await agent.post("/auth/private-owner").send({}).expect(200);
    const bootstrap = await agent.get("/bootstrap").expect(200);
    const projectId = bootstrap.body.projects[0].id;
    const startingCredits = bootstrap.body.creditBalance;
    const threadId = await createThread(agent, projectId);

    const chat = await agent
      .post(`/projects/${projectId}/chat`)
      .send({ threadId, prompt: "i cant sync it, you need to auto sync", mode: "changeset", model: "gemini-3-flash-preview" })
      .expect(200);

    expect(chat.body.changeSet).toBeUndefined();
    expect(chat.body.assistantMessage.modelUsed).toBe("vectis-router");
    expect(chat.body.assistantMessage.usageCostCredits).toBeUndefined();
    expect(chat.body.assistantMessage.content).toContain("Auto-sync runs from the Studio plugin");
    expect(chat.body.creditBalance).toBe(startingCredits);
  });

  it("dismisses ready changes and keeps them out of Studio queues", async () => {
    const app = await createApp();
    const agent = request.agent(app);

    await agent.post("/auth/private-owner").send({}).expect(200);
    const bootstrap = await agent.get("/bootstrap").expect(200);
    const projectId = bootstrap.body.projects[0].id;

    const pair = await request(app)
      .post("/studio/pair")
      .send({ pluginVersion: "test" })
      .expect(201);

    await agent
      .post(`/projects/${projectId}/studio/pair-project`)
      .send({ pairingCode: pair.body.pairingCode })
      .expect(200);

    await request(app)
      .post("/studio/snapshot")
      .send({
        sessionId: pair.body.sessionId,
        connectorToken: pair.body.connectorToken,
        nodes: [{ path: "ServerScriptService/Main", className: "Script", source: "print('hi')" }]
      })
      .expect(201);

    const threadId = await createThread(agent, projectId);
    const chat = await agent
      .post(`/projects/${projectId}/chat`)
      .send({ threadId, prompt: "Add a sprint mechanic", mode: "changeset" })
      .expect(200);

    const balanceBeforeDismiss = await store.getCreditBalance(bootstrap.body.organization.id);
    const dismissed = await agent
      .post(`/studio/changes/${chat.body.changeSet.id}/dismiss`)
      .send({})
      .expect(200);
    expect(dismissed.body.changeSet.status).toBe("rejected");
    const balanceAfterDismiss = await store.getCreditBalance(bootstrap.body.organization.id);
    expect(balanceAfterDismiss).toBeGreaterThanOrEqual(balanceBeforeDismiss);

    // Concurrent/double dismiss must not issue a second refund.
    await agent
      .post(`/studio/changes/${chat.body.changeSet.id}/dismiss`)
      .send({})
      .expect(409);
    expect(await store.getCreditBalance(bootstrap.body.organization.id)).toBe(balanceAfterDismiss);

    const pending = await request(app)
      .get(`/studio/changes/pending?sessionId=${pair.body.sessionId}&connectorToken=${pair.body.connectorToken}`)
      .expect(200);
    expect(pending.body.changeSets).toHaveLength(0);

    const patches = await request(app)
      .get(`/studio/session/${pair.body.sessionId}/pending-patches?connectorToken=${pair.body.connectorToken}`)
      .expect(200);
    expect(patches.body.patches).toHaveLength(0);

    await agent
      .post(`/studio/changes/${chat.body.changeSet.id}/approve`)
      .send({})
      .expect(409);
  });

  it("rejects dismiss for foreign or already-approved change sets", async () => {
    const app = await createApp();
    const owner = request.agent(app);

    await owner.post("/auth/private-owner").send({}).expect(200);
    const bootstrap = await owner.get("/bootstrap").expect(200);
    const projectId = bootstrap.body.projects[0].id;

    const pair = await request(app)
      .post("/studio/pair")
      .send({ pluginVersion: "test" })
      .expect(201);

    await owner
      .post(`/projects/${projectId}/studio/pair-project`)
      .send({ pairingCode: pair.body.pairingCode })
      .expect(200);

    await request(app)
      .post("/studio/snapshot")
      .send({
        sessionId: pair.body.sessionId,
        connectorToken: pair.body.connectorToken,
        nodes: [{ path: "ServerScriptService/Main", className: "Script", source: "print('hi')" }]
      })
      .expect(201);

    const threadId = await createThread(owner, projectId);
    const chat = await owner
      .post(`/projects/${projectId}/chat`)
      .send({ threadId, prompt: "Add a shop prompt", mode: "changeset" })
      .expect(200);

    const outsiderUser = await store.upsertGoogleUser({
      googleUserId: "outsider",
      name: "Outside User",
      email: "outside@example.com"
    });
    const outsiderSession = await store.createAuthSession(outsiderUser.id);
    await request(app)
      .post(`/studio/changes/${chat.body.changeSet.id}/dismiss`)
      .set("Cookie", `ras_session=${outsiderSession.id}`)
      .send({})
      .expect(403);

    await owner
      .post(`/studio/changes/${chat.body.changeSet.id}/approve`)
      .send({})
      .expect(200);

    await owner
      .post(`/studio/changes/${chat.body.changeSet.id}/dismiss`)
      .send({})
      .expect(409);
  });

  it("allows Free workspaces to create additional projects", async () => {
    const app = await createApp();
    const agent = request.agent(app);
    await agent.post("/auth/private-owner").send({}).expect(200);

    await agent
      .post("/projects")
      .send({ name: "Second Game", template: "simulator", description: "" })
      .expect(201);
  });

  it("allows Starter to create unlimited projects", async () => {
    const app = await createApp();
    const agent = request.agent(app);
    await agent.post("/auth/private-owner").send({}).expect(200);
    const bootstrap = await agent.get("/bootstrap").expect(200);
    const org = await store.fetchOrganization(bootstrap.body.organization.id);
    expect(org).toBeTruthy();
    org!.plan = "starter";
    await store.saveOrganization(org!);
    await store.addCredits(org!.id, 900, "Test Starter capacity");

    await agent
      .post("/projects")
      .send({ name: "Second Game", template: "simulator", description: "" })
      .expect(201);
    await agent
      .post("/projects")
      .send({ name: "Third Game", template: "tycoon", description: "" })
      .expect(201);
    await agent
      .post("/projects")
      .send({ name: "Fourth Game", template: "obby", description: "" })
      .expect(201);
  });

  it("enforces model and Plan Mode entitlements by plan", async () => {
    const app = await createApp();
    const agent = request.agent(app);
    await agent.post("/auth/private-owner").send({}).expect(200);
    const bootstrap = await agent.get("/bootstrap").expect(200);
    const projectId = bootstrap.body.projects[0].id;
    const org = await store.fetchOrganization(bootstrap.body.organization.id);
    expect(org).toBeTruthy();
    const threadId = await createThread(agent, projectId);

    await agent
      .post(`/projects/${projectId}/chat`)
      .send({ threadId, prompt: "what do you see", mode: "changeset", model: "gemini-3.1-pro-preview" })
      .expect(403);

    org!.plan = "starter";
    await store.saveOrganization(org!);
    await store.addCredits(org!.id, 900, "Test Starter capacity");
    await agent
      .post(`/projects/${projectId}/chat`)
      .send({ threadId, prompt: "what do you see", mode: "changeset", planMode: true })
      .expect(403);

    org!.plan = "pro";
    await store.saveOrganization(org!);
    await store.addCredits(org!.id, 1500, "Test Pro capacity");
    await agent
      .post(`/projects/${projectId}/chat`)
      .send({ threadId, prompt: "what do you see", mode: "changeset", model: "gemini-3.5-flash", planMode: true })
      .expect(200);

    org!.plan = "studio";
    await store.saveOrganization(org!);
    await agent
      .post(`/projects/${projectId}/chat`)
      .send({ threadId, prompt: "Inspect the current structure", mode: "changeset", model: "gemini-3.1-pro-preview", planMode: true })
      .expect(200);
  });

  it("refills plans to weekly capacity without reducing extra Studio usage", async () => {
    const app = await createApp();
    await request(app).post("/auth/private-owner").send({}).expect(200);
    const user = await store.findUserByPrivateProvider();
    expect(user).toBeTruthy();
    const org = await store.fetchOrganizationForUser(user!.id);
    expect(org).toBeTruthy();

    org!.plan = "starter";
    org!.lastRefillAt = "2020-01-01T00:00:00.000Z";
    await store.saveOrganization(org!);
    await store.checkWeeklyRefill(org!.id);
    expect(await store.getCreditBalance(org!.id)).toBe(1000);

    await store.addCredits(org!.id, 4000, "Studio top-up test");
    org!.plan = "studio";
    org!.lastRefillAt = "2020-01-01T00:00:00.000Z";
    await store.saveOrganization(org!);
    await store.checkWeeklyRefill(org!.id);
    expect(await store.getCreditBalance(org!.id)).toBe(5000);

    const usage = await store.getUsageStats(org!.id);
    expect(usage.weekly.allowance).toBe(5000);
    expect(usage.monthly.allowance).toBe(20000);
  });

  it("enforces fixed monthly plan credits separately from weekly refills", async () => {
    const app = await createApp();
    await request(app).post("/auth/private-owner").send({}).expect(200);
    const user = await store.findUserByPrivateProvider();
    const org = await store.fetchOrganizationForUser(user!.id);
    expect(org).toBeTruthy();

    org!.plan = "starter";
    await store.saveOrganization(org!);
    await store.addCredits(org!.id, 10000, "Initial workspace credits for cap test");

    const tooLarge = await store.tryDeductCredits(org!.id, 4001, "AI response (test) - Context Tax");
    expect(tooLarge.ok).toBe(false);

    const allowed = await store.tryDeductCredits(org!.id, 4000, "AI response (test) - Context Tax");
    expect(allowed.ok).toBe(true);

    const usage = await store.getUsageStats(org!.id);
    expect(usage.monthly.used).toBe(4000);
    expect(usage.monthly.remaining).toBe(0);
  });

  it("finalizes accepted chat responses even when final monthly capacity is tight", async () => {
    const app = await createApp();
    const agent = request.agent(app);

    await agent.post("/auth/private-owner").send({}).expect(200);
    const bootstrap = await agent.get("/bootstrap").expect(200);
    const projectId = bootstrap.body.projects[0].id;
    const org = await store.fetchOrganization(bootstrap.body.organization.id);
    expect(org).toBeTruthy();
    org!.plan = "starter";
    await store.saveOrganization(org!);
    const startingBalance = await store.getCreditBalance(org!.id);
    if (startingBalance !== 0) {
      await store.addCredits(org!.id, -startingBalance, "Manual test balance reset");
    }
    await store.addCredits(org!.id, -3994, "AI response (test) - Context Tax");
    await store.addCredits(org!.id, 4000, "Manual test balance");
    expect(await store.getCreditBalance(org!.id)).toBe(6);
    expect((await store.getUsageStats(org!.id)).monthly.remaining).toBe(6);

    const threadId = await createThread(agent, projectId);
    const chat = await agent
      .post(`/projects/${projectId}/chat`)
      .send({ threadId, prompt: "what is this project about?", mode: "explain", model: "gemini-3-flash-preview" })
      .expect(200);

    expect(chat.body.assistantMessage.usageCostCredits).toBeUndefined();
    const storedAssistant = await store.fetchMessage(chat.body.assistantMessage.id);
    expect(storedAssistant?.usageCostCredits).toBe(6);
    expect(chat.body.creditBalance).toBe(0);
    const usage = await store.getUsageStats(org!.id);
    expect(usage.monthly.used).toBeGreaterThanOrEqual(3994);
    expect(usage.monthly.remaining).toBe(0);
  });

  it("allows admin email access without a hidden developer plan", async () => {
    const originalAdminEmails = [...config.adminEmails];
    config.adminEmails = ["admin@example.com"];
    const app = await createApp();
    const admin = await store.upsertGoogleUser({
      googleUserId: "admin-google",
      name: "Admin",
      email: "admin@example.com"
    });
    const target = await store.upsertGoogleUser({
      googleUserId: "target-google",
      name: "Target",
      email: "target@example.com"
    });
    await store.upsertFirebaseUser({
      firebaseUserId: "target-firebase",
      name: "Target Duplicate",
      email: "target@example.com"
    });
    const adminSession = await store.createAuthSession(admin.id);
    const targetSession = await store.createAuthSession(target.id);
    const adminCookie = `ras_session=${adminSession.id}`;
    const targetCookie = `ras_session=${targetSession.id}`;

    await request(app).get("/admin/users").set("Cookie", targetCookie).expect(404);
    await request(app).get("/admin/payments").set("Cookie", targetCookie).expect(404);
    const users = await request(app).get("/admin/users").set("Cookie", adminCookie).expect(200);
    expect(users.body.users.length).toBeGreaterThanOrEqual(2);
    expect(users.body.total).toBeGreaterThanOrEqual(2);
    expect(users.body.users.filter((user: { email?: string }) => user.email === "target@example.com")).toHaveLength(1);

    const firstUserPage = await request(app).get("/admin/users?limit=1").set("Cookie", adminCookie).expect(200);
    expect(firstUserPage.body.users).toHaveLength(1);
    expect(firstUserPage.body.nextCursor).toEqual(expect.any(String));
    const secondUserPage = await request(app)
      .get(`/admin/users?limit=1&cursor=${encodeURIComponent(firstUserPage.body.nextCursor)}`)
      .set("Cookie", adminCookie)
      .expect(200);
    expect(secondUserPage.body.users).toHaveLength(1);
    expect(secondUserPage.body.users[0].id).not.toBe(firstUserPage.body.users[0].id);

    const payments = await request(app).get("/admin/payments").set("Cookie", adminCookie).expect(200);
    expect(payments.body.security.secretExposedToClient).toBe(false);
    expect(payments.body.security.webhookSignatureRequired).toBe(true);
    expect(payments.body.localWorkspaces.length).toBeGreaterThanOrEqual(2);

    const planUpdate = await request(app)
      .patch(`/admin/users/${target.id}/plan`)
      .set("Cookie", adminCookie)
      .send({ plan: "studio" })
      .expect(200);
    expect(planUpdate.body.user.plan).toBe("studio");
    expect(planUpdate.body.user.credits).toBe(20000);

    const directGrant = await request(app)
      .post(`/admin/users/${target.id}/credits`)
      .set("Cookie", adminCookie)
      .send({ delta: 250, reason: "Manual admin credit grant" })
      .expect(200);
    expect(directGrant.body.user.credits).toBe(20250);
    const evidence = await request(app)
      .get(`/admin/users/${target.id}/evidence`)
      .set("Cookie", adminCookie)
      .expect(200);
    expect(evidence.body.organization).toMatchObject({
      id: expect.any(String),
      plan: "studio"
    });
    expect(evidence.body.snapshot).toMatchObject({
      plan: "studio",
      creditBalance: 20250,
      weeklyAllowance: 5000,
      projectCount: expect.any(Number),
      lastIp: expect.any(String)
    });
    expect(evidence.body.counts.total).toBeGreaterThanOrEqual(2);

    const evidenceCsv = await request(app)
      .get(`/admin/users/${target.id}/evidence.csv`)
      .set("Cookie", adminCookie)
      .expect(200);
    expect(evidenceCsv.text).toContain("snapshot");
    expect(evidenceCsv.text).toContain("creditBalance");

    const grant = await request(app)
      .post(`/admin/users/${target.id}/usage-adjustment`)
      .set("Cookie", adminCookie)
      .send({ deltaPercent: 10, reason: "Manual QA grant" })
      .expect(200);
    expect(grant.body.user.credits).toBe(22250);

    const revoke = await request(app)
      .post(`/admin/users/${target.id}/usage-adjustment`)
      .set("Cookie", adminCookie)
      .send({ deltaPercent: -20, reason: "Manual QA revoke" })
      .expect(200);
    expect(revoke.body.user.credits).toBe(18250);

    const targetOrg = await store.fetchOrganizationForUser(target.id);
    expect(targetOrg).toBeTruthy();
    await store.addCredits(targetOrg!.id, -1000, "AI response (admin reset test) - Context Tax");
    expect((await store.getUsageStats(targetOrg!.id)).monthly.used).toBe(1000);
    const reset = await request(app)
      .post(`/admin/users/${target.id}/usage-reset`)
      .set("Cookie", adminCookie)
      .expect(200);
    expect(reset.body.resetCredits).toBe(1000);
    expect(reset.body.user.credits).toBe(18250);
    expect((await store.getUsageStats(targetOrg!.id)).monthly.used).toBe(0);
    config.adminEmails = originalAdminEmails;
  });

  it("rejects unknown or excessive admin evaluation models", async () => {
    const originalAdminEmails = [...config.adminEmails];
    config.adminEmails = ["admin@example.com"];
    try {
      const app = await createApp();
      const admin = await store.upsertGoogleUser({
        googleUserId: "admin-eval-google",
        name: "Admin Eval",
        email: "admin@example.com"
      });
      const session = await store.createAuthSession(admin.id);
      const adminCookie = `ras_session=${session.id}`;

      await request(app)
        .post("/admin/evaluations/run")
        .set("Cookie", adminCookie)
        .send({ promptId: "custom", customPromptText: "Test", models: ["unknown-model"] })
        .expect(400);

      await request(app)
        .post("/admin/evaluations/run")
        .set("Cookie", adminCookie)
        .send({
          promptId: "custom",
          customPromptText: "Test",
          models: [
            "gemini-3.5-flash",
            "gemini-3.1-pro-preview",
            "deepseek-v4-flash",
            "qwen3.7-max",
            "gpt-5.5",
            "claude-opus-4-8",
            "glm-5.2"
          ]
        })
        .expect(400);
    } finally {
      config.adminEmails = originalAdminEmails;
    }
  });

  it("answers tiny project structure inspection without provider latency", async () => {
    const app = await createApp();
    const agent = request.agent(app);
    await agent.post("/auth/private-owner").send({}).expect(200);
    const bootstrap = await agent.get("/bootstrap").expect(200);
    const projectId = bootstrap.body.projects[0].id;
    const thread = await agent.post(`/projects/${projectId}/threads`).send({ name: "Structure check" }).expect(201);

    await store.saveSnapshot({
      id: "snapshot_tiny_structure",
      projectId,
      studioSessionId: "session_tiny_structure",
      nodes: [
        { path: "Workspace", className: "Workspace" },
        { path: "Workspace/Baseplate", className: "Part" },
        { path: "Workspace/SpawnLocation", className: "SpawnLocation" },
        { path: "ServerScriptService", className: "ServerScriptService" },
        { path: "ReplicatedStorage", className: "ReplicatedStorage" },
        { path: "StarterGui", className: "StarterGui" },
        { path: "StarterPlayer", className: "StarterPlayer" },
        { path: "Lighting", className: "Lighting" },
        { path: "SoundService", className: "SoundService" }
      ],
      createdAt: new Date().toISOString()
    });

    const response = await agent
      .post(`/projects/${projectId}/chat`)
      .send({
        threadId: thread.body.thread.id,
        prompt: "Inspect my project structure and suggest what to improve first.",
        mode: "explain",
        model: "gemini-3.5-flash"
      })
      .expect(200);

    expect(response.body.assistantMessage.modelUsed).toBe("vectis-router");
    expect(response.body.assistantMessage.thoughtDurationMs).toBe(0);
    expect(response.body.assistantMessage.content).toContain("9 synced instances");
    expect(response.body.assistantMessage.content).toContain("Get one checkpoint loop working");
  });

  it("limits extra usage checkout to Studio workspaces", async () => {
    const app = await createApp();
    const agent = request.agent(app);
    await agent.post("/auth/private-owner").send({}).expect(200);
    const bootstrap = await agent.get("/bootstrap").expect(200);
    const org = await store.fetchOrganization(bootstrap.body.organization.id);
    expect(org).toBeTruthy();

    await agent.post("/billing/top-up").send({ pack: "small", immediateAccessRequested: true, withdrawalAcknowledged: true }).expect(403);

    org!.plan = "studio";
    await store.saveOrganization(org!);
    await agent.post("/billing/top-up").send({ pack: "small", immediateAccessRequested: true, withdrawalAcknowledged: true }).expect(503);
  });

  it("rejects chat requests for missing or foreign threads", async () => {
    const app = await createApp();
    const agent = request.agent(app);

    await agent.post("/auth/private-owner").send({}).expect(200);
    const bootstrap = await agent.get("/bootstrap").expect(200);
    const projectId = bootstrap.body.projects[0].id;

    await agent
      .post(`/projects/${projectId}/chat`)
      .send({ threadId: "thread_missing", prompt: "what do you see", mode: "changeset" })
      .expect(404);
  });

  it("requires connector tokens for Studio snapshot and pending reads", async () => {
    const app = await createApp();
    const agent = request.agent(app);

    await agent.post("/auth/private-owner").send({}).expect(200);
    const bootstrap = await agent.get("/bootstrap").expect(200);
    const projectId = bootstrap.body.projects[0].id;

    const pair = await request(app)
      .post("/studio/pair")
      .send({ pluginVersion: "test" })
      .expect(201);

    await agent
      .post(`/projects/${projectId}/studio/pair-project`)
      .send({ pairingCode: pair.body.pairingCode })
      .expect(200);

    await request(app)
      .post("/studio/snapshot")
      .send({
        sessionId: pair.body.sessionId,
        nodes: [{ path: "ServerScriptService/Main", className: "Script", source: "print('hi')" }]
      })
      .expect(403);

    await request(app)
      .post("/studio/snapshot")
      .send({
        sessionId: pair.body.sessionId,
        connectorToken: "wrong",
        nodes: [{ path: "ServerScriptService/Main", className: "Script", source: "print('hi')" }]
      })
      .expect(403);

    await request(app)
      .get(`/studio/changes/pending?sessionId=${pair.body.sessionId}`)
      .expect(403);

    await request(app)
      .get(`/studio/changes/pending?sessionId=${pair.body.sessionId}&connectorToken=wrong`)
      .expect(403);
  });

  it("accepts header connector auth, rotates tokens after pairing, and keeps legacy query auth during rollout", async () => {
    const app = await createApp();
    const agent = request.agent(app);

    await agent.post("/auth/private-owner").send({}).expect(200);
    const bootstrap = await agent.get("/bootstrap").expect(200);
    const projectId = bootstrap.body.projects[0].id;
    const pair = await request(app)
      .post("/studio/pair")
      .send({ pluginVersion: "test" })
      .expect(201);

    const claim = await agent
      .post(`/projects/${projectId}/studio/pair-project`)
      .send({ pairingCode: pair.body.pairingCode })
      .expect(200);
    const rotatedToken = claim.body.session.connectorToken;

    expect(rotatedToken).not.toBe(pair.body.connectorToken);
    expect(claim.body.session.previousConnectorToken).toBe(pair.body.connectorToken);

    const heartbeat = await request(app)
      .get(`/studio/session/${pair.body.sessionId}`)
      .set("X-Vectis-Connector-Token", pair.body.connectorToken)
      .expect(200);
    expect(heartbeat.body.session.connectorToken).toBe(rotatedToken);

    await request(app)
      .post("/studio/snapshot")
      .set("X-Vectis-Connector-Token", rotatedToken)
      .send({
        sessionId: pair.body.sessionId,
        nodes: [{ path: "Workspace/HeaderAuthPart", className: "Part" }]
      })
      .expect(201);

    const headerPatches = await request(app)
      .get(`/studio/session/${pair.body.sessionId}/pending-patches`)
      .set("X-Vectis-Connector-Token", rotatedToken)
      .expect(200);
    expect(headerPatches.body.patches).toEqual([]);

    await request(app)
      .get(`/studio/session/${pair.body.sessionId}/pending-patches?connectorToken=${pair.body.connectorToken}`)
      .expect(200);
  });

  it("queues and resolves Studio commands through the poll loop", async () => {
    const app = await createApp();
    const agent = request.agent(app);

    await agent.post("/auth/private-owner").send({}).expect(200);
    const bootstrap = await agent.get("/bootstrap").expect(200);
    const projectId = bootstrap.body.projects[0].id;
    const pair = await request(app)
      .post("/studio/pair")
      .send({ pluginVersion: "test" })
      .expect(201);

    await agent.post(`/projects/${projectId}/studio/pair-project`).send({ pairingCode: pair.body.pairingCode }).expect(200);

    const commandPromise = queueStudioCommand(pair.body.sessionId, {
      id: "test_cmd_1",
      type: "read_output",
      arguments: { limit: 5 }
    });

    const poll = await request(app)
      .get(`/studio/session/${pair.body.sessionId}/poll`)
      .set("X-Vectis-Connector-Token", pair.body.connectorToken)
      .expect(200);
    expect(poll.body.commands).toEqual([
      { id: "test_cmd_1", type: "read_output", arguments: { limit: 5 } }
    ]);

    const resultResponse = await request(app)
      .post(`/studio/session/${pair.body.sessionId}/command-result`)
      .set("X-Vectis-Connector-Token", pair.body.connectorToken)
      .send({
        sessionId: pair.body.sessionId,
        commandId: "test_cmd_1",
        status: "ok",
        result: { messages: [{ level: "info", message: "hello" }] }
      })
      .expect(200);
    expect(resultResponse.body.ok).toBe(true);

    const result = await commandPromise;
    expect(result.messages).toBeDefined();
    expect(result.messages[0].message).toBe("hello");
  });

  it("revokes previous Studio connector tokens on manual rotation", async () => {
    const app = await createApp();
    const agent = request.agent(app);

    await agent.post("/auth/private-owner").send({}).expect(200);
    const bootstrap = await agent.get("/bootstrap").expect(200);
    const projectId = bootstrap.body.projects[0].id;
    const pair = await request(app)
      .post("/studio/pair")
      .send({ pluginVersion: "test" })
      .expect(201);

    const claim = await agent
      .post(`/projects/${projectId}/studio/pair-project`)
      .send({ pairingCode: pair.body.pairingCode })
      .expect(200);
    const claimedToken = claim.body.session.connectorToken;

    const rotation = await agent
      .post(`/studio/sessions/${pair.body.sessionId}/rotate-token`)
      .send({})
      .expect(200);

    expect(rotation.body.connectorToken).not.toBe(claimedToken);

    await request(app)
      .get(`/studio/session/${pair.body.sessionId}/pending-patches`)
      .set("X-Vectis-Connector-Token", claimedToken)
      .expect(401);

    await request(app)
      .get(`/studio/session/${pair.body.sessionId}/pending-patches`)
      .set("X-Vectis-Connector-Token", rotation.body.connectorToken)
      .expect(200);
  });

  it("expires elapsed Studio sessions before accepting bridge writes", async () => {
    const app = await createApp();
    const agent = request.agent(app);

    await agent.post("/auth/private-owner").send({}).expect(200);
    const bootstrap = await agent.get("/bootstrap").expect(200);
    const projectId = bootstrap.body.projects[0].id;
    const pair = await request(app).post("/studio/pair").send({ pluginVersion: "test" }).expect(201);
    await agent.post(`/projects/${projectId}/studio/pair-project`).send({ pairingCode: pair.body.pairingCode }).expect(200);

    const session = await store.fetchStudioSession(pair.body.sessionId);
    expect(session).toBeTruthy();
    session!.expiresAt = new Date(Date.now() - 1000).toISOString();
    await store.saveStudioSession(session!);

    const heartbeat = await request(app)
      .get(`/studio/session/${pair.body.sessionId}`)
      .set("X-Vectis-Connector-Token", pair.body.connectorToken)
      .expect(200);
    expect(heartbeat.body.session.status).toBe("expired");
    expect(heartbeat.body.session.disconnectReason).toContain("expired");

    await request(app)
      .post("/studio/snapshot")
      .set("X-Vectis-Connector-Token", pair.body.connectorToken)
      .send({ sessionId: pair.body.sessionId, nodes: [] })
      .expect(403);
  });

  it("merges delta snapshots into the full project context", async () => {
    const app = await createApp();
    const agent = request.agent(app);

    await agent.post("/auth/private-owner").send({}).expect(200);
    const bootstrap = await agent.get("/bootstrap").expect(200);
    const projectId = bootstrap.body.projects[0].id;

    const pair = await request(app)
      .post("/studio/pair")
      .send({ pluginVersion: "test" })
      .expect(201);

    await agent
      .post(`/projects/${projectId}/studio/pair-project`)
      .send({ pairingCode: pair.body.pairingCode })
      .expect(200);

    await request(app)
      .post("/studio/snapshot")
      .send({
        sessionId: pair.body.sessionId,
        connectorToken: pair.body.connectorToken,
        mode: "full",
        nodes: [
          { path: "ServerScriptService/ProductionSystem", className: "Script", source: "print('old')" },
          { path: "ReplicatedStorage/CashCollectedEffect", className: "RemoteEvent" }
        ]
      })
      .expect(201);

    await request(app)
      .post("/studio/snapshot")
      .send({
        sessionId: pair.body.sessionId,
        connectorToken: pair.body.connectorToken,
        mode: "delta",
        nodes: [
          { path: "ServerScriptService/ProductionSystem", className: "Script", source: "print('new')" }
        ]
      })
      .expect(201);

    const afterDelta = await agent.get("/bootstrap").expect(200);
    expect(afterDelta.body.snapshots[0].nodes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: "ServerScriptService/ProductionSystem", source: "print('new')" }),
        expect.objectContaining({ path: "ReplicatedStorage/CashCollectedEffect", className: "RemoteEvent" })
      ])
    );

    await request(app)
      .post("/studio/snapshot")
      .send({
        sessionId: pair.body.sessionId,
        connectorToken: pair.body.connectorToken,
        mode: "delta",
        nodes: [
          { path: "ReplicatedStorage/CashCollectedEffect", className: "RemoteEvent", deleted: true }
        ]
      })
      .expect(201);

    const afterDelete = await agent.get("/bootstrap").expect(200);
    expect(afterDelete.body.snapshots[0].nodes.some((node: { path: string }) => node.path === "ReplicatedStorage/CashCollectedEffect")).toBe(false);
  });

  it("assembles chunked Studio snapshots before saving project context", async () => {
    const app = await createApp();
    const agent = request.agent(app);

    await agent.post("/auth/private-owner").send({}).expect(200);
    const bootstrap = await agent.get("/bootstrap").expect(200);
    const projectId = bootstrap.body.projects[0].id;

    const pair = await request(app)
      .post("/studio/pair")
      .send({ pluginVersion: "test" })
      .expect(201);

    await agent
      .post(`/projects/${projectId}/studio/pair-project`)
      .send({ pairingCode: pair.body.pairingCode })
      .expect(200);

    const first = await request(app)
      .post("/studio/snapshot")
      .send({
        sessionId: pair.body.sessionId,
        connectorToken: pair.body.connectorToken,
        mode: "full",
        chunk: { id: "upload_test", index: 1, total: 2, totalNodeCount: 3 },
        nodes: [
          { path: "ServerScriptService/Main", className: "Script", source: "print('one')" }
        ]
      })
      .expect(202);
    expect(first.body.pending).toBe(true);
    expect(first.body.receivedChunks).toBe(1);

    const second = await request(app)
      .post("/studio/snapshot")
      .send({
        sessionId: pair.body.sessionId,
        connectorToken: pair.body.connectorToken,
        mode: "full",
        chunk: { id: "upload_test", index: 2, total: 2, totalNodeCount: 3 },
        nodes: [
          { path: "ReplicatedStorage/Signals", className: "Folder" },
          { path: "ReplicatedStorage/Signals/Jumped", className: "RemoteEvent" }
        ]
      })
      .expect(201);
    expect(second.body.upload).toMatchObject({ id: "upload_test", chunks: 2, nodes: 3 });

    const after = await agent.get("/bootstrap").expect(200);
    expect(after.body.snapshots[0].nodes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: "ServerScriptService/Main", source: "print('one')" }),
        expect.objectContaining({ path: "ReplicatedStorage/Signals", className: "Folder" }),
        expect.objectContaining({ path: "ReplicatedStorage/Signals/Jumped", className: "RemoteEvent" })
      ])
    );
  });

  it("meters Studio sync with a small throttle and daily cap", async () => {
    const app = await createApp();
    const agent = request.agent(app);

    await agent.post("/auth/private-owner").send({}).expect(200);
    const bootstrap = await agent.get("/bootstrap").expect(200);
    const projectId = bootstrap.body.projects[0].id;
    const orgId = bootstrap.body.organization.id;

    const pair = await request(app)
      .post("/studio/pair")
      .send({ pluginVersion: "test" })
      .expect(201);

    await agent
      .post(`/projects/${projectId}/studio/pair-project`)
      .send({ pairingCode: pair.body.pairingCode })
      .expect(200);

    const largeSource = "x".repeat(80 * 1024);
    const first = await request(app)
      .post("/studio/snapshot")
      .send({
        sessionId: pair.body.sessionId,
        connectorToken: pair.body.connectorToken,
        mode: "delta",
        nodes: [{ path: "ServerScriptService/LargeSync", className: "Script", source: largeSource }]
      })
      .expect(201);

    expect(first.body.sync.status).toBe("charged");
    expect(first.body.sync.chargedCredits).toBe(1);

    const second = await request(app)
      .post("/studio/snapshot")
      .send({
        sessionId: pair.body.sessionId,
        connectorToken: pair.body.connectorToken,
        mode: "delta",
        nodes: [{ path: "ServerScriptService/LargeSync2", className: "Script", source: largeSource }]
      })
      .expect(201);

    expect(second.body.sync.status).toBe("throttled");
    expect(second.body.sync.chargedCredits).toBe(0);

    const ledger = await store.fetchLedgerForOrganization(orgId);
    const syncEntries = ledger.filter((entry) => /^Studio sync metering\b/.test(entry.reason));
    expect(syncEntries).toHaveLength(1);
    expect(syncEntries[0].delta).toBe(-1);
  });

  it("protects Studio logs, supports resync requests, and clears local project data", async () => {
    const app = await createApp();
    const agent = request.agent(app);

    await agent.post("/auth/private-owner").send({}).expect(200);
    const bootstrap = await agent.get("/bootstrap").expect(200);
    const projectId = bootstrap.body.projects[0].id;

    const pair = await request(app)
      .post("/studio/pair")
      .send({ pluginVersion: "test" })
      .expect(201);

    await agent
      .post(`/projects/${projectId}/studio/pair-project`)
      .send({ pairingCode: pair.body.pairingCode })
      .expect(200);

    await request(app)
      .post("/studio/logs")
      .send({ sessionId: pair.body.sessionId, level: "info", message: "test" })
      .expect(403);

    await request(app)
      .post("/studio/logs")
      .send({ sessionId: pair.body.sessionId, connectorToken: pair.body.connectorToken, level: "info", message: "test" })
      .expect(201);

    const resync = await agent.post(`/studio/sessions/${pair.body.sessionId}/resync`).send({}).expect(200);
    expect(resync.body.session.resyncRequestedAt).toBeTruthy();

    await request(app)
      .post("/studio/snapshot")
      .send({
        sessionId: pair.body.sessionId,
        connectorToken: pair.body.connectorToken,
        nodes: [{ path: "ServerScriptService/Main", className: "Script", source: "print('hi')" }]
      })
      .expect(201);

    const threadId = await createThread(agent, projectId, "Clear runtime data");
    await store.saveMessage({
      id: "msg_clear_runtime",
      projectId,
      threadId,
      role: "user",
      content: "clear me",
      createdAt: new Date().toISOString()
    });
    await store.saveChangeSet({
      id: "cs_clear_runtime",
      projectId,
      threadId,
      aiMessageId: "msg_clear_runtime",
      title: "Clear me",
      summary: "Clear this pending patch.",
      status: "approved_for_studio",
      files: [],
      safety: { ok: true, blockedPatterns: [] },
      createdAt: new Date().toISOString()
    });
    await store.saveApplyResult({
      id: "apply_clear_runtime",
      changeSetId: "cs_clear_runtime",
      studioSessionId: pair.body.sessionId,
      status: "failed",
      details: "clear me",
      createdAt: new Date().toISOString()
    });
    await store.saveAttachment({
      id: "attachment_clear_runtime",
      organizationId: bootstrap.body.organization.id,
      projectId,
      threadId,
      userId: bootstrap.body.user.id,
      source: "upload",
      fileName: "notes.lua",
      mimeType: "text/plain",
      sizeBytes: 12,
      inlineText: "print('bye')",
      createdAt: new Date().toISOString()
    });

    await agent.delete("/local-data").expect(200);
    const after = await agent.get("/bootstrap").expect(200);
    expect(after.body.snapshots).toHaveLength(0);
    expect(after.body.logs).toHaveLength(0);
    expect(after.body.threads.filter((thread: { projectId: string }) => thread.projectId === projectId)).toHaveLength(0);
    expect(after.body.messages.filter((message: { projectId: string }) => message.projectId === projectId)).toHaveLength(0);
    expect(after.body.changeSets.filter((changeSet: { projectId: string }) => changeSet.projectId === projectId)).toHaveLength(0);
    expect(after.body.attachments.filter((attachment: { projectId: string }) => attachment.projectId === projectId)).toHaveLength(0);
    expect(await store.fetchApplyResultsForChangeSet("cs_clear_runtime")).toHaveLength(0);
  });

  it("answers project-awareness questions without creating a change set", async () => {
    const app = await createApp();
    const agent = request.agent(app);

    await agent.post("/auth/private-owner").send({}).expect(200);
    const bootstrap = await agent.get("/bootstrap").expect(200);
    const projectId = bootstrap.body.projects[0].id;
    const threadId = await createThread(agent, projectId);

    const chat = await agent
      .post(`/projects/${projectId}/chat`)
      .send({ threadId, prompt: "what do you see", mode: "changeset" })
      .expect(200);

    expect(chat.body.changeSet).toBeUndefined();
    expect(chat.body.assistantMessage.content).toContain("I do not see any synced Roblox files yet");
  });

  it("edits an older user message and resets later conversation state", async () => {
    const app = await createApp();
    const agent = request.agent(app);

    await agent.post("/auth/private-owner").send({}).expect(200);
    const bootstrap = await agent.get("/bootstrap").expect(200);
    const projectId = bootstrap.body.projects[0].id;
    const threadId = await createThread(agent, projectId);

    const first = await agent
      .post(`/projects/${projectId}/chat`)
      .send({ threadId, prompt: "what do you see", mode: "changeset" })
      .expect(200);

    const second = await agent
      .post(`/projects/${projectId}/chat`)
      .send({ threadId, prompt: "Inspect the current structure", mode: "changeset" })
      .expect(200);

    await agent
      .patch(`/projects/${projectId}/messages/${first.body.userMessage.id}`)
      .send({ threadId, prompt: "what files are synced right now", mode: "changeset" })
      .expect(200);

    const after = await agent.get("/bootstrap").expect(200);
    const projectMessages = after.body.messages.filter((message: { projectId: string }) => message.projectId === projectId);

    expect(projectMessages.some((message: { id: string }) => message.id === second.body.userMessage.id)).toBe(false);
    expect(projectMessages.find((message: { id: string }) => message.id === first.body.userMessage.id).content).toBe(
      "what files are synced right now"
    );
    expect(after.body.changeSets).toHaveLength(0);
  });

  it("removes stale change sets when editing an older message", async () => {
    const app = await createApp();
    const agent = request.agent(app);

    await agent.post("/auth/private-owner").send({}).expect(200);
    const bootstrap = await agent.get("/bootstrap").expect(200);
    const projectId = bootstrap.body.projects[0].id;
    const org = await store.fetchOrganization(bootstrap.body.organization.id);
    expect(org).toBeTruthy();
    org!.plan = "starter";
    await store.saveOrganization(org!);
    await store.addCredits(org!.id, 1000, "Admin balance grant");
    const threadId = await createThread(agent, projectId);

    const first = await agent
      .post(`/projects/${projectId}/chat`)
      .send({ threadId, prompt: "Add a checkpoint system", mode: "changeset" })
      .expect(200);

    const second = await agent
      .post(`/projects/${projectId}/chat`)
      .send({ threadId, prompt: "Add a sprint system", mode: "changeset" })
      .expect(200);

    await agent
      .patch(`/projects/${projectId}/messages/${first.body.userMessage.id}`)
      .send({ threadId, prompt: "Add a cleaner checkpoint system", mode: "changeset" })
      .expect(200);

    const after = await agent.get("/bootstrap").expect(200);
    const projectMessages = after.body.messages.filter((message: { projectId: string }) => message.projectId === projectId);
    const projectChangeSets = after.body.changeSets.filter((changeSet: { projectId: string }) => changeSet.projectId === projectId);

    expect(projectMessages.some((message: { id: string }) => message.id === second.body.userMessage.id)).toBe(false);
    expect(projectChangeSets.some((changeSet: { id: string }) => changeSet.id === second.body.changeSet.id)).toBe(false);
    expect(projectChangeSets.some((changeSet: { id: string }) => changeSet.id === first.body.changeSet.id)).toBe(false);
  });

  it("reports local diagnostics", async () => {
    const app = await createApp();
    const diagnostics = await request(app).get("/diagnostics").expect(200);

    expect(diagnostics.body.product).toBe("vectiscode");
    expect(diagnostics.body.service).toBe("vectis-code-api");
    expect(diagnostics.body.auth).toHaveProperty("firebaseConfigured");
    expect(diagnostics.body.ai).toHaveProperty("provider");
    expect(diagnostics.body.storage).toHaveProperty("studioSessions");
    expect(diagnostics.body.release).toHaveProperty("checks");
  });

  it("locks production diagnostics behind admin auth and sends security headers", async () => {
    const original = {
      isProduction: config.isProduction,
      adminEmails: [...config.adminEmails],
      useSupabase: config.useSupabase
    };
    const originalSourceCommitSha = process.env.SOURCE_COMMIT_SHA;
    config.isProduction = true;
    config.adminEmails = ["admin@example.com"];
    config.useSupabase = false;
    process.env.SOURCE_COMMIT_SHA = "1234567890abcdef1234567890abcdef12345678";

    try {
      const app = await createApp();
      const health = await request(app).get("/health").expect(200);
      expect(health.body.release).toMatchObject({
        sha: "1234567890abcdef1234567890abcdef12345678",
        version: expect.any(String)
      });
      expect(health.headers["x-frame-options"]).toBe("DENY");
      expect(health.headers["strict-transport-security"]).toContain("max-age=31536000");
      expect(health.headers["content-security-policy"]).toContain("frame-ancestors 'none'");

      await request(app).get("/diagnostics").expect(404);

      const admin = await store.upsertGoogleUser({
        googleUserId: "diagnostics-admin",
        name: "Admin",
        email: "admin@example.com"
      });
      const adminSession = await store.createAuthSession(admin.id);
      await request(app)
        .get("/diagnostics")
        .set("Cookie", `ras_session=${adminSession.id}`)
        .expect(200);
    } finally {
      config.isProduction = original.isProduction;
      config.adminEmails = original.adminEmails;
      config.useSupabase = original.useSupabase;
      if (originalSourceCommitSha === undefined) delete process.env.SOURCE_COMMIT_SHA;
      else process.env.SOURCE_COMMIT_SHA = originalSourceCommitSha;
    }
  });

  it("records browser client errors for admin diagnostics", async () => {
    const originalAdminEmails = [...config.adminEmails];
    config.adminEmails = ["admin@example.com"];
    const app = await createApp();

    try {
      await request(app)
        .post("/client-errors")
        .send({
          kind: "api_unreachable",
          message: "Could not reach the Vectis Code API.",
          route: "/admin",
          apiPath: "/admin/evaluations/run",
          statusCode: 0
        })
        .expect(202);

      const admin = await store.upsertGoogleUser({
        googleUserId: "client-error-admin",
        name: "Admin",
        email: "admin@example.com"
      });
      const adminSession = await store.createAuthSession(admin.id);
      const adminAgent = request.agent(app);
      adminAgent.set("Cookie", `ras_session=${adminSession.id}`);

      const res = await adminAgent.get("/admin/client-errors").expect(200);
      expect(res.body.events[0]).toMatchObject({
        type: "client_error",
        action: "api_unreachable",
        status: "Could not reach the Vectis Code API."
      });
    } finally {
      config.adminEmails = originalAdminEmails;
    }
  });

  it("summarizes product telemetry for admin insights", async () => {
    const originalAdminEmails = [...config.adminEmails];
    config.adminEmails = ["admin@example.com"];
    const app = await createApp();

    try {
      const admin = await store.upsertGoogleUser({
        googleUserId: "insights-admin",
        name: "Admin",
        email: "admin@example.com"
      });
      const project = await store.ensureProjectForUser(admin.id);
      const adminSession = await store.createAuthSession(admin.id);
      const adminAgent = request.agent(app);
      adminAgent.set("Cookie", `ras_session=${adminSession.id}`);
      const threadId = await createThread(adminAgent, project.id, "Telemetry insights");
      const nowIso = new Date().toISOString();

      await store.saveMessage({
        id: "msg_insights_success",
        projectId: project.id,
        threadId,
        role: "assistant",
        content: "Patch ready.",
        modelUsed: "deepseek-v4-flash",
        usageCostCredits: 12,
        thoughtDurationMs: 1500,
        createdAt: nowIso
      });
      await store.saveMessage({
        id: "msg_insights_timeout",
        projectId: project.id,
        threadId,
        role: "assistant",
        content: "Provider timed out while generating the patch.",
        error: "Provider timeout",
        modelUsed: "deepseek-v4-pro",
        thoughtDurationMs: 120_000,
        createdAt: nowIso
      });
      await store.saveChangeSet({
        id: "cs_insights_success",
        projectId: project.id,
        threadId,
        aiMessageId: "msg_insights_success",
        title: "Successful insight patch",
        summary: "Applied patch used for cost insight.",
        status: "applied",
        files: [],
        safety: { ok: true, blockedPatterns: [] },
        approvedWithSnapshotConflict: true,
        createdAt: nowIso,
        appliedAt: nowIso
      });
      await store.saveChangeSet({
        id: "cs_insights_failed",
        projectId: project.id,
        threadId,
        aiMessageId: "msg_insights_timeout",
        title: "Failed insight patch",
        summary: "Failed patch used for failure insight.",
        status: "failed",
        files: [],
        safety: { ok: true, blockedPatterns: [] },
        createdAt: nowIso
      });
      await store.saveStudioSession({
        id: "studio_insights_session",
        userId: admin.id,
        projectId: project.id,
        connectorToken: "studio_insights_token",
        status: "connected",
        pluginVersion: "vectis-connector-test",
        createdAt: nowIso,
        pairedAt: nowIso,
        lastSeenAt: nowIso
      });
      await store.saveStudioTaskRun({
        id: "task_insights_failed",
        projectId: project.id,
        studioSessionId: "studio_insights_session",
        changeSetId: "cs_insights_failed",
        threadId,
        status: "failed",
        repairRound: 0,
        maxRepairRounds: 2,
        verificationProfile: "standard",
        visualQa: "not_requested",
        createdAt: nowIso,
        updatedAt: nowIso,
        completedAt: nowIso
      });
      await store.saveStudioObservation({
        id: "observation_insights_apply_failed",
        taskRunId: "task_insights_failed",
        studioSessionId: "studio_insights_session",
        projectId: project.id,
        kind: "apply_result",
        status: "failed",
        summary: "Patch apply failed.",
        createdAt: nowIso
      });
      await store.saveLog({
        id: "log_insights_error",
        studioSessionId: "studio_insights_session",
        level: "error",
        message: "ServerScriptService.Main:3: attempt to index nil",
        createdAt: nowIso
      });
      await store.saveCustomerEvidence({
        id: "evidence_insights_snapshot",
        userId: admin.id,
        organizationId: project.organizationId,
        projectId: project.id,
        type: "studio",
        action: "snapshot_sync",
        route: "/studio/snapshot",
        method: "POST",
        status: "ok",
        createdAt: nowIso
      });
      await store.saveLedger({
        id: "ledger_insights_debit",
        organizationId: project.organizationId,
        delta: -20,
        reason: "Generated reviewable Roblox change set",
        createdAt: nowIso
      });
      await store.saveLedger({
        id: "ledger_insights_refund",
        organizationId: project.organizationId,
        delta: 5,
        reason: "Refund for rejected change set",
        createdAt: nowIso
      });

      const res = await adminAgent.get("/admin/insights").expect(200);
      expect(res.body.patches).toMatchObject({
        total: 2,
        applied: 1,
        failed: 1,
        applyFailures: 1,
        conflictsBypassed: 1
      });
      expect(res.body.ai).toMatchObject({
        assistantMessages: 2,
        timeoutCount: 1,
        timeoutRate: 0.5
      });
      expect(res.body.ai.modelCostPerSuccessfulPatch).toEqual([
        expect.objectContaining({
          modelId: "deepseek-v4-flash",
          successfulPatches: 1,
          totalCostCredits: 12,
          averageCostCredits: 12
        })
      ]);
      expect(res.body.credits).toMatchObject({
        refundedCredits: 5,
        refundEvents: 1
      });
      expect(res.body.studio).toMatchObject({
        onlineSessions: 1,
        recentSnapshotSyncs: 1,
        recentRuntimeErrors: 1
      });
      expect(res.body.studio.connectorVersions).toEqual([
        expect.objectContaining({ version: "vectis-connector-test", count: 1 })
      ]);
      expect(res.body.recentFailures).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ source: "task", label: "Studio task failed" }),
          expect.objectContaining({ source: "log", label: "Studio runtime error" }),
          expect.objectContaining({ source: "message", label: "Provider timeout" })
        ])
      );
    } finally {
      config.adminEmails = originalAdminEmails;
    }
  });

  it("reports readiness checks for the current environment", async () => {
    const app = await createApp();
    const readiness = await request(app).get("/readiness").expect(200);

    expect(readiness.body.ok).toBe(true);
    expect(Array.isArray(readiness.body.checks)).toBe(true);
  });

  it("creates a claimable Studio connector session", async () => {
    const app = await createApp();

    const created = await request(app)
      .post("/studio/connect")
      .send({ pluginVersion: "test", placeName: "Local Place", placeId: "0" })
      .expect(201);

    expect(created.body.mode).toBe("pairing-required");
    expect(created.body.status).toBe("waiting");
    expect(created.body.pairingCode).toMatch(/^[0-9A-Z]{4}-[0-9A-Z]{4}-[0-9A-Z]{4}$/);

    const status = await request(app)
      .get(`/studio/session/${created.body.sessionId}?connectorToken=${created.body.connectorToken}`)
      .expect(200);
    expect(status.body.session.status).toBe("waiting");
  });

  it("locks repeated invalid Studio pairing claims by code prefix", async () => {
    const app = await createApp();
    const agent = request.agent(app);
    await agent.post("/auth/private-owner").send({}).expect(200);
    const bootstrap = await agent.get("/bootstrap").expect(200);
    const projectId = bootstrap.body.projects[0].id;
    const pair = await request(app)
      .post("/studio/pair")
      .send({ pluginVersion: "test" })
      .expect(201);
    const normalized = String(pair.body.pairingCode).replace(/[^A-Z0-9]/g, "");
    const badCode = `${normalized.slice(0, 4)}ZZZZZZZZ`;

    for (let attempt = 0; attempt < 6; attempt += 1) {
      await agent
        .post(`/projects/${projectId}/studio/pair-project`)
        .send({ pairingCode: badCode })
        .expect(404);
    }

    await agent
      .post(`/projects/${projectId}/studio/pair-project`)
      .send({ pairingCode: pair.body.pairingCode })
      .expect(404);
  });

  it("status update rejects non-admin and updates status for admin", async () => {
    const originalAdminEmails = [...config.adminEmails];
    config.adminEmails = ["admin@example.com"];
    try {
      const app = await createApp();
      const admin = await store.upsertGoogleUser({ googleUserId: "admin-status", name: "Admin", email: "admin@example.com" });
      const target = await store.upsertGoogleUser({ googleUserId: "target-status", name: "Target", email: "target@example.com" });
      const adminSession = await store.createAuthSession(admin.id);
      const targetSession = await store.createAuthSession(target.id);
      const adminCookie = `ras_session=${adminSession.id}`;
      const targetCookie = `ras_session=${targetSession.id}`;

      // non-admin must be rejected
      await request(app)
        .patch(`/admin/users/${target.id}/status`)
        .set("Cookie", targetCookie)
        .send({ status: "suspended" })
        .expect(404);

      // invalid body must be rejected
      await request(app)
        .patch(`/admin/users/${target.id}/status`)
        .set("Cookie", adminCookie)
        .send({ status: "suspended" })
        .expect(400);

      // valid admin status update
      const res = await request(app)
        .patch(`/admin/users/${target.id}/status`)
        .set("Cookie", adminCookie)
        .send({ status: "banned" })
        .expect(200);
      expect(res.body.ok).toBe(true);
      expect(res.body.user.id).toBe(target.id);

      // restore active status
      const restored = await request(app)
        .patch(`/admin/users/${target.id}/status`)
        .set("Cookie", adminCookie)
        .send({ status: "active" })
        .expect(200);
      expect(restored.body.user.id).toBe(target.id);
    } finally {
      config.adminEmails = originalAdminEmails;
    }
  });

  it("admin mutation endpoints reject non-admin callers", async () => {
    const originalAdminEmails = [...config.adminEmails];
    config.adminEmails = ["admin@example.com"];
    try {
      const app = await createApp();
      const admin = await store.upsertGoogleUser({ googleUserId: "admin-mut-check", name: "Admin", email: "admin@example.com" });
      const nonAdmin = await store.upsertGoogleUser({ googleUserId: "non-admin-mut", name: "NonAdmin", email: "nonadmin@example.com" });
      const adminSession = await store.createAuthSession(admin.id);
      const nonAdminSession = await store.createAuthSession(nonAdmin.id);
      const adminCookie = `ras_session=${adminSession.id}`;
      const nonAdminCookie = `ras_session=${nonAdminSession.id}`;

      const endpoints: Array<{ method: "post" | "patch"; path: string; body: Record<string, unknown> }> = [
        { method: "post", path: `/admin/users/${nonAdmin.id}/credits`, body: { delta: 10, reason: "Test" } },
        { method: "post", path: `/admin/users/${nonAdmin.id}/usage-adjustment`, body: { deltaPercent: 5, reason: "Test" } },
        { method: "post", path: `/admin/users/${nonAdmin.id}/usage-reset`, body: {} },
        { method: "patch", path: `/admin/users/${nonAdmin.id}/plan`, body: { plan: "pro" } },
        { method: "patch", path: `/admin/users/${nonAdmin.id}/status`, body: { status: "active" } }
      ];

      for (const endpoint of endpoints) {
        await request(app)
          [endpoint.method](endpoint.path)
          .set("Cookie", nonAdminCookie)
          .send(endpoint.body)
          .expect(404);
      }

      // Confirm at least one endpoint accepts admin with valid body
      const credits = await request(app)
        .post(`/admin/users/${nonAdmin.id}/credits`)
        .set("Cookie", adminCookie)
        .send({ delta: 5, reason: "Test credit" })
        .expect(200);
      expect(credits.body.ok).toBe(true);
    } finally {
      config.adminEmails = originalAdminEmails;
    }
  });

  it("GET /user/export returns the calling user's own data", async () => {
    const app = await createApp();
    const agent = request.agent(app);
    await agent.post("/auth/private-owner").send({}).expect(200);

    const exported = await agent.get("/user/export").expect(200);

    expect(exported.body.profile).toMatchObject({
      id: expect.any(String),
      authProvider: "private"
    });
    expect(exported.body.plan).toBeDefined();
    expect(exported.body.creditBalance).toBeGreaterThanOrEqual(0);
    expect(Array.isArray(exported.body.projects)).toBe(true);
    expect(Array.isArray(exported.body.events)).toBe(true);
  });

  it("GET /user/export rejects unauthenticated callers", async () => {
    const app = await createApp();
    await request(app).get("/user/export").expect(401);
  });
});
