import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createApp } from "../app.js";
import { store } from "../services/store.js";
import { config } from "../services/config.js";
import * as aiProviderModule from "../services/aiProvider.js";
import type { TaskPlan } from "../types.js";

describe("Task Plan API Routes", () => {
  beforeEach(async () => {
    await store.reset();
    vi.restoreAllMocks();
  });

  it("can edit, approve, and supersede task plans", async () => {
    const app = await createApp();
    const agent = request.agent(app);

    // Login and bootstrap project
    await agent.post("/auth/private-owner").send({}).expect(200);
    const org = await store.fetchOrganization("org_owner");
    if (org) {
      org.plan = "studio";
      await store.saveOrganization(org);
    }
    const bootstrap = await agent.get("/bootstrap").expect(200);
    const project = bootstrap.body.projects[0];
    
    const threadRes = await agent
      .post(`/projects/${project.id}/threads`)
      .send({ name: "Test Chat" })
      .expect(201);
    const threadId = threadRes.body.thread.id;

    // Setup: save a mock task plan in draft status
    const taskPlan = {
      id: "plan_test123",
      projectId: project.id,
      threadId,
      userMessageId: "msg_user123",
      status: "draft" as const,
      goal: "Build a health check script",
      assumptions: ["Assume basic variables exist"],
      targetInstances: ["Workspace/Part"],
      steps: [
        { id: "step_1", description: "Create Part", targetFile: "Workspace/Part" }
      ],
      acceptanceCriteria: ["Part exists in Workspace"],
      risks: ["None"],
      estimatedComplexity: "low" as const,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    await store.saveDoc("taskPlans", taskPlan);

    // 1. PATCH /projects/:projectId/task-plans/:planId (Edit task plan)
    const patchRes = await agent
      .patch(`/projects/${project.id}/task-plans/${taskPlan.id}`)
      .send({
        goal: "Build a robust health check script",
        estimatedComplexity: "medium"
      })
      .expect(200);

    expect(patchRes.body.taskPlan.goal).toBe("Build a robust health check script");
    expect(patchRes.body.taskPlan.estimatedComplexity).toBe("medium");

    // 2. POST /projects/:projectId/task-plans/:planId/supersede (Supersede task plan)
    const taskPlan2 = {
      ...taskPlan,
      id: "plan_test456",
      status: "draft" as const
    };
    await store.saveDoc("taskPlans", taskPlan2);

    const supersedeRes = await agent
      .post(`/projects/${project.id}/task-plans/${taskPlan2.id}/supersede`)
      .send({})
      .expect(200);

    expect(supersedeRes.body.taskPlan.status).toBe("superseded");
    expect(supersedeRes.body.taskPlan.supersededAt).toBeDefined();

    // 3. POST /projects/:projectId/task-plans/:planId/approve (Approve and generate changeset)
    const generateChangeSetSpy = vi.spyOn(aiProviderModule, "generateSafeChangeSet").mockResolvedValue({
      title: "HUD Health Check",
      summary: "Created the health HUD system",
      files: [
        {
          id: "f1",
          action: "create",
          instancePath: "StarterGui/HealthHUD",
          className: "ScreenGui",
          reason: "HUD layout"
        }
      ],
      safety: { ok: true, blockedPatterns: [] },
      usage: { promptTokens: 10, outputTokens: 20 }
    });

    const approveRes = await agent
      .post(`/projects/${project.id}/task-plans/${taskPlan.id}/approve`)
      .send({
        model: "gemini-3.5-flash"
      })
      .expect(200);

    expect(approveRes.body.taskPlan.status).toBe("approved");
    expect(approveRes.body.taskPlan.approvedAt).toBeDefined();
    expect(approveRes.body.taskPlan.changeSetId).toBeDefined();
    expect(approveRes.body.changeSet).toBeDefined();
    expect(approveRes.body.assistantMessage).toBeDefined();

    expect(generateChangeSetSpy).toHaveBeenCalled();

    const emptyPlan = {
      ...taskPlan,
      id: "plan_empty_generation",
      status: "draft" as const,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    await store.saveDoc("taskPlans", emptyPlan);
    const balanceBeforeFailedGeneration = await store.getCreditBalance(project.organizationId);
    generateChangeSetSpy.mockResolvedValueOnce({
      title: "No usable patch",
      summary: "No operations were produced.",
      files: [],
      safety: { ok: true, blockedPatterns: [] }
    });

    await agent
      .post(`/projects/${project.id}/task-plans/${emptyPlan.id}/approve`)
      .send({ model: "gemini-3.5-flash" })
      .expect(422);

    expect(await store.getCreditBalance(project.organizationId)).toBe(balanceBeforeFailedGeneration);
    const failedPlan = await store.getDoc<TaskPlan>("taskPlans", emptyPlan.id);
    expect(failedPlan?.status).toBe("draft");

    const generatingPlan = {
      ...taskPlan,
      id: "plan_already_generating",
      status: "generating" as const,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    await store.saveDoc("taskPlans", generatingPlan);
    await agent
      .post(`/projects/${project.id}/task-plans/${generatingPlan.id}/approve`)
      .send({ model: "gemini-3.5-flash" })
      .expect(409);
    expect(generateChangeSetSpy).toHaveBeenCalledTimes(2);
  });

  it("generates a task plan from AI response in plan mode", async () => {
    const app = await createApp();
    const agent = request.agent(app);

    // Login and bootstrap project
    await agent.post("/auth/private-owner").send({}).expect(200);
    const org = await store.fetchOrganization("org_owner");
    if (org) {
      org.plan = "studio";
      await store.saveOrganization(org);
    }
    const bootstrap = await agent.get("/bootstrap").expect(200);
    const project = bootstrap.body.projects[0];
    
    const threadRes = await agent
      .post(`/projects/${project.id}/threads`)
      .send({ name: "Test Chat" })
      .expect(201);
    const threadId = threadRes.body.thread.id;

    const answerProjectQuestionSpy = vi.spyOn(aiProviderModule, "answerProjectQuestion").mockResolvedValue({
      text: `<VECTIS_PLAN>
{
  "goal": "Build a health check script",
  "assumptions": ["Assume Basic variables exist"],
  "targetInstances": ["Workspace/Part"],
  "steps": [
    {"id": "step_1", "description": "Create Part", "targetFile": "Workspace/Part"}
  ],
  "acceptanceCriteria": ["Part exists in Workspace"],
  "risks": ["None"],
  "estimatedComplexity": "low"
}
</VECTIS_PLAN>
Here is my friendly plan explanation.`,
      usage: { promptTokens: 10, outputTokens: 20 }
    });

    const chatRes = await agent
      .post(`/projects/${project.id}/chat`)
      .send({
        threadId,
        prompt: "Build a health check script",
        planMode: true,
        mode: "explain",
        model: "gemini-3.5-flash"
      })
      .expect(200);

    expect(chatRes.body.taskPlan).toBeDefined();
    expect(chatRes.body.taskPlan.goal).toBe("Build a health check script");
    expect(chatRes.body.taskPlan.steps[0].description).toBe("Create Part");
    expect(chatRes.body.assistantMessage.content).toContain("Here is my friendly plan explanation.");
    expect(chatRes.body.assistantMessage.content).not.toContain("<VECTIS_PLAN>");
    expect(answerProjectQuestionSpy).toHaveBeenCalled();
  });
});
