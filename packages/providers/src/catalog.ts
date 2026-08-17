import type { ProviderCapabilities, ProviderModel } from "@vectiscode/core";

export interface CatalogProviderEntry {
  id: string;
  label: string;
  tier: "verified" | "catalog" | "experimental";
  auth: "api_key" | "oauth" | "none";
  baseUrl?: string;
  models: ProviderModel[];
}

export interface CatalogSnapshotMeta {
  source: string;
  version: string;
  generatedAt: string;
  providerCount: number;
  modelCount: number;
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
    label: "OpenAI / ChatGPT",
    tier: "verified",
    auth: "api_key",
    baseUrl: "https://api.openai.com/v1",
    models: [
      { id: "openai/gpt-4o", label: "GPT-4o", provider: "openai", capabilities: caps({ images: true, reasoning: false, promptCaching: true }), contextWindow: 128000, supportsTools: true, streaming: true },
      { id: "openai/gpt-4o-mini", label: "GPT-4o mini", provider: "openai", capabilities: caps({ images: true, promptCaching: true }), contextWindow: 128000, streaming: true },
      { id: "openai/o3-mini", label: "o3-mini", provider: "openai", capabilities: caps({ reasoning: true, promptCaching: true }), contextWindow: 200000, supportsReasoning: true, streaming: true },
      { id: "openai/o1", label: "o1", provider: "openai", capabilities: caps({ reasoning: true, promptCaching: true }), contextWindow: 200000, supportsReasoning: true, streaming: true }
    ]
  },
  {
    id: "anthropic",
    label: "Anthropic Claude",
    tier: "verified",
    auth: "api_key",
    baseUrl: "https://api.anthropic.com",
    models: [
      { id: "anthropic/claude-3-7-sonnet-20250219", label: "Claude 3.7 Sonnet", provider: "anthropic", capabilities: caps({ images: true, reasoning: true, promptCaching: true }), contextWindow: 200000, supportsReasoning: true, streaming: true },
      { id: "anthropic/claude-3-5-sonnet-20241022", label: "Claude 3.5 Sonnet", provider: "anthropic", capabilities: caps({ images: true, promptCaching: true }), contextWindow: 200000, streaming: true },
      { id: "anthropic/claude-3-5-haiku-20241022", label: "Claude 3.5 Haiku", provider: "anthropic", capabilities: caps({ promptCaching: true }), contextWindow: 200000, streaming: true }
    ]
  },
  {
    id: "google",
    label: "Google Gemini",
    tier: "verified",
    auth: "api_key",
    models: [
      { id: "google/gemini-2.5-pro", label: "Gemini 2.5 Pro", provider: "google", capabilities: caps({ images: true, reasoning: true }), contextWindow: 1000000, supportsReasoning: true, streaming: true },
      { id: "google/gemini-2.5-flash", label: "Gemini 2.5 Flash", provider: "google", capabilities: caps({ images: true }), contextWindow: 1000000, streaming: true },
      { id: "google/gemini-2.0-flash", label: "Gemini 2.0 Flash", provider: "google", capabilities: caps({ images: true }), contextWindow: 1000000, streaming: true }
    ]
  },
  {
    id: "groq",
    label: "Groq (Meta Llama)",
    tier: "verified",
    auth: "api_key",
    baseUrl: "https://api.groq.com/openai/v1",
    models: [
      { id: "groq/llama-3.3-70b-versatile", label: "Meta Llama 3.3 70B (Groq)", provider: "groq", capabilities: caps(), contextWindow: 128000, streaming: true },
      { id: "groq/llama-3.1-8b-instant", label: "Meta Llama 3.1 8B (Groq)", provider: "groq", capabilities: caps(), contextWindow: 128000, streaming: true }
    ]
  },
  {
    id: "deepseek",
    label: "DeepSeek",
    tier: "verified",
    auth: "api_key",
    baseUrl: "https://api.deepseek.com/v1",
    models: [
      { id: "deepseek/deepseek-chat", label: "DeepSeek-V3", provider: "deepseek", capabilities: caps(), contextWindow: 64000, streaming: true },
      { id: "deepseek/deepseek-reasoner", label: "DeepSeek-R1", provider: "deepseek", capabilities: caps({ reasoning: true }), contextWindow: 64000, supportsReasoning: true, streaming: true }
    ]
  },
  {
    id: "openrouter",
    label: "OpenRouter",
    tier: "verified",
    auth: "api_key",
    baseUrl: "https://openrouter.ai/api/v1",
    models: [
      { id: "openrouter/auto", label: "OpenRouter Auto", provider: "openrouter", capabilities: caps({ images: true }), contextWindow: 200000, streaming: true },
      { id: "openrouter/meta-llama/llama-3.3-70b-instruct", label: "Meta Llama 3.3 70B (OpenRouter)", provider: "openrouter", capabilities: caps(), contextWindow: 128000, streaming: true }
    ]
  },
  {
    id: "ollama",
    label: "Ollama (Local Meta Llama)",
    tier: "verified",
    auth: "none",
    baseUrl: "http://127.0.0.1:11434/v1",
    models: [
      { id: "ollama/llama3.3", label: "Meta Llama 3.3 (Local)", provider: "ollama", capabilities: caps({ modelDiscovery: false }), contextWindow: 128000, streaming: true },
      { id: "ollama/llama3.2", label: "Meta Llama 3.2 (Local)", provider: "ollama", capabilities: caps({ modelDiscovery: false }), contextWindow: 128000, streaming: true },
      { id: "ollama/qwen2.5-coder", label: "Qwen2.5 Coder (Local)", provider: "ollama", capabilities: caps({ modelDiscovery: false }), contextWindow: 32000, streaming: true }
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
      { id: "xai/grok-2-latest", label: "Grok 2", provider: "xai", capabilities: caps(), streaming: true }
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

const ALIASES: Record<string, string> = {
  chatgpt: "openai",
  claude: "anthropic",
  gemini: "google",
  llama: "ollama",
  meta: "groq"
};

export function normalizeProviderId(id: string): string {
  const clean = id.toLowerCase().trim();
  return ALIASES[clean] ?? clean;
}

export function findCatalogModel(canonicalId: string): ProviderModel | null {
  const normalized = canonicalId.includes("/") ? canonicalId : `openai/${canonicalId}`;
  for (const provider of providerCatalog) {
    const found = provider.models.find((model) => model.id === normalized || model.id === canonicalId);
    if (found) return found;
  }
  return null;
}

export function listSupportedProviders(): string[] {
  return providerCatalog.map((entry) => entry.id);
}

export function catalogSnapshotMeta(): CatalogSnapshotMeta {
  const totalModels = providerCatalog.reduce((sum, p) => sum + p.models.length, 0);
  return {
    source: "models.dev",
    version: "2026.08.2",
    generatedAt: "2026-08-17T00:00:00.000Z",
    providerCount: providerCatalog.length,
    modelCount: totalModels
  };
}
