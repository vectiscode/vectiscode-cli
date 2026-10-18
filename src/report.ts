import { day, pct, units, type Finding, type Report } from "./checks.js";

const useColor = process.stdout.isTTY && !process.env.NO_COLOR;
const paint = (code: string) => (s: string) => (useColor ? `\x1b[${code}m${s}\x1b[0m` : s);
const bold = paint("1");
const dim = paint("2");
const LEVEL: Record<Finding["level"], (s: string) => string> = { high: paint("31"), medium: paint("33"), low: paint("36"), ok: paint("32") };

const WIDTH = Math.min(process.stdout.columns || 100, 100);
const PAD = 13;

export function render(report: Report, days: number | null): string {
  const out: string[] = [];
  const range = days ? `last ${days} ${days === 1 ? "day" : "days"}` : `since ${day(report.since)}`;
  out.push("", `${bold("vectiscode")} ${dim(`usage doctor · ${range}`)}`, "");

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
    const limits = [...x.limits].sort((a, b) => b.windowMinutes - a.windowMinutes || a.limit.localeCompare(b.limit));
    const text = limits.map((l) => `${l.limit === "codex" ? "" : `${l.limit} `}${windowName(l.windowMinutes)} ${l.used}%${l.used ? ` used, resets ${when(l.resetsAt)}` : ""}`);
    if (text.length) out.push(row("", `latest reading: ${text.join(" · ")}`));
    if (x.severalAccounts) out.push(row("", dim("You use more than one ChatGPT account. The reading above is from the one used last; each account's chats are counted against its own limit.")));
    if (x.topChats.length) out.push(row("", `biggest chats: ${x.topChats.map((s) => `${s.project} (${day(s.start)}) ${Math.round(s.points)}%`).join(", ")} of a weekly limit`));
  }
  if (!c && !x) return `${out.join("\n")}No Claude Code or Codex logs found in that time.\n`;
  if (c) out.push("", dim(wrap("Units are API-equivalent dollars, used to weigh tokens against each other. They are not your bill.", 0)));

  const problems = report.findings.filter((f) => f.level !== "ok");
  const fine = report.findings.filter((f) => f.level === "ok");
  if (problems.length) out.push("", bold("FINDINGS"));
  for (const f of problems) {
    out.push("", `${LEVEL[f.level](`● ${f.level.toUpperCase().padEnd(6)}`)} ${bold(f.title)}`);
    for (const fact of f.facts) out.push(wrap(fact, 9));
    out.push(wrap(`${bold("Fix:")} ${f.fix}`, 9));
  }
  if (fine.length) {
    out.push("", bold("LOOKS FINE"), "");
    for (const f of fine) out.push(`${LEVEL.ok("✓")} ${f.title} ${dim(`(${pct(f.share)})`)}`);
  }
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
  for (const word of text.split(" ")) {
    if (line && visible(line).length + 1 + visible(word).length > WIDTH - indent) {
      lines.push(line);
      line = word;
    } else line = line ? `${line} ${word}` : word;
  }
  lines.push(line);
  return lines.map((l, i) => (i ? " ".repeat(indent) : first) + l).join("\n");
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
