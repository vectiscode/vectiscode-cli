import { describe, expect, it } from "vitest";
import { generateTransparentIcon, iconGenerationPrompt } from "../services/assets.js";
import { config } from "../services/config.js";

describe("icon generation prompts", () => {
  it("keeps brainrot rebirth icons text-free by default", () => {
    const prompt = iconGenerationPrompt("brainrot rebirth icon");

    expect(prompt).toContain("Roblox brainrot rebirth game icon");
    expect(prompt).toContain("hot-pink square or rounded-square plastic toy tile");
    expect(prompt).toContain("goofy brain character");
    expect(prompt).toContain("Do not include any letters");
    expect(prompt).toContain("Avoid phoenixes");
    expect(prompt).not.toContain('Include the exact readable label "REBIRTH"');
  });

  it("only includes labels when text is explicitly requested", () => {
    const prompt = iconGenerationPrompt("brainrot rebirth icon with text REBIRTH");

    expect(prompt).toContain('Include the exact readable label "REBIRTH"');
    expect(prompt).toContain("Do not invent extra words");
  });

  it("forbids fake transparency grids in the model prompt", () => {
    const prompt = iconGenerationPrompt("brainrot icon");

    expect(prompt).toContain("perfectly flat solid chroma key green background #00FF00");
    expect(prompt).toContain("Do not draw a transparency checkerboard");
    expect(prompt).toContain("black checker grid");
  });

  it("fails closed in production instead of calling a Google image model", async () => {
    const original = config.isProduction;
    config.isProduction = true;
    try {
      await expect(generateTransparentIcon("blue jump button")).rejects.toThrow(/non-Google image provider/i);
    } finally {
      config.isProduction = original;
    }
  });
});
