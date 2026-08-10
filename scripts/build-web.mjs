#!/usr/bin/env node
/**
 * build-web.mjs - Build the web app with the production API/WS URLs and
 * statically prerender the marketing routes so that AI crawlers and search
 * engines see real HTML instead of an empty SPA shell.
 *
 * Reads VITE_API_URL (default: https://api.vectiscode.com),
 * VITE_WS_URL (default: wss://api.vectiscode.com/ws), and
 * VITE_BILLING_CURRENCY from .env.
 *
 * Set PRERENDER=skip to skip the SSG step (useful for fast local builds).
 */
import { spawnSync, execSync } from "node:child_process";
import fs from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { loadEnv } from "./load-env.mjs";

loadEnv();

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const apiUrl = process.env.VITE_API_URL || "https://api.vectiscode.com";
const wsUrl = process.env.VITE_WS_URL || "wss://api.vectiscode.com/ws";
const billingCurrency = process.env.VITE_BILLING_CURRENCY || process.env.STRIPE_PRO_CURRENCY || "usd";

console.log(`[build-web] VITE_API_URL=${apiUrl} VITE_WS_URL=${wsUrl} VITE_BILLING_CURRENCY=${billingCurrency}`);

const viteBuild = spawnSync("npm", ["run", "build", "-w", "apps/web"], {
  cwd: root,
  stdio: "inherit",
  shell: true,
  env: {
    ...process.env,
    VITE_API_URL: apiUrl,
    VITE_WS_URL: wsUrl,
    VITE_BILLING_CURRENCY: billingCurrency
  }
});

if (viteBuild.status !== 0) {
  process.exit(viteBuild.status ?? 1);
}

if (process.env.PRERENDER === "skip") {
  console.log("[build-web] PRERENDER=skip set, skipping SSG step.");
  process.exit(0);
}

console.log("[build-web] running marketing route prerender...");
const prerender = spawnSync("node", ["scripts/prerender-marketing.mjs"], {
  cwd: root,
  stdio: "inherit",
  env: process.env
});

try {
  const sha = (()=>{ try{ return execSync("git rev-parse HEAD",{encoding:"utf8"}).trim(); } catch{ return process.env.GITHUB_SHA || "local"; }})();
  const buildTime = new Date().toISOString();
  const webPackage = JSON.parse(fs.readFileSync(resolve(root,"apps/web/package.json"),"utf8"));
  const cliPackage = JSON.parse(fs.readFileSync(resolve(root,"apps/cli/package.json"),"utf8"));
  const meta = { sha, buildTime, channel: process.env.CF_PAGES_BRANCH || "main", cliVersion: cliPackage.version, release: webPackage.version };
  fs.writeFileSync(resolve(root,"apps/web/dist/build-meta.json"), JSON.stringify(meta,null,2));
  console.log("[build-web] wrote build-meta.json", meta);
} catch(e){ console.warn("[build-web] build-meta failed", e); }
process.exit(prerender.status ?? 1);
