#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { loadEnv } from "./load-env.mjs";

loadEnv();

const backupDirectory = process.argv.slice(2).find((argument) => !argument.startsWith("--"));
const targetUrl = process.env.RESTORE_DATABASE_URL ?? "";
const confirmedTarget = process.env.RESTORE_CONFIRM_TARGET === "disposable";

function databaseEnvironment(connectionString) {
  const url = new URL(connectionString);
  return {
    PGHOST: url.hostname,
    PGPORT: url.port || "5432",
    PGDATABASE: decodeURIComponent(url.pathname.replace(/^\//, "")),
    PGUSER: decodeURIComponent(url.username),
    PGPASSWORD: decodeURIComponent(url.password),
    PGSSLMODE: url.searchParams.get("sslmode") || "require"
  };
}

function main() {
  if (!backupDirectory) throw new Error("Usage: node scripts/supabase-restore-verify.mjs <backup-directory>");
  const directory = resolve(backupDirectory);
  const archive = resolve(directory, "database.dump");
  const manifestPath = resolve(directory, "manifest.json");
  if (!existsSync(archive) || !existsSync(manifestPath)) throw new Error("Backup directory is missing database.dump or manifest.json.");
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  if (!manifest.createdAt || !manifest.databaseArchive) throw new Error("Backup manifest is invalid.");

  const list = spawnSync("pg_restore", ["--list", archive], { encoding: "utf8", shell: process.platform === "win32" });
  if (list.status !== 0) throw new Error(`Archive validation failed: ${(list.stderr || "unknown error").trim()}`);
  console.log("PASS archive structure is readable");

  if (!targetUrl) {
    console.log("SKIP database restore because RESTORE_DATABASE_URL is not set");
    return;
  }
  if (!confirmedTarget) throw new Error("Set RESTORE_CONFIRM_TARGET=disposable before restoring into the target database.");
  const restore = spawnSync("pg_restore", ["--clean", "--if-exists", "--no-owner", "--no-privileges", "--exit-on-error", archive], {
    env: { ...process.env, ...databaseEnvironment(targetUrl) },
    encoding: "utf8",
    shell: process.platform === "win32"
  });
  if (restore.status !== 0) throw new Error(`Restore failed: ${(restore.stderr || restore.stdout || "unknown error").trim()}`);
  console.log("PASS database archive restored into the disposable target");
}

try {
  main();
} catch (error) {
  console.error(`FAIL ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}
