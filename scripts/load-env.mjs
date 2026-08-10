#!/usr/bin/env node
/**
 * load-env.mjs - Source .env into process.env without external deps.
 *
 * Usage: `import { loadEnv } from "./load-env.mjs"; loadEnv();`
 *
 * - Looks for .env in the project root and walks upward
 * - Skips blank lines and lines starting with #
 * - Respects ${VAR} interpolation from existing env
 * - Idempotent; safe to call multiple times
 * - Does NOT overwrite existing process.env entries (use override: true to force)
 */

import { existsSync, readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

function findEnv(startDir) {
  let dir = startDir;
  for (let i = 0; i < 6; i++) {
    const candidate = resolve(dir, ".env");
    if (existsSync(candidate)) return candidate;
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
  return null;
}

function interpolate(value) {
  return value.replace(/\$\{([A-Z0-9_]+)\}/gi, (_, name) => {
    return process.env[name] ?? "";
  });
}

export function loadEnv({ override = false, quiet = false } = {}) {
  const scriptPath = fileURLToPath(import.meta.url);
  const startDir = process.cwd();
  const file = findEnv(startDir);
  if (!file) {
    if (!quiet) console.warn("[load-env] no .env found");
    return false;
  }

  const text = readFileSync(file, "utf8");
  let count = 0;
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith("\"") && value.endsWith("\"")) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    value = interpolate(value);
    if (!override && process.env[key] !== undefined) continue;
    process.env[key] = value;
    count++;
  }
  if (!quiet) console.log(`[load-env] loaded ${count} var(s) from ${file}`);
  return true;
}

if (import.meta.url === `file:///${process.argv[1]?.replace(/\\/g, "/")}`) {
  loadEnv();
}
