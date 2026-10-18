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
    .flatMap((n) => {
      try {
        return [{ path: join(dir, n), stat: statSync(join(dir, n)) }];
      } catch {
        return []; // removed since the listing, or a broken link
      }
    })
    .filter((f) => f.stat.mtimeMs >= since)
    .sort((a, b) => a.stat.birthtimeMs - b.stat.birthtimeMs)
    .map((f) => f.path);
}

/** Parses only the lines `keep` accepts, which skips most of a multi-gigabyte log unparsed. */
export async function* readLines(path: string, keep: (line: string) => boolean): AsyncGenerator<any> {
  const lines = createInterface({ input: createReadStream(path, { encoding: "utf8" }), crlfDelay: Infinity });
  try {
    for await (const line of lines) {
      if (!keep(line)) continue;
      try {
        yield JSON.parse(line);
      } catch {
        // a line still being written
      }
    }
  } catch {
    // A log that is locked or deleted mid-read keeps what was read so far.
  }
}
