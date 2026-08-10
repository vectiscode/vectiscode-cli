---
name: ai-provider-health-gating
description: Use when changing AI provider selection, adding a new model to the picker, or debugging multi-minute model stalls. Covers the configuredProviderForModel -> modelIsAvailable -> runtimeAiModels chain in services/config.ts, the AbortController timeout pattern, and the GLM NVIDIA hold. Do NOT use for prompt engineering - that's a different concern.
---

# AI Provider Health Gating

## The selection chain

Every AI call goes through this:

1. `modelConfigFor(modelId)` - returns config (provider, thinking levels, limits)
2. `configuredProviderForModel(modelId)` - returns the HEALTHY provider, or `null`
3. `modelIsAvailable(modelId)` - true if a healthy provider exists
4. `runtimeAiModels()` - lists the user-facing picker options, filtered by health

A model is held from the picker when no healthy provider is configured for it. Example: GLM 5.1 with no Z.AI key falls back to NVIDIA NIM, which has shown 240-300s stalls. The fix is `configuredProviderForModel("glm-5.1")` returning `null` unless a Z.AI key is set.

## Timeout pattern

Every provider call gets an AbortController timeout:

```ts
const controller = new AbortController();
const timer = setTimeout(() => controller.abort(), providerTimeoutMs);
try {
  return await provider.call(input, { signal: controller.signal });
} finally {
  clearTimeout(timer);
}
```

- `providerTimeoutMs` is an input field on `AiProviderInput`
- Eval handler sets it to `120_000` (2 min) so broken models fail fast
- Direct provider window for patches is up to `600_000` (10 min)
- Timeouts do NOT switch to fallback models - they fail the call cleanly

## Thinking level mapping

`getThinkingLevel(appLevel)` translates the app's `off | low | medium | high` to the provider's native field:

- NVIDIA NIM DeepSeek: `low | medium` -> `high`, `high` -> `max`, `off` -> omitted
- Xiaomi MiMo: `thinking: { type: "enabled" | "disabled" }`
- DeepSeek: `reasoning_effort: "high" | "max"`
- Yunwu (OpenAI-compatible): passthrough, plus thinking defaults per model

## Adding a new model

1. Add entry to `runtimeAiModels()` in `services/config.ts`
2. Wire `configuredProviderForModel` to a healthy provider
3. If it supports thinking, document it in the "Thinking level mapping" section
4. Update the AGENTS.md "NVIDIA Model Status" (or the relevant provider's) table
5. Run `npm run smoke:models` and `npm run smoke:thinking` to verify

## Rules

- Never hard-code a provider branch in `aiProvider.ts` - use `configuredProviderForModel`
- Never send `chat_template_kwargs` to NVIDIA NIM. Use top-level `reasoning_effort`
- If a model stalls > 120s in eval, mark it held in `configuredProviderForModel`
- Update AGENTS.md "Model Status" table whenever model availability changes
- `nvidiaAnswerMaxTokens`: 8192 (thinking off), 16384 (thinking on)
- `nvidiaPatchMaxTokens`: 16384
- `streamContentIsUsable` requires 200+ chars and 3+ sentences before cancelling

## Critical files

- `apps/api/src/services/config.ts:1` - model registry, provider selection, thinking mapping
- `apps/api/src/services/aiProvider.ts:1` - 8k-line engine
- `apps/api/src/services/modelHealth.ts` - health checks
- `apps/api/src/services/evaluator.ts` - eval handler with 120s timeout
- `scripts/nvidia-thinking-matrix.mjs` - thinking smoke
- `scripts/thinking-matrix-smoke.mjs` - cross-provider thinking smoke
