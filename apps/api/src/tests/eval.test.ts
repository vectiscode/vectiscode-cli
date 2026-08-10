import request from "supertest";
import { beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../app.js";
import { buildProjectContextSummary, optimizedModelFor, projectSnapshotCacheKey } from "../routes/chatHelpers.js";
import { aiModels, calculateUsageCostCredits, config, CREDIT_VALUE_USD_RETAIL, ESTIMATED_GENERATED_ICON_PROVIDER_COST_USD, GENERATED_ICON_COST_CREDITS, getThinkingLevel, getThinkingMultiplier, MODEL_CREDIT_MARGIN_MULTIPLIER, modelBillingRates, MODEL_COSTS, MODEL_RATES, YUNWU_MODEL_RATES } from "../services/config.js";
import { planUiIntent, shouldUseNoCostDeterministicTemplate } from "../services/aiProvider.js";
import { validateLuauSyntax } from "../services/evaluator.js";
import { store } from "../services/store.js";

describe("Model Evaluations and Optimization Rules", () => {
  beforeEach(async () => {
    await store.reset();
  });

  async function createThread(agent: ReturnType<typeof request.agent>, projectId: string) {
    const created = await agent.post(`/projects/${projectId}/threads`).send({}).expect(201);
    return created.body.thread.id as string;
  }

  it("uses official Gemini 3 dynamic thinking defaults", () => {
    expect(getThinkingLevel("gemini-3-flash-preview")).toBe("high");
    expect(getThinkingMultiplier("gemini-3-flash-preview", "changeset")).toBe(2);
    expect(getThinkingLevel("gemini-3-flash-preview", { thinkingGemini3Flash: "medium" })).toBe("medium");
  });

  it("inflates thinking estimates when thinking is on", () => {
    expect(getThinkingLevel("deepseek-v4-flash", { thinkingDeepSeekV4Flash: "max" })).toBe("max");
    expect(getThinkingLevel("deepseek-v4-flash", { thinkingDeepSeekV4Flash: "high" })).toBe("high");
    expect(getThinkingMultiplier("deepseek-v4-flash", "chat", { thinkingDeepSeekV4Flash: "high" })).toBe(1.5);
    expect(getThinkingMultiplier("deepseek-v4-flash", "chat", { thinkingDeepSeekV4Flash: "max" })).toBe(2);
  });

  it("restricts evaluations routes to admin users only", async () => {
    const originalAdminEmails = [...config.adminEmails];
    config.adminEmails = ["admin@example.com"];
    const app = await createApp();
    const agent = request.agent(app);

    // Regular owner user login
    await agent.post("/auth/private-owner").send({}).expect(200);

    // Should return 404 or 403 on admin routes
    await agent.get("/admin/evaluations").expect(404);
    await agent.post("/admin/evaluations/run").send({ promptId: "leaderstats", models: ["gemini-3-flash-preview"] }).expect(404);

    try {
      const admin = await store.upsertGoogleUser({
        googleUserId: "admin-google",
        name: "Admin",
        email: "admin@example.com"
      });
      const adminSession = await store.createAuthSession(admin.id);
      const adminAgent = request.agent(app);
      adminAgent.set("Cookie", `ras_session=${adminSession.id}`);

      const evals = await adminAgent.get("/admin/evaluations").expect(200);
      expect(evals.body.runs).toBeDefined();
      expect(evals.body.scenarios).toBeDefined();
    } finally {
      config.adminEmails = originalAdminEmails;
    }
  });

  it("persists evaluation runs correctly in the store", async () => {
    const mockRun = {
      id: "eval_run_test_123",
      promptId: "leaderstats",
      promptText: "Test prompt text",
      startedAt: new Date().toISOString(),
      completedAt: new Date().toISOString(),
      runs: [
        {
          modelId: "gemini-3-flash-preview",
          success: true,
          latencyMs: 1500,
          costCredits: 15,
          safetyOk: true,
          blockedPatterns: [],
          syntaxOk: true,
          score: 8,
          reasoning: "Good job."
        }
      ]
    };

    const saved = await store.saveEvaluationRun(mockRun);
    expect(saved.id).toBe(mockRun.id);

    const retrieved = await store.fetchEvaluationRuns();
    expect(retrieved.length).toBeGreaterThanOrEqual(1);
    expect(retrieved[0].id).toBe(mockRun.id);
    expect(retrieved[0].promptId).toBe("leaderstats");
  });

  it("lets admins delete and clear evaluation history", async () => {
    const originalAdminEmails = [...config.adminEmails];
    config.adminEmails = ["admin@example.com"];
    const app = await createApp();
    try {
      const admin = await store.upsertGoogleUser({
        googleUserId: "admin-google",
        name: "Admin",
        email: "admin@example.com"
      });
      const adminSession = await store.createAuthSession(admin.id);
      const adminAgent = request.agent(app);
      adminAgent.set("Cookie", `ras_session=${adminSession.id}`);

      await store.saveEvaluationRun({
        id: "eval_delete_me",
        promptId: "leaderstats",
        promptText: "Test prompt text",
        startedAt: new Date().toISOString(),
        completedAt: new Date().toISOString(),
        runs: []
      });
      await store.saveEvaluationRun({
        id: "eval_clear_me",
        promptId: "sprint",
        promptText: "Test prompt text 2",
        startedAt: new Date().toISOString(),
        completedAt: new Date().toISOString(),
        runs: []
      });

      await adminAgent.delete("/admin/evaluations/eval_delete_me").expect(200);
      let retrieved = await store.fetchEvaluationRuns();
      expect(retrieved.map(run => run.id)).not.toContain("eval_delete_me");
      expect(retrieved.map(run => run.id)).toContain("eval_clear_me");

      const cleared = await adminAgent.delete("/admin/evaluations").expect(200);
      expect(cleared.body.deleted).toBe(1);
      retrieved = await store.fetchEvaluationRuns();
      expect(retrieved).toHaveLength(0);
    } finally {
      config.adminEmails = originalAdminEmails;
    }
  });

  it("accepts Luau elseif blocks as a single if block", () => {
    const source = `
local function classify(amount)
  if amount >= 50 then
    return "enough"
  elseif amount > 0 then
    return "some"
  else
    return "none"
  end
end
`;

    expect(validateLuauSyntax(source).ok).toBe(true);
  });

  it("does not tell backend shop evaluations to avoid backend wiring", () => {
    const plan = planUiIntent({
      prompt: "Create a basic GUI Shop system. Under StarterGui, create a ScreenGui named 'ShopGui' with a shop panel Frame, a TextButton to open/close the shop, and a purchase TextButton for an item 'SpeedPotion' that costs 50 Gold. Include a RemoteEvent named 'ShopPurchase' in ReplicatedStorage, and a server Script to handle the purchase, deducting Gold from leaderstats."
    });

    expect(plan.scope).toBe("mixed");
    expect(plan.mustInclude.join(" ")).toMatch(/ShopPurchase remote/);
    expect(plan.mustInclude.join(" ")).toMatch(/server purchase handler/);
    expect(plan.mustAvoid).not.toContain("backend");
    expect(plan.mustAvoid).not.toContain("remotes");
    expect(plan.mustAvoid).not.toContain("leaderstats");
  });

  it("deterministic templates are disabled - always uses the real AI model", async () => {
    const prompt = "Players collect coins, sell them, upgrade backpack size, and unlock a new area";
    expect(shouldUseNoCostDeterministicTemplate({ prompt })).toBe(false);
    expect(shouldUseNoCostDeterministicTemplate({ prompt: "Add a sprint system with stamina and a small UI bar" })).toBe(false);
  });

  it("keeps every listed model wired to margin-positive ledger economics", () => {
    const sampleInputTokens = 20_000;
    const sampleOutputTokens = 5_000;

    for (const model of aiModels) {
      expect(MODEL_COSTS).toHaveProperty(model.id);
      expect(MODEL_RATES).toHaveProperty(model.id);

      const credits = calculateUsageCostCredits(model.id, sampleInputTokens, sampleOutputTokens);
      const revenueUsd = credits * CREDIT_VALUE_USD_RETAIL;
      const rawCostUsd = (sampleInputTokens * MODEL_RATES[model.id].input) + (sampleOutputTokens * MODEL_RATES[model.id].output);

      expect(revenueUsd).toBeGreaterThanOrEqual(rawCostUsd * MODEL_CREDIT_MARGIN_MULTIPLIER);
    }

    const generatedIconRevenue = GENERATED_ICON_COST_CREDITS * CREDIT_VALUE_USD_RETAIL;
    expect(generatedIconRevenue).toBeGreaterThanOrEqual(ESTIMATED_GENERATED_ICON_PROVIDER_COST_USD * MODEL_CREDIT_MARGIN_MULTIPLIER);
  });

  it("always uses official MODEL_RATES for billing regardless of Yunwu routing", () => {
    const originalApiKey = config.yunwu.apiKey;
    const originalPrefer = config.yunwu.prefer;
    const sampleInputTokens = 20_000;
    const sampleOutputTokens = 5_000;

    try {
      config.yunwu.apiKey = "";
      config.yunwu.prefer = true;
      const officialGeminiCredits = calculateUsageCostCredits("gemini-3.5-flash", sampleInputTokens, sampleOutputTokens);
      expect(modelBillingRates("gemini-3.5-flash")).toEqual(MODEL_RATES["gemini-3.5-flash"]);

      config.yunwu.apiKey = "yunwu-test";
      const yunwuConfiguredGeminiCredits = calculateUsageCostCredits("gemini-3.5-flash", sampleInputTokens, sampleOutputTokens);
      expect(modelBillingRates("gemini-3.5-flash")).toEqual(MODEL_RATES["gemini-3.5-flash"]);
      expect(yunwuConfiguredGeminiCredits).toEqual(officialGeminiCredits);
    } finally {
      config.yunwu.apiKey = originalApiKey;
      config.yunwu.prefer = originalPrefer;
    }
  });

  it("applies optimization rules correctly by routing level", async () => {
    const app = await createApp();
    const agent = request.agent(app);

    await agent.post("/auth/private-owner").send({}).expect(200);
    const bootstrap = await agent.get("/bootstrap").expect(200);
    const projectId = bootstrap.body.projects[0].id;
    const threadId = await createThread(agent, projectId);

    // Upgrade organization to pro plan to allow premium models
    const org = await store.fetchOrganization(bootstrap.body.organization.id);
    expect(org).toBeTruthy();
    org!.plan = "pro";
    await store.saveOrganization(org!);

    // Check default router behavior for minor explanation questions
    // Simple greeting or chat question when optimization is disabled
    await agent.patch("/user/preferences").send({
      optimizationMode: "disabled",
      thinkingGemini31Pro: "low",
      thinkingGemini35Flash: "none",
      thinkingGemini3Flash: "none",
      thinkingGemini31FlashLite: "none"
    }).expect(200);

    const resDisabled = await agent
      .post(`/projects/${projectId}/chat`)
      .send({ threadId, prompt: "What is a RemoteEvent", mode: "explain", model: "gemini-3.1-pro-preview" })
      .expect(200);

    // With optimization disabled, it should use the selected model exactly
    expect(resDisabled.body.assistantMessage.modelUsed).toBe("gemini-3.1-pro-preview");
    expect(resDisabled.body.assistantMessage.usageCostCredits).toBeUndefined();
    expect((await store.fetchMessage(resDisabled.body.assistantMessage.id))?.usageCostCredits).toBe(36);

    // Enable Balanced mode
    await agent.patch("/user/preferences").send({ optimizationMode: "balanced" }).expect(200);

    const resBalanced = await agent
      .post(`/projects/${projectId}/chat`)
      .send({ threadId, prompt: "What is a RemoteEvent", mode: "explain", model: "gemini-3.1-pro-preview" })
      .expect(200);

    // In balanced mode, simple chat questions should use the lower-cost balanced chat route.
    expect(resBalanced.body.assistantMessage.modelUsed).toBe("qwen3.7-max");
    expect(resBalanced.body.assistantMessage.usageCostCredits).toBeUndefined();
    expect((await store.fetchMessage(resBalanced.body.assistantMessage.id))?.usageCostCredits).toBe(27);

    const resBalancedChangeSet = await agent
      .post(`/projects/${projectId}/chat`)
      .send({ threadId, prompt: "change color of GoldPart to blue", mode: "changeset", model: "gemini-3.1-pro-preview" })
      .expect(200);

    // In balanced mode, changesets use the standard Gemini 3.5 route instead of the selected premium model.
    expect(resBalancedChangeSet.body.assistantMessage.modelUsed).toBe("gemini-3.5-flash");
    expect(resBalancedChangeSet.body.assistantMessage.usageCostCredits).toBeUndefined();
    expect((await store.fetchMessage(resBalancedChangeSet.body.assistantMessage.id))?.usageCostCredits).toBe(24);

    // Enable Cost-Saver mode
    await agent.patch("/user/preferences").send({ optimizationMode: "cost_saver" }).expect(200);

    // Minor changeset task (e.g. simple edit)
    const resCostSaver = await agent
      .post(`/projects/${projectId}/chat`)
      .send({ threadId, prompt: "change color of GoldPart to red", mode: "changeset", model: "gemini-3.1-pro-preview" })
      .expect(200);

    // In cost_saver mode, minor changeset should be routed to the fastest health-gated cheap model.
    expect(resCostSaver.body.assistantMessage.modelUsed).toBe("deepseek-v4-flash");
    expect(resCostSaver.body.assistantMessage.usageCostCredits).toBeUndefined();
    expect((await store.fetchMessage(resCostSaver.body.assistantMessage.id))?.usageCostCredits).toBe(6);
  });

  it("keeps optimized routing predictable with Gemini 3.5 as the balanced patch path", () => {
    expect(optimizedModelFor("explain", "balanced")).toBe("qwen3.7-max");
    expect(optimizedModelFor("changeset", "balanced")).toBe("gemini-3.5-flash");
    expect(optimizedModelFor("explain", "cost_saver")).toBe("deepseek-v4-flash");
    expect(optimizedModelFor("changeset", "cost_saver")).toBe("deepseek-v4-flash");
  });

  it("builds compact project summaries for cached routine context", () => {
    const summary = buildProjectContextSummary({
      id: "snap_test",
      projectId: "project_test",
      studioSessionId: "session_test",
      createdAt: new Date().toISOString(),
      nodes: [
        { path: "ServerScriptService/Main", className: "Script", source: "print('hi')" },
        { path: "ReplicatedStorage/Remotes/BuyItem", className: "RemoteEvent" },
        { path: "StarterGui/MainHud", className: "ScreenGui" },
        { path: "Workspace/Spawn", className: "SpawnLocation" }
      ]
    });
    expect(summary).toContain("4 synced nodes");
    expect(summary).toContain("ServerScriptService/Main");
    expect(summary).toContain("ReplicatedStorage/Remotes/BuyItem");
    expect(summary).toContain("StarterGui/MainHud");
    expect(summary).toContain("Workspace objects: Workspace/Spawn");
    expect(summary).toContain("Script source coverage: 1/1");
  });

  it("uses stable project context cache keys for identical resyncs", () => {
    const first = {
      id: "snap_first",
      projectId: "project_test",
      studioSessionId: "session_test",
      createdAt: "2026-01-01T00:00:00.000Z",
      nodes: [
        { path: "ServerScriptService/Main", className: "Script", source: "print('hi')", properties: { Enabled: true } },
        { path: "ReplicatedStorage/Remotes/BuyItem", className: "RemoteEvent" }
      ]
    };
    const resync = {
      ...first,
      id: "snap_second",
      studioSessionId: "session_new",
      createdAt: "2026-01-02T00:00:00.000Z",
      nodes: [...first.nodes].reverse()
    };
    const changedSource = {
      ...resync,
      nodes: [
        { path: "ReplicatedStorage/Remotes/BuyItem", className: "RemoteEvent" },
        { path: "ServerScriptService/Main", className: "Script", source: "print('changed')", properties: { Enabled: true } }
      ]
    };

    expect(projectSnapshotCacheKey(first)).toBe(projectSnapshotCacheKey(resync));
    expect(projectSnapshotCacheKey(changedSource)).not.toBe(projectSnapshotCacheKey(first));
  });
});
