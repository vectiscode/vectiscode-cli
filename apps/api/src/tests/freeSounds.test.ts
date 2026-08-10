import { describe, expect, it } from "vitest";
import {
  detectSoundCategory,
  freeSoundCatalogPromptBlock,
  isAllowedFreeSoundId,
  listInvalidSoundIdsInFiles,
  pickFreeSound,
  promptRequestsSound,
  rewriteChangeFilesSoundIds,
  rewriteSourceSoundIds
} from "../services/freeSounds.js";

describe("freeSounds", () => {
  it("detects swish/whoosh requests", () => {
    expect(promptRequestsSound("add a swish sound")).toBe(true);
    expect(detectSoundCategory("add a swish sound")).toBe("swish");
    expect(detectSoundCategory("whoosh when dashing")).toBe("whoosh");
  });

  it("provides a catalog prompt for sound requests", () => {
    const block = freeSoundCatalogPromptBlock("add a swish sound to the grass");
    expect(block).toContain("FREE ROBLOX AUDIO CATALOG");
    expect(block).toContain("rbxassetid://9114444008");
    expect(block).toContain("Never invent SoundIds");
  });

  it("rewrites the bad script-id sound the model used for grass rustle", () => {
    // 9114223143 is a Script asset, not audio - this is the exact production failure.
    const source = [
      "local RUSTLE_SOUND_ID = \"rbxassetid://9114223143\"",
      "sound.SoundId = RUSTLE_SOUND_ID",
      "sound.SoundId = \"rbxassetid://9114223143\""
    ].join("\n");

    const rewritten = rewriteSourceSoundIds(source, "add a swish sound");
    expect(rewritten.rewrote).toBeGreaterThan(0);
    expect(rewritten.source).not.toContain("9114223143");
    expect(rewritten.source).toMatch(/rbxassetid:\/\/\d+/);
    const preferred = pickFreeSound("swish");
    expect(rewritten.source).toContain(`rbxassetid://${preferred.id}`);
    expect(isAllowedFreeSoundId(preferred.id)).toBe(true);
  });

  it("keeps already-valid free audio IDs", () => {
    const source = "sound.SoundId = \"rbxassetid://12221976\"";
    const rewritten = rewriteSourceSoundIds(source, "click sound");
    expect(rewritten.rewrote).toBe(0);
    expect(rewritten.source).toContain("12221976");
  });

  it("rewrites invalid SoundIds across change files", () => {
    const { files, rewrote } = rewriteChangeFilesSoundIds(
      [{ source: "sound.SoundId = \"rbxassetid://9114223143\"" }],
      "add rustle sound"
    );
    expect(rewrote).toBeGreaterThan(0);
    expect(files[0]?.source).not.toContain("9114223143");
    expect(listInvalidSoundIdsInFiles(files)).toEqual([]);
  });

  it("flags invalid sound ids still present in files", () => {
    const invalid = listInvalidSoundIdsInFiles([
      { source: "sound.SoundId = \"rbxassetid://9114223143\"" }
    ]);
    expect(invalid).toContain(9114223143);
  });
});
