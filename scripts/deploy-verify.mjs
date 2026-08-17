#!/usr/bin/env node
/**
 * deploy-verify.mjs - Mandatory deploy verification for AI agents.
 *
 * Chains: typecheck -> build -> test -> deploy
 *
 * Usage:
 *   node scripts/deploy-verify.mjs            # deploy both api + web
 *   node scripts/deploy-verify.mjs api        # deploy api only
 *   node scripts/deploy-verify.mjs web        # deploy web only
 *   node scripts/deploy-verify.mjs --check    # run checks only, skip deploy
 *
 * Exit code 0 = all passed. Non-zero = failed at the step shown.
 * AI agents MUST run this script before ending any turn that touched code.
 */
import { execFileSync, execSync } from "node:child_process";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const scriptPath = fileURLToPath(import.meta.url);
const root = resolve(dirname(scriptPath), "..");

const args = process.argv.slice(2);
const mode = args[0] || "both";
const checkOnly = args.includes("--check");

const STEPS = {
  both: ["typecheck", "check:emdash", "check:attribution", "build", "audit:bundle", "audit:dependencies", "test", "verify:connector", "audit:bridge", "test:visual", "deploy:api", "deploy:web", "deploy:health"],
  api: ["typecheck:api", "build:api", "audit:dependencies", "test", "deploy:api", "deploy:health"],
  web: ["typecheck:web", "build:web", "audit:bundle", "audit:dependencies", "test:visual", "deploy:web", "deploy:health"],
  check: ["typecheck", "check:emdash", "check:attribution", "build", "audit:bundle", "audit:dependencies", "test", "verify:connector", "audit:bridge", "test:visual"],
};

const steps = checkOnly ? STEPS.check : (STEPS[mode] || STEPS.both);

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

const PASS = "\x1b[32mPASS\x1b[0m";
const FAIL = "\x1b[31mFAIL\x1b[0m";
const SKIP = "\x1b[33mSKIP\x1b[0m";
const BOLD = "\x1b[1m";
const DIM = "\x1b[2m";

function run(cmd, label) {
  const start = performance.now();
  process.stdout.write(`  ${BOLD}${label}${DIM} ... `);
  try {
    execFileSync(cmd.bin, cmd.args, {
      cwd: root,
      stdio: "pipe",
      env: { ...process.env, CI: "true" },
    });
    const ms = Math.round(performance.now() - start);
    console.log(`${PASS} (${ms}ms)`);
    return true;
  } catch (err) {
    const ms = Math.round(performance.now() - start);
    console.log(`${FAIL} (${ms}ms)`);
    if (err.stdout?.length) {
      const out = err.stdout.toString().trim();
      if (out) console.log(`\n${DIM}${out.split("\n").slice(-15).join("\n")}${DIM}`);
    }
    if (err.stderr?.length) {
      const errOut = err.stderr.toString().trim();
      if (errOut) console.log(`\n${DIM}${errOut.split("\n").slice(-15).join("\n")}${DIM}`);
    }
    return false;
  }
}

function npmRun(script) {
  return npmCommand(["run", script, "--workspaces", "--if-present"]);
}

function npmRunW(workspace, script) {
  return npmCommand(["run", script, "-w", workspace]);
}

function npmCommand(args) {
  if (process.platform === "win32") {
    return { bin: "cmd.exe", args: ["/d", "/s", "/c", "npm", ...args] };
  }
  return { bin: "npm", args };
}

function stepCommand(step) {
  switch (step) {
    case "typecheck":
      return npmCommand(["run", "typecheck"]);
    case "typecheck:api":
      return npmRunW("apps/api", "typecheck");
    case "typecheck:web":
      return npmRunW("apps/web", "typecheck");
    case "check:emdash":
      return npmCommand(["run", "check:emdash"]);
    case "check:attribution":
      return npmCommand(["run", "check:attribution"]);
    case "build":
      return npmCommand(["run", "build"]);
    case "build:api":
      return npmRunW("apps/api", "build");
    case "build:web":
      return npmRunW("apps/web", "build");
    case "test":
      return npmCommand(["run", "test", "--", "--run"]);
    case "audit:bundle":
      return npmCommand(["run", "audit:bundle"]);
    case "audit:dependencies":
      return npmCommand(["run", "audit:dependencies"]);
    case "verify:connector":
      return npmCommand(["run", "verify:connector"]);
    case "audit:bridge":
      return npmCommand(["run", "audit:bridge"]);
    case "test:visual":
      return npmCommand(["run", "test:visual"]);
    case "deploy:api":
      return npmCommand(["run", "deploy:api"]);
    case "deploy:web":
      return npmCommand(["run", "deploy:web"]);
    case "deploy:health":
      return npmCommand(["run", "deploy:health"]);
    default:
      return null;
  }
}

/* ------------------------------------------------------------------ */
/*  Git State & Safety Verification                                    */
/* ------------------------------------------------------------------ */

const secretRules = [
  { name: "Stripe Secret Key", pattern: /sk_(live|test)_[0-9a-zA-Z]{24,}/ },
  { name: "GitHub Personal Access Token", pattern: /ghp_[0-9a-zA-Z]{36}/ },
  { name: "Google/Firebase API Key", pattern: /AIzaSy[0-9a-zA-Z-_]{33}/ },
  { name: "Generic Secret/Key Assignment", pattern: /(apiKey|api_key|client_secret|clientSecret|secretKey|secret_key|private_key|privateKey|password)\s*[:=]\s*["'](?![a-zA-Z0-9_\-\.\/]+(?:@|\.))([0-9a-zA-Z-_/+]{16,})["']/i },
  { name: "Hugging Face Token", pattern: /hf_[0-9a-zA-Z]{34,}/ },
  { name: "Roblox Open Cloud Key", pattern: /roblox-open-cloud-ke[y]/i }
];

function screenDiffForSecrets(diffLabel, diff) {
  const flagged = new Map();
  for (const line of diff.split("\n")) {
    if (!line.startsWith("+") || line.startsWith("+++")) continue;
    for (const rule of secretRules) {
      if (rule.pattern.test(line)) {
        flagged.set(rule.name, (flagged.get(rule.name) ?? 0) + 1);
      }
    }
  }

  if (flagged.size === 0) {
    console.log(`  ${PASS} Secret screening passed for ${diffLabel}.`);
    return true;
  }

  console.log(`\n  ${FAIL} ${BOLD}Possible secret leak detected in ${diffLabel}:${DIM}`);
  for (const [ruleName, count] of flagged.entries()) {
    console.log(`    - ${ruleName}: ${count} matching added line${count === 1 ? "" : "s"}`);
  }
  console.log("\n  Aborting deploy. Inspect the diff locally before retrying.");
  return false;
}

function verifyGitStateForDeploy() {
  console.log(`\n${BOLD}=== Git State & Safety Verification ===${DIM}\n`);

  let statusOutput = "";
  try {
    statusOutput = execSync("git status --porcelain", { cwd: root, encoding: "utf8" }).trim();
  } catch (err) {
    console.log(`  ${FAIL} Failed to check git status: ${err.message}`);
    return false;
  }

  if (statusOutput) {
    console.log(`  ${FAIL} Local changes are present. Commit and push before deploying.`);
    console.log(`${DIM}${statusOutput.split("\n").map(l => "    " + l).join("\n")}${DIM}`);
    return false;
  }

  console.log(`  ${PASS} Working tree is clean.`);

  let headDiff = "";
  try {
    headDiff = execSync("git show --format= --no-ext-diff HEAD", { cwd: root, encoding: "utf8", maxBuffer: 8 * 1024 * 1024 });
  } catch (err) {
    console.log(`  ${FAIL} Failed to read deployed commit diff: ${err.message}`);
    return false;
  }

  if (!screenDiffForSecrets("HEAD", headDiff)) return false;

  let branch = "";
  let upstream = "";
  try {
    branch = execSync("git rev-parse --abbrev-ref HEAD", { cwd: root, encoding: "utf8" }).trim();
    upstream = execSync("git rev-parse --abbrev-ref --symbolic-full-name @{u}", { cwd: root, encoding: "utf8" }).trim();
  } catch (err) {
    console.log(`  ${FAIL} Current branch has no upstream tracking branch: ${err.message}`);
    console.log("  Push the branch and set upstream before deploying.");
    return false;
  }

  try {
    execSync("git fetch --quiet", { cwd: root, stdio: "pipe" });
  } catch (err) {
    console.log(`  ${FAIL} Failed to fetch upstream before deploy: ${err.message}`);
    return false;
  }

  const head = execSync("git rev-parse HEAD", { cwd: root, encoding: "utf8" }).trim();
  const upstreamHead = execSync("git rev-parse @{u}", { cwd: root, encoding: "utf8" }).trim();
  const mergeBase = execSync("git merge-base HEAD @{u}", { cwd: root, encoding: "utf8" }).trim();

  if (head === upstreamHead) {
    console.log(`  ${PASS} ${branch} is synced with ${upstream}.`);
    return verifyGitRemoteUrls();
  }

  if (mergeBase === upstreamHead) {
    console.log(`  ${FAIL} ${branch} has unpushed commits. Push before deploying.`);
    return false;
  }

  if (mergeBase === head) {
    console.log(`  ${FAIL} ${branch} is behind ${upstream}. Pull or rebase before deploying.`);
    return false;
  }

  console.log(`  ${FAIL} ${branch} and ${upstream} have diverged. Resolve git history before deploying.`);
  return false;
}

function verifyGitRemoteUrls() {
  let remotes = "";
  try {
    remotes = execSync("git remote -v", { cwd: root, encoding: "utf8" });
  } catch (err) {
    console.log(`  ${FAIL} Failed to inspect git remotes: ${err.message}`);
    return false;
  }

  const credentialedUrl = /https?:\/\/[^/\s@]+@/i;
  if (credentialedUrl.test(remotes)) {
    console.log(`  ${FAIL} Git remote URL contains embedded credentials. Use a credential helper, environment variable, or authenticated CLI instead.`);
    return false;
  }

  console.log(`  ${PASS} Git remotes do not expose embedded credentials.`);
  return true;
}

/* ------------------------------------------------------------------ */
/*  Main                                                               */
/* ------------------------------------------------------------------ */

console.log(`\n${BOLD}=== Deploy Verify: ${checkOnly ? "checks only" : mode} ===${DIM}\n`);

const results = [];
let gitVerified = false;
for (const step of steps) {
  if (step.startsWith("deploy:") && !checkOnly && !gitVerified) {
    const gitSuccess = verifyGitStateForDeploy();
    if (!gitSuccess) {
      console.log(`\n${FAIL} ${BOLD}Git state verification failed. Aborting deploy.${DIM}`);
      process.exit(1);
    }
    gitVerified = true;
  }

  const cmd = stepCommand(step);
  if (!cmd) {
    console.log(`  ${SKIP} ${step} (unknown step)`);
    results.push({ step, passed: true });
    continue;
  }
  const passed = run(cmd, step);
  results.push({ step, passed });
  if (!passed) {
    console.log(`\n${FAIL} ${BOLD}Failed at: ${step}${DIM}`);
    console.log(`${DIM}Fix the issue above, then re-run: node scripts/deploy-verify.mjs ${mode}${DIM}\n`);
    process.exit(1);
  }
}

console.log(`\n${PASS} ${BOLD}All steps passed.${checkOnly ? " Ready to deploy." : " Deployed."}${DIM}\n`);
process.exit(0);
