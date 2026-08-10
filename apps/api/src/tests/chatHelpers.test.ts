import { describe, expect, it } from "vitest";
import {
  isRoutineImplementationPatchPrompt,
  changeSetRepairAttemptsFor,
  providerTimeoutAssistantText,
  providerTimeoutMessage,
  shouldRunPlanningPass
} from "../routes/chatHelpers.js";

describe("chat helper timeout copy", () => {
  it("presents answer timeouts as a clean safety stop", () => {
    const message = providerTimeoutMessage("gemini-3.5-flash", "answer", 180_000);
    const assistantText = providerTimeoutAssistantText("gemini-3.5-flash", "answer", 180_000);

    expect(message).toContain("did not return a finished response");
    expect(message).not.toContain("180s");
    expect(assistantText).toContain("stopped the turn cleanly");
    expect(assistantText).not.toContain("180s");
    expect(assistantText).toContain("no usage was charged");
  });

  it("does not expose timeout duration for changeset mode", () => {
    const message = providerTimeoutMessage("gemini-3.5-flash", "changeset", 300_000);
    const assistantText = providerTimeoutAssistantText("gemini-3.5-flash", "changeset", 300_000);

    expect(message).toContain("did not return a finished patch");
    expect(message).not.toContain("300s");
    expect(assistantText).not.toContain("300s");
    expect(assistantText).toContain("no Studio patch was queued");
  });
});

describe("routine patch routing", () => {
  it("keeps bounded repair available for premium and entry models", () => {
    expect(changeSetRepairAttemptsFor("claude-opus-4-8")).toBe(1);
    expect(changeSetRepairAttemptsFor("gemini-3.5-flash")).toBe(1);
  });
  it("treats simple sprint stamina bars as routine model work, not a planning task", () => {
    const prompt = "Add a sprint system with stamina and a small UI bar";

    expect(isRoutineImplementationPatchPrompt(prompt)).toBe(true);
    expect(shouldRunPlanningPass({
      deterministicTemplateEligible: false,
      prompt,
      model: "gemini-3.5-flash",
      simpleOptimized: false
    })).toBe(false);
  });

  it("treats server-validated sprint HUD requests as routine", () => {
    const prompt = "Add a server-validated sprint system with a polished compact HUD.";
    expect(isRoutineImplementationPatchPrompt(prompt)).toBe(true);
    expect(shouldRunPlanningPass({
      deterministicTemplateEligible: false,
      prompt,
      model: "gemini-3.5-flash",
      simpleOptimized: false
    })).toBe(false);
  });

  it("does not treat custom multi-system movement UI as routine", () => {
    expect(isRoutineImplementationPatchPrompt("Add sprint, dash, double jump, mobile buttons, and a themed ability wheel")).toBe(false);
  });
});
