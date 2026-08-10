import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createApp } from "../app.js";
import { store } from "../services/store.js";
import { config } from "../services/config.js";

describe("Patch Comments API Routes", () => {
  beforeEach(async () => {
    await store.reset();
    vi.restoreAllMocks();
  });

  it("can add and resolve patch comments", async () => {
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

    // Create a mock changeset
    const changeSet = await store.saveChangeSet({
      id: "cs_comment_test",
      projectId: project.id,
      threadId,
      aiMessageId: "msg_ai123",
      title: "Test Changeset",
      summary: "Does something",
      status: "ready_for_review",
      files: [],
      safety: { ok: true, blockedPatterns: [] },
      createdAt: new Date().toISOString()
    });

    // 1. POST /projects/:projectId/changesets/:changeSetId/comments (Add comment)
    const commentRes = await agent
      .post(`/projects/${project.id}/changesets/${changeSet.id}/comments`)
      .send({
        commentText: "This looks like a great implementation",
        filePath: "ServerScriptService/Test.lua"
      })
      .expect(200);

    const comment = commentRes.body.comment;
    expect(comment).toBeDefined();
    expect(comment.commentText).toBe("This looks like a great implementation");
    expect(comment.filePath).toBe("ServerScriptService/Test.lua");
    expect(comment.resolved).toBe(false);

    // Check that the changeset's reviewCommentCount is incremented
    const updatedChangeSet = await store.fetchChangeSet(changeSet.id);
    expect(updatedChangeSet?.reviewCommentCount).toBe(1);

    // 2. POST /projects/:projectId/comments/:commentId/resolve (Resolve comment)
    const resolveRes = await agent
      .post(`/projects/${project.id}/comments/${comment.id}/resolve`)
      .send({})
      .expect(200);

    const resolvedComment = resolveRes.body.comment;
    expect(resolvedComment.resolved).toBe(true);
    expect(resolvedComment.resolvedByUserId).toBeDefined();
    expect(resolvedComment.resolvedAt).toBeDefined();
  });
});
