#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { analyze } from "./checks.js";
import { readClaude } from "./claude.js";
import { readCodex } from "./codex.js";
import { render } from "./report.js";

const HELP = `vectiscode: find out why your Claude Code and Codex limits drain, and what to change.

Usage: npx vectiscode [options]

  --days <n>          look at the last n days (default 30)
  --since <date>      look at everything since a date, like 2026-10-01
  --json              print the full report as JSON
  --claude-dir <dir>  Claude Code folder (default $CLAUDE_CONFIG_DIR or ~/.claude)
  --codex-dir <dir>   Codex folder (default $CODEX_HOME or ~/.codex)
  -v, --version       print the version
  -h, --help          print this help

Everything runs on this computer. Your logs are read, never changed and never sent anywhere.`;

const { values } = parseArgs({
  options: {
    days: { type: "string" },
    since: { type: "string" },
    json: { type: "boolean" },
    "claude-dir": { type: "string" },
    "codex-dir": { type: "string" },
    version: { type: "boolean", short: "v" },
    help: { type: "boolean", short: "h" },
  },
});

if (values.help) {
  console.log(HELP);
} else if (values.version) {
  console.log(JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")).version);
} else {
  const days = values.since ? null : Number(values.days ?? 30);
  const since = values.since ? Date.parse(values.since) : Date.now() - days! * 86_400_000;
  if (!Number.isFinite(since)) {
    console.error(`Could not read the date or number of days. Try --since 2026-10-01 or --days 7.`);
    process.exit(1);
  }
  const claudeDir = values["claude-dir"] ?? process.env.CLAUDE_CONFIG_DIR ?? join(homedir(), ".claude");
  const codexDir = values["codex-dir"] ?? process.env.CODEX_HOME ?? join(homedir(), ".codex");
  if (process.stderr.isTTY && !values.json) process.stderr.write("Reading your logs...\r");
  const [claude, codex] = await Promise.all([readClaude(claudeDir, since), readCodex(codexDir, since)]);
  if (process.stderr.isTTY && !values.json) process.stderr.write("                   \r");
  const report = analyze(claude, codex, since);
  console.log(values.json ? JSON.stringify(report, null, 2) : render(report, days));
}
