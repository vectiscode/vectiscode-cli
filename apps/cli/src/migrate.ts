import { existsSync } from "node:fs";

import { configPath, migrateOpencodeConfig } from "@vectiscode/core";

import { output } from "./output.js";

export function runMigrateOpencode(): void {
  const result = migrateOpencodeConfig(process.cwd());
  if (result.created && result.source) {
    output.success(`Migrated ${result.source} to ${result.created}`);
    if (existsSync(configPath())) {
      output.line(`Existing global config preserved at ${configPath()}`);
    }
    return;
  }
  if (existsSync("vectiscode.jsonc") || existsSync("vectiscode.json") || existsSync(".vectiscode/config.json")) {
    output.line("VectisCode config already exists, nothing to migrate");
    return;
  }
  output.line("No compatible opencode config found to migrate");
}
