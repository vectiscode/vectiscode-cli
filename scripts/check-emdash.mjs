#!/usr/bin/env node
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const roots = ["apps/cli", "apps/site", "packages", "scripts"];
const extensions = new Set([".ts", ".tsx", ".js", ".mjs", ".md", ".json"]);
let found = false;

function walk(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name === "dist" || entry.name === ".git") continue;
    const path = join(dir, entry.name);
    if (entry.isDirectory()) walk(path);
    else if ([...extensions].some((ext) => path.endsWith(ext))) {
      const content = readFileSync(path, "utf8");
      if (content.includes("\u2014")) {
        console.error(`em dash found in ${path}`);
        found = true;
      }
    }
  }
}

for (const root of roots) {
  try {
    if (statSync(root).isDirectory()) walk(root);
  } catch {}
}
for (const file of ["AGENTS.md", "UPSTREAM.md", "THIRD_PARTY_NOTICES.md", "README.md"]) {
  try {
    const content = readFileSync(file, "utf8");
    if (content.includes("\u2014")) {
      console.error(`em dash found in ${file}`);
      found = true;
    }
  } catch {}
}

if (found) {
  console.error("em dash scan failed: replace with - or :");
  process.exit(1);
}
console.log("em dash scan passed");
