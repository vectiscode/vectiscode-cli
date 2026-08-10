import { describe, expect, it } from "vitest";
import { mergeAiUsage, normalizeAiUsage } from "../services/usageAccounting.js";

describe("AI usage accounting", () => {
  it("aggregates delivered planning, generation, and repair usage", () => {
    const planning = normalizeAiUsage({ inputTokens: 1000, outputTokens: 200 }, "planner");
    const generation = normalizeAiUsage({ inputTokens: 3000, outputTokens: 800, cacheInputTokens: 500 }, "generator");
    const repair = normalizeAiUsage({ inputTokens: 1200, outputTokens: 300 }, "repair");

    const delivered = mergeAiUsage(mergeAiUsage(planning, generation), repair);

    expect(delivered).toMatchObject({
      inputTokens: 5200,
      outputTokens: 1300,
      cacheInputTokens: 500,
      attemptCount: 3,
      providerCostSource: "planner+generator+repair"
    });
  });

  it("ignores failed or empty attempts with no usage", () => {
    const deliveredFallback = normalizeAiUsage({ inputTokens: 900, outputTokens: 150 }, "fallback");

    expect(mergeAiUsage(undefined, deliveredFallback)).toEqual(deliveredFallback);
    expect(normalizeAiUsage({ inputTokens: 0, outputTokens: 0 }, "failed")).toBeUndefined();
  });
});
