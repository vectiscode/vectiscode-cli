import { describe, expect, it } from "vitest";
import { aiModels, getThinkingControlMode, getThinkingLevel, getThinkingMultiplier } from "../services/config.js";
import {
  assessChangeSetHealth,
  assessModelHealthText,
  assessModelLatency,
  modelLatencyBudgetMs
} from "../services/modelHealth.js";

describe("model health checks", () => {
  it("accepts useful Roblox safety answers and rejects weak ones", () => {
    const good = assessModelHealthText(
      "RemoteEvents must validate on the server because clients can send forged data. Without server checks, an exploit can grant coins, bypass cooldowns, or trigger abilities illegally."
    );
    expect(good.ok).toBe(true);

    const weak = assessModelHealthText("OK");
    expect(weak.ok).toBe(false);
    expect(weak.reasons).toContain("response only said OK");
  });

  it("defines latency budgets for every listed model", () => {
    for (const model of aiModels) {
      expect(modelLatencyBudgetMs(model.id, "chat")).toBeGreaterThan(0);
      expect(modelLatencyBudgetMs(model.id, "changeset")).toBeGreaterThan(modelLatencyBudgetMs(model.id, "chat"));
    }

    expect(assessModelLatency("gemini-3.5-flash", 5_000, "chat").ok).toBe(true);
    expect(modelLatencyBudgetMs("gemini-3.5-flash", "chat")).toBe(240_000);
    expect(assessModelLatency("gemini-3.5-flash", 250_000, "chat").ok).toBe(false);
  });

  it("uses official Gemini dynamic thinking defaults unless users override them", () => {
    expect(getThinkingLevel("gemini-3-flash-preview")).toBe("high");
    expect(getThinkingLevel("gemini-3.5-flash")).toBe("medium");
    expect(getThinkingLevel("gemini-3.1-pro-preview")).toBe("high");
  });

  it("caps expensive thinking levels on the free plan", () => {
    expect(getThinkingLevel("gemini-3-flash-preview", { thinkingGemini3Flash: "high" }, "free")).toBe("medium");
    expect(getThinkingLevel("gpt-5.5", { thinkingGpt55: "xhigh" }, "free")).toBe("medium");
    expect(getThinkingMultiplier("gpt-5.5", "changeset", { thinkingGpt55: "xhigh" }, "free")).toBe(1.5);
    expect(getThinkingMultiplier("deepseek-v4-flash", "changeset", { thinkingDeepSeekV4Flash: "max" }, "free")).toBe(1);
  });

  it("maps DeepSeek thinking to official high and max levels", () => {
    for (const modelId of ["deepseek-v4-flash"]) {
      expect(getThinkingControlMode(modelId)).toBe("tiered");
      expect(getThinkingLevel(modelId, {
        thinkingDeepSeekV4Flash: "high"
      })).toBe("high");
      expect(getThinkingLevel(modelId, {
        thinkingDeepSeekV4Flash: "max"
      })).toBe("max");
      expect(getThinkingMultiplier(modelId, "chat", {
        thinkingDeepSeekV4Flash: "high"
      })).toBe(1.5);
      expect(getThinkingMultiplier(modelId, "chat", {
        thinkingDeepSeekV4Flash: "max"
      })).toBe(2);
    }
  });

  it("maps frontier thinking levels for Qwen, GPT-5.5, Opus, and Kimi", () => {
    expect(getThinkingControlMode("qwen3.7-max")).toBe("binary");
    expect(getThinkingLevel("qwen3.7-max")).toBe("high");
    expect(getThinkingMultiplier("qwen3.7-max", "chat")).toBe(1.5);
    expect(getThinkingMultiplier("qwen3.7-max", "chat", { thinkingQwen: "none" })).toBe(1);

    expect(getThinkingControlMode("gpt-5.5")).toBe("tiered");
    expect(getThinkingLevel("gpt-5.5")).toBe("medium");
    expect(getThinkingMultiplier("gpt-5.5", "chat", { thinkingGpt55: "xhigh" })).toBe(2.5);

    expect(getThinkingControlMode("claude-opus-4-8")).toBe("tiered");
    expect(getThinkingLevel("claude-opus-4-8")).toBe("high");
    expect(getThinkingMultiplier("claude-opus-4-8", "chat", { thinkingOpus: "max" })).toBe(3);

    expect(getThinkingControlMode("kimi-k2.7-code")).toBe("always");
    expect(getThinkingLevel("kimi-k2.7-code", { thinkingKimi: "none" })).toBe("high");
    expect(getThinkingMultiplier("kimi-k2.7-code", "chat", { thinkingKimi: "none" })).toBe(1.0);
  });


  it("validates generated Studio patch shape", () => {
    const healthy = assessChangeSetHealth({
      title: "Health Check HUD",
      summary: "Creates a visible health-check HUD in StarterGui.",
      files: [
        {
          id: "file_1",
          action: "create",
          instancePath: "StarterGui/VectisHealthCheckGui",
          className: "ScreenGui",
          reason: "Adds the HUD container."
        },
        {
          id: "file_2",
          action: "create",
          instancePath: "StarterGui/VectisHealthCheckGui/HealthCheckLabel",
          className: "TextLabel",
          reason: "Shows the health check label.",
          properties: { Text: "Vectis OK" }
        }
      ]
    });
    expect(healthy.ok).toBe(true);

    const broken = assessChangeSetHealth({
      title: "",
      summary: "",
      files: []
    });
    expect(broken.ok).toBe(false);
    expect(broken.reasons).toContain("no Studio operations were generated");
  });
});
