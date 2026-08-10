#!/usr/bin/env node
import { execFileSync } from "node:child_process";

const api = process.env.HEALTH_API_URL || "https://api.vectiscode.com";
const web = process.env.HEALTH_WEB_URL || "https://vectiscode.com";

function localGitSha() {
  try {
    return execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    return "";
  }
}

async function json(url) {
  const response = await fetch(url, { signal: AbortSignal.timeout(20_000) });
  if (!response.ok) throw new Error(`${url} returned ${response.status}`);
  return response.json();
}

async function main() {
  const expectedSha = process.env.HEALTH_EXPECTED_SHA || localGitSha();
  const [health, readiness, authConfig, homepage] = await Promise.all([
    json(`${api}/health`),
    json(`${api}/readiness`),
    json(`${api}/auth/config`),
    fetch(web, { signal: AbortSignal.timeout(20_000) })
  ]);
  const checks = {
    health: health.ok === true,
    releaseIdentity: !expectedSha || String(health.release?.sha ?? "").startsWith(expectedSha.slice(0, 12)),
    readiness: readiness.ok === true && Array.isArray(readiness.checks) && readiness.checks.length === 0,
    productionConfiguration: readiness.ok === true && readiness.checks.length === 0,
    stripe: authConfig.billing?.stripeConfigured === true && authConfig.billing?.proPriceConfigured === true,
    authentication: authConfig.firebaseConfigured === true || authConfig.supabaseConfigured === true,
    homepage: homepage.ok,
    csp: Boolean(homepage.headers.get("content-security-policy"))
  };
  for (const [name, passed] of Object.entries(checks)) console.log(`${passed ? "PASS" : "FAIL"} ${name}`);
  if (!Object.values(checks).every(Boolean)) process.exit(1);
  console.log("PASS production read-only canary completed");
}

main().catch((error) => {
  console.error(`FAIL ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
