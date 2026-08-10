export interface AiUsageAccumulator {
  inputTokens: number;
  outputTokens: number;
  cacheInputTokens?: number;
  attemptCount?: number;
  providerCostSource?: string;
  costRisk?: string[];
}

export function normalizeAiUsage(usage?: Partial<AiUsageAccumulator>, providerCostSource?: string): AiUsageAccumulator | undefined {
  if (!usage) return undefined;
  const inputTokens = Math.max(0, Math.floor(Number(usage.inputTokens ?? 0)));
  const outputTokens = Math.max(0, Math.floor(Number(usage.outputTokens ?? 0)));
  const cacheInputTokens = Math.max(0, Math.floor(Number(usage.cacheInputTokens ?? 0)));
  if (inputTokens + outputTokens + cacheInputTokens <= 0) return undefined;
  return {
    inputTokens,
    outputTokens,
    ...(cacheInputTokens > 0 ? { cacheInputTokens } : {}),
    attemptCount: Math.max(1, Math.floor(Number(usage.attemptCount ?? 1))),
    providerCostSource: providerCostSource ?? usage.providerCostSource,
    ...(usage.costRisk?.length ? { costRisk: [...usage.costRisk] } : {})
  };
}

export function mergeAiUsage(
  left?: AiUsageAccumulator,
  right?: AiUsageAccumulator
): AiUsageAccumulator | undefined {
  if (!left) return right;
  if (!right) return left;

  const sources = [left.providerCostSource, right.providerCostSource].filter(Boolean);
  const risks = [...(left.costRisk ?? []), ...(right.costRisk ?? [])];
  return {
    inputTokens: Math.max(0, left.inputTokens) + Math.max(0, right.inputTokens),
    outputTokens: Math.max(0, left.outputTokens) + Math.max(0, right.outputTokens),
    cacheInputTokens: Math.max(0, left.cacheInputTokens ?? 0) + Math.max(0, right.cacheInputTokens ?? 0) || undefined,
    attemptCount: Math.max(0, left.attemptCount ?? 1) + Math.max(0, right.attemptCount ?? 1),
    providerCostSource: sources.length ? [...new Set(sources)].join("+") : undefined,
    costRisk: risks.length ? [...new Set(risks)] : undefined
  };
}
