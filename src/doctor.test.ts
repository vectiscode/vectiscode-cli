import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { analyze } from "./checks.js";
import { readClaude } from "./claude.js";
import { limitDeltas, readCodex, severalAccounts } from "./codex.js";
import { projectName } from "./model.js";

const START = Date.UTC(2026, 9, 1, 10, 0);
const at = (min: number) => new Date(START + min * 60_000).toISOString();
const jsonl = (rows: object[]) => rows.map((r) => JSON.stringify(r)).join("\n") + "\n";

const usage = (read: number, write1h: number, output = 100) => ({
  input_tokens: 5,
  cache_read_input_tokens: read,
  cache_creation_input_tokens: write1h,
  cache_creation: { ephemeral_1h_input_tokens: write1h, ephemeral_5m_input_tokens: 0 },
  output_tokens: output,
});

const assistant = (requestId: string, min: number, u: object, content: object[] = [{ type: "text", text: "ok" }], extra = {}) => ({
  type: "assistant",
  requestId,
  timestamp: at(min),
  cwd: "C:\\work\\demo",
  message: { id: `m-${requestId}`, model: "claude-opus-5-5", usage: u, content },
  ...extra,
});

function claudeLogs(): string {
  const root = mkdtempSync(join(tmpdir(), "vectiscode-claude-"));
  const dir = join(root, "projects", "C--work-demo");
  mkdirSync(join(dir, "s1", "subagents"), { recursive: true });
  writeFileSync(
    join(dir, "s1.jsonl"),
    jsonl([
      { type: "attachment", timestamp: at(-1), attachment: { type: "instructions" }, rendered: [{ content: "x".repeat(3500) }] },
      { type: "user", timestamp: at(-1), message: { content: "hello" } },
      {
        type: "api-request-shape",
        timestamp: at(0),
        shape: { system: [{ type: "text", text: "s".repeat(3400) }], tools: [{ name: "Read" }, { name: "Unused", description: "d".repeat(3100) }] },
      },
      assistant("r1", 0, usage(0, 60_000, 50)),
      assistant("r1", 0, usage(0, 60_000, 250), [{ type: "tool_use", name: "Read" }]),
      assistant("r2", 5, usage(60_000, 100_000)),
      assistant("r3", 6, usage(160_000, 1_000)),
      { type: "system", subtype: "compact_boundary", timestamp: at(7), compactMetadata: { preTokens: 161_000 } },
      { type: "system", subtype: "compact_boundary", timestamp: at(7), compactMetadata: { preTokens: 161_000 } },
      assistant("r4", 150, usage(0, 50_000)),
      assistant("r5", 151, usage(50_000, 1_000)),
      { type: "assistant", requestId: "r6", timestamp: at(152), message: { model: "<synthetic>", usage: usage(0, 0, 0), content: [] } },
    ]),
  );
  writeFileSync(join(dir, "s1", "subagents", "agent-1.jsonl"), jsonl([assistant("h1", 10, usage(0, 30_000), undefined, { isSidechain: true })]));
  writeFileSync(join(dir, "s1", "subagents", "agent-1.meta.json"), JSON.stringify({ agentType: "scout" }));
  return root;
}

const RESET = Date.UTC(2026, 9, 5) / 1000;
const tokenCount = (min: number, total: number, input: number, used: number, resetsAt = RESET) => ({
  type: "event_msg",
  timestamp: at(min),
  payload: {
    type: "token_count",
    info: { total_token_usage: { total_tokens: total }, last_token_usage: { input_tokens: input, cached_input_tokens: input / 2, output_tokens: 10 } },
    rate_limits: {
      limit_id: "codex",
      plan_type: "plus",
      primary: { used_percent: 1, window_minutes: 300, resets_at: resetsAt },
      secondary: { used_percent: used, window_minutes: 10_080, resets_at: resetsAt },
    },
  },
});

function codexLogs(): string {
  const root = mkdtempSync(join(tmpdir(), "vectiscode-codex-"));
  const dir = join(root, "sessions", "2026", "10", "01");
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, "rollout-a.jsonl"),
    jsonl([
      { type: "session_meta", timestamp: at(0), payload: { id: "c1", cwd: "C:\\work\\demo" } },
      { type: "turn_context", timestamp: at(0), payload: { model: "gpt-test" } },
      tokenCount(1, 1_000, 1_000, 10),
      tokenCount(2, 1_000, 1_000, 10), // same running total: not a new turn
      tokenCount(3, 201_000, 200_000, 14, RESET + 60), // same window, reset time reported a minute off
      tokenCount(4, 202_000, 1_000, 12), // an older, lower reading from a parallel chat
      tokenCount(5, 203_000, 1_000, 15),
      tokenCount(6, 204_000, 1_000, 2, RESET + 3 * 86_400), // a second account's window
      tokenCount(7, 205_000, 1_000, 15), // back on the first account
    ]),
  );
  return root;
}

const SINCE = Date.UTC(2026, 9, 1);

test("reads Claude Code logs: one request per API call, helpers, compactions, setup", async () => {
  const { requests, sessions } = await readClaude(claudeLogs(), 0);
  assert.deepEqual(requests.map((r) => r.id), ["r1", "r2", "r3", "h1", "r4", "r5"]);
  const r1 = requests[0]!;
  assert.equal(r1.output, 250);
  assert.equal(r1.context, 60_005);
  assert.equal(r1.project, "demo");
  assert.equal(projectName("/Users/me/game/.claude/worktrees/fix-ui", "x"), "game");
  assert.equal(projectName("C:\\Users\\me\\game\\", "x"), "game");
  assert.ok(r1.cost > 0);
  assert.equal(requests.find((r) => r.id === "h1")!.agent, "scout");
  const s = sessions.get("s1")!;
  assert.equal(s.compactions.length, 1);
  assert.ok(s.toolsCalled.has("Read"));
  assert.deepEqual(s.tools!.map((t) => t.name), ["Read", "Unused"]);
  assert.equal(s.setup!.get("instructions"), 3500);
  assert.equal(s.setup!.get("first-message"), 5);
});

test("finds long chats, a cold cache rewrite, the setup and unused tools", async () => {
  const report = analyze(await readClaude(claudeLogs(), 0), undefined, SINCE);
  const ids = Object.fromEntries(report.findings.map((f) => [f.id, f]));
  assert.ok(ids["long-chats"]!.share > 0);
  assert.match(ids["cache-breaks"]!.facts[0]!, /^1 time /);
  assert.match(ids["always-on"]!.facts.join(" "), /CLAUDE\.md and rules 1k/);
  assert.match(ids["always-on"]!.facts.join(" "), /Unused \(1k\)/);
  assert.equal(report.claude!.chats, 1);
});

test("reads Codex logs: skips repeated totals and counts each limit window from its peak", async () => {
  const codex = await readCodex(codexLogs(), 0);
  assert.equal(codex.requests.length, 6);
  assert.equal(codex.requests[1]!.context, 200_000);
  assert.equal(codex.requests[1]!.cacheRead, 100_000);
  const deltas = [...limitDeltas(codex.limits, 10_080, SINCE).values()];
  assert.deepEqual(deltas, [0, 0, 4, 0, 1, 2, 0]);
  assert.equal(severalAccounts(codex.limits, 10_080), true);
  assert.equal(severalAccounts(codex.limits.slice(0, 10), 10_080), false);
  const report = analyze(undefined, codex, SINCE, SINCE);
  assert.equal(report.codex!.topChats[0]!.points, 7);
  assert.match(report.findings.find((f) => f.id === "long-chats")!.facts[0]!, /^Codex: 57% /);
});
