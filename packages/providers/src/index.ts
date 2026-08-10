import type { CredentialVault, ProviderAdapter } from "@vectiscode/core";

import { AnthropicAdapter } from "./anthropic.js";
import { GoogleAdapter } from "./google.js";
import { OllamaAdapter } from "./ollama.js";
import { OpenAiCompatibleAdapter } from "./openai-compatible.js";

export class ProviderRegistry {
  private readonly adapters = new Map<string, ProviderAdapter>();

  constructor(adapters: ProviderAdapter[]) {
    for (const adapter of adapters) {
      if (this.adapters.has(adapter.id)) throw new Error(`Duplicate provider id: ${adapter.id}`);
      this.adapters.set(adapter.id, adapter);
    }
  }

  get(id: string): ProviderAdapter {
    const adapter = this.adapters.get(id.toLowerCase());
    if (!adapter) throw new Error(`Unknown provider ${id}. Available: ${this.list().map((item) => item.id).join(", ")}`);
    return adapter;
  }

  list(): ProviderAdapter[] {
    return [...this.adapters.values()];
  }
}

export function createProviderRegistry(vault: CredentialVault): ProviderRegistry {
  return new ProviderRegistry([
    new OpenAiCompatibleAdapter(vault, {
      id: "openai",
      label: "OpenAI",
      credentialProvider: "openai",
      credentialRequired: true,
      baseUrl: () => process.env.OPENAI_BASE_URL ?? "https://api.openai.com/v1",
      capabilities: { images: true, promptCaching: true }
    }),
    new AnthropicAdapter(vault),
    new GoogleAdapter(vault),
    new OpenAiCompatibleAdapter(vault, {
      id: "openrouter",
      label: "OpenRouter",
      credentialProvider: "openrouter",
      credentialRequired: true,
      baseUrl: () => "https://openrouter.ai/api/v1",
      headers: () => ({ "HTTP-Referer": "https://vectiscode.com", "X-Title": "VectisCode CLI" }),
      capabilities: { images: true }
    }),
    new OllamaAdapter(),
    new OpenAiCompatibleAdapter(vault, {
      id: "openai-compatible",
      label: "OpenAI compatible",
      credentialProvider: "openai-compatible",
      credentialRequired: false,
      baseUrl: () => process.env.OPENAI_COMPATIBLE_BASE_URL ?? "http://127.0.0.1:1234/v1"
    })
  ]);
}

export { AnthropicAdapter, GoogleAdapter, OllamaAdapter, OpenAiCompatibleAdapter };
