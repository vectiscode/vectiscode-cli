#!/usr/bin/env node
import { readFileSync } from "node:fs";

function requireContains(path, needle, label) {
  try {
    const content = readFileSync(path, "utf8");
    if (!content.includes(needle)) {
      console.error(`${label} missing ${needle} in ${path}`);
      process.exit(1);
    }
  } catch (error) {
    console.error(`Could not read ${path}: ${error.message}`);
    process.exit(1);
  }
}

requireContains("UPSTREAM.md", "a3647eb025", "UPSTREAM version");
requireContains("UPSTREAM.md", "v1.18.16", "UPSTREAM release");
requireContains("THIRD_PARTY_NOTICES.md", "OpenCode", "attribution");
requireContains("THIRD_PARTY_NOTICES.md", "MIT License", "license");
console.log("attribution check passed");
