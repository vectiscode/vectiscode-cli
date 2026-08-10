#!/usr/bin/env node
/**
 * cloudflare-pages-deploy.mjs - Deploy the built web app to Cloudflare Pages.
 *
 * Reads CLOUDFLARE_EMAIL, CLOUDFLARE_API_KEY, CLOUDFLARE_ACCOUNT_ID,
 * CF_PAGES_PROJECT (default: vectiscode), CF_PAGES_BRANCH (default: main)
 * from .env via scripts/load-env.mjs.
 *
 * Requires apps/web/dist to exist (run `node scripts/build-web.mjs` first).
 */
import { existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { execSync } from "node:child_process";
import { loadEnv } from "./load-env.mjs";

loadEnv();

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const distDir = resolve(root, "apps/web/dist");
if (!existsSync(distDir)) {
  console.error(`Missing build output: ${distDir}. Run "node scripts/build-web.mjs" first.`);
  process.exit(1);
}

const email = process.env.CLOUDFLARE_EMAIL;
const apiKey = process.env.CLOUDFLARE_API_KEY;
const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
const project = process.env.CF_PAGES_PROJECT || "vectiscode";
const branch = process.env.CF_PAGES_BRANCH || "main";

const env = { ...process.env };
if (email) env.CLOUDFLARE_EMAIL = email;
if (apiKey) env.CLOUDFLARE_API_KEY = apiKey;
if (accountId) env.CLOUDFLARE_ACCOUNT_ID = accountId;

if (!email || !apiKey || !accountId) {
  console.warn("CLOUDFLARE_EMAIL, CLOUDFLARE_API_KEY, or CLOUDFLARE_ACCOUNT_ID not fully set in .env. Falling back to authenticated local wrangler session.");
}

console.log(`[cloudflare-pages] deploying ${distDir} to ${project}@${branch}`);
try {
  const localWrangler = resolve(root, "node_modules/.bin/wrangler.cmd");
  const bin = existsSync(localWrangler) ? `"${localWrangler}"` : "npx wrangler";
  const cmd = `${bin} pages deploy "${distDir}" --project-name "${project}" --branch "${branch}" `;
  console.log(`Running: ${cmd}`);
  execSync(cmd, { stdio: "inherit", env });
  process.exit(0);
} catch (error) {
  console.error("Wrangler deployment failed:", error);
  process.exit(1);
}
