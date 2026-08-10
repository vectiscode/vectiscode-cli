#!/usr/bin/env node
/**
 * huggingface-deploy.mjs - Securely deploys the API to Hugging Face Spaces.
 *
 * Pushes a clean, single-commit copy of the API codebase to Hugging Face Space Git repository.
 * Masking is active to ensure the HF_TOKEN never leaks into standard output/error.
 */
import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { loadEnv } from "./load-env.mjs";

loadEnv({ override: true });

const hfToken = process.env.HF_TOKEN;

function maskToken(str) {
  if (!hfToken) return str;
  // Escape token for safety in regular expressions
  const escaped = hfToken.replace(/[-\/\\^$*+?.()|[\]{}]/g, "\\$&");
  return str.replace(new RegExp(escaped, "g"), "HF_TOKEN");
}

async function checkTokenWriteAccess(token) {
  if (!token) return false;
  try {
    const res = await fetch("https://huggingface.co/api/whoami-v2", {
      headers: { Authorization: `Bearer ${token}` }
    });
    if (!res.ok) return false;
    const data = await res.json();
    return data?.auth?.accessToken?.role === "write";
  } catch {
    return false;
  }
}

function copyRecursive(src, dest, excludeList = []) {
  if (excludeList.some(ex => src.endsWith(ex) || path.basename(src) === ex)) return;
  const stats = fs.statSync(src);
  if (stats.isDirectory()) {
    fs.mkdirSync(dest, { recursive: true });
    const files = fs.readdirSync(src);
    for (const file of files) {
      copyRecursive(path.join(src, file), path.join(dest, file), excludeList);
    }
  } else {
    fs.copyFileSync(src, dest);
  }
}

async function main() {
  console.log("Starting Hugging Face Space deploy for Vectis Code API...");
  console.log("Target Space: juicy123/vectiscode");

  const sourceCommit = execSync("git rev-parse HEAD", {
    cwd: process.cwd(),
    encoding: "utf8"
  }).trim();
  if (!/^[0-9a-f]{40}$/i.test(sourceCommit)) {
    throw new Error("Could not determine the source Git commit for deployment.");
  }

  let repoUrl = "https://huggingface.co/spaces/juicy123/vectiscode";
  
  if (hfToken) {
    console.log("Checking HF_TOKEN write permission...");
    const hasWriteAccess = await checkTokenWriteAccess(hfToken);
    if (hasWriteAccess) {
      console.log("HF_TOKEN has write access. Deploying using token...");
      repoUrl = `https://juicy123:${hfToken}@huggingface.co/spaces/juicy123/vectiscode`;
    } else {
      console.log("HF_TOKEN does not have write access (or is read-only).");
      console.log("Falling back to local Git credential manager...");
    }
  } else {
    console.log("No HF_TOKEN found in environment. Using local Git credentials...");
  }

  const tempDir = path.resolve(process.cwd(), "scratch", "hf-deploy-temp");

  try {
    console.log("Creating temporary deployment workspace...");
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
    fs.mkdirSync(tempDir, { recursive: true });

    console.log("Copying required backend files for compilation...");
    
    // Copy root files
    const rootFiles = ["package.json", "package-lock.json", "Dockerfile", ".dockerignore", "README.md"];
    for (const file of rootFiles) {
      if (fs.existsSync(file)) {
        fs.copyFileSync(file, path.join(tempDir, file));
      }
    }
    fs.appendFileSync(
      path.join(tempDir, "Dockerfile"),
      `\nENV SOURCE_COMMIT_SHA=${sourceCommit}\n`,
      "utf8"
    );

    // Copy apps/api (excluding node_modules, dist, data, .log)
    copyRecursive(
      path.resolve(process.cwd(), "apps", "api"),
      path.join(tempDir, "apps", "api"),
      ["node_modules", "dist", "data", ".log"]
    );

    // Copy packages
    copyRecursive(
      path.resolve(process.cwd(), "packages"),
      path.join(tempDir, "packages"),
      ["node_modules", "dist", ".log"]
    );

    // Copy supabase
    copyRecursive(
      path.resolve(process.cwd(), "supabase"),
      path.join(tempDir, "supabase"),
      [".log"]
    );

    // Copy apps/web/package.json
    fs.mkdirSync(path.join(tempDir, "apps", "web"), { recursive: true });
    fs.copyFileSync(
      path.resolve(process.cwd(), "apps", "web", "package.json"),
      path.join(tempDir, "apps", "web", "package.json")
    );

    console.log("Initializing temporary Git repository...");
    execSync("git init", { cwd: tempDir, stdio: "ignore" });
    execSync('git config user.name "Vectis Code Deploy"', { cwd: tempDir, stdio: "ignore" });
    execSync('git config user.email "ardatest4@gmail.com"', { cwd: tempDir, stdio: "ignore" });
    execSync("git add .", { cwd: tempDir, stdio: "ignore" });
    execSync('git commit -m "deploy: Hugging Face Space build"', { cwd: tempDir, stdio: "ignore" });

    console.log(`Executing Git push to Hugging Face Space for source ${sourceCommit.slice(0, 12)}...`);
    execSync(`git push --force "${repoUrl}" HEAD:refs/heads/main`, {
      cwd: tempDir,
      stdio: ["ignore", "pipe", "pipe"],
    });
    console.log("Git push to Hugging Face completed successfully.");
    return 0;
  } catch (err) {
    console.error("Git push failed!");
    if (err.message) {
      console.error(maskToken(err.message));
    }
    if (err.stdout) {
      console.log(maskToken(err.stdout.toString()));
    }
    if (err.stderr) {
      console.error(maskToken(err.stderr.toString()));
    }
    return 1;
  } finally {
    console.log("Cleaning up temporary deployment workspace...");
    try {
      if (fs.existsSync(tempDir)) {
        fs.rmSync(tempDir, { recursive: true, force: true });
      }
    } catch (e) {
      console.error("Error cleaning up temp directory:", e.message);
    }
  }
}

process.exitCode = await main();
