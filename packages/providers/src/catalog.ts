import type { ProviderCapabilities, ProviderModel } from "@vectiscode/core";

export interface CatalogProviderEntry {
  id: string;
  label: string;
  tier: "verified" | "catalog" | "experimental";
  auth: "api_key" | "oauth" | "none";
  baseUrl?: string;
  models: ProviderModel[];
}

function caps(override: Partial<ProviderCapabilities> = {}): ProviderCapabilities {
  return {
    tools: true,
    images: false,
    reasoning: false,
    modelDiscovery: true,
    promptCaching: false,
    parallelToolCalls: true,
    ...override
  };
}

export const providerCatalog: CatalogProviderEntry[] = [
  {
    id: "openai",
    label: "OpenAI",
    tier: "verified",
    auth: "api_key",
    baseUrl: "https://api.openai.com/v1",
    models: [
      { id: "openai/gpt-4o", label: "GPT-4o", provider: "openai", capabilities: caps({ images: true, reasoning: false, promptCaching: true }), contextWindow: 128000, supportsTools: true, streaming: true },
      { id: "openai/gpt-4o-mini", label: "GPT-4o mini", provider: "openai", capabilities: caps({ images: true, promptCaching: true }), contextWindow: 128000, streaming: true },
      { id: "openai/o4-mini", label: "o4 mini", provider: "openai", capabilities: caps({ reasoning: true, promptCaching: true }), contextWindow: 200000, supportsReasoning: true, streaming: true },
      { id: "openai/gpt-4.1", label: "GPT-4.1", provider: "openai", capabilities: caps({ images: true }), contextWindow: 1000000, streaming: true }
    ]
  },
  {
    id: "anthropic",
    label: "Anthropic",
    tier: "verified",
    auth: "api_key",
    baseUrl: "https://api.anthropic.com",
    models: [
      { id: "anthropic/claude-sonnet-4", label: "Claude Sonnet 4", provider: "anthropic", capabilities: caps({ images: true, reasoning: true }), contextWindow: 200000, supportsReasoning: true, streaming: true },
      { id: "anthropic/claude-haiku-4", label: "Claude Haiku 4", provider: "anthropic", capabilities: caps({ images: true }), contextWindow: 200000, streaming: true }
    ]
  },
  {
    id: "google",
    label: "Google",
    tier: "verified",
    auth: "api_key",
    models: [
      { id: "google/gemini-2.5-pro", label: "Gemini 2.5 Pro", provider: "google", capabilities: caps({ images: true, reasoning: true }), contextWindow: 1000000, supportsReasoning: true, streaming: true },
      { id: "google/gemini-2.5-flash", label: "Gemini 2.5 Flash", provider: "google", capabilities: caps({ images: true }), contextWindow: 1000000, streaming: true }
    ]
  },
  {
    id: "openrouter",
    label: "OpenRouter",
    tier: "verified",
    auth: "api_key",
    baseUrl: "https://openrouter.ai/api/v1",
    models: [
      { id: "openrouter/auto", label: "OpenRouter Auto", provider: "openrouter", capabilities: caps({ images: true }), contextWindow: 200000, streaming: true }
    ]
  },
  {
    id: "ollama",
    label: "Ollama",
    tier: "verified",
    auth: "none",
    baseUrl: "http://127.0.0.1:11434/v1",
    models: [
      { id: "ollama/llama3.2", label: "Llama 3.2", provider: "ollama", capabilities: caps({ modelDiscovery: false }), contextWindow: 128000, streaming: true },
      { id: "ollama/qwen2.5-coder", label: "Qwen2.5 Coder", provider: "ollama", capabilities: caps({ modelDiscovery: false }), contextWindow: 32000, streaming: true }
    ]
  },
  {
    id: "openai-compatible",
    label: "OpenAI compatible",
    tier: "verified",
    auth: "api_key",
    models: [
      { id: "openai-compatible/model", label: "Custom model", provider: "openai-compatible", capabilities: caps(), streaming: true }
    ]
  },
  {
    id: "xai",
    label: "xAI",
    tier: "catalog",
    auth: "api_key",
    baseUrl: "https://api.x.ai/v1",
    models: [
      { id: "xai/grok-4", label: "Grok 4", provider: "xai", capabilities: caps({ reasoning: true }), supportsReasoning: true, streaming: true }
    ]
  },
  {
    id: "azure",
    label: "Azure OpenAI",
    tier: "verified",
    auth: "api_key",
    models: [
      { id: "azure/gpt-4o", label: "Azure GPT-4o", provider: "azure", capabilities: caps({ images: true }), streaming: true }
    ]
  },
  {
    id: "bedrock",
    label: "Amazon Bedrock",
    tier: "verified",
    auth: "api_key",
    models: [
      { id: "bedrock/claude-sonnet-4", label: "Bedrock Claude Sonnet", provider: "bedrock", capabilities: caps({ images: true }), streaming: true }
    ]
  },
  {
    id: "github-copilot",
    label: "GitHub Copilot",
    tier: "verified",
    auth: "oauth",
    models: [
      { id: "github-copilot/gpt-4o", label: "Copilot GPT-4o", provider: "github-copilot", capabilities: caps(), streaming: true }
    ]
  },
  {
    id: "lmstudio",
    label: "LM Studio",
    tier: "verified",
    auth: "none",
    baseUrl: "http://127.0.0.1:1234/v1",
    models: [
      { id: "lmstudio/local-model", label: "Local model", provider: "lmstudio", capabilities: caps({ modelDiscovery: false }), streaming: true }
    ]
  }
];

export function findCatalogModel(canonicalId: string): ProviderModel | null {
  const normalized = canonicalId.includes("/") ? canonicalId : `openai/${canonicalId}`;
  for (const provider of providerCatalog) {
    const match = provider.models.find((model) => model.id === normalized || model.id === canonicalId);
    if (match) return match;
  }
  return null;
}

export function catalogSnapshotMeta(): { generatedAt: string; providerCount: number; modelCount: number } {
  return {
    generatedAt: new Date().toISOString(),
    providerCount: providerCatalog.length,
    modelCount: providerCatalog.reduce((count, provider) => count + provider.models.length, 0)
  };
}
