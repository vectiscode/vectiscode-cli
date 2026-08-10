# Upstream Import Record

This file tracks the OpenCode derivation that underpins the VectisCode CLI rebuild. Keep it current whenever upstream-derived code changes.

## Upstream Source

- Project: OpenCode (https://github.com/anomalyco/opencode)
- Release: v1.18.16
- Commit: `a3647eb025c7615159d417dcc49fc39fdaeba65b`
- License: MIT (see THIRD_PARTY_NOTICES.md)
- Release page: https://github.com/anomalyco/opencode/releases/tag/v1.18.16
- Local archive of pre-cutover VectisCode hosted product: `archive/legacy-api-90920c4` at commit `90920c4` (local tag, origin is now `vectiscode-cli`, legacy remote is `legacy-api`)

## Import Scope

The rebuild imports the core CLI architecture from OpenCode and rebrands it for VectisCode with a Roblox specialization. Import is under the MIT license with attribution retained. Upstream license headers remain in derived files.

### Imported subsystems (planned and in progress)

- CLI and command surface (`apps/cli`)
  - Commander wiring, TUI shell, headless `run`, `serve` and `attach` runtime, typed client protocol
- TUI layer
  - OpenTUI plus Solid rendering, Ink compatibility shims, streaming message parts, approval prompts, scrollback, session chrome
- Local server and event protocol
  - Versioned JSON event stream for TUI, headless JSON output, and server clients (message parts, reasoning, tool progress, permission requests, questions, usage, completion, cancellation, structured errors)
- Agent runtime
  - Iterative tool loop, permission gating, retry with provider-aware backoff, cancellation with process tree termination, compaction, branching, resume, fork, export, import, chronological replay
- Configuration and credentials
  - `vectiscode.jsonc` and `.vectiscode/` canonical config, Zod schemas, precedence chain, OpenCode compatibility read (`opencode.json`, `opencode.jsonc`, `.opencode`), `migrate opencode` command, OS keychain vault via `@napi-rs/keyring`
- Session and checkpoint persistence
  - SQLite for sessions, messages, parts, tool states, permissions, checkpoints, usage, branches, compaction summaries; JSONL import for legacy sessions; file checkpoint and Studio mutation receipt chain
- Provider catalog
  - Models.dev plus AI SDK adapters, canonical `provider/model` identifiers, model-scoped capabilities (`ProviderModel`, `ProviderAuth`, `ProviderError`, `ProviderStreamEvent`), SSE parsing, usage normalization, error mapping, offline catalog snapshot and last-known-good cache
- Tools, permissions, and skills
  - File read, write, edit, patch, glob, ripgrep search, shell execution, Git inspection, snapshots, LSP diagnostics, questions, tasks, skills, todo tools; wildcard permission rules with `allow`, `ask`, `deny` plus argument and path matching and approve-once and approve-for-session
- MCP and LSP
  - MCP SDK client for Studio and external MCP servers, tool risk metadata, LSP clients for Luau, Selene, StyLua, Rojo
- Build and distribution
  - Bun workspace, binary compilation, small npm launcher, `bun run verify` gate covering lint, strict typecheck, style checks, tests, builds, dependency audit, license attribution, binary smoke, npm pack, static site tests

### Excluded upstream subsystems

Not imported into this repository. If needed in the future, re-evaluate against product boundaries:

- Desktop applications, hosted sharing, account services, ACP, GitHub PR automation, remote control planes, cloud workspaces, OpenCode web client

## Local Changes on Top of Upstream

VectisCode keeps the imported runtime focused on local-first Roblox work. Local deltas include but are not limited to:

- Full rebrand from OpenCode to VectisCode, including names, identifiers, config files, and marketing copy
- Roblox specialization: Studio MCP stdio transport, discovery, multiple instance selection, persisted session selection, bounded reconnect, risk classification per tool, Studio-aware transactions (capture, propose, apply, read back, receipt), turn-level undo and redo for filesystem and reversible Studio mutations, `studio`, `playtest`, `verify` commands and TUI actions, Visual QA loop (playtest, console, screenshots) with approval-gated input, automatic enablement when `.rbxl`, `.rbxlx`, Luau, Rojo, Aftman, Selene, or StyLua is detected
- Permission posture: `build` defaults to supervised writes, `plan` hard-denies mutations, unknown tools always ask, destructive and non-reversible actions always ask
- Credential policy: OS keychain only, environment overrides without corrupting write verification, no plaintext fallback, redaction from events, logs, sessions, and exports
- Path safety: `resolveWorkspacePath` boundary enforcement, Windows junction and Unix symlink handling, bounded tool output, full process tree termination on cancellation
- Provider policy: verified, catalog-compatible, and experimental tiers, fixture-based protocol validation, opt-in live smoke required before a provider is labeled verified, never switch providers silently on timeout, never scrape prohibited consumer logins (Claude Pro or Max), Meta models only through gateways and supported hosts
- Configuration: precedence chain that honors VectisCode flags, env, project config, global config, then OpenCode compatibility config, then defaults; native `vectiscode.jsonc` and `.vectiscode/` as canonical

All local changes preserve upstream MIT notices and add VectisCode notices where files are modified.

## Preserved Elsewhere, Removed From CLI Repository

The following hosted product surfaces remain at `archive/legacy-api-90920c4` and at remote `legacy-api` and are not present in the CLI runtime:

- Hosted chat (Express API chat handlers), Stripe credit accounting, Firebase and Supabase dependencies for the hosted path, browser account workspace, proprietary Studio polling flows, `packages/contracts` legacy shapes, and their operational deploy scripts

`apps/site` replaces `apps/web` for the CLI era. It contains only static marketing, docs, downloads, privacy, and terms with no account or chat dependencies. The legacy `apps/web` remains in the archived tag.

`apps/api` may remain in this repository during the transition as an isolated optional hosted account and aggregate usage service. It is not in the CLI provider or tool execution path.

## Verification of the Import

- The workspace verification gate is `bun run verify`. `node scripts/deploy-verify.mjs --check` remains as a compatibility wrapper for the same chain
- Acceptance requires all checks green, clean packaged installs, successful alpha migration on copied fixtures, no em dashes in authored surfaces, only essential comments, and no unsupported provider claims
- Live provider and Studio checks are opt-in: missing credentials skip local development but block provider certification for a release

## Maintenance Rules

- Do not remove or obscure upstream license headers from derived files
- Update this file whenever an upstream-derived subsystem is added, modified, or locally delta-patched
- Update `THIRD_PARTY_NOTICES.md` in lockstep with any change to upstream-derived code
- Record the new upstream version and commit whenever the import is rebased or cherry-picked
