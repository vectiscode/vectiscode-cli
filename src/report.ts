import { day, pct, units, type Finding, type Report } from "./checks.js";
import { bold, cells, cyan, dim, green, gutter, magenta, numbers, orange, pad, paint, red, tableHeader, width, wrap, yellow } from "./terminal.js";

const LEVEL: Record<Finding["level"], (s: string) => string> = { high: paint("7;31"), medium: paint("7;33"), low: paint("7;36"), ok: green };
const LABEL = 21;

export function render(report: Report, days: number | null, check?: { date?: number; rows: string[] }): string {
  const out: string[] = [];
  const range = days ? `last ${days} ${days === 1 ? "day" : "days"}` : `since ${day(report.since)}`;
  out.push("", wrap(`${bold("vectiscode")} ${dim(`usage doctor · ${range}`)}`, 2, ""), "");
  if (check?.rows.length) out.push(wrap(bold(`SINCE YOUR LAST CHECK (${day(check.date!)})`)), tableHeader(), ...check.rows, "");

  const c = report.claude;
  if (c) {
    out.push(section("CLAUDE CODE", `${units(c.units)} units · ${c.requests.toLocaleString("en-US")} requests · ${c.chats} chats`));
    out.push(...shares(c.split, orange));
    out.push(detail("projects", c.projects.map((p) => `${p.name} ${pct(p.share)}`).join(" · ")));
    out.push("");
  }
  const x = report.codex;
  if (x) {
    const plan = x.limits.find((l) => l.plan)?.plan;
    out.push(section("CODEX", `${x.turns.toLocaleString("en-US")} turns · ${x.chats} chats${plan ? ` · ${plan[0]!.toUpperCase()}${plan.slice(1)} plan` : ""}`));
    out.push(...shares(x.split, cyan, true));
    const limits = [...x.limits].sort((a, b) => b.windowMinutes - a.windowMinutes || a.limit.localeCompare(b.limit));
    for (const l of limits) {
      const label = `${l.limit === "codex" ? "" : `${l.limit} `}${windowName(l.windowMinutes)}`;
      const color = l.used > 80 ? red : l.used > 50 ? yellow : cyan;
      const text = `${bold(`${l.used}% used`)}${l.used ? dim(` · resets ${when(l.resetsAt)}`) : ""}`;
      // The bar gives way to the reset time on narrow terminals.
      out.push(detail(label, `${bar(l.used / 100, Math.max(4, Math.min(24, width() - LABEL - 4 - cells(text))), color, true)}  ${text}`));
    }
    if (x.topChats.length) out.push(detail("biggest chats", `${x.topChats.map((s) => `${s.project} ${day(s.start)} ${Math.round(s.points)}%`).join(" · ")} of a weekly limit`));
    if (x.severalAccounts) out.push(wrap(dim("You use more than one ChatGPT account. The reading above is from the one used last; each account's chats are counted against its own limit."), 2));
    out.push("");
  }
  const o = report.opencode;
  if (o) {
    out.push(section("OPENCODE", `${o.requests.toLocaleString("en-US")} requests · ${o.chats} chats${o.units ? ` · ${units(o.units)} units` : ""}`));
    out.push(detail("models", o.models.map((m) => `${m.name} ${pct(m.share)}`).join(" · ")));
    if (o.split) {
      out.push(...shares(o.split, magenta));
      out.push(detail("", dim("models with known API prices")));
    }
    out.push("");
  }
  if (!c && !x && !o) out.push(wrap("No Claude Code, Codex or OpenCode logs found in that time."), "");

  const problems = report.findings.filter((f) => f.level !== "ok");
  const fine = report.findings.filter((f) => f.level === "ok");
  if (problems.length) out.push(...actions(problems.slice(0, 3), !!c), "");
  if (c || o?.units) out.push(wrap(dim("Units are API-equivalent dollars, used to weigh tokens against each other. They are not your bill.")), "");
  if (problems.length) out.push(bold("FINDINGS"));
  for (const f of problems) {
    const badge = LEVEL[f.level](` ${f.level.toUpperCase()} `);
    const label = badge.startsWith("\x1b") ? badge : `[${f.level.toUpperCase()}]`;
    out.push("", wrap(bold(f.title), 9, `${pad(label, 8)} `));
    for (const fact of f.facts) out.push(wrap(dim(numbers(fact)), 9));
    out.push(wrap(f.fix, 14, `         ${green(bold("Fix"))}  `));
  }
  if (fine.length) {
    out.push("", bold("LOOKS FINE"), "");
    for (const f of fine) {
      out.push(wrap(`${f.title} ${dim(`(${pct(f.share)})`)}`, 2, `${green("✓")} `));
      for (const fact of f.facts.filter((s) => s.startsWith("OpenCode:") || s.startsWith("A new OpenCode"))) out.push(wrap(dim(numbers(fact)), 9));
    }
  }
  if (check) out.push("", wrap(dim(check.date === undefined
    ? "Saved today's date. Run vectiscode again after a few days of work to see what changed."
    : "Next check: run it again in a few days to see what changed.")));
  out.push("");
  return gutter(out.join("\n"));
}

function section(label: string, text: string): string {
  return wrap(text, 13, bold(label.padEnd(13)));
}

function detail(label: string, text: string): string {
  if (cells(label) > LABEL) return `${wrap(label, 4, "  ")}\n${wrap(text, 4)}`;
  return wrap(text, 2 + LABEL, `  ${label.padEnd(LABEL)}`);
}

const barWidth = (extra = 0) => Math.max(4, Math.min(24, width() - LABEL - 11 - extra));

function shares(split: { read: number; input: number; output: number; write?: number }, color: (s: string) => string, estimated = false): string[] {
  const rows: [string, number][] = [["re-reading the chat", split.read]];
  if (split.write !== undefined) rows.push(["writing to cache", split.write]);
  if (estimated) rows.push(["new input", split.input], ["output", split.output]);
  else rows.push(["output", split.output], ["new input", split.input]);
  return rows.map(([label, share], i) => detail(label, `${bar(share, barWidth(estimated ? 11 : 0), color)}  ${pad(pct(share), 4, true)}${estimated && i === 0 ? dim("  estimated") : ""}`));
}

function bar(share: number, size: number, color: (s: string) => string, track = false): string {
  const eighths = Math.round(Math.min(1, Math.max(0, share)) * size * 8);
  const whole = Math.floor(eighths / 8);
  const part = " ▏▎▍▌▋▊▉"[eighths % 8]!;
  const fill = "█".repeat(whole) + (eighths % 8 ? part : "");
  const rest = Math.max(0, size - cells(fill));
  return color(fill) + (track ? dim("░".repeat(rest)) : " ".repeat(rest));
}

function actions(findings: Finding[], claude: boolean): string[] {
  const size = width();
  const boxed = size >= 50;
  const inside = size - (boxed ? 4 : 0);
  const rows = findings.map((f) => ({ text: f.action, share: f.id === "long-chats" && claude ? `up to ${pct(f.share)}` : pct(f.share) }));
  const right = Math.max(...rows.map((r) => cells(r.share)));
  const left = inside - right - 5;
  const out = [boxed ? dim("╭─ ") + bold("WHAT TO DO FIRST") + dim(` ${"─".repeat(size - 21)}╮`) : bold("WHAT TO DO FIRST")];
  for (const [i, r] of rows.entries()) {
    const lines = wrap(r.text, 0, "", left).split("\n");
    for (const [n, line] of lines.entries()) {
      const content = `${n ? "   " : `${i + 1}  `}${pad(line, left)}  ${n === lines.length - 1 ? bold(pad(r.share, right, true)) : " ".repeat(right)}`;
      out.push(boxed ? `${dim("│")} ${content} ${dim("│")}` : content.trimEnd());
    }
  }
  if (boxed) out.push(dim(`╰${"─".repeat(size - 2)}╯`));
  return out;
}

function windowName(minutes: number): string {
  if (minutes === 10_080) return "weekly limit";
  if (minutes % 60 === 0) return `${minutes / 60}-hour limit`;
  return `${minutes}-minute limit`;
}

function when(t: number): string {
  return new Date(t).toLocaleString("en-US", { weekday: "short", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false });
}
