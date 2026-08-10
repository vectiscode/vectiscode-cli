---
title: VectisCode
emoji: 🧰
colorFrom: gray
colorTo: red
sdk: docker
app_port: 7860
---

# VectisCode

VectisCode is a free, open-source coding agent for Roblox. It runs in your terminal, connects directly to the AI provider you choose, and operates Roblox Studio through Studio's native MCP server.

```sh
npm install -g vectiscode@alpha
vectiscode providers login openai
vectiscode doctor
vectiscode
```

Windows is the primary alpha platform. Node.js 20 or newer is required.

## Why it exists

Models alone are not coding agents. VectisCode supplies the iterative tool loop, project context, provider normalization, permissions, Studio transport, mutation receipts, file checkpoints, and rollback boundary needed for dependable Roblox work.

- Bring OpenAI, Anthropic, Gemini, OpenRouter, Ollama, or an OpenAI-compatible endpoint.
- Work interactively in the Ink terminal UI or run headlessly with JSONL events.
- Use Roblox Studio's documented stdio MCP tools instead of a proprietary polling bridge.
- Keep provider credentials in the operating system keychain with no plaintext fallback.
- Default to supervised writes. Plan mode is read-only, and dangerous or unknown tools always ask.
- Keep prompts, responses, code, paths, diffs, tool arguments, and detailed sessions local.

## Commands

```text
vectiscode
vectiscode run "inspect this project" [--json]
vectiscode resume [session]
vectiscode providers list|login|logout|models
vectiscode studio list|connect|status|select
vectiscode config get|set
vectiscode doctor
vectiscode rollback <checkpoint>
```

## Repository layout

| Path | Purpose |
| --- | --- |
| `apps/cli` | Published `vectiscode` package and terminal UI |
| `packages/core` | Agent loop, sessions, permissions, configuration, credentials |
| `packages/providers` | Provider adapters and capability registry |
| `packages/roblox` | Studio MCP, workspace tools, checkpoints, path safety |
| `packages/testkit` | Deterministic agent and provider test support |
| `apps/web` | Public site and optional account interface |
| `apps/api` | Optional hosted account and aggregate usage service |

## Local development

```sh
npm ci
npm run typecheck
npm test
npm run build
npm run test:visual
npm run pack:cli
```

Before deployment, run `node scripts/deploy-verify.mjs --check`. See [CONTRIBUTING.md](CONTRIBUTING.md) for contribution rules and [SECURITY.md](SECURITY.md) for private vulnerability reporting.

## Accounts and privacy

The CLI works without a VectisCode account. The optional hosted account is limited to convenience features such as connection labels, device sessions, model preferences, and aggregate usage. It is not in the provider or tool execution path.

VectisCode is independent and is not affiliated with or endorsed by Roblox Corporation.

MIT licensed. See [LICENSE](LICENSE).
