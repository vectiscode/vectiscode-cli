import { afterEach, describe, expect, it, vi } from "vitest";
import worker, { isAllowedWebOrigin } from "../../../cf-api-proxy/src/index.js";

describe("Cloudflare API proxy", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("answers credentialed preflight requests before Hugging Face can strip CORS headers", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const request = new Request("https://api.vectiscode.com/projects/test/studio/pair-project", {
      method: "OPTIONS",
      headers: {
        Origin: "https://vectiscode.com",
        "Access-Control-Request-Method": "POST",
        "Access-Control-Request-Headers": "content-type,x-csrf-token"
      }
    });

    const response = await worker.fetch(request);

    expect(response.status).toBe(204);
    expect(response.headers.get("Access-Control-Allow-Origin")).toBe("https://vectiscode.com");
    expect(response.headers.get("Access-Control-Allow-Credentials")).toBe("true");
    expect(response.headers.get("Access-Control-Allow-Methods")).toBe("POST");
    expect(response.headers.get("Access-Control-Allow-Headers")).toBe("content-type,x-csrf-token");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("blocks preflight requests from untrusted origins", async () => {
    const response = await worker.fetch(new Request("https://api.vectiscode.com/studio/connect", {
      method: "OPTIONS",
      headers: {
        Origin: "https://attacker.example",
        "Access-Control-Request-Method": "POST"
      }
    }));

    expect(response.status).toBe(403);
    expect(response.headers.get("Access-Control-Allow-Origin")).toBeNull();
  });

  it("keeps allowed preview and production origins aligned with the API", () => {
    expect(isAllowedWebOrigin("https://vectiscode.com")).toBe(true);
    expect(isAllowedWebOrigin("https://www.vectiscode.com")).toBe(true);
    expect(isAllowedWebOrigin("https://preview-123.vectiscode.pages.dev")).toBe(true);
    expect(isAllowedWebOrigin("https://example.pages.dev")).toBe(false);
  });

  it("adds credentialed CORS headers to proxied responses", async () => {
    const fetchSpy = vi.fn().mockResolvedValue(new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { "Content-Type": "application/json" }
    }));
    vi.stubGlobal("fetch", fetchSpy);
    const request = new Request("https://api.vectiscode.com/readiness", {
      headers: { Origin: "https://vectiscode.com" }
    });

    const response = await worker.fetch(request);

    expect(fetchSpy).toHaveBeenCalledOnce();
    const upstreamRequest = fetchSpy.mock.calls[0][0] as Request;
    expect(new URL(upstreamRequest.url).hostname).toBe("juicy123-vectiscode.hf.space");
    expect(response.headers.get("Access-Control-Allow-Origin")).toBe("https://vectiscode.com");
    expect(response.headers.get("Access-Control-Allow-Credentials")).toBe("true");
  });
});
