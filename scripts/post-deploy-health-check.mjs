#!/usr/bin/env node
/**
 * post-deploy-health-check.mjs - Verify the API + web after a deploy.
 *
 * Polls:
 *   https://api.vectiscode.com/health       (immediate)
 *   https://api.vectiscode.com/readiness    (must return ok: true)
 *   https://vectiscode.com                  (200 + CSP header check)
 *
 * Exits non-zero if any check fails. Useful as a post-deploy gate so
 * a broken deploy can be detected without a human in the loop.
 *
 * Configurable via env:
 *   HEALTH_API_URL  (default https://api.vectiscode.com)
 *   HEALTH_WEB_URL  (default https://vectiscode.com)
 *   HEALTH_TIMEOUT_MS (default 15000 per request)
 *   HEALTH_POLL_ATTEMPTS (default 12, 5s apart, ~60s)
 */
import { execFileSync } from "node:child_process";
import { loadEnv } from "./load-env.mjs";
loadEnv();

function localGitSha() {
  try {
    return execFileSync("git", ["rev-parse", "HEAD"], {
      cwd: process.cwd(),
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"]
    }).trim();
  } catch {
    return "";
  }
}

const API = process.env.HEALTH_API_URL || "https://api.vectiscode.com";
const WEB = process.env.HEALTH_WEB_URL || "https://vectiscode.com";
const TIMEOUT_MS = Number(process.env.HEALTH_TIMEOUT_MS || 15000);
const ATTEMPTS = Number(process.env.HEALTH_POLL_ATTEMPTS || 45);
const POLL_MS = Number(process.env.HEALTH_POLL_INTERVAL_MS || 5000);
const EXPECTED_SHA = process.env.HEALTH_EXPECTED_SHA || process.env.GITHUB_SHA || localGitSha();

const PASS = "\x1b[32mPASS\x1b[0m";
const FAIL = "\x1b[31mFAIL\x1b[0m";
const BOLD = "\x1b[1m";
const DIM = "\x1b[2m";

function fetchWithTimeout(url, opts = {}) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), TIMEOUT_MS);
  return fetch(url, { ...opts, signal: ctl.signal }).finally(() => clearTimeout(t));
}

async function checkReadiness() {
  let lastError = null;
  for (let i = 1; i <= ATTEMPTS; i++) {
    try {
      const r = await fetchWithTimeout(`${API}/readiness`);
      if (r.ok) {
        const body = await r.json();
        if (body?.ok === true) {
          return { passed: true, attempt: i, body };
        }
        lastError = new Error(`readiness not ok: ${JSON.stringify(body)}`);
      } else {
        lastError = new Error(`readiness status ${r.status}`);
      }
    } catch (err) {
      lastError = err;
    }
    if (i < ATTEMPTS) await new Promise(r => setTimeout(r, POLL_MS));
  }
  return { passed: false, error: lastError?.message || "unknown" };
}

function hasDirectiveValue(csp, directiveName, value) {
  const directives = csp.split(";").map(d => d.trim().split(/\s+/));
  const target = directives.find(d => d[0] && d[0].toLowerCase() === directiveName.toLowerCase());
  if (!target) {
    if (directiveName.toLowerCase() !== "default-src") {
      const defaultSrc = directives.find(d => d[0] && d[0].toLowerCase() === "default-src");
      return defaultSrc ? defaultSrc.includes(value) : false;
    }
    return false;
  }
  return target.includes(value);
}

async function checkWebCsp() {
  try {
    const r = await fetchWithTimeout(WEB);
    if (!r.ok) return { passed: false, error: `homepage status ${r.status}` };
    const csp = r.headers.get("content-security-policy") || "";
    const noInline = !hasDirectiveValue(csp, "script-src", "'unsafe-inline'");
    const noEval = !hasDirectiveValue(csp, "script-src", "'unsafe-eval'");
    return {
      passed: r.ok && noInline && noEval,
      csp,
      noInline,
      noEval
    };
  } catch (err) {
    return { passed: false, error: err.message };
  }
}

async function main() {
  console.log(`\n${BOLD}=== Post-deploy health check ===${DIM}\n`);

  const results = [];

  process.stdout.write(`  ${BOLD}api.health${DIM} ... `);
  let healthPassed = false;
  let lastHealthError = "";
  for (let i = 1; i <= ATTEMPTS; i++) {
    try {
      const r = await fetchWithTimeout(`${API}/health`);
      if (r.ok) {
        const body = await r.json();
        const releaseSha = String(body?.release?.sha ?? "");
        const shaMatches = !EXPECTED_SHA || (
          Boolean(releaseSha) && (
            releaseSha.startsWith(EXPECTED_SHA.slice(0, 12)) ||
            EXPECTED_SHA.startsWith(releaseSha.slice(0, 12))
          )
        );
        if (body?.ok === true && shaMatches) {
          healthPassed = true;
          console.log(`${PASS} (attempt ${i}, sha=${releaseSha.slice(0, 12)})`);
          break;
        }
        lastHealthError = `sha mismatch: expected ${EXPECTED_SHA.slice(0, 12)}, got ${releaseSha.slice(0, 12) || "missing"}`;
      } else {
        lastHealthError = `status ${r.status}`;
      }
    } catch (err) {
      lastHealthError = err.message;
    }
    if (i < ATTEMPTS) {
      await new Promise(r => setTimeout(r, POLL_MS));
    }
  }
  if (!healthPassed) {
    console.log(`${FAIL} ${lastHealthError}`);
  }
  results.push({ name: "api.health", passed: healthPassed });

  process.stdout.write(`  ${BOLD}api.readiness${DIM} ... `);
  const readiness = await checkReadiness();
  if (readiness.passed) {
    console.log(`${PASS} (attempt ${readiness.attempt})`);
  } else {
    console.log(`${FAIL} ${readiness.error}`);
  }
  results.push({ name: "api.readiness", passed: readiness.passed });

  process.stdout.write(`  ${BOLD}web.homepage${DIM} ... `);
  const web = await checkWebCsp();
  if (web.passed) {
    console.log(`${PASS} (no 'unsafe-inline' or 'unsafe-eval')`);
  } else {
    console.log(`${FAIL} ${web.error || "unsafe directive present"}`);
  }
  results.push({ name: "web.homepage", passed: web.passed });

  const allPassed = results.every(r => r.passed);
  console.log(
    `\n${allPassed ? PASS : FAIL} ${BOLD}${allPassed ? "All post-deploy checks passed." : "Some checks failed."}${DIM}\n`
  );
  process.exit(allPassed ? 0 : 1);
}

main();
