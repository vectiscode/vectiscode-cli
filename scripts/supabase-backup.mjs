#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { resolve, relative, sep } from "node:path";
import { createClient } from "@supabase/supabase-js";
import { loadEnv } from "./load-env.mjs";

loadEnv();

const root = resolve(import.meta.dirname, "..");
const checkOnly = process.argv.includes("--check");
const outputRoot = process.env.BACKUP_OUTPUT_DIR ? resolve(process.env.BACKUP_OUTPUT_DIR) : "";
const databaseUrl = process.env.SUPABASE_DB_URL ?? "";
const supabaseUrl = process.env.SUPABASE_URL ?? "";
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
const bucket = process.env.SUPABASE_STORAGE_BUCKET || "vectis-attachments";

function commandAvailable(command) {
  return spawnSync(command, ["--version"], { encoding: "utf8", shell: process.platform === "win32" }).status === 0;
}

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

function assertOutsideRepository(path) {
  const rel = relative(root, path);
  if (!rel || (!rel.startsWith(`..${sep}`) && rel !== "..")) {
    throw new Error("BACKUP_OUTPUT_DIR must be outside the repository.");
  }
}

async function backupStorage(client, destination) {
  let downloaded = 0;
  async function walk(prefix = "") {
    for (let offset = 0; ; offset += 1000) {
      const { data, error } = await client.storage.from(bucket).list(prefix, { limit: 1000, offset, sortBy: { column: "name", order: "asc" } });
      if (error) throw error;
      const entries = data ?? [];
      for (const entry of entries) {
        const objectPath = prefix ? `${prefix}/${entry.name}` : entry.name;
        if (!entry.id) {
          await walk(objectPath);
          continue;
        }
        const { data: blob, error: downloadError } = await client.storage.from(bucket).download(objectPath);
        if (downloadError) throw downloadError;
        const target = resolve(destination, ...objectPath.split("/"));
        mkdirSync(resolve(target, ".."), { recursive: true });
        writeFileSync(target, Buffer.from(await blob.arrayBuffer()));
        downloaded += 1;
      }
      if (entries.length < 1000) break;
    }
  }
  await walk();
  return downloaded;
}

async function main() {
  const checks = {
    pgDump: commandAvailable("pg_dump"),
    pgRestore: commandAvailable("pg_restore"),
    databaseUrl: Boolean(databaseUrl),
    supabaseUrl: Boolean(supabaseUrl),
    serviceKey: Boolean(serviceKey),
    outputDirectory: Boolean(outputRoot)
  };
  for (const [name, passed] of Object.entries(checks)) {
    console.log(`${passed ? "PASS" : "FAIL"} ${name}`);
  }
  if (checkOnly) process.exit(Object.values(checks).every(Boolean) ? 0 : 1);
  if (!Object.values(checks).every(Boolean)) throw new Error("Backup prerequisites are incomplete. Run npm run backup:check.");

  assertOutsideRepository(outputRoot);
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const destination = resolve(outputRoot, `vectis-${stamp}`);
  const storageDestination = resolve(destination, "storage", bucket);
  const databaseArchive = resolve(destination, "database.dump");
  mkdirSync(storageDestination, { recursive: true });

  const dump = spawnSync("pg_dump", ["--format=custom", "--no-owner", "--no-privileges", "--file", databaseArchive], {
    env: { ...process.env, ...databaseEnvironment(databaseUrl) },
    encoding: "utf8",
    shell: process.platform === "win32"
  });
  if (dump.status !== 0) throw new Error(`pg_dump failed: ${(dump.stderr || dump.stdout || "unknown error").trim()}`);

  const archiveCheck = spawnSync("pg_restore", ["--list", databaseArchive], { encoding: "utf8", shell: process.platform === "win32" });
  if (archiveCheck.status !== 0) throw new Error(`Backup archive validation failed: ${(archiveCheck.stderr || "unknown error").trim()}`);

  const client = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const storageObjects = await backupStorage(client, storageDestination);
  writeFileSync(resolve(destination, "manifest.json"), JSON.stringify({
    createdAt: new Date().toISOString(),
    bucket,
    databaseArchive: "database.dump",
    storageObjects
  }, null, 2));
  console.log(`PASS backup created at ${destination}`);
}

main().catch((error) => {
  console.error(`FAIL ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
