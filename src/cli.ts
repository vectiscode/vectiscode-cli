#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { analyze } from "./checks.js";
import { readClaude } from "./claude.js";
import { readCodex } from "./codex.js";
import { activeHours, compare, recentChanges, renderComparison } from "./compare.js";
import { filterSource } from "./model.js";
import { readOpenCode } from "./opencode.js";
import { render } from "./report.js";
import { lastCheck, saveCheck } from "./state.js";

const HELP = `vectiscode: find out where your Claude Code, Codex and OpenCode usage went, and what to change.

Usage: npx vectiscode [options]
       npx vectiscode compare <date> [options]

  compare <date>      compare your habits before and after a date, like the day you
                      changed a setting (with --days: how many days before, default 7)
  --days <n>          look at the last n days (default 30)
  --since <date>      look at everything since a date, like 2026-10-01
  --json              print the full report as JSON
  --claude-dir <dir>  Claude Code folder (default $CLAUDE_CONFIG_DIR or ~/.claude)
  --codex-dir <dir>   Codex folder (default $CODEX_HOME or ~/.codex)
  --opencode-dir <dir> OpenCode folder (default $XDG_DATA_HOME/opencode or ~/.local/share/opencode)
  -v, --version       print the version
  -h, --help          print this help

Nothing is uploaded. Logs are only read; only the last-check date is saved.`;

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    days: { type: "string" },
    since: { type: "string" },
    json: { type: "boolean" },
    "claude-dir": { type: "string" },
    "codex-dir": { type: "string" },
    "opencode-dir": { type: "string" },
    version: { type: "boolean", short: "v" },
    help: { type: "boolean", short: "h" },
  },
});

if (values.help) {
  console.log(HELP);
} else if (values.version) {
  console.log(JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")).version);
} else if (positionals[0] === "compare") {
  const date = parseDate(positionals[1]);
  const days = Number(values.days ?? 7);
  if (!Number.isFinite(date) || !(days > 0) || date > Date.now()) fail("Give the date to compare around, like: npx vectiscode compare 2026-10-01");
  const from = date - days * 86_400_000;
  const [claude, codex, opencode] = await read(from);
  const comparison = compare(claude, codex, date, from, Date.now(), opencode);
  console.log(values.json ? JSON.stringify(comparison, null, 2) : renderComparison(comparison));
} else if (positionals.length) {
  fail(`Unknown command: ${positionals[0]}. Run npx vectiscode --help for the options.`);
} else {
  const days = values.since ? null : Number(values.days ?? 30);
  const since = values.since ? parseDate(values.since) : Date.now() - days! * 86_400_000;
  if (!Number.isFinite(since)) fail("Could not read the date or number of days. Try --since 2026-10-01 or --days 7.");
  const now = Date.now();
  const previous = values.json ? undefined : lastCheck(now);
  const from = previous === undefined ? since : Math.min(since, previous - 7 * 86_400_000);
  const [claude, codex, opencode] = await read(from);
  const report = analyze(filterSource(claude, since, now), filterSource(codex, since, now), since, now, filterSource(opencode, since, now));
  // Runs within 12 hours of the last check keep it, so checking twice in a day doesn't reset the baseline.
  const due = previous === undefined || now - previous >= 12 * 3_600_000;
  const active = previous === undefined ? [] : [...claude.requests, ...codex.requests, ...opencode.requests].filter((r) => r.time >= previous && r.time < now);
  const rows = previous !== undefined && due && activeHours(active) >= 3
    ? recentChanges(compare(claude, codex, previous, previous - 7 * 86_400_000, now, opencode)) : [];
  console.log(values.json ? JSON.stringify(report, null, 2) : render(report, days, { date: previous, rows }));
  if (!values.json && due) saveCheck(now, JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")).version);
}

async function read(since: number) {
  const claudeDir = values["claude-dir"] ?? process.env.CLAUDE_CONFIG_DIR ?? join(homedir(), ".claude");
  const codexDir = values["codex-dir"] ?? process.env.CODEX_HOME ?? join(homedir(), ".codex");
  const opencodeDir = values["opencode-dir"] ?? join(process.env.XDG_DATA_HOME ?? join(homedir(), ".local", "share"), "opencode");
  const status = process.stderr.isTTY && !values.json;
  if (status) process.stderr.write("Reading your logs...\r");
  try {
    return await Promise.all([readClaude(claudeDir, since), readCodex(codexDir, since), readOpenCode(join(opencodeDir, "opencode.db"), since)]);
  } finally {
    if (status) process.stderr.write("\r\x1b[2K");
  }
}

/** A plain date means local midnight, not UTC. */
function parseDate(s: string | undefined): number {
  return s ? Date.parse(/^\d{4}-\d{2}-\d{2}$/.test(s) ? `${s}T00:00` : s) : NaN;
}

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}
