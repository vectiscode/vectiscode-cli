import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RoutedRobloxAiProvider, XiaomiRobloxAiProvider } from "../services/aiProvider.js";
import { config } from "../services/config.js";

describe("Yunwu provider routing", () => {
  const originalApiKey = config.yunwu.apiKey;
  const originalBaseUrl = config.yunwu.baseUrl;
  const originalPrefer = config.yunwu.prefer;
  const originalMoonshotApiKey = config.moonshot.apiKey;
  const originalMoonshotBaseUrl = config.moonshot.baseUrl;
  const project = {
    id: "project_yunwu",
    organizationId: "org_yunwu",
    name: "Yunwu Test",
    description: "Provider routing test",
    template: "obby",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  } as const;

  beforeEach(() => {
    config.yunwu.apiKey = "yunwu-test";
    config.yunwu.baseUrl = "https://yunwu.test/v1";
    config.yunwu.prefer = true;
  });

  afterEach(() => {
    vi.restoreAllMocks();
    config.yunwu.apiKey = originalApiKey;
    config.yunwu.baseUrl = originalBaseUrl;
    config.yunwu.prefer = originalPrefer;
    config.moonshot.apiKey = originalMoonshotApiKey;
    config.moonshot.baseUrl = originalMoonshotBaseUrl;
  });

  it("routes Yunwu-only models through the OpenAI-compatible chat endpoint", async () => {
    let requestUrl = "";
    let requestBody: any;
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input: any, init?: RequestInit) => {
      requestUrl = String(input);
      requestBody = JSON.parse(String(init?.body ?? "{}"));
      return new Response(JSON.stringify({
        choices: [{ message: { content: "Server validation stops client exploits." } }],
        usage: { prompt_tokens: 100, completion_tokens: 8 }
      }), {
        status: 200,
        headers: { "Content-Type": "application/json" }
      });
    });

    const provider = new RoutedRobloxAiProvider();
    const response = await provider.answerProjectQuestion({
      project,
      prompt: "Why validate RemoteEvents on the server?",
      model: "qwen3.7-max"
    });

    expect(requestUrl).toBe("https://yunwu.test/v1/chat/completions");
    expect(requestBody.model).toBe("qwen3.7-max");
    expect(requestBody.max_tokens).toBe(8192);
    expect(response.usage).toMatchObject({ inputTokens: 100, outputTokens: 8, providerCostSource: "yunwu" });
  });

  it("caps routine optimized answer length without changing normal Yunwu answer limits", async () => {
    let requestBody: any;
    vi.spyOn(globalThis, "fetch").mockImplementation(async (_input: any, init?: RequestInit) => {
      requestBody = JSON.parse(String(init?.body ?? "{}"));
      return new Response(JSON.stringify({
        choices: [{ message: { content: "Keep RemoteEvents validated on the server." } }],
        usage: { prompt_tokens: 40, completion_tokens: 8 }
      }), {
        status: 200,
        headers: { "Content-Type": "application/json" }
      });
    });

    const provider = new RoutedRobloxAiProvider();
    await provider.answerProjectQuestion({
      project,
      prompt: "What is a RemoteEvent?",
      model: "qwen3.7-max",
      responseStyle: "concise"
    });

    expect(requestBody.model).toBe("qwen3.7-max");
    expect(requestBody.max_tokens).toBe(2048);
    expect(String(requestBody.messages[0].content)).toContain("Routine optimized answer");
  });

  it("keeps streamed reasoning out of visible Yunwu answers", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async () => {
      const encoder = new TextEncoder();
      const body = new ReadableStream({
        start(controller) {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ choices: [{ delta: { reasoning_content: "hidden chain of thought" } }] })}\n\n`));
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ choices: [{ delta: { content: "Use server authority for rewards." } }], usage: { prompt_tokens: 12, completion_tokens: 4 } })}\n\n`));
          controller.enqueue(encoder.encode("data: [DONE]\n\n"));
          controller.close();
        }
      });
      return new Response(body, {
        status: 200,
        headers: { "Content-Type": "text/event-stream" }
      });
    });

    const provider = new RoutedRobloxAiProvider();
    const response = await provider.answerProjectQuestion({
      project,
      prompt: "How should rewards be validated?",
      model: "qwen3.7-max"
    });

    expect(response.text).toBe("Use server authority for rewards.");
    expect(response.text).not.toContain("hidden chain of thought");
  });

  it("passes Gemini thinking effort to Yunwu without Gemini SDK routing", async () => {
    let requestBody: any;
    vi.spyOn(globalThis, "fetch").mockImplementation(async (_input: any, init?: RequestInit) => {
      requestBody = JSON.parse(String(init?.body ?? "{}"));
      return new Response(JSON.stringify({
        choices: [{ message: { content: "Gemini via Yunwu answered." } }],
        usage: { prompt_tokens: 20, completion_tokens: 5 }
      }), {
        status: 200,
        headers: { "Content-Type": "application/json" }
      });
    });

    const provider = new RoutedRobloxAiProvider();
    await provider.answerProjectQuestion({
      project,
      prompt: "Inspect my project.",
      model: "gemini-3.5-flash",
      preferences: { thinkingGemini35Flash: "high" }
    });

    expect(requestBody.model).toBe("gemini-3.5-flash");
    expect(requestBody.reasoning_effort).toBe("high");
    expect(requestBody.temperature).toBeUndefined();

    await provider.answerProjectQuestion({
      project,
      prompt: "Inspect my project on free plan.",
      model: "gemini-3.5-flash",
      plan: "free",
      preferences: { thinkingGemini35Flash: "high" }
    });

    expect(requestBody.reasoning_effort).toBe("medium");
  });

  it("routes gpt-5.5 to Yunwu and passes reasoning_effort based on preferences", async () => {
    let requestBody: any;
    vi.spyOn(globalThis, "fetch").mockImplementation(async (_input: any, init?: RequestInit) => {
      requestBody = JSON.parse(String(init?.body ?? "{}"));
      return new Response(JSON.stringify({
        choices: [{ message: { content: "GPT-5.5 answered." } }],
        usage: { prompt_tokens: 30, completion_tokens: 10 }
      }), {
        status: 200,
        headers: { "Content-Type": "application/json" }
      });
    });

    const provider = new RoutedRobloxAiProvider();
    await provider.answerProjectQuestion({
      project,
      prompt: "Explain architecture.",
      model: "gpt-5.5",
      preferences: { thinkingGpt55: "medium" }
    });

    expect(requestBody.model).toBe("gpt-5.5");
    expect(requestBody.reasoning_effort).toBe("medium");
    expect(requestBody.temperature).toBeUndefined();

    // Verify xhigh maps to xhigh
    await provider.answerProjectQuestion({
      project,
      prompt: "Explain architecture.",
      model: "gpt-5.5",
      preferences: { thinkingGpt55: "xhigh" }
    });
    expect(requestBody.reasoning_effort).toBe("xhigh");
  });

  it("passes reasoning_effort for qwen3.7-max and claude-opus-4-8 based on preferences", async () => {
    let lastRequestBody: any;
    vi.spyOn(globalThis, "fetch").mockImplementation(async (_input: any, init?: RequestInit) => {
      lastRequestBody = JSON.parse(String(init?.body ?? "{}"));
      return new Response(JSON.stringify({
        choices: [{ message: { content: "Relay answer." } }],
        usage: { prompt_tokens: 30, completion_tokens: 10 }
      }), {
        status: 200,
        headers: { "Content-Type": "application/json" }
      });
    });

    const provider = new RoutedRobloxAiProvider();

    // Test Qwen
    await provider.answerProjectQuestion({
      project,
      prompt: "Relay test.",
      model: "qwen3.7-max",
      preferences: { thinkingQwen: "high" }
    });
    expect(lastRequestBody.model).toBe("qwen3.7-max");
    expect(lastRequestBody.reasoning_effort).toBe("high");

    // Test Claude Opus
    await provider.answerProjectQuestion({
      project,
      prompt: "Relay test.",
      model: "claude-opus-4-8",
      preferences: { thinkingOpus: "max" }
    });
    expect(lastRequestBody.model).toBe("claude-opus-4-8");
    expect(lastRequestBody.reasoning_effort).toBe("max");
    expect(lastRequestBody.temperature).toBeUndefined();
    expect(lastRequestBody.top_p).toBeUndefined();

    // Test Kimi K2.7 Code
    await provider.answerProjectQuestion({
      project,
      prompt: "Relay test.",
      model: "kimi-k2.7-code",
      preferences: { thinkingKimi: "high" }
    });
    expect(lastRequestBody.model).toBe("kimi-k2.7-code");
    expect(lastRequestBody.reasoning_effort).toBe("high");
    expect(lastRequestBody.temperature).toBeUndefined();
    expect(lastRequestBody.top_p).toBeUndefined();
  });

  it("routes Kimi K2.7 Code through Moonshot with official always-on thinking when Yunwu is not preferred", async () => {
    let requestUrl = "";
    let requestBody: any;
    config.yunwu.apiKey = "";
    config.yunwu.prefer = false;
    config.moonshot.apiKey = "moonshot-test";
    config.moonshot.baseUrl = "https://moonshot.test/v1";

    vi.spyOn(globalThis, "fetch").mockImplementation(async (input: any, init?: RequestInit) => {
      requestUrl = String(input);
      requestBody = JSON.parse(String(init?.body ?? "{}"));
      return new Response(JSON.stringify({
        choices: [{ message: { content: "Kimi can inspect the Roblox task." } }],
        usage: { prompt_tokens: 20, completion_tokens: 7 }
      }), {
        status: 200,
        headers: { "Content-Type": "application/json" }
      });
    });

    const provider = new RoutedRobloxAiProvider();
    await provider.answerProjectQuestion({
      project,
      prompt: "Relay test.",
      model: "kimi-k2.7-code",
      preferences: { thinkingKimi: "none" }
    });

    expect(requestUrl).toBe("https://moonshot.test/v1/chat/completions");
    expect(requestBody.model).toBe("kimi-k2.7-code");
    expect(requestBody.thinking).toEqual({ type: "enabled", keep: "all" });
    expect(requestBody.reasoning_effort).toBeUndefined();
  });

  it("omits OpenAI JSON mode for Opus, but includes it for Qwen relay patch requests", async () => {
    let requestBody: any;
    vi.spyOn(globalThis, "fetch").mockImplementation(async (_input: any, init?: RequestInit) => {
      requestBody = JSON.parse(String(init?.body ?? "{}"));
      return new Response(JSON.stringify({
        choices: [{
          message: {
            content: null,
            tool_calls: [{
              id: "call_finalize",
              type: "function",
              function: {
                name: "finalize_changeset",
                arguments: JSON.stringify({
                  title: "Patch",
                  summary: "Prepared a safe patch.",
                  files: []
                })
              }
            }]
          }
        }],
        usage: { prompt_tokens: 30, completion_tokens: 10 }
      }), {
        status: 200,
        headers: { "Content-Type": "application/json" }
      });
    });

    const provider = new RoutedRobloxAiProvider();

    // Test Claude Opus (omits response_format)
    await provider.generateChangeSet({
      project,
      prompt: "Create a small reviewed Studio patch.",
      model: "claude-opus-4-8",
      preferences: { thinkingOpus: "max" }
    });

    expect(requestBody.model).toBe("claude-opus-4-8");
    expect(requestBody.max_tokens).toBe(16384);
    expect(requestBody.reasoning_effort).toBe("max");
    expect(requestBody.response_format).toBeUndefined();
    expect(requestBody.temperature).toBeUndefined();
    expect(requestBody.top_p).toBeUndefined();

    // Test Qwen (uses native tool contract first)
    await provider.generateChangeSet({
      project,
      prompt: "Create a small reviewed Studio patch.",
      model: "qwen3.7-max",
      preferences: { thinkingQwen: "high" }
    });

    expect(requestBody.model).toBe("qwen3.7-max");
    expect(requestBody.max_tokens).toBe(16384);
    expect(requestBody.reasoning_effort).toBe("high");
    expect(requestBody.response_format).toBeUndefined();
    expect(requestBody.tools?.some((tool: { function?: { name?: unknown } }) => tool.function?.name === "finalize_changeset")).toBe(true);
    expect(requestBody.temperature).toBeUndefined();
    expect(requestBody.top_p).toBeUndefined();
  });

  it("uses the native read-tool loop for OpenAI-compatible answer providers", async () => {
    const requestBodies: Array<Record<string, any>> = [];
    vi.spyOn(globalThis, "fetch").mockImplementation(async (_input: any, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body ?? "{}"));
      requestBodies.push(body);
      const response = requestBodies.length === 1
        ? {
            choices: [{ message: { content: null, tool_calls: [{ id: "call_read", type: "function", function: { name: "script_read", arguments: JSON.stringify({ path: "ServerScriptService/Main" }) } }] } }],
            usage: { prompt_tokens: 20, completion_tokens: 4 }
          }
        : {
            choices: [{ message: { content: "The server script trusts a client-provided reward value." }, finish_reason: "stop" }],
            usage: { prompt_tokens: 30, completion_tokens: 8 }
          };
      return new Response(JSON.stringify(response), { status: 200, headers: { "Content-Type": "application/json" } });
    });

    const executed: string[] = [];
    const provider = new RoutedRobloxAiProvider();
    const response = await provider.answerProjectQuestion({
      project,
      prompt: "Inspect the server reward handling.",
      model: "qwen3.7-max",
      studioTools: {
        enabled: true,
        execute: async (calls) => calls.map((call) => {
          executed.push(call.name);
          return { id: call.id, name: call.name, result: { source: "RewardEvent.OnServerEvent:Connect(function(player, amount) player.Coins.Value += amount end)" } };
        })
      }
    });

    expect(response.text).toContain("trusts a client-provided reward");
    expect(executed).toEqual(["script_read"]);
    expect(requestBodies[0].tools).toEqual(expect.arrayContaining([
      expect.objectContaining({ function: expect.objectContaining({ name: "script_read" }) })
    ]));
    expect(requestBodies[0].tools).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ function: expect.objectContaining({ name: "finalize_changeset" }) })
    ]));
    expect(requestBodies[1].messages).toEqual(expect.arrayContaining([
      expect.objectContaining({ role: "tool", tool_call_id: "call_read" })
    ]));
  });

  it("stops repeated native reads and finishes from collected evidence", async () => {
    const requestBodies: Array<Record<string, any>> = [];
    vi.spyOn(globalThis, "fetch").mockImplementation(async (_input: any, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body ?? "{}"));
      requestBodies.push(body);
      const response = requestBodies.length <= 3
        ? {
            choices: [{ message: { content: null, tool_calls: [{ id: `call_${requestBodies.length}`, type: "function", function: { name: "script_read", arguments: JSON.stringify({ path: "ServerScriptService/Main" }) } }] } }],
            usage: { prompt_tokens: 10, completion_tokens: 2 }
          }
        : {
            choices: [{ message: { content: "The existing evidence is enough to diagnose the trust bug." }, finish_reason: "stop" }],
            usage: { prompt_tokens: 12, completion_tokens: 6 }
          };
      return new Response(JSON.stringify(response), { status: 200, headers: { "Content-Type": "application/json" } });
    });

    const executed: string[] = [];
    const warnings: string[] = [];
    const provider = new RoutedRobloxAiProvider();
    const response = await provider.answerProjectQuestion({
      project,
      prompt: "Inspect the same script until you can diagnose it.",
      model: "qwen3.7-max",
      studioTools: {
        enabled: true,
        execute: async (calls) => calls.map((call) => {
          executed.push(call.name);
          return { id: call.id, name: call.name, result: { source: "return true" } };
        })
      },
      onRuntimeEvent: (event) => {
        if (event.type === "warning") warnings.push(event.message);
      }
    });

    expect(response.text).toContain("existing evidence");
    expect(executed).toEqual(["script_read", "script_read"]);
    expect(warnings).toContain("The agent repeated the same read call three times. Forcing a final answer from current evidence.");
    expect(requestBodies).toHaveLength(4);
    expect(requestBodies[3].tools).toBeUndefined();
  });

  it("cancels the native answer loop before another provider call", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const provider = new RoutedRobloxAiProvider();

    await expect(provider.answerProjectQuestion({
      project,
      prompt: "Inspect the project.",
      model: "qwen3.7-max",
      studioTools: {
        enabled: true,
        isCancelled: async () => true,
        execute: async () => []
      }
    })).rejects.toThrow("Agent run cancelled at a safe runtime boundary.");

    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
