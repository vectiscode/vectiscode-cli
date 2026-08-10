import { existsSync } from "node:fs";
import { resolve } from "node:path";

import chalk from "chalk";
import { Command } from "commander";

import {
  configPath,
  credentialVault,
  loadConfig,
  sessionStore,
  setConfigValue,
  type PermissionMode
} from "@vectiscode/core";
import { createProviderRegistry } from "@vectiscode/providers";
import { rollbackCheckpoint, studioMcp } from "@vectiscode/roblox";

import { runDoctor } from "./doctor.js";
import { output } from "./output.js";
import { promptLine, promptSecret } from "./prompt.js";
import { runHeadless } from "./run.js";
import { startTui } from "./tui.js";

const VERSION = "0.1.0-alpha.0";
const program = new Command();

async function runFirstSetup(): Promise<void> {
  if (existsSync(configPath()) || !process.stdin.isTTY || !process.stdout.isTTY) return;
  output.line("\nWelcome to VectisCode. The CLI works without a Vectis account.\n");
  output.line("Providers: openai, anthropic, google, openrouter, ollama, openai-compatible");
  const providerId = (await promptLine("Provider", "openai")).toLowerCase();
  const registry = createProviderRegistry(credentialVault);
  const provider = registry.get(providerId);
  let validation: { ok: boolean; detail?: string } = await provider.validate().catch(() => ({ ok: false }));
  if (!validation.ok && !["ollama", "openai-compatible"].includes(providerId)) {
    const secret = await promptSecret(`${provider.label} API key`);
    if (!secret) throw new Error("Provider setup cancelled because the API key was empty");
    await credentialVault.set(providerId, secret);
    validation = await provider.validate();
    if (!validation.ok) throw new Error(validation.detail ?? `${provider.label} setup failed`);
  }
  let suggestedModel = loadConfig().model;
  try {
    const models = await provider.listModels();
    if (models.length) {
      suggestedModel = models[0].id;
      output.line(`\nAvailable models (first 8):\n${models.slice(0, 8).map((model) => `  ${model.id}`).join("\n")}`);
    }
  } catch (error) {
    output.line(`\nLive model discovery is unavailable: ${error instanceof Error ? error.message : String(error)}`);
  }
  const model = await promptLine("Model", suggestedModel);
  output.line("\nPermission modes: plan (read-only), supervised (asks before writes), auto (workspace writes). High-risk tools always ask.");
  const permission = await promptLine("Permission mode", "supervised");
  if (!["plan", "supervised", "auto"].includes(permission)) throw new Error("Permission mode must be plan, supervised, or auto");
  setConfigValue("provider", providerId);
  setConfigValue("model", model);
  setConfigValue("permissionMode", permission);
  const studio = studioMcp.status();
  output.line(`\nProject: ${process.cwd()}\nStudio MCP: ${studio.detail}\n`);
}

program.name("vectiscode").description("Local-first Roblox coding agent with native Studio MCP").version(VERSION);

program.command("run")
  .argument("<prompt...>", "agent prompt")
  .option("--json", "emit versioned JSONL events")
  .option("--provider <provider>", "provider id")
  .option("--model <model>", "model id")
  .option("--mode <mode>", "plan, supervised, or auto")
  .option("--cwd <path>", "project directory")
  .option("--session <id>", "resume a session")
  .action(async (promptParts: string[], options: { json?: boolean; provider?: string; model?: string; mode?: PermissionMode; cwd?: string; session?: string }) => {
    const config = loadConfig();
    const mode = options.mode ?? config.permissionMode;
    if (!["plan", "supervised", "auto"].includes(mode)) throw new Error("Mode must be plan, supervised, or auto");
    await runHeadless(promptParts.join(" "), {
      json: options.json,
      provider: options.provider ?? config.provider,
      model: options.model ?? config.model,
      mode,
      cwd: resolve(options.cwd ?? process.cwd()),
      sessionId: options.session
    });
  });

program.command("resume")
  .argument("[session]", "session id or prefix")
  .description("Resume a local interactive session")
  .action(async (prefix?: string) => {
    const session = prefix ? sessionStore.resolveSession(prefix) : sessionStore.listSessions()[0];
    if (!session) throw new Error("No matching session found");
    await startTui(session.id);
  });

const providers = program.command("providers").description("Manage AI providers");
providers.command("list").action(async () => {
  for (const provider of createProviderRegistry(credentialVault).list()) {
    const validation = await provider.validate().catch(() => ({ ok: false }));
    output.line(`${provider.id.padEnd(20)} ${provider.label.padEnd(22)} ${validation.ok ? chalk.green("ready") : chalk.dim("not configured")}`);
  }
});
providers.command("login").argument("<provider>").action(async (provider: string) => {
  createProviderRegistry(credentialVault).get(provider);
  const secret = await promptSecret(`${provider} API key`);
  await credentialVault.set(provider, secret);
  output.success(`Saved ${provider} credential in the OS keychain.`);
});
providers.command("logout").argument("<provider>").action(async (provider: string) => {
  await credentialVault.delete(provider);
  output.success(`Removed ${provider} credential from the OS keychain.`);
});
providers.command("models").argument("[provider]").action(async (providerId?: string) => {
  const config = loadConfig();
  const provider = createProviderRegistry(credentialVault).get(providerId ?? config.provider);
  for (const model of await provider.listModels()) output.line(`${model.id}\t${model.label}`);
});

const studio = program.command("studio").description("Connect to Roblox Studio MCP");
studio.command("status").action(() => output.line(JSON.stringify(studioMcp.status(), null, 2)));
studio.command("connect").action(async () => {
  try { output.line(JSON.stringify(await studioMcp.connect(), null, 2)); }
  finally { await studioMcp.close(); }
});
studio.command("list").action(async () => {
  try { await studioMcp.connect(); output.line(JSON.stringify(await studioMcp.listStudios(), null, 2)); }
  finally { await studioMcp.close(); }
});
studio.command("select").argument("<studioId>").action(async (studioId: string) => {
  try { await studioMcp.connect(); output.line(JSON.stringify(await studioMcp.selectStudio(studioId), null, 2)); }
  finally { await studioMcp.close(); }
});

const config = program.command("config").description("Read or update local configuration");
config.command("get").argument("[key]").action((key?: string) => {
  const current = loadConfig();
  if (!key) output.line(JSON.stringify(current, null, 2));
  else if (key in current) output.line(String(current[key as keyof typeof current]));
  else throw new Error(`Unknown config key: ${key}`);
});
config.command("set").argument("<key>").argument("<value>").action((key: string, value: string) => {
  if (!["provider", "model", "permissionMode"].includes(key)) throw new Error("Supported keys: provider, model, permissionMode");
  const next = setConfigValue(key as "provider" | "model" | "permissionMode", value);
  output.success(`Saved ${key}=${String(next[key as keyof typeof next])} to ${configPath()}`);
});

program.command("doctor").option("--migrate-credentials", "move legacy plaintext keys into the OS keychain and remove the files").action(async (options: { migrateCredentials?: boolean }) => {
  await runDoctor(options);
});
program.command("rollback").argument("<checkpoint>").option("--cwd <path>", "project directory").action((checkpoint: string, options: { cwd?: string }) => {
  output.success(`Restored ${rollbackCheckpoint(checkpoint, resolve(options.cwd ?? process.cwd())).restored}`);
});

program.action(async () => {
  await runFirstSetup();
  await startTui();
});

program.parseAsync(process.argv).catch((error: unknown) => {
  output.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
