# Project Instructions

I maintain this file myself. Every time I learn something about this project, I update it so future sessions start smarter. If I missed something or got something wrong, tell me once and I will fix it here permanently.

## Project Overview

VectisCode is a local-first Roblox coding agent that runs in the terminal and operates Roblox Studio through Studio's documented MCP server.

The CLI is the product. It connects directly to the provider you choose, runs an iterative tool loop, and keeps prompts, responses, code, diffs, tool arguments, and sessions on your machine. An optional hosted account service exists only for convenience features such as connection labels and aggregate usage. It is never in the provider or tool execution path.

Position VectisCode as AI change-set review for Roblox, not file sync. Studio Script Sync commoditized on-disk mirroring. Lead with review before apply, per-patch rollback, Studio-aware transactions, and Visual QA. Do not market no manual copy pasting or external editor angles.

Repository remotes:
- `origin` is `vectiscode-cli`, the canonical CLI repository
- `legacy-api` is `vectiscode-api`, the archived hosted product at `archive/legacy-api-90920c4` (local tag, do not push without release approval)

## Tech Stack (pinned)

See the relevant `package.json` for exact versions. This is the source of truth.

- Bun + TypeScript (strict)
- React + Ink (TUI), OpenTUI + Solid for the rebuilt terminal layer
- AI SDK + Models.dev for provider catalog and adapters
- SQLite for sessions, messages, checkpoints, permissions, and usage (JSONL remains as legacy import source)
- MCP SDK (`@modelcontextprotocol/client`) for Studio and external MCP servers
- LSP clients for Luau, Selene, StyLua, Rojo when installed
- Zod for config and tool schemas
- Sentry for error reporting
- Vitest + Playwright for tests
- Luau (Roblox Studio)

In transition the workspace still builds under Node 20 plus TypeScript while the Bun, OpenTUI, Solid, AI SDK, Models.dev, and SQLite migration lands. Do not add new Node-only provider adapters during the transition. Extend the shared catalog instead.

## Project Structure

- `apps/cli/` - published `vectiscode` package, commander surface, Ink/OpenTUI terminal UI, `serve` and `attach` runtime
- `packages/core/` - agent loop, SQLite session store, configuration, credentials, permissions, events, compaction, branching
- `packages/providers/` - provider registry, Models.dev catalog, AI SDK adapters, capability and error normalization, streaming protocol
- `packages/roblox/` - Studio MCP client, workspace tools, checkpoints, path safety, playtest and visual verification helpers
- `packages/testkit/` - deterministic fake provider, fake tools, fixtures, provider conformance harness
- `packages/contracts/` - shared versioned event and checkpoint contracts
- `packages/tsconfig/` - shared TypeScript base
- `apps/site/` - static marketing, docs, downloads, privacy, terms (converted from `apps/web`, no account or chat dependencies)
- `apps/api/` - optional hosted account and aggregate usage service, isolated from the CLI runtime and not required for local use
- `scripts/` - verification, health, and benchmark scripts
- `.opencode/skills/` - project-specific skills
- `UPSTREAM.md` - OpenCode import version, commit, subsystems, and local deltas
- `THIRD_PARTY_NOTICES.md` - MIT attribution

Legacy hosted product is preserved at local tag `archive/legacy-api-90920c4` (commit `90920c4`) and at remote `legacy-api`. Do not reintroduce hosted chat, Express API, Stripe, Firebase, Supabase credit accounting, or proprietary Studio polling flows into the CLI runtime.

## Canonical Commands

### Verification and build

- `bun run verify` - full release gate: lint, strict typecheck, style checks, tests, builds, dependency audit, license attribution, binary smoke tests, npm pack, static site tests
- `node scripts/deploy-verify.mjs --check` - compatibility wrapper for the same gate
- `npm run typecheck` / `bun run typecheck` - typecheck all workspaces
- `npm run build` / `bun run build` - build contracts, runtime, CLI, and site
- `npm run test` - vitest across core, providers, roblox, cli, api
- `npm run test:visual` - playwright in `apps/site` and `apps/web` during transition
- `npm run pack:cli` - build CLI and produce tarball
- `bun run verify:connector` - Studio MCP roundtrip smoke (recorded plus live opt-in)
- `bun run audit:bridge` - bridge performance baseline
- `npm run smoke:models` / `npm run smoke:thinking` - live provider smoke (opt-in, needs credentials)

### CLI surface

- `vectiscode [project]` - start the TUI in the project directory
- `vectiscode run [message...] --format text|json` - headless execution with versioned JSONL events on `--format json`
- `vectiscode serve` and `vectiscode attach <url>` - local client server split. Standalone servers bind to `127.0.0.1:4097` by default and require explicit auth and bind flags for non loopback access
- `vectiscode providers list|login|logout`, `vectiscode models`, `vectiscode session ...`, `vectiscode mcp ...`, `vectiscode studio ...`, `vectiscode config ...`, `vectiscode doctor`
- Compatibility aliases retained for one alpha release: `resume`, `rollback`, `providers models`
- `vectiscode migrate opencode` - copy compatible OpenCode config into VectisCode native files without modifying the source

### TUI commands

- `/connect`, `/models`, `/new`, `/sessions`, `/agent`, `/permissions`, `/compact`, `/undo`, `/redo`, `/mcp`, `/studio`, `/playtest`, `/verify`, `/help`, `/exit`
- Queued prompts, steering during a turn, cancellation with full child process tree termination, retry with provider aware backoff, bounded tool output, resume, fork, export, import, chronological replay

### Configuration

Canonical config is `vectiscode.jsonc` and `.vectiscode/`:

- Sections: `model`, `providers`, `agents`, `permissions`, `mcp`, `commands`, `skills`, `instructions`, `compaction`, `snapshots`, `lsp`, `formatters`, `roblox`
- Precedence: command flags, environment variables, project VectisCode config, global VectisCode config, compatible OpenCode config, defaults
- Read `opencode.json`, `opencode.jsonc`, and `.opencode` as lowest priority compatibility source. Never modify them

## Efficient Agent Workflow

- Start non-trivial repo work with a quick memory pass, then inspect only the files and symbols needed for the request. Re-verify unstable external facts live instead of re-reading unrelated areas
- Use `rg` to locate symbols and bounded reads for context. Do not dump whole large sources, generated files, or broad search results unless the task needs them
- Decide whether the request is answer only, diagnosis, or implementation before acting. Answer only stays read only. Diagnosis inspects and explains without patching unless a fix is requested
- Keep `gpt-5.6-terra` at Medium for scoped investigation, routine fixes, and coordination. Escalate to a stronger model or higher reasoning only for cross cutting design, ambiguous root causes, security sensitive changes, or repeated failed attempts. Return to the default after the hard subtask
- Prefer the project's existing skills and scripts when their scope matches. Do not build a new helper, repeat discovery, or add dependencies when an established path already provides the evidence
- Batch connected edits. Run focused tests while iterating, then run the full verification gate once after the final code change

## Boundaries

### Always

- Keep TypeScript strict, no explicit `any`. Use `unknown` and narrow. Keep modules small and cohesive
- Use natural human naming and self explanatory code. Comments only for license notices, security invariants, and unavoidable protocol quirks. Do not narrate what the code does
- Preserve import order: external, internal, types
- Use the project logger (`createLogger({ service })`) in API contexts, not `console.log`
- Pin provider behavior with config flags, not hard coded branches
- Use OS keychain for API keys and OAuth token records. Keep only nonsecret labels and provider metadata in configuration. Environment credentials override runtime reads without corrupting keychain write verification
- Define exact risk metadata for every Studio MCP tool. Unknown tools always ask. Script and hierarchy reads are safe, Studio mutations ask in supervised mode, `execute_luau`, user input, asset generation, uploads, and other non reversible actions always ask
- Before reversible script or property mutations, capture affected Studio state, present a readable change set, apply, read back, and store a receipt with Studio ID, tool, risk, reversibility, before and after evidence, verification result, and checkpoint
- Preserve symlink and junction boundaries. Resolve workspace paths through `resolveWorkspacePath` and reject escapes. Terminate complete child process trees on cancellation
- Keep Content Security Policy directives synchronized if a hosted surface exists. Keep Import attribution in `UPSTREAM.md` and `THIRD_PARTY_NOTICES.md` current whenever upstream derived code changes

### Ask First

- Adding new dependencies or provider SDKs
- Changing Stripe price IDs, webhook secrets, or env var names in `apps/api`
- Changing the Supabase schema in `supabase/` or startup migrations in `apps/api/src/app.ts`
- Changing deploy scripts (`scripts/huggingface-deploy.mjs`, `scripts/cloudflare-pages-deploy.mjs`, `scripts/build-web.mjs`)
- Changing the public model picker lineup or adding a new verified provider
- Renaming env vars or production URLs
- Publishing binaries, npm package, or deploying the site

### Never

- Use em dashes. Use a plain hyphen instead
- Use `any` or `@ts-ignore` to silence a type error. Fix the type or narrow the value
- Add comments that restate the code, add doc fluff, or use em dashes
- Store provider secrets in plaintext, in config files, in session JSONL, in logs, or in exported bundles. No plaintext fallback
- Install providers, plugins, MCP servers, formatters, or linters silently. Detect missing tools and explain setup. Require explicit approval for installs
- Add `chat_template_kwargs` to NVIDIA NIM requests. Use top-level `reasoning_effort`
- Force `chat_template_kwargs` or provider-specific hacks into a shared adapter. Keep provider quirks isolated per adapter
- Switch to a fallback model when a direct provider times out. Fail clean and surface a structured error
- Make buttons or cards grow or move on hover (no translateY, scale, or padding changes on :hover) in the static site
- Make unapproved network calls from tests. Live provider smoke is opt-in only
- Claim that arbitrary Luau execution, inserted assets, or generated content can be rolled back. Only filesystem changes and reversible Studio script mutations support turn level undo and redo
- Implement Claude Pro or Max login scraping or any prohibited consumer login workaround. Claude access is API only. Meta models are accessed through gateways, cloud platforms, Hugging Face, Ollama, LM Studio, or other supported hosts
- Edit `codex-*.log`, `scratch_diff*.txt`, or `fix-*.js` in repo root
- Force-push to `main`

## Code Style

- TypeScript strict mode, no `any`, no implicit `any`, `unknown` plus narrowing
- Named exports only in `apps/api/src/` and `packages/`
- Keep `apps/api/src/services/aiProvider.ts` under 9k lines when it exists. Extract intent, prompts, providers, and validators into separate files as it grows. In the CLI runtime, keep each module under ~400 lines and split by concern, not by layer dump
- Self explanatory code with comments limited to license notices, security invariants, and unavoidable protocol quirks. No function header boilerplate, no inline narration
- No em dashes in source, prompts, UI strings, tests, or documentation. Use a hyphen or a colon
- Validate external input with Zod. Do not trust provider JSON, tool output, or Studio MCP payloads without parsing
- Use canonical `provider/model` identifiers and model scoped capabilities for tools, images, reasoning, streaming, structured output, context limits, caching, and auth methods

## Testing

- Unit: vitest in `packages/core/src`, `packages/providers/src`, `packages/roblox/src`, `apps/cli/src`, `apps/api/src/tests`. Single file: `npx vitest run src/tests/<file>.test.ts` or `bun vitest run <path>`
- Visual: playwright in `apps/site/tests` and `apps/web/tests` during transition
- Provider conformance fixtures: text, reasoning, images, sequential and parallel tool calls, malformed arguments, cached usage, cancellation, rate limits, context overflow, mid stream errors
- Live smoke (opt-in): every verified provider must pass live smoke before it can be labeled verified. Missing credentials skip local dev but block provider certification for a release
- Studio contract: recorded MCP fixtures plus manual live acceptance covering discovery, selection, script read, hierarchy search, previewed edit, verification, rollback, playtest, console, screenshot, cancellation, reconnection
- Path safety: Windows junction and Unix symlink escapes, shell permission matching with wildcard rules (`allow`, `ask`, `deny`, argument or path matching, approve once and approve for session)
- Security: local server auth, plugin install approval, export redaction, absence of secrets in logs and sessions
- Connector: `npm run verify:connector` for roundtrip and `npm run audit:bridge` for perf baselines

Keep tests deterministic and offline by default. Do not hit live providers, Studio, or the network from unit tests.

## Release Rules (MANDATORY)

Do NOT run an automatic deploy or publish after local code changes. Deploys and publishes require explicit user approval.

### What counts as a code change that requires explicit release approval

- Editing any `.ts`, `.tsx`, `.lua`, `.mjs`, `.json` (non lockfile) file in `apps/` or `packages/`
- Changing Dockerfiles, `package.json` scripts, `docs/deploy.md`, or `apps/site` routing and headers
- Modifying prompt templates, validation rules, or provider and capability config

### What does NOT require a deploy

- Editing `AGENTS.md`, `README.md`, `.gitignore`, `UPSTREAM.md`, `THIRD_PARTY_NOTICES.md`, docs, or `scripts/` helpers that are not part of the runtime
- Changing `.env` locally
- Editing `.opencode/skills/` agent context

### Gates

- All checks in `bun run verify` must be green: lint, strict typecheck, style checks (including em dash scan), tests, builds, dependency audit, license attribution, binary smoke tests, npm packing, static site tests
- `node scripts/deploy-verify.mjs --check` remains the compatibility entry point for the same gate
- If typecheck, build, or tests fail, fix first. Never publish broken code
- Produce checksums and release notes. Stop before publication, tag push, or site deploy unless the user explicitly approves. Never change env vars or production URLs without permission
- API deploys to Hugging Face Spaces via `scripts/huggingface-deploy.mjs` and web/site deploys to Cloudflare Pages via `scripts/cloudflare-pages-deploy.mjs` only when the hosted surfaces are involved and explicitly requested

## Critical Files

- `apps/cli/src/index.ts:1` - commander surface, command registration, TUI and headless entry
- `apps/cli/src/tui.tsx:1` - Ink/OpenTUI interactive workspace, approvals, streaming, session chrome
- `apps/cli/src/run.ts:1` - headless `run` with versioned JSONL events
- `packages/core/src/agent.ts:1` - iterative tool loop, permission gating, retry, cancellation, compaction
- `packages/core/src/store.ts:1` - SQLite session persistence plus legacy JSONL import
- `packages/core/src/config.ts:1` - `vectiscode.jsonc` schema, precedence, OpenCode compatibility read, migration
- `packages/core/src/credentials.ts:1` - OS keychain vault, environment overrides, legacy migration, diagnostics
- `packages/providers/src/index.ts:1` - provider registry and catalog wiring
- `packages/providers/src/shared.ts:1` - SSE parsing, usage normalization, error mapping
- `packages/roblox/src/studio-mcp.ts:1` - Studio MCP stdio transport, discovery, risk classification
- `packages/roblox/src/tools.ts:1` - workspace tools and Studio tool delegation
- `packages/roblox/src/path-safety.ts:1` - workspace boundary and symlink/junction handling
- `packages/roblox/src/checkpoints.ts:1` - file checkpoint creation and rollback
- `scripts/deploy-verify.mjs:1` - legacy verification chain, now wraps `bun run verify`

## Provider Contract

Providers are resolved from Models.dev and bundled AI SDK providers, not from hand written raw HTTP per model. The current alpha has six adapters as a starting point. The rebuilt catalog covers 75 plus integrations and local models.

Tiers:
- Verified: OpenAI API and ChatGPT OAuth, Google AI Studio and Vertex AI, Anthropic API, OpenRouter, GitHub Copilot, Azure OpenAI, Amazon Bedrock, xAI, Ollama, LM Studio, configurable OpenAI compatible endpoints. Each must pass opt-in live smoke before it can be labeled verified
- Catalog compatible: other Models.dev and AI SDK providers that pass fixture based protocol validation for text, reasoning, images, tool calls, caching, and streaming
- Experimental: custom provider plugins or packages, clearly labeled and never installed silently

Provider rules:
- Use canonical `provider/model` identifiers and model scoped `ProviderModel`, `ProviderAuth`, `ProviderError`, `ProviderStreamEvent` contracts. Do not use provider wide capability booleans
- Use the Responses API for OpenAI reasoning, tool calling, streaming, and multi turn state where applicable
- Normalize failures into authentication, billing, rate limit, timeout, network, context limit, unsupported feature, invalid model, and server errors. Respect retry headers and never switch providers silently
- Support browser and headless OAuth where the upstream provider flow is maintained. Never scrape credentials
- Maintain an offline provider catalog snapshot with a last known good cache. `doctor` reports catalog age, credential source, model compatibility, and endpoint health without exposing secrets

## Roblox Specialization

Roblox behavior enables automatically when VectisCode detects Studio MCP, `.rbxl`, `.rbxlx`, Luau sources, Rojo project files, Aftman, Selene, or StyLua config. General repositories continue to work normally.

- Keep Studio connected through the long lived local runtime. Support discovery, multiple Studio instances, explicit selection, persisted session selection, reconnect with bounded backoff, and useful offline diagnostics in `doctor` and `studio status`
- Use exact risk metadata per discovered Studio tool. Unknown tools always ask
- Before reversible mutations, capture affected Studio state, present a readable change set, apply, read back, store a receipt with Studio ID, tool, risk, reversibility, before and after evidence, verification result, and checkpoint
- Implement turn level undo and redo for filesystem changes and reversible Studio script mutations. Never claim broader reversibility
- Add Roblox focused commands and TUI actions for Studio selection, hierarchy and script search, diff review, playtest start and stop, console capture, screenshots, and verification
- Build an optional Visual QA loop using playtest state, console output, and screenshots. Mouse or keyboard interaction remains approval gated
- Integrate Luau LSP, Selene, StyLua, and Rojo when already installed or configured. Detect missing tools and explain setup without installing silently

## Public Interfaces and Migration

- `vectiscode.jsonc` and `.vectiscode/` are canonical. `opencode.json`, `opencode.jsonc`, and `.opencode` are read only compatibility sources. Provide `vectiscode migrate opencode` to materialize VectisCode native files explicitly
- Use one versioned event protocol for TUI, JSON output, and server clients, covering message parts, reasoning, tool progress, permission requests, questions, usage, completion, cancellation, and structured errors
- Migrate alpha state idempotently: back up v1 config before creating v2, preserve provider, model, permission, and endpoint settings, reuse and verify existing keychain entries without deleting them, import readable JSONL sessions into SQLite and mark incomplete historical tool data as legacy rather than inventing events, index old checkpoints and keep their original files until migration verification passes
- Keep local servers on `127.0.0.1:4097` by default. Require explicit auth and bind flags for non loopback access. Enforce bounded tool output, cancellation that kills full process trees, and redaction of secrets from events and exports

## Upstream Attribution

OpenCode v1.18.16 at commit `a3647eb025c7615159d417dcc49fc39fdaeba65b` is the upstream for the core CLI architecture. Import is under the MIT license with attribution retained. See `UPSTREAM.md` and `THIRD_PARTY_NOTICES.md` for the imported subsystems, local changes, and required notices. Do not remove or obscure upstream license headers from derived files.

## Model Status

The single source of truth for verified models is the Models.dev backed catalog wired through `packages/providers` and `packages/core/src/config.ts`. Do not maintain a separate ad hoc model list in this file or in docs. Run `npm run smoke:models` and `npm run smoke:thinking` to verify live provider status before trusting any model status claim. Provider health gating lives in the registry and `doctor`, not in scattered adapters.

Prior durable rules from the hosted product remain relevant for the hosted path only and are documented in the archived tag `archive/legacy-api-90920c4`. For the CLI, provider behavior is gated by the catalog and by per-model conformance fixtures, not by hard coded branches.

## Common Pitfalls

| Symptom | Cause | Fix |
|---|---|---|
| NVIDIA NIM returns no thinking | Sent `chat_template_kwargs` | Remove it, use top-level `reasoning_effort` only |
| GLM hangs for minutes on HF Spaces | Used NVIDIA NIM route | Hold GLM behind a direct Z.AI key, route through fallback otherwise |
| Chat answers truncated at 512 tokens | `nvidiaAnswerMaxTokens` was 512 non thinking | Use 8192 off and 16384 on, use 16384 for patch |
| Eval kills HF Spaces request | Provider hung past 300s | `providerTimeoutMs: 120_000` in eval handler |
| Stream cancels early on partial thinking | `streamContentIsUsable` threshold too low | Require 200 plus chars and 3 plus sentences |
| Studio patch never applies | Plugin pointed to localhost | Confirm endpoint is `https://api.vectiscode.com` for hosted, or local runtime `127.0.0.1:4097` for CLI |
| Pixelated web font | Non standard `font-weight: 450` triggered variable font interpolation | Use `font-weight: 500` and add `font-synthesis: none` |
| New signups invisible in admin panel | Signup route does not write `customerEvidence` | Query `vectis_collections` directly, or add a `signup` event in the auth route |
