import { describe, expect, it } from "vitest";

import type { CredentialVault, ProviderAdapter } from "@vectiscode/core";

import { createProviderRegistry, ProviderRegistry } from "./index.js";

const vault: CredentialVault = {
  get: async () => null,
  set: async () => undefined,
  delete: async () => undefined,
  list: async () => []
};

function adapter(id: string): ProviderAdapter {
  return {
    id,
    label: id,
    capabilities: { tools: true, images: false, reasoning: false, modelDiscovery: true, promptCaching: false, parallelToolCalls: false },
    validate: async () => ({ ok: true }),
    listModels: async () => [],
    complete: async () => ({ text: "", toolCalls: [], usage: { provider: id, model: "test", inputTokens: 0, outputTokens: 0 } })
  };
}

describe("provider registry", () => {
  it("publishes one canonical adapter for every supported provider", () => {
    const ids = createProviderRegistry(vault).list().map((provider) => provider.id);
    expect(ids).toEqual(["openai", "anthropic", "google", "groq", "deepseek", "openrouter", "ollama", "openai-compatible", "xai", "azure", "lmstudio"]);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("resolves provider aliases seamlessly", () => {
    const registry = createProviderRegistry(vault);
    expect(registry.get("chatgpt").id).toBe("openai");
    expect(registry.get("claude").id).toBe("anthropic");
    expect(registry.get("gemini").id).toBe("google");
    expect(registry.get("meta").id).toBe("groq");
  });

  it("rejects duplicate provider identifiers", () => {
    expect(() => new ProviderRegistry([adapter("local"), adapter("local")])).toThrow("Duplicate provider id: local");
  });
});
