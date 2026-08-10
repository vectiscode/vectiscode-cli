import { describe, expect, it } from "vitest";
import {
  broadRecommendationFollowupText,
  blockedPatchFollowupText,
  effectiveChatMode,
  effectiveChatModeWithHistory,
  isBroadRecommendationFollowup,
  isAutoSyncStatusPrompt,
  isFailedGenerationFollowup,
  needsUiBackendClarification,
  resolvePromptWithHistory,
  shouldGenerateChangeSet
} from "../services/chatIntent.js";
import { planUiIntent } from "../services/aiProvider.js";

describe("chat intent routing", () => {
  it("routes natural follow-up approvals to reviewable Studio patches", () => {
    expect(shouldGenerateChangeSet("do all of it")).toBe(true);
    expect(shouldGenerateChangeSet("sync that")).toBe(true);
    expect(shouldGenerateChangeSet("bro actually do that what did i ask you for")).toBe(true);
    expect(shouldGenerateChangeSet("what dude? you need to fucking apply it")).toBe(true);
    expect(shouldGenerateChangeSet("you are supposed to fix it")).toBe(true);
    expect(effectiveChatMode("explain", "whatever you say")).toBe("changeset");
  });

  it("routes gameplay feature descriptions to Studio patches and reconnects follow-ups", () => {
    const prompt = "Players collect coins, sell them, upgrade backpack size, and unlock a new area";
    expect(shouldGenerateChangeSet(prompt)).toBe(true);

    const history = [
      { role: "user" as const, content: prompt },
      { role: "assistant" as const, content: "Want me to generate the Studio patch? It would create the economy loop." }
    ];

    expect(effectiveChatModeWithHistory("explain", "go ahead", history)).toBe("changeset");
    expect(resolvePromptWithHistory("go ahead", history)).toContain(prompt);
  });

  it("keeps greetings and pure questions in explain mode", () => {
    expect(shouldGenerateChangeSet("hello")).toBe(false);
    expect(shouldGenerateChangeSet("what should be the next step?")).toBe(false);
    expect(effectiveChatMode("changeset", "inspect my structure")).toBe("explain");
  });

  it("keeps formatting and presentation requests in explain mode", () => {
    expect(shouldGenerateChangeSet("write this in a table")).toBe(false);
    expect(shouldGenerateChangeSet("put this in a list")).toBe(false);
    expect(shouldGenerateChangeSet("make this a numbered list")).toBe(false);
    expect(shouldGenerateChangeSet("change the format to a table")).toBe(false);
    expect(shouldGenerateChangeSet("show it as bullet points")).toBe(false);
    expect(shouldGenerateChangeSet("convert this to json")).toBe(false);
    expect(shouldGenerateChangeSet("rewrite this shorter")).toBe(false);
    expect(shouldGenerateChangeSet("display it in a table format")).toBe(false);
    expect(effectiveChatMode("changeset", "write this in a table")).toBe("explain");
  });

  it("keeps complaints about pasted code in explain mode", () => {
    expect(shouldGenerateChangeSet("why the fuck would you send me code? you are the coder")).toBe(false);
    expect(effectiveChatMode("changeset", "stop pasting code, you are the coder")).toBe("explain");
  });

  it("routes corrective follow-ups to repair patches but keeps 'what' explain-only", () => {
    expect(shouldGenerateChangeSet("i want it done properly")).toBe(true);
    expect(shouldGenerateChangeSet("fix that, it still looks bad")).toBe(true);
    expect(shouldGenerateChangeSet("how do i use this? can you place it next to the spawn?")).toBe(true);
    expect(effectiveChatMode("changeset", "what")).toBe("explain");
  });

  it("flags ambiguous shop and rebirth UI prompts for clarification", () => {
    expect(needsUiBackendClarification("create a nice rebirth and shop ui")).toBe(true);
    expect(shouldGenerateChangeSet("create a nice rebirth and shop ui")).toBe(false);
    expect(needsUiBackendClarification("generate a shop ui")).toBe(false);
    expect(shouldGenerateChangeSet("generate a shop ui")).toBe(true);
    expect(needsUiBackendClarification("just create a rebirth and shop UI, no backend")).toBe(false);
    expect(needsUiBackendClarification("create a rebirth and shop UI with working purchases and backend")).toBe(false);
  });

  it("treats front end UI requests as visual-only patches", () => {
    expect(needsUiBackendClarification("add a good front end ui for a brainrot game")).toBe(false);
    expect(shouldGenerateChangeSet("add a good front end ui for a brainrot game")).toBe(true);
  });

  it("plans brainrot shop, index, and full frontend surfaces distinctly", () => {
    const shop = planUiIntent({ prompt: "generate a typical brainrot shop ui" });
    expect(shop.surface).toBe("shop");
    expect(shop.scope).toBe("ui_only");
    expect(shop.style).toBe("bright_simulator");
    expect(shop.fallbackKind).toBe("shop_ui");
    expect(shop.mustAvoid).toContain("rebirth");

    const index = planUiIntent({ prompt: "make a brainrot index UI with locked rarities" });
    expect(index.surface).toBe("index");
    expect(index.style).toBe("dark_collection_index");
    expect(index.fallbackKind).toBe("index_panel");

    const frontend = planUiIntent({ prompt: "add frontend necessities for a brainrot simulator game" });
    expect(frontend.surface).toBe("full_frontend");
    expect(frontend.style).toBe("bright_simulator");
    expect(frontend.fallbackKind).toBe("none");

    const generic = planUiIntent({ prompt: "generate a nice looking ui" });
    expect(generic.surface).toBe("hud");
    expect(generic.fallbackKind).toBe("general_ui");
    expect(generic.mustAvoid).toContain("single centered panel");

    const placement = planUiIntent({ prompt: "how do i use this? can you place it next to the spawn?" });
    expect(placement.fallbackKind).toBe("none");
  });

  it("detects auto-sync status prompts without generating a patch", () => {
    expect(isAutoSyncStatusPrompt("i cant sync it, you need to auto sync")).toBe(true);
    expect(shouldGenerateChangeSet("i cant sync it, you need to auto sync")).toBe(false);
  });

  it("routes backend clarification answers into the original UI patch request", () => {
    const history = [
      { role: "user" as const, content: "create a nice rebirth and shop ui" },
      { role: "assistant" as const, content: "Do you want UI only, or working backend too?" }
    ];

    expect(effectiveChatModeWithHistory("explain", "both", history)).toBe("changeset");
    expect(resolvePromptWithHistory("both", history)).toContain("working backend");
    expect(resolvePromptWithHistory("both", history)).toContain("create a nice rebirth and shop ui");
  });

  it("routes UI-only clarification answers into a visual patch", () => {
    const history = [
      { role: "user" as const, content: "create a nice rebirth and shop ui" },
      { role: "assistant" as const, content: "Do you want UI only, or working backend too?" }
    ];

    expect(effectiveChatModeWithHistory("explain", "just ui", history)).toBe("changeset");
    expect(resolvePromptWithHistory("just ui", history)).toContain("Build the polished UI only");
    expect(resolvePromptWithHistory("just ui", history)).toContain("Do not add backend");
  });

  it("routes general follow-up approvals into the last implementation request", () => {
    const history = [
      { role: "user" as const, content: "add a fighting system and custom animations" },
      { role: "assistant" as const, content: "I can generate a reviewable Studio patch with a sword tool and server hit detection." }
    ];

    expect(effectiveChatModeWithHistory("explain", "go ahead implement", history)).toBe("changeset");
    expect(resolvePromptWithHistory("go ahead implement", history)).toContain("add a fighting system and custom animations");
  });

  it("blocks broad recommendation follow-ups until the user chooses one patch", () => {
    const history = [
      { role: "user" as const, content: "Inspect my project structure and suggest what to improve first." },
      { role: "assistant" as const, content: "The most immediate improvement I recommend is removing the giant baseplate. Also optimize parts, resolve duplicate spawn locations, and add a game manager." }
    ];

    expect(isBroadRecommendationFollowup("go ahead and implement everything you were talking about", history)).toBe(true);
    expect(broadRecommendationFollowupText(history)).toContain("multiple separate improvements");
  });

  it("explains blocked patch follow-ups without another generation", () => {
    const history = [
      { role: "assistant" as const, content: "I could not prepare a safe Studio patch.\n- quality: shop panels cannot be empty" }
    ];

    expect(isFailedGenerationFollowup("what", history)).toBe(true);
    expect(blockedPatchFollowupText(history)).toContain("shop panels cannot be empty");
  });
});
