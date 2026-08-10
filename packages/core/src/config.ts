import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { z } from "zod";

import type { PermissionMode } from "./types.js";

const providerProfileSchema = z.object({
  label: z.string().min(1).max(80).optional(),
  baseUrl: z.string().url().optional(),
  model: z.string().min(1).optional()
});

const agentProfileSchema = z.object({
  model: z.string().min(1).optional(),
  permissionMode: z.enum(["plan", "supervised", "auto"]).optional(),
  maxToolRounds: z.number().int().min(1).max(50).optional()
});

const permissionRuleSchema = z.object({
  pattern: z.string().min(1),
  action: z.enum(["allow", "ask", "deny"]),
  scope: z.enum(["tool", "path", "argument"]).optional()
});

const mcpServerSchema = z.object({
  command: z.string().min(1),
  args: z.array(z.string()).optional(),
  env: z.record(z.string(), z.string()).optional()
});

const configSchema = z.object({
  version: z.literal(1).default(1),
  provider: z.string().min(1).default("openai"),
  model: z.string().min(1).default("gpt-4o-mini"),
  permissionMode: z.enum(["plan", "supervised", "auto"]).default("supervised"),
  studioAutoConnect: z.boolean().default(true),
  providers: z.record(z.string(), providerProfileSchema).default({}),
  agents: z.record(z.string(), agentProfileSchema).optional().default({}),
  permissions: z.array(permissionRuleSchema).optional().default([]),
  mcp: z.record(z.string(), mcpServerSchema).optional().default({}),
  commands: z.record(z.string(), z.string()).optional().default({}),
  skills: z.array(z.string()).optional().default([]),
  instructions: z.array(z.string()).optional().default([]),
  compaction: z.object({ thresholdTokens: z.number().int().optional(), keepTurns: z.number().int().optional() }).optional(),
  snapshots: z.object({ enabled: z.boolean().optional(), maxCount: z.number().int().optional() }).optional(),
  lsp: z.record(z.string(), z.object({ enabled: z.boolean().optional(), command: z.string().optional() })).optional().default({}),
  formatters: z.record(z.string(), z.object({ command: z.string(), args: z.array(z.string()).optional() })).optional().default({}),
  roblox: z.object({
    studioAutoConnect: z.boolean().optional(),
    playtestTimeoutMs: z.number().int().optional(),
    visualQa: z.boolean().optional()
  }).optional()
});

export type VectisConfig = z.infer<typeof configSchema>;

function stripJsoncComments(source: string): string {
  let result = "";
  let inString = false;
  let escaped = false;
  let inSingleLineComment = false;
  let inMultiLineComment = false;
  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];
    const next = source[index + 1];
    if (inSingleLineComment) {
      if (char === "\n") {
        inSingleLineComment = false;
        result += char;
      }
      continue;
    }
    if (inMultiLineComment) {
      if (char === "*" && next === "/") {
        inMultiLineComment = false;
        index += 1;
      }
      continue;
    }
    if (inString) {
      result += char;
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"' ) {
      inString = true;
      result += char;
      continue;
    }
    if (char === "/" && next === "/") {
      inSingleLineComment = true;
      index += 1;
      continue;
    }
    if (char === "/" && next === "*") {
      inMultiLineComment = true;
      index += 1;
      continue;
    }
    result += char;
  }
  return result;
}

function parseJsoncFile(path: string): unknown | null {
  if (!existsSync(path)) return null;
  try {
    const raw = readFileSync(path, "utf8");
    return JSON.parse(stripJsoncComments(raw));
  } catch {
    return null;
  }
}

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

export function vectisConfigPaths(cwd = process.cwd()): string[] {
  const globalDir = configDirectory();
  return [
    join(resolve(cwd), "vectiscode.jsonc"),
    join(resolve(cwd), "vectiscode.json"),
    join(resolve(cwd), ".vectiscode", "config.jsonc"),
    join(resolve(cwd), ".vectiscode", "config.json"),
    join(globalDir, "vectiscode.jsonc"),
    join(globalDir, "config.jsonc"),
    join(globalDir, "config.json")
  ];
}

export function opencodeCompatPaths(cwd = process.cwd()): string[] {
  return [
    join(resolve(cwd), "opencode.jsonc"),
    join(resolve(cwd), "opencode.json"),
    join(resolve(cwd), ".opencode", "config.json"),
    join(configDirectory().replace("VectisCode", "opencode").replace("vectiscode", "opencode"), "opencode.jsonc"),
    join(configDirectory().replace("VectisCode", "opencode").replace("vectiscode", "opencode"), "opencode.json")
  ];
}

function mergeConfig(base: VectisConfig, override: unknown): VectisConfig {
  if (!override || typeof override !== "object") return base;
  const parsed = configSchema.safeParse({ ...base, ...(override as Record<string, unknown>) });
  if (!parsed.success) return base;
  return parsed.data;
}

export function loadConfig(cwd = process.cwd()): VectisConfig {
  const envOverride: Record<string, unknown> = {};
  if (process.env.VECTISCODE_PROVIDER) envOverride.provider = process.env.VECTISCODE_PROVIDER;
  if (process.env.VECTISCODE_MODEL) envOverride.model = process.env.VECTISCODE_MODEL;
  if (process.env.VECTISCODE_PERMISSION_MODE) envOverride.permissionMode = process.env.VECTISCODE_PERMISSION_MODE;

  let config = configSchema.parse({});

  for (const path of [...opencodeCompatPaths(cwd)].reverse()) {
    const data = parseJsoncFile(path);
    if (data) config = mergeConfig(config, data);
  }
  for (const path of [...vectisConfigPaths(cwd)].reverse()) {
    const data = parseJsoncFile(path);
    if (data) config = mergeConfig(config, data);
  }
  if (Object.keys(envOverride).length) {
    config = mergeConfig(config, envOverride);
  }
  return config;
}

export function loadConfigFromPath(path: string): VectisConfig | null {
  const data = parseJsoncFile(path);
  if (!data) return null;
  const parsed = configSchema.safeParse(data);
  return parsed.success ? parsed.data : null;
}

export function saveConfig(config: VectisConfig): void {
  const parsed = configSchema.parse(config);
  const path = configPath();
  mkdirSync(dirname(path), { recursive: true });
  const temporaryPath = `${path}.${process.pid}.tmp`;
  writeFileSync(temporaryPath, `${JSON.stringify(parsed, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  renameSync(temporaryPath, path);
}

export function saveVectisJsonc(config: VectisConfig, cwd = process.cwd()): string {
  const path = join(resolve(cwd), "vectiscode.jsonc");
  const parsed = configSchema.parse(config);
  mkdirSync(dirname(path), { recursive: true });
  const temporaryPath = `${path}.${process.pid}.tmp`;
  writeFileSync(temporaryPath, `${JSON.stringify(parsed, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  renameSync(temporaryPath, path);
  return path;
}

export function migrateOpencodeConfig(cwd = process.cwd()): { created: string | null; source: string | null } {
  const vectisPaths = vectisConfigPaths(cwd).slice(0, 4);
  const hasVectis = vectisPaths.some((path) => existsSync(path)) || existsSync(configPath());
  if (hasVectis) return { created: null, source: null };
  for (const source of opencodeCompatPaths(cwd)) {
    const data = parseJsoncFile(source);
    if (!data) continue;
    const parsed = configSchema.safeParse(data);
    if (!parsed.success) continue;
    const target = join(resolve(cwd), "vectiscode.jsonc");
    if (existsSync(target)) return { created: null, source };
    mkdirSync(dirname(target), { recursive: true });
    const backupPath = join(configDirectory(), `config.backup.${Date.now()}.json`);
    try {
      if (existsSync(configPath())) {
        mkdirSync(dirname(backupPath), { recursive: true });
        writeFileSync(backupPath, readFileSync(configPath(), "utf8"), "utf8");
      }
    } catch {
      // backup is best effort
    }
    writeFileSync(target, `${JSON.stringify(parsed.data, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
    return { created: target, source };
  }
  return { created: null, source: null };
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
