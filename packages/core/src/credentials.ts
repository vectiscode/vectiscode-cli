import { existsSync, readdirSync, readFileSync, unlinkSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const SERVICE = "vectiscode";

const environmentAliases: Record<string, string[]> = {
  openai: ["OPENAI_API_KEY"],
  anthropic: ["ANTHROPIC_API_KEY"],
  google: ["GOOGLE_API_KEY", "GEMINI_API_KEY"],
  openrouter: ["OPENROUTER_API_KEY"],
  "openai-compatible": ["OPENAI_COMPATIBLE_API_KEY"]
};

export class KeychainUnavailableError extends Error {
  constructor(detail: string) {
    super(`OS keychain is unavailable. VectisCode will not write API keys to disk. ${detail}`);
    this.name = "KeychainUnavailableError";
  }
}

async function keyringModule(): Promise<typeof import("@napi-rs/keyring")> {
  try {
    return await import("@napi-rs/keyring");
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new KeychainUnavailableError(detail);
  }
}

function environmentSecret(provider: string): string | null {
  for (const name of environmentAliases[provider] ?? [`${provider.toUpperCase().replace(/[^A-Z0-9]/g, "_")}_API_KEY`]) {
    const value = process.env[name]?.trim();
    if (value) return value;
  }
  return null;
}

export interface CredentialVault {
  get(provider: string): Promise<string | null>;
  set(provider: string, secret: string): Promise<void>;
  delete(provider: string): Promise<void>;
  list(): Promise<string[]>;
}

export class OsCredentialVault implements CredentialVault {
  async get(provider: string): Promise<string | null> {
    const ephemeral = environmentSecret(provider);
    if (ephemeral) return ephemeral;
    const keyring = await keyringModule();
    try {
      return new keyring.Entry(SERVICE, provider).getPassword();
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      if (/no entry|not found/i.test(detail)) return null;
      throw new KeychainUnavailableError(detail);
    }
  }

  async set(provider: string, secret: string): Promise<void> {
    if (!secret.trim()) throw new Error("Credential cannot be empty");
    const keyring = await keyringModule();
    try {
      new keyring.Entry(SERVICE, provider).setPassword(secret.trim());
    } catch (error) {
      throw new KeychainUnavailableError(error instanceof Error ? error.message : String(error));
    }
    const verified = await this.get(provider);
    if (verified !== secret.trim()) throw new KeychainUnavailableError("Keychain round-trip verification failed.");
  }

  async delete(provider: string): Promise<void> {
    const keyring = await keyringModule();
    try {
      new keyring.Entry(SERVICE, provider).deletePassword();
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      if (!/no entry|not found/i.test(detail)) throw new KeychainUnavailableError(detail);
    }
  }

  async list(): Promise<string[]> {
    const keyring = await keyringModule();
    return keyring.findCredentials(SERVICE).map((credential) => credential.account).sort();
  }
}

export function legacyCredentialDirectory(): string {
  if (process.platform === "win32") {
    return join(process.env.APPDATA ?? join(homedir(), "AppData", "Roaming"), "VectisCode", "credentials");
  }
  return join(process.env.XDG_CONFIG_HOME ?? join(homedir(), ".config"), "vectiscode", "credentials");
}

export function listLegacyCredentialFiles(): string[] {
  const directory = legacyCredentialDirectory();
  if (!existsSync(directory)) return [];
  return readdirSync(directory)
    .filter((name) => name.endsWith(".key"))
    .map((name) => join(directory, name));
}

export async function migrateLegacyCredentials(vault: CredentialVault = new OsCredentialVault()): Promise<string[]> {
  const migrated: string[] = [];
  for (const path of listLegacyCredentialFiles()) {
    const provider = path.split(/[\\/]/).pop()?.replace(/\.key$/, "");
    if (!provider) continue;
    const secret = readFileSync(path, "utf8").trim();
    if (!secret) continue;
    await vault.set(provider, secret);
    if ((await vault.get(provider)) !== secret) throw new Error(`Could not verify migrated credential for ${provider}`);
    unlinkSync(path);
    migrated.push(provider);
  }
  return migrated;
}

export async function diagnoseKeychain(): Promise<{ available: boolean; backend: string; detail: string }> {
  const account = `doctor-${process.pid}-${Date.now()}`;
  try {
    const keyring = await keyringModule();
    const entry = new keyring.Entry(SERVICE, account);
    entry.setPassword("vectiscode-keychain-check");
    const ok = entry.getPassword() === "vectiscode-keychain-check";
    entry.deletePassword();
    return {
      available: ok,
      backend: process.platform === "win32" ? "Windows Credential Manager" : process.platform === "darwin" ? "macOS Keychain" : "Linux Secret Service",
      detail: ok ? "Read and write verified" : "Round-trip verification failed"
    };
  } catch (error) {
    return {
      available: false,
      backend: "unavailable",
      detail: error instanceof Error ? error.message : String(error)
    };
  }
}

export const credentialVault = new OsCredentialVault();
