import { day, pct, units, type Finding, type Report } from "./checks.js";

const useColor = process.stdout.isTTY && !process.env.NO_COLOR;
const paint = (code: string) => (s: string) => (useColor ? `\x1b[${code}m${s}\x1b[0m` : s);
export const bold = paint("1");
export const dim = paint("2");
export const green = paint("32");
export const red = paint("31");
const LEVEL: Record<Finding["level"], (s: string) => string> = { high: paint("31"), medium: paint("33"), low: paint("36"), ok: paint("32") };

const WIDTH = Math.min(process.stdout.columns || 100, 100);
const PAD = 13;

export function render(report: Report, days: number | null, check?: { date?: number; rows: string[] }): string {
  const out: string[] = [];
  const range = days ? `last ${days} ${days === 1 ? "day" : "days"}` : `since ${day(report.since)}`;
  out.push("", `${bold("vectiscode")} ${dim(`usage doctor · ${range}`)}`, "");
  if (check?.rows.length) out.push(bold(`SINCE YOUR LAST CHECK (${day(check.date!)})`), ...check.rows, "");

  const c = report.claude;
  if (c) {
    out.push(row("Claude Code", `${units(c.units)} units over ${c.requests.toLocaleString("en-US")} requests in ${c.chats} chats`));
    out.push(row("", `re-reading the chat ${pct(c.split.read)} · writing to cache ${pct(c.split.write)} · output ${pct(c.split.output)} · new input ${pct(c.split.input)}`));
    out.push(row("", `by project: ${c.projects.map((p) => `${p.name} ${pct(p.share)}`).join(", ")}`));
  }
  const x = report.codex;
  if (x) {
    const plan = x.limits.find((l) => l.plan)?.plan;
    out.push(row("Codex", `${x.turns.toLocaleString("en-US")} turns in ${x.chats} chats${plan ? ` · ${plan} plan` : ""}`));
    out.push(row("", `re-reading the chat ${pct(x.split.read)} · new input ${pct(x.split.input)} · output ${pct(x.split.output)} ${dim("(estimated)")}`));
    const limits = [...x.limits].sort((a, b) => b.windowMinutes - a.windowMinutes || a.limit.localeCompare(b.limit));
    const text = limits.map((l) => `${l.limit === "codex" ? "" : `${l.limit} `}${windowName(l.windowMinutes)} ${l.used}%${l.used ? ` used, resets ${when(l.resetsAt)}` : ""}`);
    if (text.length) out.push(row("", `latest reading: ${text.join(" · ")}`));
    if (x.severalAccounts) out.push(row("", dim("You use more than one ChatGPT account. The reading above is from the one used last; each account's chats are counted against its own limit.")));
    if (x.topChats.length) out.push(row("", `biggest chats: ${x.topChats.map((s) => `${s.project} (${day(s.start)}) ${Math.round(s.points)}%`).join(", ")} of a weekly limit`));
  }
  const o = report.opencode;
  if (o) {
    out.push(row("OpenCode", `${o.requests.toLocaleString("en-US")} requests in ${o.chats} chats${o.units ? ` · ${units(o.units)} units` : ""}`));
    out.push(row("", `models: ${o.models.map((m) => `${m.name} ${pct(m.share)}`).join(", ")}`));
    if (o.split) out.push(row("", `re-reading the chat ${pct(o.split.read)} · writing to cache ${pct(o.split.write)} · output ${pct(o.split.output)} · new input ${pct(o.split.input)} ${dim("(models with known API prices)")}`));
  }
  if (!c && !x && !o) out.push("No Claude Code, Codex or OpenCode logs found in that time.");

  const problems = report.findings.filter((f) => f.level !== "ok");
  const fine = report.findings.filter((f) => f.level === "ok");
  const actions = problems.slice(0, 3).map((f, i) => ({
    text: `${i + 1}. ${f.action}`,
    share: f.id === "long-chats" && c ? `saves about ${pct(f.share)}` : `${pct(f.share)} of ${f.id === "long-chats" && !c ? "Codex" : "Claude"} usage`,
  }));
  if (actions.length) {
    out.push("", bold("WHAT TO DO FIRST"));
    const left = Math.max(...actions.map((a) => a.text.length));
    const right = Math.max(...actions.map((a) => a.share.length));
    for (const a of actions) out.push(left + 2 + right <= WIDTH ? `${a.text.padEnd(left)}  ${a.share}` : `${wrap(a.text, 3, "")}\n   ${a.share}`);
  }
  if (c || o?.units) out.push("", dim(wrap("Units are API-equivalent dollars, used to weigh tokens against each other. They are not your bill.", 0)));
  if (problems.length) out.push("", bold("FINDINGS"));
  for (const f of problems) {
    out.push("", `${LEVEL[f.level](`● ${f.level.toUpperCase().padEnd(6)}`)} ${bold(f.title)}`);
    for (const fact of f.facts) out.push(wrap(fact, 9));
    out.push(wrap(`${bold("Fix:")} ${f.fix}`, 9));
  }
  if (fine.length) {
    out.push("", bold("LOOKS FINE"), "");
    for (const f of fine) {
      out.push(`${LEVEL.ok("✓")} ${f.title} ${dim(`(${pct(f.share)})`)}`);
      for (const fact of f.facts.filter((s) => s.startsWith("OpenCode:") || s.startsWith("A new OpenCode"))) out.push(wrap(fact, 9));
    }
  }
  if (check) out.push("", dim(check.date === undefined
    ? "Saved today's date. Run vectiscode again after a few days of work to see what changed."
    : "Next check: run it again in a few days to see what changed."));
  out.push("");
  return out.join("\n");
}

function row(label: string, text: string): string {
  return wrap(text, PAD, label ? bold(label.padEnd(PAD)) : " ".repeat(PAD));
}

/** Word-wraps `text` to the terminal width with a hanging indent. */
function wrap(text: string, indent: number, first = " ".repeat(indent)): string {
  const lines: string[] = [];
  let line = "";
  // Keep dates like "Oct 16" on one line.
  for (const word of text.replace(/\b([A-Z][a-z]{2}) (\d)/g, "$1 $2").split(" ")) {
    if (line && visible(line).length + 1 + visible(word).length > WIDTH - indent) {
      lines.push(line);
      line = word;
    } else line = line ? `${line} ${word}` : word;
  }
  lines.push(line);
  return lines.map((l, i) => (i ? " ".repeat(indent) : first) + l.replaceAll(" ", " ")).join("\n");
}

const visible = (s: string) => s.replace(/\x1b\[\d+m/g, "");

function windowName(minutes: number): string {
  if (minutes === 10_080) return "weekly limit";
  if (minutes % 60 === 0) return `${minutes / 60}-hour limit`;
  return `${minutes}-minute limit`;
}

function when(t: number): string {
  return new Date(t).toLocaleString("en-US", { weekday: "short", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false });
}
