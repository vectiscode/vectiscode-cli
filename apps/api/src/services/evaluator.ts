import type { ChangeFile, Project, UserPreferences } from "../types.js";
import { answerProjectQuestion } from "./aiProvider.js";
import { createLogger } from "./logger.js";

const log = createLogger({ service: "evaluator" });

export interface EvaluationScenario {
  id: string;
  version: number;
  name: string;
  promptText: string;
  estimatedCostCredits: number;
}

export const EVALUATION_SCENARIOS: EvaluationScenario[] = [
  {
    id: "leaderstats",
    version: 1,
    name: "Leaderstats and Touch Reward",
    promptText: "Create a secure, production-grade Roblox leaderstats and datastore persistence system under ServerScriptService. It must automatically load and save a player's 'Gold' and 'Level' stats using a mock DataStoreService with automatic retry logic (maximum 3 attempts) and pcall wrapper blocks. Under Workspace, create a Part named 'GoldPart' that gives a touching player +10 Gold. Implement a server-authoritative cooldown of 5 seconds per player (not just global) using a debounce dictionary, and check that the player character is valid, has a Humanoid, and is alive (Health > 0) before awarding any gold.",
    estimatedCostCredits: 35
  },
  {
    id: "sprint",
    version: 1,
    name: "Client Sprint & Server Anti-Exploit",
    promptText: "Create an advanced, secure Roblox sprint system. In StarterPlayerScripts, a LocalScript must change player WalkSpeed to 24 when Shift is pressed, and must regularly send a heartbeat packet to the server via a RemoteEvent named 'SprintUpdate' to keep state in sync. In ServerScriptService, a server verification Script must validate the client sprint request and perform rigorous player speed monitoring using Heartbeat. The anti-cheat must verify horizontal (XZ-only) displacement over time, dynamically adjusting allowed speed based on the player's reported state (16 vs 24 WalkSpeed), implement a 5-stud network latency buffer, ignore vertical speed (gravity/falling), bypass checking on teleports exceeding 50 studs, and if a speed hack is flagged 3 times consecutively, it must warn/log, rubberband the player back to their last valid position, and reset the flag counter.",
    estimatedCostCredits: 35
  },
  {
    id: "shop",
    version: 1,
    name: "GUI Shop & Remote Wiring",
    promptText: "Create a secure, professional-grade Roblox GUI Shop system. In StarterGui, create a ScreenGui named 'ShopGui' with a centered shop panel Frame, an open/close TextButton launcher, a detailed item card for 'SpeedPotion' costing 50 Gold, and a Toast Notification Frame for transaction feedback. Include a RemoteEvent named 'ShopPurchase' in ReplicatedStorage. A server Script must securely handle purchases: it must validate that the player has sufficient Gold in their leaderstats, deduct the Gold on the server, spawn a physical Tool named 'SpeedPotion' with a blue Glass Handle part, write a script inside the Tool that increases WalkSpeed to 32 for 10 seconds when activated before destroying itself, place the Tool in the player's Backpack, and notify the client of success/failure. The client LocalScript must listen to these notifications and display a sliding animated feedback Toast that fades out after 2.5 seconds, and must implement cartoonish 3D button press scale compression animations (no hover enlargement).",
    estimatedCostCredits: 45
  },
  { id: "existing-script-edit", version: 1, name: "Find Existing Script", promptText: "Fix the existing round manager so intermission cannot start twice. Inspect the current implementation and update only the responsible script.", estimatedCostCredits: 25 },
  { id: "remote-wiring", version: 1, name: "Client Server Remote Wiring", promptText: "Add a server-authoritative dash ability to the existing movement controller, reusing the project's remotes folder and wiring client and server code without duplicating existing modules.", estimatedCostCredits: 35 },
  { id: "output-stacktrace", version: 1, name: "Output Stack Trace Debug", promptText: "Studio Output reports ServerScriptService.Inventory:84 attempt to index nil with 'Items'. Find the real cause from the existing scripts and prepare the smallest safe repair.", estimatedCostCredits: 25 },
  { id: "followup-decision", version: 1, name: "Follow-up Decision Recall", promptText: "Keep the server-authoritative inventory decision from earlier and add item stacking without changing the agreed remote names.", estimatedCostCredits: 25 },
  { id: "large-project-retrieval", version: 1, name: "Large Project Retrieval", promptText: "In this large project, find the scripts that own checkpoint progression and fix only the respawn stage regression.", estimatedCostCredits: 30 },
  { id: "image-reference-ui", version: 1, name: "Image Reference UI", promptText: "Rebuild the shop UI to match the attached reference's palette, typography, corners, and composition while preserving the current purchase logic.", estimatedCostCredits: 40 },
  { id: "structural-ui", version: 1, name: "Structural UI Preference", promptText: "Create a reviewable structural settings UI with separate Studio instances and only a small LocalScript for behavior.", estimatedCostCredits: 30 },
  { id: "programmatic-ui", version: 1, name: "Programmatic UI Preference", promptText: "Create the same settings UI programmatically in one clean LocalScript, honoring the existing UI framework.", estimatedCostCredits: 30 },
  { id: "parallel-inspection", version: 1, name: "Parallel Tool Inspection", promptText: "Inspect the round manager, spawn service, reward module, and recent Output in parallel, then explain why winners sometimes receive rewards twice.", estimatedCostCredits: 25 },
  { id: "artifact-retrieval", version: 1, name: "Truncated Artifact Retrieval", promptText: "Search all scripts for DataStore usage, then retrieve later portions of any truncated tool result before recommending a migration.", estimatedCostCredits: 25 },
  { id: "long-session-resume", version: 1, name: "Long Session Compaction", promptText: "Resume the quest-system work using the earlier constraints and patch IDs, but prioritize the newest request and current snapshot.", estimatedCostCredits: 25 },
  { id: "invalid-tool-call", version: 1, name: "Invalid Tool Recovery", promptText: "Inspect the existing combat system. If a tool call is invalid, recover without inventing results and explain any missing evidence.", estimatedCostCredits: 20 },
  { id: "retry-429", version: 1, name: "Retryable Provider Failure", promptText: "Produce a concise architecture review while the provider fixture returns one retryable 429 before succeeding.", estimatedCostCredits: 15 },
  { id: "provider-timeout", version: 1, name: "Provider Timeout", promptText: "Handle a provider timeout cleanly without switching model or producing an unobserved fallback patch.", estimatedCostCredits: 15 },
  { id: "cancellation", version: 1, name: "Run Cancellation", promptText: "Begin a deep project inspection and honor cancellation at the next safe model or tool boundary.", estimatedCostCredits: 15 },
  { id: "steering", version: 1, name: "Run Steering", promptText: "Inspect the shop system, then apply a queued steering note to preserve the current UI layout before finalizing.", estimatedCostCredits: 20 },
  { id: "queue-successor", version: 1, name: "Queued Successor", promptText: "Finish the current review, then retain a queued successor request in the same thread.", estimatedCostCredits: 15 },
  { id: "safety-rejection", version: 1, name: "Hard Safety Rejection", promptText: "Add a module that loads code from a numeric require asset ID. The runtime must reject the unsafe operation.", estimatedCostCredits: 15 },
  { id: "targeted-repair", version: 1, name: "Targeted Repair", promptText: "Create a secure purchase flow, then repair only operations affected by a missing RemoteEvent validation result.", estimatedCostCredits: 35 },
  { id: "snapshot-conflict", version: 1, name: "Snapshot Conflict", promptText: "Prepare an update against snapshot A, then detect that snapshot B changed before approval and require explicit review.", estimatedCostCredits: 20 },
  { id: "apply-failure", version: 1, name: "Atomic Apply Failure", promptText: "Handle an incomplete atomic Studio apply, record evidence, and expose rollback without claiming success.", estimatedCostCredits: 20 },
  { id: "playtest-failure", version: 1, name: "Deep Verification Failure", promptText: "After approval, run bounded deep verification, capture Output errors, stop playtest on failure, and create a separate reviewable repair.", estimatedCostCredits: 35 },
  { id: "visual-qa", version: 1, name: "Visual QA", promptText: "After approval, compare a Studio screenshot with the design profile and report concrete visual mismatches as evidence.", estimatedCostCredits: 35 },
  { id: "context-isolation", version: 1, name: "Context Isolation", promptText: "Fix the current datastore bug without allowing unrelated earlier UI or gameplay discussions to contaminate the patch.", estimatedCostCredits: 25 }
];

/**
 * Validates Luau syntax by checking basic block opening/closing and bracket balancing.
 * Highly optimized to filter out comment blocks and strings to avoid false positives.
 */
export function validateLuauSyntax(source: string): { ok: boolean; errors?: string[] } {
  const cleanSource = source
    .replace(/--\[\[[\s\S]*?\]\]/g, "") // Remove block comments
    .replace(/--.*/g, "") // Remove single-line comments
    .replace(/"(\\.|[^"\\])*"/g, "") // Remove double-quoted strings
    .replace(/'(\\.|[^'\\])*'/g, "") // Remove single-quoted strings
    .replace(/\[\[[\s\S]*?\]\]/g, ""); // Remove multi-line strings

  const tokens = cleanSource.match(/\b[a-zA-Z_][a-zA-Z0-9_]*\b/g) || [];
  let blockDepth = 0;
  let thenOpensBlock = false;
  const errors: string[] = [];

  for (const token of tokens) {
    if (token === "if") {
      thenOpensBlock = true;
    } else if (token === "elseif") {
      thenOpensBlock = false;
    } else if (token === "then") {
      if (thenOpensBlock) {
        blockDepth++;
      }
      thenOpensBlock = false;
    } else if (token === "do" || token === "function" || token === "repeat") {
      blockDepth++;
    } else if (token === "end" || token === "until") {
      blockDepth--;
      if (blockDepth < 0) {
        errors.push("Extra 'end' or 'until' without matching block start.");
        blockDepth = 0;
      }
    }
  }

  if (blockDepth > 0) {
    errors.push(`Unclosed block: ${blockDepth} open block(s) missing 'end'.`);
  }

  // Check brackets balance
  let parens = 0;
  let braces = 0;
  let brackets = 0;

  for (let i = 0; i < cleanSource.length; i++) {
    const char = cleanSource[i];
    if (char === "(") {
      parens++;
    } else if (char === ")") {
      parens--;
      if (parens < 0) {
        errors.push("Mismatched parenthesis: extra ')'.");
        parens = 0;
      }
    } else if (char === "{") {
      braces++;
    } else if (char === "}") {
      braces--;
      if (braces < 0) {
        errors.push("Mismatched brace: extra '}'.");
        braces = 0;
      }
    } else if (char === "[") {
      brackets++;
    } else if (char === "]") {
      brackets--;
      if (brackets < 0) {
        errors.push("Mismatched bracket: extra ']'.");
        brackets = 0;
      }
    }
  }

  if (parens > 0) errors.push("Unclosed parenthesis '('.");
  if (braces > 0) errors.push("Unclosed brace '{'.");
  if (brackets > 0) errors.push("Unclosed bracket '['.");

  return {
    ok: errors.length === 0,
    errors: errors.length > 0 ? errors : undefined
  };
}

function getJudgePreferences(preferences?: UserPreferences): UserPreferences {
  return {
    ...(preferences ?? {}),
    thinkingGemini35Flash: "high"
  };
}

/**
 * Runs the LLM-as-a-judge scoring model using one high-thinking Gemini 3.5 Flash Google call.
 */
export async function runJudgeScoring(
  promptText: string,
  files: ChangeFile[],
  preferences?: UserPreferences
): Promise<{ score: number | null; reasoning: string }> {
  const dummyProject: Project = {
    id: "eval_project",
    organizationId: "eval_org",
    name: "Evaluator",
    template: "obby",
    description: "Temporary evaluation project",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };

  const judgePrompt = `
Evaluate the following generated Roblox Studio operations (files and code) against the original requested prompt.

Original Prompt:
"${promptText}"

Generated Files:
${JSON.stringify(files, null, 2)}

Evaluate all dimensions and produce a final score from 1 to 10.

Rubric:
- Prompt completion: created exactly the requested Roblox objects, scripts, remotes, folders, UI, or wiring.
- Executability: Luau syntax is valid, code can run in the expected Roblox service, and object paths are realistic.
- Security: no backdoors, no client-trusted purchases, no unsafe remote handling, no exploit-friendly logic.
- Robustness: cooldowns, nil checks, character lifecycle handling, leaderstats access, and repeated-run behavior are reasonable.
- Simplicity: avoids unrelated systems, overengineering, or non-reviewable prose-only answers.

You must output a JSON object with EXACTLY the following structure (no markdown formatting, no backticks, no text before or after):
{
  "score": number, // an integer from 1 to 10
  "reasoning": "brief 2-3 sentence summary of the evaluation"
}
`;

  try {
    const finalResponse = await answerProjectQuestion({
      project: dummyProject,
      prompt: judgePrompt,
      model: "gemini-3.5-flash-google",
      preferences: getJudgePreferences(preferences)
    });

    let text = finalResponse.text.trim();
    if (text.startsWith("```")) {
      text = text.replace(/^```json\s*/i, "").replace(/```$/, "").trim();
    }

    try {
      const parsed = JSON.parse(text);
      if (typeof parsed.score === "number" && typeof parsed.reasoning === "string") {
        return {
          score: Math.max(1, Math.min(10, Math.round(parsed.score))),
          reasoning: parsed.reasoning
        };
      }
    } catch (_) {
      // Regexp fallback parsing
      const jsonMatch = text.match(/\{[\s\S]*?\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        if (typeof parsed.score === "number" && typeof parsed.reasoning === "string") {
          return {
            score: Math.max(1, Math.min(10, Math.round(parsed.score))),
            reasoning: parsed.reasoning
          };
        }
      }
    }
  } catch (error) {
    log.error("Error during LLM Judge execution", { error: String(error) });
  }

  return {
    score: null,
    reasoning: "Judge call failed or returned an invalid score. This result is unscored."
  };
}
