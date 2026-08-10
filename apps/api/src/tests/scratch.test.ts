import { describe, it } from "vitest";
import { aiProvider } from "../services/aiProvider.js";
import { MODEL_HEALTH_PATCH_PROMPT } from "../services/modelHealth.js";

describe("Scratch diagnostics", () => {
  it("diagnoses raw aiProvider.generateChangeSet for Gemini 3.1 Pro", async () => {
    const dummyProject = {
      id: "smoke_project",
      organizationId: "smoke_org",
      name: "Model Health Smoke",
      template: "obby",
      description: "Temporary provider smoke project",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    const response = await aiProvider.generateChangeSet({
      project: dummyProject,
      prompt: MODEL_HEALTH_PATCH_PROMPT,
      model: "gemini-3.1-pro-preview",
      preferences: {
        thinkingGemini3Flash: "none",
        thinkingGemini35Flash: "low",
        thinkingGemini31FlashLite: "none",
        thinkingGemini31Pro: "low",
        thinkingDeepSeekV4Flash: "none",
        thinkingDeepSeekV4Pro: "none",
        thinkingGlm51: "none"
      },
      providerTimeoutMs: 60000
    } as any);
    console.log("RAW PATCH RESPONSE:", JSON.stringify(response, null, 2));
  }, 60000);
});
