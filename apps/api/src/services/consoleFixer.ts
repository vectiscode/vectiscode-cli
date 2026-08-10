import type { StudioLog, ProjectSnapshot, SnapshotNode } from "../types.js";

export interface AggregatedConsoleError {
  scriptPath: string;
  sourceCode?: string;
  className?: string;
  logs: Array<{
    message: string;
    level: "warn" | "error";
    line?: number;
    createdAt: string;
  }>;
}

export function aggregateConsoleErrors(
  logs: StudioLog[],
  snapshot?: ProjectSnapshot
): {
  matchedScripts: AggregatedConsoleError[];
  unmatchedLogs: Array<{ message: string; level: "warn" | "error"; createdAt: string }>;
} {
  const matchedScriptsMap = new Map<string, AggregatedConsoleError>();
  const unmatchedLogs: Array<{ message: string; level: "warn" | "error"; createdAt: string }> = [];

  const nodes = snapshot?.nodes ?? [];

  // Helper to find a snapshot node matching a parsed path
  function findNode(parsedPath: string): SnapshotNode | undefined {
    // Try exact match
    let found = nodes.find(n => n.path === parsedPath);
    if (found) return found;

    // Try case-insensitive exact match
    const lowerParsed = parsedPath.toLowerCase();
    found = nodes.find(n => n.path.toLowerCase() === lowerParsed);
    if (found) return found;

    // Try suffix match (e.g. Workspace/Folder/Script matches Folder/Script or Script)
    const parts = parsedPath.split("/");
    if (parts.length > 0) {
      const lastComponent = parts[parts.length - 1];
      // Find all nodes ending with the last component or the whole suffix
      const candidates = nodes.filter(n => n.path.endsWith(parsedPath) || n.path.endsWith(lastComponent));
      if (candidates.length === 1) {
        return candidates[0];
      }
      // If multiple candidates, try to find the best match by path overlap
      if (candidates.length > 1) {
        let bestMatch = candidates[0];
        let maxOverlap = 0;
        for (const candidate of candidates) {
          const candParts = candidate.path.split("/");
          let overlap = 0;
          for (let i = 1; i <= Math.min(parts.length, candParts.length); i++) {
            if (parts[parts.length - i].toLowerCase() === candParts[candParts.length - i].toLowerCase()) {
              overlap++;
            } else {
              break;
            }
          }
          if (overlap > maxOverlap) {
            maxOverlap = overlap;
            bestMatch = candidate;
          }
        }
        return bestMatch;
      }
    }
    return undefined;
  }

  for (const log of logs) {
    if (log.level !== "error" && log.level !== "warn") {
      continue;
    }

    // Try matching dot path syntax: e.g. ServerScriptService.MainScript:15: attempt to index nil
    const dotMatch = log.message.match(/([a-zA-Z0-9_\s]+(?:\.[a-zA-Z0-9_\s]+)+):(\d+)/);
    // Try matching slash path syntax: e.g. ServerScriptService/MainScript:15: attempt to index nil
    const slashMatch = log.message.match(/([a-zA-Z0-9_\s]+(?:\/[a-zA-Z0-9_\s]+)+):(\d+)/);

    let parsedPath: string | undefined;
    let line: number | undefined;

    if (dotMatch) {
      parsedPath = dotMatch[1].replace(/\./g, "/");
      line = parseInt(dotMatch[2], 10);
    } else if (slashMatch) {
      parsedPath = slashMatch[1];
      line = parseInt(slashMatch[2], 10);
    }

    if (parsedPath) {
      const node = findNode(parsedPath);
      const scriptPath = node ? node.path : parsedPath;

      let aggregated = matchedScriptsMap.get(scriptPath);
      if (!aggregated) {
        aggregated = {
          scriptPath,
          sourceCode: node?.source,
          className: node?.className,
          logs: []
        };
        matchedScriptsMap.set(scriptPath, aggregated);
      }

      aggregated.logs.push({
        message: log.message,
        level: log.level,
        line,
        createdAt: log.createdAt
      });
    } else {
      unmatchedLogs.push({
        message: log.message,
        level: log.level,
        createdAt: log.createdAt
      });
    }
  }

  return {
    matchedScripts: Array.from(matchedScriptsMap.values()),
    unmatchedLogs
  };
}

export function buildConsoleFixerPrompt(
  logs: StudioLog[],
  snapshot?: ProjectSnapshot
): string {
  const { matchedScripts, unmatchedLogs } = aggregateConsoleErrors(logs, snapshot);

  if (matchedScripts.length === 0 && unmatchedLogs.length === 0) {
    return "Fix any potential issues in the codebase. (No active console errors were found).";
  }

  const promptParts: string[] = [
    "Vectis Console Fixer has aggregated the following active errors and warnings from the Roblox Studio playtest console.",
    "Your goal is to generate a Roblox reviewed Studio patch (changeset) that resolves these errors.",
    ""
  ];

  if (matchedScripts.length > 0) {
    promptParts.push("### Active Errors in Synced Scripts:");
    for (const script of matchedScripts) {
      promptParts.push(`#### Script Path: \`${script.scriptPath}\` (Class: ${script.className ?? "Unknown"})`);
      promptParts.push("Logs:");
      for (const log of script.logs) {
        const lineText = log.line ? `Line ${log.line}: ` : "";
        promptParts.push(`- [${log.level.toUpperCase()}] ${lineText}${log.message}`);
      }
      if (script.sourceCode) {
        promptParts.push("Current Source Code:");
        promptParts.push("```luau");
        promptParts.push(script.sourceCode);
        promptParts.push("```");
      } else {
        promptParts.push("(No source code was found for this script path in the snapshot).");
      }
      promptParts.push("");
    }
  }

  if (unmatchedLogs.length > 0) {
    promptParts.push("### Other Unmatched Console Logs:");
    for (const log of unmatchedLogs) {
      promptParts.push(`- [${log.level.toUpperCase()}] ${log.message}`);
    }
    promptParts.push("");
  }

  promptParts.push("Formulate a fix for these errors and output the modified scripts in a reviewed Studio patch.");
  return promptParts.join("\n");
}
