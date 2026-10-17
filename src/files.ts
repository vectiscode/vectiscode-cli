import { createReadStream, readdirSync, statSync } from "node:fs";
import { basename, join } from "node:path";
import { createInterface } from "node:readline";

/** Every .jsonl log under `dir` changed since `since`, oldest first, so forks lose to the chat they copied. */
export function jsonlFiles(dir: string, since: number): string[] {
  let names: string[];
  try {
    names = readdirSync(dir, { recursive: true, encoding: "utf8" });
  } catch {
    return [];
  }
  return names
    .filter((n) => n.endsWith(".jsonl") && basename(n) !== "journal.jsonl")
    .map((n) => ({ path: join(dir, n), stat: statSync(join(dir, n)) }))
    .filter((f) => f.stat.mtimeMs >= since)
    .sort((a, b) => a.stat.birthtimeMs - b.stat.birthtimeMs)
    .map((f) => f.path);
}

/** Parses only the lines `keep` accepts, which skips most of a multi-gigabyte log unparsed. */
export async function* readLines(path: string, keep: (line: string) => boolean): AsyncGenerator<any> {
  const lines = createInterface({ input: createReadStream(path, { encoding: "utf8" }), crlfDelay: Infinity });
  for await (const line of lines) {
    if (!keep(line)) continue;
    try {
      yield JSON.parse(line);
    } catch {
      // a line still being written
    }
  }
}
