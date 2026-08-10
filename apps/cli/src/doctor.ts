import { existsSync } from "node:fs";

import {
  configPath,
  credentialVault,
  dataDirectory,
  diagnoseKeychain,
  listLegacyCredentialFiles,
  loadConfig,
  migrateLegacyCredentials
} from "@vectiscode/core";
import { createProviderRegistry } from "@vectiscode/providers";
import { studioMcp } from "@vectiscode/roblox";

import { output } from "./output.js";

export async function runDoctor(options: { migrateCredentials?: boolean } = {}): Promise<boolean> {
  const config = loadConfig();
  const registry = createProviderRegistry(credentialVault);
  const keychain = await diagnoseKeychain();
  const legacyFiles = listLegacyCredentialFiles();

  output.line("\nVectisCode doctor\n");
  output.line(`Config       ${configPath()}${existsSync(configPath()) ? "" : " (not created)"}`);
  output.line(`Data         ${dataDirectory()}`);
  output.line(`Runtime      Node ${process.version} on ${process.platform}/${process.arch}`);
  output.line(`Provider     ${config.provider}/${config.model}`);
  output.line(`Permissions  ${config.permissionMode}`);
  output.line(`Keychain     ${keychain.available ? keychain.backend : "unavailable"} - ${keychain.detail}`);
  output.line(`Legacy keys  ${legacyFiles.length ? `${legacyFiles.length} plaintext file(s) require migration` : "none detected"}`);

  if (options.migrateCredentials) {
    if (!keychain.available) throw new Error("Cannot migrate credentials until the OS keychain is available");
    const migrated = await migrateLegacyCredentials();
    output.success(`Migrated and removed ${migrated.length} legacy credential file(s): ${migrated.join(", ") || "none"}`);
  }

  output.line("\nProviders");
  for (const provider of registry.list()) {
    const validation = await provider.validate().catch((error: unknown) => ({ ok: false, detail: error instanceof Error ? error.message : String(error) }));
    output.line(`  ${provider.id.padEnd(20)} ${validation.ok ? "ready" : validation.detail ?? "not configured"}`);
  }

  const status = studioMcp.status();
  output.line("\nRoblox Studio MCP");
  output.line(`  ${status.connected ? "connected" : "offline"} - ${status.detail}`);
  output.line(`  launcher: ${status.command}`);
  output.line(`  tools: ${status.toolCount}`);
  output.line(`\nProject      ${process.cwd()}\n`);
  return keychain.available && legacyFiles.length === 0;
}
