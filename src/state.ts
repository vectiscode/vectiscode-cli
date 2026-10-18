import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const stateDir = () => process.env.VECTISCODE_HOME ?? join(homedir(), ".vectiscode");

export function lastCheck(now = Date.now()): number | undefined {
  try {
    const state = JSON.parse(readFileSync(join(stateDir(), "state.json"), "utf8"));
    if (Number.isFinite(state.lastCheck) && state.lastCheck > 0 && state.lastCheck <= now) return state.lastCheck;
  } catch {
    // Missing or unreadable state means this is the first check.
  }
  return undefined;
}

export function saveCheck(time: number, version: string): void {
  try {
    mkdirSync(stateDir(), { recursive: true });
    writeFileSync(join(stateDir(), "state.json"), JSON.stringify({ lastCheck: time, version }) + "\n");
  } catch {
    // Reports still work when the home folder is read-only.
  }
}
