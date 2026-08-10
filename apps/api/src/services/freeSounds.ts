/**
 * Vetted free Roblox audio assets (AssetTypeId = 3) for reliable SoundId use.
 * Models often hallucinate IDs that are Scripts/Images/Hair - those fail with
 * "Asset type does not match requested type". Always prefer this catalog.
 */

export type FreeSoundCategory =
  | "whoosh"
  | "swish"
  | "rustle"
  | "click"
  | "hit"
  | "footstep"
  | "ui"
  | "impact"
  | "generic";

export interface FreeSoundEntry {
  id: number;
  name: string;
  categories: FreeSoundCategory[];
}

/** Verified type=3 audio owned/published by Roblox or confirmed free SFX. */
export const FREE_SOUND_CATALOG: FreeSoundEntry[] = [
  { id: 9114444008, name: "Fire Whoosh 3 (SFX)", categories: ["whoosh", "swish", "generic"] },
  { id: 12222216, name: "swordslash.wav", categories: ["swish", "whoosh", "hit", "generic"] },
  { id: 12222084, name: "Rocket shot.wav", categories: ["whoosh", "swish", "impact"] },
  { id: 12222132, name: "Shoulder fired rocket.wav", categories: ["whoosh", "impact"] },
  { id: 12222124, name: "Short spring sound.wav", categories: ["ui", "generic"] },
  { id: 12221967, name: "button.wav", categories: ["click", "ui"] },
  { id: 12221976, name: "clickfast.wav", categories: ["click", "ui"] },
  { id: 12222183, name: "SWITCH3.wav", categories: ["ui", "click"] },
  { id: 12222046, name: "hit.wav", categories: ["hit", "impact"] },
  { id: 12222005, name: "glassbreak.wav", categories: ["impact"] },
  { id: 12222140, name: "snap.wav", categories: ["rustle", "impact", "generic"] },
  { id: 12222076, name: "pageturn.wav", categories: ["rustle", "generic"] },
  { id: 12221984, name: "collide.wav", categories: ["hit", "impact", "footstep"] },
  { id: 12221952, name: "bfsl-minifigfoots1.mp3", categories: ["footstep"] },
  { id: 12222019, name: "HalloweenLightning.wav", categories: ["impact"] },
  { id: 12222030, name: "HalloweenThunder.wav", categories: ["impact"] }
];

const ALLOWED_SOUND_IDS = new Set(FREE_SOUND_CATALOG.map((entry) => entry.id));

export function freeSoundAssetUrl(id: number): string {
  return `rbxassetid://${id}`;
}

export function isAllowedFreeSoundId(id: number): boolean {
  return ALLOWED_SOUND_IDS.has(id);
}

export function extractSoundIdsFromText(text: string): number[] {
  const ids = new Set<number>();
  for (const match of text.matchAll(/rbxassetid:\/\/(\d+)/gi)) {
    const id = Number(match[1]);
    if (Number.isFinite(id) && id > 0) ids.add(id);
  }
  for (const match of text.matchAll(/SoundId\s*=\s*["'](\d+)["']/gi)) {
    const id = Number(match[1]);
    if (Number.isFinite(id) && id > 0) ids.add(id);
  }
  return [...ids];
}

export function detectSoundCategory(prompt: string): FreeSoundCategory {
  const normalized = prompt.toLowerCase();
  if (/\b(rustle|foliage|leaf|leaves|grass\s*sound|bush|brush)\b/.test(normalized)) return "rustle";
  if (/\b(swish|slash|blade|sword)\b/.test(normalized)) return "swish";
  if (/\b(whoosh|swoosh|dash|sprint|air|wind\s*sound|flyby)\b/.test(normalized)) return "whoosh";
  if (/\b(footstep|foot\s*step|walk\s*sound|run\s*sound)\b/.test(normalized)) return "footstep";
  if (/\b(click|tap|press|button\s*sound)\b/.test(normalized)) return "click";
  if (/\b(ui\s*sound|menu\s*sound|toggle\s*sound|switch\s*sound)\b/.test(normalized)) return "ui";
  if (/\b(hit|punch|smack|thud|impact)\b/.test(normalized)) return "hit";
  if (/\b(explode|break|crash|boom)\b/.test(normalized)) return "impact";
  if (/\b(sound|sfx|audio|noise|rustl|swish|whoosh)\b/.test(normalized)) return "generic";
  return "generic";
}

export function promptRequestsSound(prompt: string): boolean {
  return /\b(sound|sfx|audio|noise|swish|whoosh|swoosh|rustle|footstep|click\s*sound|music|jingle)\b/i.test(prompt);
}

export function pickFreeSound(category: FreeSoundCategory = "generic"): FreeSoundEntry {
  const match = FREE_SOUND_CATALOG.find((entry) => entry.categories.includes(category));
  return match ?? FREE_SOUND_CATALOG[0];
}

export function freeSoundCatalogPromptBlock(prompt: string): string {
  if (!promptRequestsSound(prompt)) return "";
  const preferred = pickFreeSound(detectSoundCategory(prompt));
  return [
    "FREE ROBLOX AUDIO CATALOG (VERIFIED AssetTypeId=3 ONLY):",
    "Never invent SoundIds. Hallucinated IDs are often Scripts/Images and fail with \"Asset type does not match requested type\".",
    "When the user asks for a sound/SFX without providing an asset ID, you MUST use one of these exact free IDs.",
    `Preferred for this request: ${freeSoundAssetUrl(preferred.id)} (${preferred.name})`,
    "Allowed free sounds:",
    ...FREE_SOUND_CATALOG.map((entry) => `  * ${freeSoundAssetUrl(entry.id)} - ${entry.name} [${entry.categories.join(", ")}]`),
    "Rules:",
    "- Set Sound.SoundId to one of the rbxassetid:// values above.",
    "- Prefer a single shared Sound instance for repeated SFX when practical (not one Sound per grass blade unless necessary).",
    "- Do not require the user to upload or provide audio assets.",
    "- Do not use random numeric IDs, rbxasset://sounds paths that may be missing, or marketplace IDs not listed above."
  ].join("\n");
}

/**
 * Rewrite SoundId assignments in Luau source to allowed free audio IDs.
 * Unknown/invalid IDs are replaced with the category default for the prompt.
 */
export function rewriteSourceSoundIds(source: string, prompt = ""): { source: string; rewrote: number } {
  if (!source || !/SoundId|rbxassetid:\/\//i.test(source)) {
    return { source, rewrote: 0 };
  }
  const preferred = pickFreeSound(detectSoundCategory(prompt));
  let rewrote = 0;

  const replaceId = (rawId: string) => {
    const id = Number(rawId);
    if (isAllowedFreeSoundId(id)) return freeSoundAssetUrl(id);
    rewrote += 1;
    return freeSoundAssetUrl(preferred.id);
  };

  let next = source.replace(/rbxassetid:\/\/(\d+)/gi, (_full, id: string) => {
    // Only rewrite IDs near sound usage when possible; still fix any non-catalog ID
    // that appears in sound contexts by scanning whole source for unsafe sound ids later.
    if (isAllowedFreeSoundId(Number(id))) return `rbxassetid://${id}`;
    // Conservative: only auto-replace if this looks sound-related nearby in the original.
    return `rbxassetid://${id}`;
  });

  next = next.replace(
    /(\.SoundId\s*=\s*["'])rbxassetid:\/\/(\d+)(["'])/gi,
    (_full, left: string, id: string, right: string) => `${left}${replaceId(id)}${right}`
  );
  next = next.replace(
    /(SoundId\s*=\s*["'])rbxassetid:\/\/(\d+)(["'])/gi,
    (_full, left: string, id: string, right: string) => `${left}${replaceId(id)}${right}`
  );
  next = next.replace(
    /(\.SoundId\s*=\s*["'])(\d+)(["'])/gi,
    (_full, left: string, id: string, right: string) => `${left}${replaceId(id)}${right}`
  );

  // Also catch constants like RUSTLE_SOUND_ID = "rbxassetid://..."
  next = next.replace(
    /((?:SOUND|SFX|AUDIO|RUSTLE|SWISH|WHOOSH|CLICK)[_A-Z0-9]*\s*=\s*["'])rbxassetid:\/\/(\d+)(["'])/gi,
    (_full, left: string, id: string, right: string) => `${left}${replaceId(id)}${right}`
  );

  return { source: next, rewrote };
}

export function rewriteChangeFilesSoundIds<T extends { source?: string }>(
  files: T[],
  prompt = ""
): { files: T[]; rewrote: number } {
  let rewrote = 0;
  const nextFiles = files.map((file) => {
    if (!file.source) return file;
    const rewritten = rewriteSourceSoundIds(file.source, prompt);
    rewrote += rewritten.rewrote;
    if (rewritten.rewrote === 0 && rewritten.source === file.source) return file;
    return { ...file, source: rewritten.source };
  });
  return { files: nextFiles, rewrote };
}

export function listInvalidSoundIdsInFiles(files: Array<{ source?: string }>): number[] {
  const invalid = new Set<number>();
  for (const file of files) {
    if (!file.source || !/SoundId|SOUND|SFX|AUDIO|RUSTLE|SWISH|WHOOSH/i.test(file.source)) continue;
    for (const id of extractSoundIdsFromText(file.source)) {
      // Only flag IDs that are used as SoundId or named sound constants
      const soundContext = new RegExp(
        `(?:SoundId\\s*=\\s*[\"'](?:rbxassetid:\\/\\/)?${id}[\"'])|(?:(?:SOUND|SFX|AUDIO|RUSTLE|SWISH|WHOOSH)[_A-Z0-9]*\\s*=\\s*[\"']rbxassetid:\\/\\/${id}[\"'])`,
        "i"
      );
      if (soundContext.test(file.source) && !isAllowedFreeSoundId(id)) {
        invalid.add(id);
      }
    }
  }
  return [...invalid];
}
