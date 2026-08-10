import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createApp } from "../app.js";
import { store } from "../services/store.js";
import { config } from "../services/config.js";
import * as aiProviderModule from "../services/aiProvider.js";

describe("Console Fixer API Routes", () => {
  beforeEach(async () => {
    await store.reset();
    vi.restoreAllMocks();
  });

  it("can parse logs and generate changeset with intent console_fix", async () => {
    const app = await createApp();
    const agent = request.agent(app);

    // Login
    await agent.post("/auth/private-owner").send({}).expect(200);

    // Update org plan to studio
    const org = await store.fetchOrganization("org_owner");
    if (org) {
      org.plan = "studio";
      await store.saveOrganization(org);
    }

    const bootstrap = await agent.get("/bootstrap").expect(200);
    const project = bootstrap.body.projects[0];

    // Create a thread
    const threadRes = await agent
      .post(`/projects/${project.id}/threads`)
      .send({ name: "Console Fix Chat" })
      .expect(201);
    const threadId = threadRes.body.thread.id;

    // Create a mock active studio session
    const session = {
      id: "session_test_123",
      userId: "user_owner",
      projectId: project.id,
      connectorToken: "token_test_123",
      status: "connected" as const,
      pluginVersion: "dev",
      createdAt: new Date().toISOString(),
      lastSeenAt: new Date().toISOString()
    };
    await store.saveStudioSession(session);

    // Save a mock project snapshot containing MainScript
    const snapshot = {
      id: "snap_test_123",
      projectId: project.id,
      studioSessionId: session.id,
      nodes: [
        {
          path: "ServerScriptService/MainScript",
          className: "Script" as const,
          source: 'local player = game.Players.LocalPlayer\nprint(player.Name)',
          properties: {}
        }
      ],
      createdAt: new Date().toISOString()
    };
    await store.saveDoc("snapshots", snapshot);

    // Save mock console error logs
    await store.saveLog({
      id: "log_test_1",
      studioSessionId: session.id,
      level: "error",
      message: "ServerScriptService.MainScript:2: attempt to index nil with 'Name'",
      createdAt: new Date().toISOString()
    });

    const generateChangeSetSpy = vi.spyOn(aiProviderModule, "generateSafeChangeSet").mockResolvedValue({
      title: "Fix LocalPlayer references",
      summary: "Fixed server script referencing client LocalPlayer",
      files: [
        {
          id: "f1",
          action: "update",
          instancePath: "ServerScriptService/MainScript",
          className: "Script",
          source: 'game.Players.PlayerAdded:Connect(function(player)\n  print(player.Name)\nend)',
          reason: "Fixed LocalPlayer nil index error on server"
        }
      ],
      safety: { ok: true, blockedPatterns: [] },
      usage: { promptTokens: 10, outputTokens: 20 }
    });

    const chatRes = await agent
      .post(`/projects/${project.id}/chat`)
      .send({
        threadId,
        prompt: "Fix the console error",
        intent: "console_fix",
        mode: "changeset",
        model: "gemini-3.5-flash"
      })
      .expect(200);

    expect(chatRes.body.changeSet).toBeDefined();
    expect(chatRes.body.changeSet.title).toBe("Fix LocalPlayer references");
    expect(chatRes.body.changeSet.reviewReport).toBeDefined();
    expect(chatRes.body.changeSet.reviewReport.source).toBe("console_fix");
    expect(generateChangeSetSpy).toHaveBeenCalled();
  });
});
