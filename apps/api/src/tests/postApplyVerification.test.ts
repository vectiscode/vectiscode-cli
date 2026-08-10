import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createApp } from "../app.js";
import { store } from "../services/store.js";

describe("Post-Apply Verification Probes API", () => {
  beforeEach(async () => {
    await store.reset();
    vi.restoreAllMocks();
  });

  it("can accept and save apply result with verificationSummary", async () => {
    const app = await createApp();
    const agent = request.agent(app);

    // Login
    await agent.post("/auth/private-owner").send({}).expect(200);

    const bootstrap = await agent.get("/bootstrap").expect(200);
    const project = bootstrap.body.projects[0];

    // Create a mock active studio session
    const session = {
      id: "session_verif_123",
      userId: "user_owner",
      projectId: project.id,
      connectorToken: "token_verif_123",
      status: "connected" as const,
      pluginVersion: "dev",
      createdAt: new Date().toISOString(),
      lastSeenAt: new Date().toISOString()
    };
    await store.saveStudioSession(session);

    // Create a mock changeset
    const changeSet = {
      id: "cs_verif_123",
      projectId: project.id,
      threadId: "thread_verif_123",
      title: "Add Sprint System",
      summary: "Sprint implementation",
      status: "approved_for_studio" as const,
      files: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    await store.saveChangeSet(changeSet);

    // Post apply-result with verificationSummary
    const verificationSummary = {
      passed: 4,
      warnings: 1,
      failed: 0,
      skipped: 0,
      failureReasons: ["Property Transparency warning"]
    };

    const res = await agent
      .post(`/studio/changes/${changeSet.id}/apply-result`)
      .send({
        sessionId: session.id,
        connectorToken: session.connectorToken,
        status: "applied",
        details: "Sprint applied successfully",
        verificationSummary
      })
      .expect(201);

    expect(res.body.changeSet).toBeDefined();
    expect(res.body.changeSet.status).toBe("applied");

    // Fetch the task run to verify verificationSummary is persisted
    const taskRuns = await store.fetchStudioTaskRunsForProject(project.id);
    const taskRun = taskRuns.find(tr => tr.changeSetId === changeSet.id);
    expect(taskRun).toBeDefined();
    expect(taskRun!.status).toBe("passed");
    expect(taskRun!.verificationSummary).toBeDefined();
    expect(taskRun!.verificationSummary!.passed).toBe(4);
    expect(taskRun!.verificationSummary!.warnings).toBe(1);
    expect(taskRun!.verificationSummary!.failureReasons).toContain("Property Transparency warning");
  });
});
