import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { z } from "zod";

import type { PermissionMode } from "./types.js";

const providerProfileSchema = z.object({
  label: z.string().min(1).max(80).optional(),
  baseUrl: z.string().url().optional(),
  model: z.string().min(1).optional()
});

const configSchema = z.object({
  version: z.literal(1).default(1),
  provider: z.string().min(1).default("openai"),
  model: z.string().min(1).default("gpt-4o-mini"),
  permissionMode: z.enum(["plan", "supervised", "auto"]).default("supervised"),
  studioAutoConnect: z.boolean().default(true),
  providers: z.record(z.string(), providerProfileSchema).default({})
});

export type VectisConfig = z.infer<typeof configSchema>;

export function configDirectory(): string {
  if (process.platform === "win32") {
    return join(process.env.APPDATA ?? join(homedir(), "AppData", "Roaming"), "VectisCode");
  }
  return join(process.env.XDG_CONFIG_HOME ?? join(homedir(), ".config"), "vectiscode");
}

export function dataDirectory(): string {
  if (process.platform === "win32") {
    return join(process.env.LOCALAPPDATA ?? join(homedir(), "AppData", "Local"), "VectisCode");
  }
  return join(process.env.XDG_DATA_HOME ?? join(homedir(), ".local", "share"), "vectiscode");
}

export function configPath(): string {
  return join(configDirectory(), "config.json");
}

export function loadConfig(): VectisConfig {
  const path = configPath();
  if (!existsSync(path)) return configSchema.parse({});
  try {
    return configSchema.parse(JSON.parse(readFileSync(path, "utf8")));
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`Invalid VectisCode config at ${path}: ${detail}`);
  }
}

export function saveConfig(config: VectisConfig): void {
  const parsed = configSchema.parse(config);
  const path = configPath();
  mkdirSync(dirname(path), { recursive: true });
  const temporaryPath = `${path}.${process.pid}.tmp`;
  writeFileSync(temporaryPath, `${JSON.stringify(parsed, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  renameSync(temporaryPath, path);
}

export function setConfigValue(key: "provider" | "model" | "permissionMode", value: string): VectisConfig {
  const current = loadConfig();
  if (key === "permissionMode" && !["plan", "supervised", "auto"].includes(value)) {
    throw new Error("permissionMode must be plan, supervised, or auto");
  }
  const next = { ...current, [key]: value } as VectisConfig;
  if (key === "permissionMode") next.permissionMode = value as PermissionMode;
  saveConfig(next);
  return next;
}
