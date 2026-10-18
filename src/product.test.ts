import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { analyze, type Report } from "./checks.js";
import { activeHours, compare, recentChanges, renderComparison } from "./compare.js";
import { filterSource, type Request, type SourceData } from "./model.js";
import { readOpenCode } from "./opencode.js";
import { render } from "./report.js";

const DAY = 86_400_000;
const START = Date.UTC(2026, 9, 1);

function request(time: number, context = 200_000): Request {
  return {
    source: "claude", id: `r-${time}`, session: "chat", thread: "chat", project: "demo", time,
    model: "claude-sonnet-5-5", agent: "main", input: 0, cacheRead: context,
    cacheWrite5m: 0, cacheWrite1h: 0, output: 0, context, cost: context * 0.2 / 1e6,
  };
}

test("prioritizes at most three actions, keeps their order and wraps narrow columns", () => {
  const report: Report = {
    since: START,
    claude: { units: 10, requests: 10, chats: 1, split: { read: 1, write: 0, output: 0, input: 0 }, agents: [], projects: [] },
    findings: [
      { id: "long-chats", action: "Start a fresh chat from a short handoff note at about 150k", share: 0.13 },
      { id: "tool-results", action: "Keep tool results small: read files in slices, keep logs short", share: 0.27 },
      { id: "always-on", action: "Turn off MCP servers and tools a project doesn't use", share: 0.17 },
      { id: "helpers", action: "Give helpers a cheaper model and cap how many a workflow starts", share: 0.3 },
    ].map((f) => ({ ...f, level: "high", title: "Finding", facts: [], fix: "Fix" } as Report["findings"][number])),
  };
  const text = render(report, 7);
  const block = text.slice(text.indexOf("WHAT TO DO FIRST"), text.indexOf("Units are"));
  assert.match(block, /1\. Start a fresh/);
  assert.match(block, /2\. Keep tool/);
  assert.match(block, /3\. Turn off/);
  assert.doesNotMatch(block, /4\.|Give helpers/);
  const lines = block.split("\n").filter((l) => /^\d\./.test(l));
  assert.equal(lines[0]!.indexOf("saves about"), lines[1]!.indexOf("27%"));
  assert.equal(lines[1]!.indexOf("27%"), lines[2]!.indexOf("17%"));
  const narrow = execFileSync(process.execPath, ["--input-type=module", "-e", `
    Object.defineProperty(process.stdout, "columns", { value: 48 });
    const { render } = await import(${JSON.stringify(new URL("./report.js", import.meta.url).href)});
    console.log(render(${JSON.stringify(report)}, 7));
  `], { encoding: "utf8" });
  const narrowBlock = narrow.slice(narrow.indexOf("WHAT TO DO FIRST"), narrow.indexOf("Units are"));
  assert.match(narrowBlock, /\n   saves about 13%/);
  assert.ok(narrowBlock.split("\n").every((l) => l.length <= 48));
});

test("findings carry the specified actions and Codex priorities use Codex usage", () => {
  const requests = [request(START), request(START + 60_000), request(START + 120_000)];
  const claude = analyze({ requests, sessions: new Map() }, undefined, START);
  assert.equal(claude.findings.find((f) => f.id === "long-chats")!.action, "Start a fresh chat from a short handoff note at about 150k");
  assert.equal(claude.findings.find((f) => f.id === "always-on")!.action, "Turn off MCP servers and tools a project doesn't use");
  const codex = analyze(undefined, { requests: requests.map((r) => ({ ...r, source: "codex" })), sessions: new Map(), limits: [] }, START);
  assert.equal(codex.findings.find((f) => f.id === "long-chats")!.action, "Start fresh Codex chats sooner");
  assert.match(render(codex, 7), /1\. Start fresh Codex chats sooner\s+100% of Codex usage/);
  const comparison = compare(undefined, { requests: requests.map((r) => ({ ...r, source: "codex" })), sessions: new Map(), limits: [] }, START + 60_000, START, START + DAY);
  assert.match(recentChanges(comparison).join("\n"), /Codex average context/);
});

test("filters requests and limits to the report window and counts shared active hours once", () => {
  const data = { requests: [request(START), request(START + DAY)], sessions: new Map(), limits: [{ time: START }, { time: START + DAY }] };
  const filtered = filterSource(data, START + DAY, START + 2 * DAY);
  assert.equal(filtered.requests.length, 1);
  assert.equal(filtered.limits.length, 1);
  const chats = filterSource({ ...data, sessions: new Map([[filtered.requests[0]!.session, {} as never], ["old", {} as never]]) }, START + DAY, START + 2 * DAY);
  assert.deepEqual([...chats.sessions.keys()], [filtered.requests[0]!.session]);
  assert.equal(data.requests.length, 2);
  assert.equal(activeHours([request(START), request(START + 1000), request(START + 3_600_000)]), 2);
  assert.equal(analyze(undefined, { ...filtered, limits: [], sessions: new Map([["old", {} as never]]) }, START).codex!.chats, 1);
});

test("reads OpenCode main chats, helpers, compactions and prices with a WAL writer open", async (t) => {
  let sqlite: typeof import("node:sqlite");
  try {
    sqlite = await import("node:sqlite");
  } catch {
    t.skip("node:sqlite is unavailable");
    return;
  }
  const root = mkdtempSync(join(tmpdir(), "vectiscode-opencode-"));
  const path = join(root, "opencode.db");
  const writer = new sqlite.DatabaseSync(path);
  t.after(() => {
    writer.close();
    rmSync(root, { recursive: true, force: true });
  });
  writer.exec(`
    PRAGMA journal_mode = WAL;
    CREATE TABLE session_v2 (id TEXT PRIMARY KEY, parent_id TEXT, directory TEXT);
    CREATE TABLE session_message (id TEXT PRIMARY KEY, session_id TEXT, type TEXT, seq INTEGER, time_created INTEGER, data TEXT);
    INSERT INTO session_v2 VALUES ('main', NULL, '/work/demo'), ('child', 'main', '/work/demo');
  `);
  const insert = writer.prepare("INSERT INTO session_message VALUES (?, ?, ?, ?, ?, ?)");
  const message = (model: string, time: number, cost = 0, agent?: string) => JSON.stringify({
    time: { created: time }, model: { id: model, providerID: "test" }, cost, agent,
    tokens: { input: 1000, output: 50, reasoning: 20, cache: { read: 150_000, write: 2000 } },
  });
  insert.run("old", "main", "assistant", 0, START - DAY, message("gpt-test", START - DAY));
  for (let i = 0; i < 3; i++) insert.run(`main-${i}`, "main", "assistant", i + 1, START + i * 60_000, message(i ? "gpt-test" : "claude-sonnet-5-5", START + i * 60_000, i === 1 ? 0.2 : 0));
  insert.run("helper", "child", "assistant", 0, START + 180_000, message("gpt-test", START + 180_000, 0, "scout"));
  insert.run("compact", "child", "compaction", 1, START + 240_000, message("claude-sonnet-5-5", START + 240_000));
  insert.run("user", "main", "user", 5, START + 300_000, "{}");
  insert.run("broken", "main", "assistant", 6, START + 360_000, "{");
  const data = await readOpenCode(path, START);
  assert.equal(data.requests.length, 5);
  assert.equal(data.requests[0]!.source, "opencode");
  assert.equal(data.requests[0]!.thread, "main");
  assert.equal(data.requests[0]!.agent, "main");
  assert.equal(data.requests[0]!.project, "demo");
  assert.equal(data.requests[0]!.context, 153_000);
  assert.equal(data.requests[0]!.output, 70);
  assert.ok(Math.abs(data.requests[0]!.cost - 0.0377) < 1e-10);
  assert.equal(data.requests[1]!.cost, 0.2);
  assert.equal(data.requests[2]!.cost, 0);
  assert.equal(data.requests[3]!.agent, "scout");
  assert.equal(data.requests[4]!.agent, "helper");
  assert.deepEqual(data.sessions.get("child")!.compactions, [{ time: START + 240_000, tokens: 153_000 }]);
  const report = analyze(undefined, undefined, START, START + DAY, data);
  assert.equal(report.opencode!.chats, 2);
  assert.equal(report.opencode!.models[0]!.name, "gpt-test");
  assert.equal(report.opencode!.models[0]!.share, 0.6);
  assert.match(render(report, 7), /OpenCode\s+5 requests in 2 chats/);
  assert.match(render(report, 7), /models: gpt-test 60%, claude-sonnet-5-5 40%/);
  assert.match(render(report, 7), /A new OpenCode chat starts at about 153k tokens/);
  assert.match(render(report, 7), /compacted 1 time/);
  const claude: SourceData = { requests: [request(START), request(START + 60_000), request(START + 120_000)], sessions: new Map() };
  assert.deepEqual(analyze(claude, undefined, START).findings.map((f) => [f.id, f.level, f.share]), analyze(claude, undefined, START, START + DAY, data).findings.map((f) => [f.id, f.level, f.share]));
  const comparison = compare(undefined, undefined, START + 120_000, START, START + DAY, data);
  assert.equal(comparison.before.opencode!.context, 153_000);
  assert.equal(comparison.after.opencode!.past150k, 1);
  assert.match(renderComparison(comparison), /OpenCode/);
  assert.equal(recentChanges(comparison).length, 2);
  writer.exec("BEGIN IMMEDIATE");
  insert.run("pending", "main", "assistant", 7, START + 400_000, message("gpt-test", START + 400_000));
  assert.equal((await readOpenCode(path, START)).requests.length, 5);
  writer.exec("ROLLBACK");
  insert.run("no-tokens", "main", "assistant", 8, START + 500_000, "{}");
  assert.equal((await readOpenCode(path, START)).requests.length, 6);
  assert.equal((await readOpenCode(join(root, "missing.db"), 0)).requests.length, 0);
});

test("CLI remembers checks, compares enough history and leaves JSON and compare state alone", (t) => {
  const root = mkdtempSync(join(tmpdir(), "vectiscode-state-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const logs = join(root, "logs");
  mkdirSync(join(logs, "projects", "demo"), { recursive: true });
  const now = Date.now();
  const times = [now - 4 * DAY, now - 2 * DAY, now - 2 * DAY + 3_600_000, now - 2 * DAY + 2 * 3_600_000];
  writeFileSync(join(logs, "projects", "demo", "chat.jsonl"), times.map((time, i) => JSON.stringify({
    type: "assistant", requestId: `r${i}`, timestamp: new Date(time).toISOString(), cwd: "/work/demo",
    message: { model: "claude-sonnet-5-5", usage: { input_tokens: 0, cache_read_input_tokens: i ? 50_000 : 200_000, output_tokens: 10 }, content: [] },
  })).join("\n"));
  const home = join(root, "state");
  const state = join(home, "state.json");
  const run = (args: string[], stateHome = home) => execFileSync(process.execPath, [fileURLToPath(new URL("./cli.js", import.meta.url)), ...args, "--claude-dir", logs, "--codex-dir", logs, "--opencode-dir", logs], {
    encoding: "utf8", env: { ...process.env, VECTISCODE_HOME: stateHome, NO_COLOR: "1" },
  });
  const first = run(["--days", "3"]);
  assert.match(first, /Saved today's date/);
  assert.doesNotMatch(first, /SINCE YOUR LAST CHECK/);
  assert.ok(JSON.parse(readFileSync(state, "utf8")).lastCheck >= now);
  assert.equal(JSON.parse(readFileSync(state, "utf8")).version, JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")).version);
  const seed = () => writeFileSync(state, JSON.stringify({ lastCheck: now - 3 * DAY, version: "0.0.0" }));
  seed();
  const prior = readFileSync(state, "utf8");
  const json = JSON.parse(run(["--days", "3", "--json"]));
  assert.equal(json.claude.requests, 3);
  assert.ok(json.findings.every((f: { action: string }) => f.action));
  assert.equal(readFileSync(state, "utf8"), prior);
  assert.match(run(["compare", new Date(now - 3 * DAY).toISOString()]), /units per request/);
  assert.equal(readFileSync(state, "utf8"), prior);
  const next = run(["--days", "3"]);
  assert.match(next, /SINCE YOUR LAST CHECK/);
  assert.match(next, /units per request/);
  assert.match(next, /3 requests in 1 chats/);
  assert.match(next, /Next check:/);
  assert.doesNotMatch(run(["--days", "3"]), /SINCE YOUR LAST CHECK/);
  seed();
  const shortWindow = run(["--days", "1"]);
  assert.match(shortWindow, /SINCE YOUR LAST CHECK/);
  assert.match(shortWindow, /No Claude Code, Codex or OpenCode logs/);
  writeFileSync(state, JSON.stringify({ lastCheck: now - 2 * DAY + 3_600_000 }));
  assert.doesNotMatch(run(["--days", "3"]), /SINCE YOUR LAST CHECK/);
  writeFileSync(state, "not json");
  assert.match(run(["--days", "3"]), /Saved today's date/);
  writeFileSync(state, JSON.stringify({ lastCheck: now + DAY }));
  assert.match(run(["--days", "3"]), /Saved today's date/);
  const badHome = join(root, "file");
  writeFileSync(badHome, "read-only state location");
  assert.match(run(["--days", "3"], badHome), /Claude Code/);
  const untouched = join(root, "untouched");
  run(["--json"], untouched);
  assert.equal(existsSync(untouched), false);
});
