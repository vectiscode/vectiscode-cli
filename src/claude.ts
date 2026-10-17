import { readFileSync } from "node:fs";
import { basename, join, sep } from "node:path";
import { jsonlFiles, readLines } from "./files.js";
import { projectName, sessionFor, type Request, type Session, type SourceData } from "./model.js";
import { calibrate, cost, type CostRecord } from "./prices.js";

const NEEDLES = ['"type":"assistant"', '"compact_boundary"', '"api-request-shape"', '"type":"cost-state"'];
// Until a chat's first request, also read what Claude Code put into it.
const SETUP_NEEDLES = ['"type":"attachment"', '"type":"user"'];

/** Reads Claude Code's logs: <root>/projects/<folder>/<session>.jsonl plus <session>/subagents/**.jsonl for helpers. */
export async function readClaude(root: string, since: number): Promise<SourceData> {
  const projects = join(root, "projects");
  const requests = new Map<string, Request>();
  const sessions = new Map<string, Session>();
  const costs: CostRecord[] = [];

  for (const file of jsonlFiles(projects, since)) {
    const parts = file.slice(projects.length + 1).split(sep);
    const folder = parts[0] ?? "";
    const isHelperFile = parts.length > 2;
    const sessionId = isHelperFile ? parts[1]! : basename(file, ".jsonl");
    const helper = isHelperFile ? helperType(file, parts) : null;
    let started = false;
    let costState: any = null;
    const keep = (line: string) =>
      NEEDLES.some((n) => line.includes(n)) || (!started && !helper && SETUP_NEEDLES.some((n) => line.includes(n)));

    for await (const r of readLines(file, keep)) {
      if (r.type === "cost-state") {
        costState = r;
        continue;
      }
      const usage = r.type === "assistant" ? r.message?.usage : undefined;
      const wasStarted = started;
      if (usage) started = true;
      const time = Date.parse(r.timestamp);
      if (!(time >= since)) continue;
      const session = sessionFor(sessions, "claude", sessionId, projectName(r.cwd, folder), time);
      if (r.cwd) session.project = projectName(r.cwd, folder);

      if (r.type === "assistant") {
        const m = r.message ?? {};
        for (const block of Array.isArray(m.content) ? m.content : []) {
          if (block?.type === "tool_use" && block.name) session.toolsCalled.add(block.name);
        }
        if (!usage || m.model === "<synthetic>") continue;
        const id = r.requestId ?? m.id;
        const known = requests.get(id);
        if (known) {
          // Claude Code writes one record per content block, all carrying the same usage.
          known.output = Math.max(known.output, usage.output_tokens ?? 0);
          continue;
        }
        const write = usage.cache_creation_input_tokens ?? 0;
        const write1h = Math.min(write, usage.cache_creation?.ephemeral_1h_input_tokens ?? 0);
        const req: Request = {
          source: "claude",
          id,
          session: sessionId,
          thread: helper ? file : r.isSidechain ? `${sessionId}:side` : sessionId,
          project: session.project,
          time,
          model: m.model ?? "unknown",
          agent: helper ?? (r.isSidechain ? "helper" : "main"),
          input: usage.input_tokens ?? 0,
          cacheRead: usage.cache_read_input_tokens ?? 0,
          cacheWrite5m: write - write1h,
          cacheWrite1h: write1h,
          output: usage.output_tokens ?? 0,
          context: 0,
          cost: 0,
        };
        req.context = req.input + req.cacheRead + write;
        requests.set(id, req);
      } else if (r.type === "system" && r.subtype === "compact_boundary" && !helper) {
        if (!session.compactions.some((c) => c.time === time)) session.compactions.push({ time, tokens: r.compactMetadata?.preTokens ?? 0 });
      } else if (r.type === "api-request-shape" && !helper && r.shape && !session.tools) {
        session.tools = (r.shape.tools ?? []).map((t: any) => ({ name: String(t.name), chars: JSON.stringify(t).length }));
        if (!wasStarted) {
          addSetup(session, "system", JSON.stringify(r.shape.system ?? []).length);
          addSetup(session, "tools", JSON.stringify(r.shape.tools ?? []).length);
        }
      } else if (r.type === "attachment" && !wasStarted) {
        addSetup(session, r.attachment?.type ?? "other", textLength(r.rendered));
      } else if (r.type === "user" && !wasStarted) {
        addSetup(session, "first-message", textLength(r.message?.content));
      }
    }

    for (const [model, u] of Object.entries<any>(costState?.modelUsage ?? {})) {
      costs.push({
        model,
        input: u.inputTokens ?? 0,
        output: u.outputTokens ?? 0,
        read: u.cacheReadInputTokens ?? 0,
        write: u.cacheCreationInputTokens ?? 0,
        searches: u.webSearchRequests ?? 0,
        usd: u.costUSD ?? 0,
      });
    }
  }

  calibrate(costs);
  const list = [...requests.values()].sort((a, b) => a.time - b.time);
  for (const r of list) r.cost = cost(r);
  return { requests: list, sessions };
}

function addSetup(session: Session, part: string, chars: number) {
  session.setup ??= new Map();
  session.setup.set(part, (session.setup.get(part) ?? 0) + chars);
}

/** Characters of text in a message or a rendered attachment: a string, or a list of text blocks. Images don't count. */
function textLength(content: unknown): number {
  if (typeof content === "string") return content.length;
  if (!Array.isArray(content)) return 0;
  let n = 0;
  for (const b of content) n += typeof b?.text === "string" ? b.text.length : typeof b?.content === "string" ? b.content.length : 0;
  return n;
}

const metaCache = new Map<string, string>();

function helperType(file: string, parts: string[]): string {
  if (parts.includes("workflows")) return "workflow";
  let type = metaCache.get(file);
  if (!type) {
    try {
      type = String(JSON.parse(readFileSync(file.replace(/\.jsonl$/, ".meta.json"), "utf8")).agentType || "helper");
    } catch {
      type = "helper";
    }
    metaCache.set(file, type);
  }
  return type;
}
