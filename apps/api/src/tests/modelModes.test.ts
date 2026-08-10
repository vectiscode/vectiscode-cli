import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createApp } from "../app.js";
import { store } from "../services/store.js";
import * as aiProviderModule from "../services/aiProvider.js";

describe("Simplified Model Modes API", () => {
  beforeEach(async () => {
    await store.reset();
    vi.restoreAllMocks();
  });

  it("can resolve fast modelMode to gemini-3.5-flash", async () => {
    const app = await createApp();
    const agent = request.agent(app);

    // Login
    await agent.post("/auth/private-owner").send({}).expect(200);

    const bootstrap = await agent.get("/bootstrap").expect(200);
    const project = bootstrap.body.projects[0];

    // Create a thread
    const threadRes = await agent
      .post(`/projects/${project.id}/threads`)
      .send({ name: "Modes Chat" })
      .expect(201);
    const threadId = threadRes.body.thread.id;

    // Create a mock active studio session
    const session = {
      id: "session_test_modes",
      userId: "user_owner",
      projectId: project.id,
      connectorToken: "token_test_modes",
      status: "connected" as const,
      pluginVersion: "dev",
      createdAt: new Date().toISOString(),
      lastSeenAt: new Date().toISOString()
    };
    await store.saveStudioSession(session);

    // Save a mock project snapshot containing MainScript
    const snapshot = {
      id: "snap_test_modes",
      projectId: project.id,
      studioSessionId: session.id,
      nodes: [
        {
          path: "ServerScriptService/MainScript",
          className: "Script" as const,
          source: 'print("hello")',
          properties: {}
        }
      ],
      createdAt: new Date().toISOString()
    };
    await store.saveDoc("snapshots", snapshot);

    // Spy on generateSafeChangeSet
    const generateChangeSetSpy = vi.spyOn(aiProviderModule, "generateSafeChangeSet").mockResolvedValue({
      title: "Sprint implementation",
      summary: "Added sprint speed",
      files: [
        {
          id: "f1",
          action: "update",
          instancePath: "ServerScriptService/MainScript",
          className: "Script",
          source: 'print("hello speed")',
          reason: "Added sprint speed"
        }
      ],
      safety: { ok: true, blockedPatterns: [] },
      usage: { promptTokens: 10, outputTokens: 20 }
    });

    const chatRes = await agent
      .post(`/projects/${project.id}/chat`)
      .send({
        threadId,
        prompt: "Make me fast",
        modelMode: "fast",
        mode: "changeset"
      })
      .expect(200);

    expect(chatRes.body.changeSet).toBeDefined();
    expect(generateChangeSetSpy).toHaveBeenCalled();
    const lastCall = generateChangeSetSpy.mock.calls[0][0];
    expect(lastCall.model).toBe("gemini-3.5-flash");
    expect(lastCall.studioTools?.enabled).toBe(true);
    expect(typeof lastCall.studioTools?.execute).toBe("function");
  });

  it("adds live Studio preflight evidence before Gemini change-set generation", async () => {
    const app = await createApp();
    const agent = request.agent(app);

    await agent.post("/auth/private-owner").send({}).expect(200);
    const bootstrap = await agent.get("/bootstrap").expect(200);
    const project = bootstrap.body.projects[0];
    await store.addCredits(bootstrap.body.organization.id, 1500, "Test Gemini preflight capacity");
    const threadRes = await agent
      .post(`/projects/${project.id}/threads`)
      .send({ name: "Gemini Studio Tools" })
      .expect(201);
    const threadId = threadRes.body.thread.id;

    const session = {
      id: "session_gemini_preflight",
      userId: "user_owner",
      projectId: project.id,
      connectorToken: "token_gemini_preflight",
      status: "connected" as const,
      pluginVersion: "dev",
      createdAt: new Date().toISOString(),
      lastSeenAt: new Date().toISOString()
    };
    await store.saveStudioSession(session);
    await store.saveDoc("snapshots", {
      id: "snap_gemini_preflight",
      projectId: project.id,
      studioSessionId: session.id,
      nodes: [
        {
          path: "ServerScriptService/SprintController",
          className: "Script",
          source: "print('old sprint')",
          properties: {}
        }
      ],
      createdAt: new Date().toISOString()
    });

    const generateChangeSetSpy = vi.spyOn(aiProviderModule, "generateSafeChangeSet").mockResolvedValue({
      title: "Sprint repair",
      summary: "Updated sprint logic from live Studio evidence",
      files: [
        {
          id: "f1",
          action: "update",
          instancePath: "ServerScriptService/SprintController",
          className: "Script",
          source: "print('fixed sprint')",
          reason: "Used live Studio context before generating"
        }
      ],
      safety: { ok: true, blockedPatterns: [] },
      usage: { promptTokens: 10, outputTokens: 20 }
    });

    const chatPromise = new Promise<request.Response>((resolve, reject) => {
      agent
        .post(`/projects/${project.id}/chat`)
        .send({
          threadId,
          prompt: "Fix SprintController because sprint prints a runtime error",
          model: "gemini-3.5-flash",
          mode: "changeset"
        })
        .expect(200)
        .end((error, response) => {
          if (error) reject(error);
          else resolve(response);
        });
    });

    let queuedCommands: Array<{ id: string; type: string; arguments: Record<string, unknown> }> = [];
    for (let attempt = 0; attempt < 20; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 25));
      const poll = await request(app)
        .get(`/studio/session/${session.id}/poll`)
        .set("X-Vectis-Connector-Token", session.connectorToken)
        .expect(200);
      queuedCommands = poll.body.commands ?? [];
      if (queuedCommands.length > 0) break;
    }

    expect(queuedCommands.map((command) => command.type)).toContain("read_output");
    expect(queuedCommands.map((command) => command.type)).toContain("script_search");
    expect(queuedCommands.map((command) => command.type)).toContain("script_grep");
    expect(queuedCommands.map((command) => command.type)).toContain("script_read");
    for (const command of queuedCommands) {
      const result = command.type === "script_read" || command.type === "inspect_instance"
        ? {
            path: "ServerScriptService/SprintController",
            className: "Script",
            source: "error('live sprint failure')"
          }
        : command.type === "read_output"
          ? { messages: [{ level: "error", message: "SprintController: live sprint failure" }] }
          : command.type === "script_search"
            ? { matches: [{ path: "ServerScriptService/SprintController", className: "Script", score: 12 }] }
            : command.type === "script_grep"
              ? { matches: [{ path: "ServerScriptService/SprintController", line: 1, text: "error('live sprint failure')" }] }
              : { nodes: [{ path: "ServerScriptService/SprintController", className: "Script" }] };
      await request(app)
        .post(`/studio/session/${session.id}/command-result`)
        .set("X-Vectis-Connector-Token", session.connectorToken)
        .send({
          sessionId: session.id,
          commandId: command.id,
          status: "ok",
          result
        })
        .expect(200);
    }

    const chatRes = await chatPromise;
    expect(chatRes.body.changeSet).toBeDefined();
    expect(generateChangeSetSpy).toHaveBeenCalled();
    const prompt = generateChangeSetSpy.mock.calls[0][0].prompt;
    expect(prompt).toContain("LIVE STUDIO TOOL PREFLIGHT");
    expect(prompt).toContain("SprintController: live sprint failure");
    expect(prompt).toContain("error('live sprint failure')");
  });

  it("persists a retryable terminal result when the provider fails after headers are streamed", async () => {
    const app = await createApp();
    const agent = request.agent(app);

    await agent.post("/auth/private-owner").send({}).expect(200);
    const bootstrap = await agent.get("/bootstrap").expect(200);
    const project = bootstrap.body.projects[0];
    await store.addCredits(bootstrap.body.organization.id, 1500, "Test provider failure capacity");
    const threadRes = await agent
      .post(`/projects/${project.id}/threads`)
      .send({ name: "Provider Failure" })
      .expect(201);
    const threadId = threadRes.body.thread.id;
    await store.saveDoc("snapshots", {
      id: "snap_provider_failure",
      projectId: project.id,
      studioSessionId: "session_provider_failure",
      nodes: [{
        path: "StarterPack/Rifle/RecoilController",
        className: "LocalScript" as const,
        source: "print('cartoony recoil')",
        properties: {}
      }],
      createdAt: new Date().toISOString()
    });

    vi.spyOn(aiProviderModule, "generateSafeChangeSet").mockRejectedValue(
      new Error("google-vertex API Error: 400 - unsupported function_call field")
    );

    await agent
      .post(`/projects/${project.id}/chat`)
      .send({
        threadId,
        clientRequestId: "provider-failure-request-01",
        prompt: "Make the rifle more serious and repair the existing recoil controller",
        model: "gemini-3.5-flash",
        mode: "changeset"
      })
      .catch(() => undefined);

    const messages = await store.fetchMessagesForThread(threadId);
    const failed = messages.find((message) => message.role === "assistant" && message.status === "failed");
    expect(failed).toMatchObject({
      clientRequestId: "provider-failure-request-01",
      errorCode: "chat_generation_failed",
      errorTitle: "Generation stopped",
      errorCanRetry: true,
      retryPrompt: "Make the rifle more serious and repair the existing recoil controller"
    });
    const runs = await store.fetchAgentRunsForThread(threadId);
    expect(runs.at(-1)).toMatchObject({
      status: "failed",
      assistantMessageId: failed?.id
    });
  });

  it("replays a completed client request without creating or charging for a second generation", async () => {
    const app = await createApp();
    const agent = request.agent(app);
    await agent.post("/auth/private-owner").send({}).expect(200);
    const bootstrap = await agent.get("/bootstrap").expect(200);
    const project = bootstrap.body.projects[0];
    await store.addCredits(bootstrap.body.organization.id, 1500, "Test idempotent chat capacity");
    const thread = await agent.post(`/projects/${project.id}/threads`).send({ name: "Idempotent Chat" }).expect(201);

    await store.saveDoc("snapshots", {
      id: "snap_idempotent_chat",
      projectId: project.id,
      studioSessionId: "session_idempotent_chat",
      nodes: [{
        path: "ServerScriptService/Main",
        className: "Script" as const,
        source: "print('before')",
        properties: {}
      }],
      createdAt: new Date().toISOString()
    });
    const generateChangeSetSpy = vi.spyOn(aiProviderModule, "generateSafeChangeSet").mockResolvedValue({
      title: "Improve the main script",
      summary: "Updates the existing script.",
      files: [{
        id: "main",
        action: "update",
        instancePath: "ServerScriptService/Main",
        className: "Script",
        source: "print('after')",
        reason: "Update the existing behavior."
      }],
      safety: { ok: true, blockedPatterns: [] },
      usage: { promptTokens: 10, outputTokens: 20 }
    });
    const payload = {
      threadId: thread.body.thread.id,
      clientRequestId: "chat-idempotency-request-01",
      prompt: "Improve the existing main script",
      model: "gemini-3.5-flash",
      mode: "changeset"
    };

    const first = await agent.post(`/projects/${project.id}/chat`).send(payload).expect(200);
    const replay = await agent.post(`/projects/${project.id}/chat`).send(payload).expect(200);

    expect(replay.body).toMatchObject({
      userMessage: { id: first.body.userMessage.id },
      assistantMessage: { id: first.body.assistantMessage.id },
      changeSet: { id: first.body.changeSet.id }
    });
    expect(generateChangeSetSpy).toHaveBeenCalledTimes(1);
    expect(await store.fetchMessagesForThread(payload.threadId)).toHaveLength(2);

    const editPayload = {
      ...payload,
      clientRequestId: "edit-idempotency-request-01",
      prompt: "Improve the main script again"
    };
    const edited = await agent
      .patch(`/projects/${project.id}/messages/${first.body.userMessage.id}`)
      .send(editPayload)
      .expect(200);
    const editReplay = await agent
      .patch(`/projects/${project.id}/messages/${first.body.userMessage.id}`)
      .send(editPayload)
      .expect(200);

    expect(editReplay.body).toMatchObject({
      userMessage: { id: edited.body.userMessage.id },
      assistantMessage: { id: edited.body.assistantMessage.id },
      changeSet: { id: edited.body.changeSet.id }
    });
    expect(generateChangeSetSpy).toHaveBeenCalledTimes(2);
    expect(await store.fetchMessagesForThread(payload.threadId)).toHaveLength(2);
  });

  it("replays a failed client request without charging a second generation", async () => {
    const app = await createApp();
    const agent = request.agent(app);
    await agent.post("/auth/private-owner").send({}).expect(200);
    const bootstrap = await agent.get("/bootstrap").expect(200);
    const project = bootstrap.body.projects[0];
    await store.addCredits(bootstrap.body.organization.id, 1500, "Test failed replay capacity");
    const thread = await agent.post(`/projects/${project.id}/threads`).send({ name: "Failed Replay" }).expect(201);
    await store.saveDoc("snapshots", {
      id: "snap_failed_replay",
      projectId: project.id,
      studioSessionId: "session_failed_replay",
      nodes: [{
        path: "ServerScriptService/Main",
        className: "Script" as const,
        source: "print('before')",
        properties: {}
      }],
      createdAt: new Date().toISOString()
    });

    const generateChangeSetSpy = vi.spyOn(aiProviderModule, "generateSafeChangeSet").mockRejectedValue(
      new Error("provider unavailable")
    );
    const payload = {
      threadId: thread.body.thread.id,
      clientRequestId: "chat-failed-replay-01",
      prompt: "Improve the existing main script carefully",
      model: "gemini-3.5-flash",
      mode: "changeset" as const
    };

    await agent.post(`/projects/${project.id}/chat`).send(payload).catch(() => undefined);
    const messagesAfterFailure = await store.fetchMessagesForThread(payload.threadId);
    const failedAssistant = messagesAfterFailure.find((message) => message.role === "assistant" && message.status === "failed");
    expect(failedAssistant).toBeTruthy();
    const balanceAfterFailure = await store.getCreditBalance(bootstrap.body.organization.id);

    const replay = await agent.post(`/projects/${project.id}/chat`).send(payload).expect(200);
    expect(replay.body.assistantMessage).toMatchObject({
      id: failedAssistant!.id,
      status: "failed"
    });
    expect(generateChangeSetSpy).toHaveBeenCalledTimes(1);
    expect(await store.getCreditBalance(bootstrap.body.organization.id)).toBe(balanceAfterFailure);
    expect(await store.fetchMessagesForThread(payload.threadId)).toHaveLength(messagesAfterFailure.length);
  });
});
