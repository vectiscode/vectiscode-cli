import request from "supertest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createApp } from "../app.js";
import { store } from "../services/store.js";
import * as assetsModule from "../services/assets.js";

describe("Attachment Content Redirects", () => {
  beforeEach(async () => {
    await store.ready();
    await store.reset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("redirects to a signed URL (307) for Supabase attachments and falls back to 200 stream", async () => {
    const app = await createApp();
    const agent = request.agent(app);

    // 1. Sign in as private owner to bypass auth
    await agent.post("/auth/private-owner").send({}).expect(200);
    const bootstrap = await agent.get("/bootstrap").expect(200);
    const projectId = bootstrap.body.projects[0].id;
    const organizationId = bootstrap.body.organization.id;
    const userId = bootstrap.body.user.id;

    // 2. Create mock attachment documents
    const supabaseAttachment = await store.saveAttachment({
      id: "asset_supabase_test",
      organizationId,
      projectId,
      userId,
      source: "upload",
      fileName: "test_supabase.txt",
      mimeType: "text/plain",
      sizeBytes: 12,
      storagePath: "supabase://vectis-attachments/attachments/test_supabase.txt",
      createdAt: new Date().toISOString()
    });

    const localAttachment = await store.saveAttachment({
      id: "asset_local_test",
      organizationId,
      projectId,
      userId,
      source: "upload",
      fileName: "test_local.txt",
      mimeType: "text/plain",
      sizeBytes: 18,
      inlineBase64: Buffer.from("inline local bytes").toString("base64"),
      createdAt: new Date().toISOString()
    });

    // 3. Spy on getAttachmentSignedUrl and mock it
    const mockSignedUrl = "https://supabase.co/signed-url-redirect-test-12345";
    const getSignedUrlSpy = vi.spyOn(assetsModule, "getAttachmentSignedUrl")
      .mockImplementation(async (attachment) => {
        if (attachment.id === "asset_supabase_test") {
          return mockSignedUrl;
        }
        return undefined;
      });

    // 4. Test redirection for Supabase storage attachment
    const redirectRes = await agent
      .get(`/projects/${projectId}/attachments/${supabaseAttachment.id}/content`)
      .expect(307);

    expect(redirectRes.headers.location).toBe(mockSignedUrl);
    expect(redirectRes.headers["cache-control"]).toBe("no-store");
    expect(getSignedUrlSpy).toHaveBeenCalled();

    // 5. Test fallback streaming for local/inline attachment
    const streamRes = await agent
      .get(`/projects/${projectId}/attachments/${localAttachment.id}/content`)
      .expect(200);

    expect(streamRes.text).toBe("inline local bytes");
    expect(streamRes.headers["content-type"]).toContain("text/plain");
    expect(streamRes.headers["cache-control"]).toBe("private, no-store");
  });

  it("prunes Studio logs to prevent database bloat", async () => {
    const sessionId = "session_log_prune_test";
    
    for (let i = 1; i <= 105; i++) {
      await store.saveLog({
        id: `log_id_${i}`,
        studioSessionId: sessionId,
        level: "info",
        message: `Log line number ${i}`,
        createdAt: new Date(Date.now() + i * 1000).toISOString()
      });
    }

    const logs = await store.fetchLogsForSession(sessionId);
    expect(logs).toHaveLength(100);

    const messages = logs.map(l => l.message);
    expect(messages).not.toContain("Log line number 1");
    expect(messages).not.toContain("Log line number 5");
    expect(messages).toContain("Log line number 6");
    expect(messages).toContain("Log line number 105");
  });
});
