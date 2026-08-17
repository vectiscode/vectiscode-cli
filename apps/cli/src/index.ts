import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve, join } from "node:path";

import chalk from "chalk";
import { Command } from "commander";

import {
  configPath,
  credentialVault,
  loadConfig,
  migrateOpencodeConfig,
  sessionStore,
  setConfigValue,
  vectisConfigPaths,
  type PermissionMode
} from "@vectiscode/core";
import { createProviderRegistry, providerCatalog } from "@vectiscode/providers";
import { rollbackCheckpoint, studioMcp } from "@vectiscode/roblox";

import { runDoctor } from "./doctor.js";
import { runMigrateOpencode } from "./migrate.js";
import { output } from "./output.js";
import { promptLine, promptSecret } from "./prompt.js";
import { runHeadless } from "./run.js";
import { attachToServer, startServe } from "./serve.js";
import { startTui } from "./tui.js";

const VERSION = "0.1.0-alpha.1";
const program = new Command();

async function runFirstSetup(): Promise<void> {
  const hasConfig = vectisConfigPaths().some((path) => existsSync(path)) || existsSync(configPath());
  if (hasConfig || !process.stdin.isTTY || !process.stdout.isTTY) return;
  output.line("\nWelcome to VectisCode. The CLI works without a Vectis account.\n");
  output.line("Providers: openai (chatgpt), anthropic (claude), google (gemini), groq (meta llama), deepseek, openrouter, ollama, openai-compatible, xai, azure, lmstudio");
  const providerInput = (await promptLine("Provider", "openai")).toLowerCase();
  const registry = createProviderRegistry(credentialVault);
  const provider = registry.get(providerInput);
  const providerId = provider.id;
  let validation: { ok: boolean; detail?: string } = await provider.validate().catch(() => ({ ok: false }));
  if (!validation.ok && !["ollama", "openai-compatible", "lmstudio"].includes(providerId)) {
    const secret = await promptSecret(`${provider.label} API key / token`);
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
  .option("--format <format>", "text or json")
  .option("--provider <provider>", "provider id")
  .option("--model <model>", "model id")
  .option("--mode <mode>", "plan, supervised, or auto")
  .option("--cwd <path>", "project directory")
  .option("--session <id>", "resume a session")
  .action(async (promptParts: string[], options: { json?: boolean; format?: string; provider?: string; model?: string; mode?: PermissionMode; cwd?: string; session?: string }) => {
    const config = loadConfig();
    const mode = options.mode ?? config.permissionMode;
    if (!["plan", "supervised", "auto"].includes(mode)) throw new Error("Mode must be plan, supervised, or auto");
    const json = options.json ?? options.format === "json";
    await runHeadless(promptParts.join(" "), {
      json,
      provider: options.provider ?? config.provider,
      model: options.model ?? config.model,
      mode,
      cwd: resolve(options.cwd ?? process.cwd()),
      sessionId: options.session
    });
  });

program.command("resume")
  .argument("[session]", "session id or prefix")
  .description("Resume a local interactive session (compat alias for session)")
  .action(async (prefix?: string) => {
    const session = prefix ? sessionStore.resolveSession(prefix) : sessionStore.listSessions()[0];
    if (!session) throw new Error("No matching session found");
    await startTui(session.id);
  });

program.command("serve")
  .description("Start local client-server runtime on 127.0.0.1:4097")
  .option("--host <host>", "bind host", "127.0.0.1")
  .option("--port <port>", "bind port", "4097")
  .option("--auth <token>", "auth token for non-loopback access")
  .option("--bind <host>", "alias for --host")
  .action(async (options: { host?: string; port?: string; auth?: string; bind?: string }) => {
    const host = options.bind ?? options.host ?? "127.0.0.1";
    const port = Number(options.port ?? 4097);
    const handle = await startServe({ host, port, authToken: options.auth });
    output.success(`vectiscode serve listening on ${handle.host}:${handle.port}`);
    output.line("Press Ctrl+C to stop");
    await new Promise<void>((resolvePromise) => {
      process.on("SIGINT", () => resolvePromise());
      process.on("SIGTERM", () => resolvePromise());
    });
    await handle.close();
  });

program.command("attach")
  .argument("<url>", "server url, e.g. http://127.0.0.1:4097")
  .option("--auth <token>", "auth token")
  .description("Attach to a running vectiscode serve instance")
  .action(async (url: string, options: { auth?: string }) => {
    const result = await attachToServer(url, options.auth);
    output.line(JSON.stringify(result, null, 2));
  });

const providers = program.command("providers").description("Manage AI providers");
providers.command("list").description("List providers and readiness").action(async () => {
  for (const provider of createProviderRegistry(credentialVault).list()) {
    const entry = providerCatalog.find((catalog) => catalog.id === provider.id);
    const tier = entry ? ` [${entry.tier}]` : "";
    const validation = await provider.validate().catch(() => ({ ok: false }));
    output.line(`${provider.id.padEnd(20)} ${provider.label.padEnd(22)}${tier.padEnd(12)} ${validation.ok ? chalk.green("ready") : chalk.dim("not configured")}`);
  }
});
providers.command("login").argument("<provider>").description("Login to a provider and store credential in OS keychain").action(async (providerInput: string) => {
  const provider = createProviderRegistry(credentialVault).get(providerInput);
  const secret = await promptSecret(`${provider.label} API key / token`);
  await credentialVault.set(provider.id, secret);
  output.success(`Saved ${provider.label} credential in the OS keychain.`);
});
providers.command("logout").argument("<provider>").description("Remove provider credential from OS keychain").action(async (providerInput: string) => {
  const provider = createProviderRegistry(credentialVault).get(providerInput);
  await credentialVault.delete(provider.id);
  output.success(`Removed ${provider.label} credential from the OS keychain.`);
});
providers.command("models").argument("[provider]").description("List models for a provider (compat alias)").action(async (providerId?: string) => {
  const config = loadConfig();
  const provider = createProviderRegistry(credentialVault).get(providerId ?? config.provider);
  try {
    for (const model of await provider.listModels()) output.line(`${model.id}\t${model.label}`);
  } catch {
    const catalogEntry = providerCatalog.find((entry) => entry.id === (providerId ?? config.provider));
    if (catalogEntry) {
      for (const model of catalogEntry.models) output.line(`${model.id}\t${model.label}`);
    } else throw new Error(`No models available for ${provider.id}`);
  }
});

program.command("models")
  .argument("[provider]", "provider id, defaults to current")
  .description("List available models from catalog and live discovery")
  .action(async (providerId?: string) => {
    const config = loadConfig();
    const target = providerId ?? config.provider;
    const registry = createProviderRegistry(credentialVault);
    const provider = registry.get(target);
    output.line(`Catalog for ${target}:`);
    const catalogEntry = providerCatalog.find((entry) => entry.id === target);
    if (catalogEntry) {
      for (const model of catalogEntry.models) output.line(`  ${model.id} - ${model.label} [${catalogEntry.tier}]`);
    }
    try {
      output.line(`\nLive models for ${target}:`);
      for (const model of await provider.listModels()) output.line(`  ${model.id}\t${model.label}`);
    } catch (error) {
      output.line(`Live discovery unavailable: ${error instanceof Error ? error.message : String(error)}`);
    }
  });

const session = program.command("session").description("Manage local sessions");
session.command("list").description("List recent sessions").action(() => {
  const sessions = sessionStore.listSessions().slice(0, 20);
  if (!sessions.length) {
    output.line("No sessions yet");
    return;
  }
  for (const entry of sessions) output.line(`${entry.id.slice(0, 8)}  ${entry.projectName.padEnd(20)} ${entry.provider}/${entry.model}  ${entry.updatedAt}  ${entry.permissionMode}`);
});
session.command("show").argument("<id>", "session id or prefix").description("Show session details").action((id: string) => {
  const found = sessionStore.resolveSession(id) ?? sessionStore.getSession(id);
  if (!found) throw new Error(`Session not found: ${id}`);
  output.line(JSON.stringify(found, null, 2));
  const events = sessionStore.readEvents(found.id);
  output.line(`\nEvents: ${events.length}`);
  for (const event of events.slice(-20)) output.line(`  ${event.seq} ${event.type} ${event.timestamp}`);
});
session.command("export").argument("<id>", "session id or prefix").argument("[file]", "output file").description("Export session events as JSONL").action((id: string, file?: string) => {
  const found = sessionStore.resolveSession(id) ?? sessionStore.getSession(id);
  if (!found) throw new Error(`Session not found: ${id}`);
  const events = sessionStore.readEvents(found.id);
  const payload = events.map((event) => JSON.stringify(event)).join("\n") + "\n";
  const target = file ?? `${found.id}.jsonl`;
  writeFileSync(target, payload, "utf8");
  output.success(`Exported ${events.length} events to ${target}`);
});
session.command("import").argument("<file>", "JSONL file to import").description("Import session events (legacy JSONL)").action((file: string) => {
  const result = sessionStore.importJsonlFile(file);
  output.success(`Imported ${result.count} event(s) for session ${result.sessionId.slice(0, 8)} successfully.`);
});

const mcp = program.command("mcp").description("Manage MCP servers");
mcp.command("list").description("List configured MCP servers and Studio tools").action(async () => {
  const config = loadConfig();
  const servers = Object.entries(config.mcp ?? {});
  if (!servers.length) output.line("No MCP servers configured. Use vectiscode.jsonc mcp section");
  else for (const [name, server] of servers) output.line(`${name}: ${server.command} ${(server.args ?? []).join(" ")}`);
  const status = studioMcp.status();
  output.line(`\nStudio MCP: ${status.connected ? "connected" : "offline"} - ${status.detail} (${status.toolCount} tools)`);
});
mcp.command("status").description("Show MCP status").action(async () => {
  const status = studioMcp.status();
  output.line(JSON.stringify(status, null, 2));
});

const studio = program.command("studio").description("Connect to Roblox Studio MCP");
studio.command("status").description("Show Studio MCP status").action(() => output.line(JSON.stringify(studioMcp.status(), null, 2)));
studio.command("connect").description("Connect to Studio MCP").action(async () => {
  try { output.line(JSON.stringify(await studioMcp.connect(), null, 2)); }
  finally { await studioMcp.close(); }
});
studio.command("list").description("List Studio instances").action(async () => {
  try { await studioMcp.connect(); output.line(JSON.stringify(await studioMcp.listStudios(), null, 2)); }
  finally { await studioMcp.close(); }
});
studio.command("select").argument("<studioId>").description("Select active Studio").action(async (studioId: string) => {
  try { await studioMcp.connect(); output.line(JSON.stringify(await studioMcp.selectStudio(studioId), null, 2)); }
  finally { await studioMcp.close(); }
});

const config = program.command("config").description("Read or update local configuration");
config.command("get").argument("[key]").description("Get config value or full config").action((key?: string) => {
  const current = loadConfig();
  if (!key) output.line(JSON.stringify(current, null, 2));
  else if (key in current) output.line(String(current[key as keyof typeof current]));
  else throw new Error(`Unknown config key: ${key}`);
});
config.command("set").argument("<key>").argument("<value>").description("Set config value").action((key: string, value: string) => {
  if (!["provider", "model", "permissionMode"].includes(key)) throw new Error("Supported keys: provider, model, permissionMode");
  const next = setConfigValue(key as "provider" | "model" | "permissionMode", value);
  output.success(`Saved ${key}=${String(next[key as keyof typeof next])} to ${configPath()}`);
});
config.command("path").description("Show resolved config paths").action(() => {
  output.line(`Primary: ${configPath()}`);
  output.line(`Candidates: ${vectisConfigPaths().join(", ")}`);
});

program.command("migrate")
  .description("Migrate configuration from other tools")
  .command("opencode")
  .description("Copy compatible OpenCode config into VectisCode native files")
  .action(() => runMigrateOpencode());

program.command("doctor").option("--migrate-credentials", "move legacy plaintext keys into the OS keychain and remove the files").description("Diagnose setup and provider health").action(async (options: { migrateCredentials?: boolean }) => {
  await runDoctor(options);
});
program.command("rollback").argument("<checkpoint>").option("--cwd <path>", "project directory").description("Rollback a file checkpoint (compat alias)").action((checkpoint: string, options: { cwd?: string }) => {
  output.success(`Restored ${rollbackCheckpoint(checkpoint, resolve(options.cwd ?? process.cwd())).restored}`);
});
program.command("undo").argument("<checkpoint>").option("--cwd <path>", "project directory").description("Undo a checkpoint").action((checkpoint: string, options: { cwd?: string }) => {
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
