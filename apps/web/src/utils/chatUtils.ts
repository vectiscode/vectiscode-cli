export const CHAT_TITLE_STOP_WORDS = new Set([
  "a", "an", "and", "are", "can", "for", "from", "i", "in", "is", "it",
  "me", "my", "of", "on", "please", "the", "this", "to", "with", "you",
  "what", "how", "why", "should", "would", "do"
]);

export function chatTitleFromPrompt(prompt: string): string {
  const words = prompt
    .replace(/https?:\/\/\S+/gi, " ")
    .replace(/[`*_~>#()[\]{}]/g, " ")
    .replace(/[^a-z0-9' ]+/gi, " ")
    .split(/\s+/)
    .map((word) => word.trim().slice(0, 24))
    .filter(Boolean);
  const contentWords = words.filter((word) => !CHAT_TITLE_STOP_WORDS.has(word.toLowerCase()));
  const titleWords = (contentWords.length >= 2 ? contentWords : words).slice(0, 5);
  if (titleWords.length === 0) return "New chat";
  const title = titleWords.join(" ");
  return title.charAt(0).toUpperCase() + title.slice(1);
}

export function isDefaultThreadName(name: string): boolean {
  return /^new chat$/i.test(name.trim());
}

export function binaryThinkingLevel(
  level: "none" | "low" | "medium" | "high" | undefined,
  fallback: "none" | "high"
): "none" | "high" {
  if (!level) return fallback;
  return level === "none" ? "none" : "high";
}

export function deepSeekThinkingLevel(
  level: "none" | "high" | "max" | undefined,
  fallback: "none" | "high"
): "none" | "high" | "max" {
  if (!level) return fallback;
  if (level === "none" || level === "high" || level === "max") return level;
  return fallback;
}

export function isBinaryThinkingModel(modelId: string): boolean {
  return modelId === "qwen3.7-max";
}

export function isAlwaysThinkingModel(modelId: string): boolean {
  return modelId === "kimi-k2.7-code";
}

export function isTieredThinkingModel(modelId: string): boolean {
  return (
    modelId === "gemini-3.5-flash" ||
    modelId === "gemini-3-flash-preview" ||
    modelId === "gemini-3-flash" ||
    modelId === "gemini-3.1-pro-preview" ||
    modelId === "gemini-3.1-flash-lite" ||
    modelId === "gpt-5.5" ||
    modelId === "claude-opus-4-8"
  );
}

export type StudioProblemLog = {
  id: string;
  studioSessionId?: string;
  level: "info" | "warn" | "error";
  message: string;
  createdAt: string;
};

const STUDIO_PROBLEM_RECENCY_MS = 30 * 60 * 1000;

const ignoredStudioProblemPatterns = [
  /^vectis\b/i,
  /visual qa skipped/i,
  /visual qa screenshot/i,
  /studio bridge/i,
  /http requests/i,
  /screenshot permission/i,
  /plugin/i,
  /rollback/i,
  /patch (?:failed|validation|applied|queued)/i,
  /unsupported property/i,
  /skipped unsupported/i
];

export function isActionableStudioProblemLog(entry: StudioProblemLog, sessionId?: string, nowMs = Date.now()): boolean {
  if (entry.level !== "error" && entry.level !== "warn") return false;
  if (sessionId && entry.studioSessionId && entry.studioSessionId !== sessionId) return false;
  const message = entry.message.trim();
  if (message.length < 8) return false;
  const createdMs = Date.parse(entry.createdAt);
  if (!Number.isFinite(createdMs)) return false;
  if (nowMs - createdMs > STUDIO_PROBLEM_RECENCY_MS) return false;
  if (ignoredStudioProblemPatterns.some((pattern) => pattern.test(message))) return false;
  return /(?:stack begin|script|localscript|modulescript|server|client|line \d+|:\d+:|attempt to|invalid argument|nil value|is not a valid member|cannot|failed|not authorized|permission)/i.test(message);
}

export function selectLatestActionableStudioProblem(logs: StudioProblemLog[], sessionId?: string, nowMs = Date.now()): StudioProblemLog | undefined {
  const actionable = logs
    .filter((entry) => isActionableStudioProblemLog(entry, sessionId, nowMs))
    .sort((a, b) => {
      const timeDiff = Date.parse(b.createdAt) - Date.parse(a.createdAt);
      if (Math.abs(timeDiff) <= 120_000 && a.level !== b.level) return a.level === "error" ? -1 : 1;
      return timeDiff;
    });
  return actionable[0];
}
