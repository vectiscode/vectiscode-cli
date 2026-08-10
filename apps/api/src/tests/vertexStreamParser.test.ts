import { describe, expect, it } from "vitest";
import { compileGeminiGenerationConfig, vertexToolTurnContents, VertexStreamObjectParser } from "../services/aiProvider.js";

const streamPayload = JSON.stringify([
  {
    candidates: [{ content: { role: "model", parts: [{ text: "First sentence. " }] } }]
  },
  {
    candidates: [{ content: { role: "model", parts: [{ text: "Second sentence." }] }, finishReason: "STOP" }],
    usageMetadata: { promptTokenCount: 20, candidatesTokenCount: 8, totalTokenCount: 28 }
  }
]);

describe("VertexStreamObjectParser", () => {
  it("uses Gemini 3 tiered thinking without custom sampling parameters", () => {
    const config = compileGeminiGenerationConfig({ thinkingLevel: "none", maxOutputTokens: 8192 });
    expect(config).toEqual({ maxOutputTokens: 8192, thinkingConfig: { thinkingLevel: "minimal", includeThoughts: true } });
    expect(config).not.toHaveProperty("temperature");
    expect(config).not.toHaveProperty("topP");
    expect(compileGeminiGenerationConfig({ thinkingLevel: "max", maxOutputTokens: 16384 }).thinkingConfig.thinkingLevel).toBe("high");
  });
  it("parses Vertex objects split across arbitrary network chunks", () => {
    const parser = new VertexStreamObjectParser();
    const parsed = [...streamPayload].flatMap((character) => parser.push(character));

    expect(parsed).toHaveLength(2);
    expect(parsed[0].candidates?.[0]?.content?.parts[0]?.text).toBe("First sentence. ");
    expect(parsed[1].candidates?.[0]?.content?.parts[0]?.text).toBe("Second sentence.");
    expect(parsed[1].candidates?.[0]?.finishReason).toBe("STOP");
    expect(parsed[1].usageMetadata?.candidatesTokenCount).toBe(8);
  });

  it("does not rescan an incomplete object when the next chunk arrives", () => {
    const parser = new VertexStreamObjectParser();
    const splitAt = streamPayload.indexOf("First sentence") + 5;

    expect(parser.push(streamPayload.slice(0, splitAt))).toEqual([]);
    expect(parser.push(streamPayload.slice(splitAt))).toHaveLength(2);
  });

  it("preserves Gemini thought signatures and provider call IDs", () => {
    const parser = new VertexStreamObjectParser();
    const [chunk] = parser.push(JSON.stringify({
      candidates: [{ content: { role: "model", parts: [{
        thoughtSignature: "opaque-signature",
        functionCall: { id: "provider-call-7", name: "script_read", args: { path: "ServerScriptService/Main" } }
      }] } }]
    }));
    const part = chunk.candidates?.[0]?.content?.parts[0];
    expect(part?.thoughtSignature).toBe("opaque-signature");
    expect(part?.functionCall?.id).toBe("provider-call-7");
  });

  it("serializes Vertex tool history without unsupported call IDs or roles", () => {
    const contents = vertexToolTurnContents(
      [{ id: "provider-call-7", name: "script_read", input: { path: "ServerScriptService/Main" }, thoughtSignature: "opaque-signature" }],
      [{ id: "provider-call-7", name: "script_read", result: { source: "print('ok')" } }]
    );

    expect(contents).toEqual([
      {
        role: "model",
        parts: [{ functionCall: { name: "script_read", args: { path: "ServerScriptService/Main" } }, thoughtSignature: "opaque-signature" }]
      },
      {
        role: "user",
        parts: [{ functionResponse: { name: "script_read", response: { source: "print('ok')" } } }]
      }
    ]);
    expect(JSON.stringify(contents)).not.toContain('"id"');
    expect(JSON.stringify(contents)).not.toContain('"role":"function"');
  });
});
