import { describe, expect, it } from "vitest";
import {
  AiRuntimeError,
  openAiCompatibleToolCalls,
  parseOpenAiCompatibleJson,
  parseOpenAiCompatibleSse,
  providerHttpError,
  withProviderRetry
} from "../services/aiRuntime.js";

function sseResponse(chunks: string[]) {
  const encoder = new TextEncoder();
  const body = new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    }
  });
  return new Response(body, {
    status: 200,
    headers: { "Content-Type": "text/event-stream" }
  });
}

describe("AI runtime stream parsing", () => {
  it("normalizes OpenAI-compatible text, reasoning, usage, and finish chunks", async () => {
    const events: string[] = [];
    const result = await parseOpenAiCompatibleSse({
      provider: "yunwu",
      response: sseResponse([
        `data: ${JSON.stringify({ choices: [{ delta: { reasoning_content: "hidden reasoning" } }] })}\n\n`,
        `data: ${JSON.stringify({ choices: [{ delta: { content: "Visible " } }] })}\n\n`,
        `data: ${JSON.stringify({ choices: [{ delta: { content: "answer." }, finish_reason: "stop" }], usage: { prompt_tokens: 10, completion_tokens: 4 } })}\n\n`,
        "data: [DONE]\n\n"
      ]),
      onText: (text) => events.push(text),
      onEvent: (event) => events.push(event.type)
    });

    expect(result.text).toBe("Visible answer.");
    expect(result.reasoning).toBe("hidden reasoning");
    expect(result.finishReason).toBe("stop");
    expect(result.usage).toMatchObject({ inputTokens: 10, outputTokens: 4, providerCostSource: "yunwu" });
    expect(events).toContain("Visible ");
    expect(events).toContain("text_delta");
    expect(events).toContain("reasoning_delta");
  });

  it("throws a typed parse error when malformed chunks produce no usable text", async () => {
    await expect(parseOpenAiCompatibleSse({
      provider: "yunwu",
      response: sseResponse(["data: {not-json}\n\n", "data: [DONE]\n\n"])
    })).rejects.toMatchObject({
      name: "AiRuntimeError",
      code: "stream_parse",
      provider: "yunwu",
      retryable: true
    } satisfies Partial<AiRuntimeError>);
  });

  it("parses non-streaming provider JSON through the same result shape", () => {
    const parsed = parseOpenAiCompatibleJson({
      choices: [{ message: { content: "Plain JSON answer." }, finish_reason: "stop" }],
      usage: { input_tokens: 7, output_tokens: 3 }
    }, "yunwu");

    expect(parsed.text).toBe("Plain JSON answer.");
    expect(parsed.finishReason).toBe("stop");
    expect(parsed.usage).toMatchObject({ inputTokens: 7, outputTokens: 3, providerCostSource: "yunwu" });
  });

  it("extracts OpenAI-compatible tool calls with parsed JSON arguments", () => {
    const calls = openAiCompatibleToolCalls({
      choices: [{
        message: {
          tool_calls: [
            {
              id: "call_1",
              type: "function",
              function: {
                name: "finalize_changeset",
                arguments: JSON.stringify({
                  title: "Sprint",
                  files: [{ action: "update", instancePath: "ServerScriptService/Sprint", className: "Script", reason: "Wire sprint" }]
                })
              }
            }
          ]
        }
      }]
    });

    expect(calls).toEqual([{
      id: "call_1",
      name: "finalize_changeset",
      input: {
        title: "Sprint",
        files: [{ action: "update", instancePath: "ServerScriptService/Sprint", className: "Script", reason: "Wire sprint" }]
      }
    }]);
  });

  it("honors retry headers and retries only retryable failures", async () => {
    const error = await providerHttpError("vertex", new Response("busy", { status: 429, headers: { "retry-after-ms": "0" } }));
    expect(error).toMatchObject({ retryable: true, retryAfterMs: 0, status: 429 });
    let attempts = 0;
    const result = await withProviderRetry(async () => {
      attempts += 1;
      if (attempts === 1) throw error;
      return "ok";
    });
    expect(result).toBe("ok");
    expect(attempts).toBe(2);
  });
});
