# VectisCode

VectisCode is an open-source terminal coding agent for Roblox. It talks directly to Roblox Studio through Studio's official MCP server, letting you build, inspect, and patch Luau scripts using models like Claude 3.7 Sonnet, GPT-4o, Gemini 2.5 Pro, DeepSeek, or local Llama.

Everything runs on your machine. Prompts, diffs, credentials, and session histories stay local.

```sh
npm install -g vectiscode@alpha
vectiscode providers login anthropic  # or openai, google, groq, deepseek
vectiscode
```

---

## Quickstart

### 1. Enable Studio MCP
In Roblox Studio:
1. Open **File > Assistant Settings** (or Beta Features).
2. Under **Manage MCP Servers**, enable **Studio MCP Server**.
3. Open any Roblox place file (`.rbxl` or `.rbxlx`).

### 2. Configure Your Provider
Run login once to store your API key securely in your OS keychain:
```sh
vectiscode providers login anthropic    # Claude 3.7 Sonnet / 3.5 Sonnet
vectiscode providers login openai       # GPT-4o / o3-mini
vectiscode providers login google       # Gemini 2.5 Pro / Flash
vectiscode providers login groq         # Meta Llama 3.3 70B
vectiscode providers login deepseek     # DeepSeek Chat / Reasoner
```
If using Ollama or LM Studio locally, no API key is required.

### 3. Start Building
Launch the interactive terminal in your project directory:
```sh
vectiscode
```
Type `/` at any time to open the command palette.

---

## Key Capabilities

- **Native Studio MCP**: Communicates over local stdio with Roblox Studio's built-in MCP server. Discovers game tree instances, reads scripts, and edits code without third-party sync plugins.
- **Review Before Apply**: Inspect unified diffs before any changes touch your Studio place. Destructive actions always require explicit confirmation.
- **Per-Patch Checkpoints**: Every turn creates an automatic file and script snapshot. If a change does not work, run `/undo <id>` to roll back instantly.
- **Visual QA & Playtesting**: Trigger playtests, capture Studio viewports, and inspect live console output directly from the terminal.
- **Multi-Provider Support**: Switch between Anthropic, OpenAI, Google, Groq, DeepSeek, OpenRouter, and Ollama seamlessly.

---

## Interactive TUI Commands

| Command | Action |
|---|---|
| `/` | Open interactive slash command palette with live autocomplete |
| `/connect` | Connect or check Roblox Studio MCP server |
| `/models [provider]` | List and switch models across providers |
| `/provider <id>` | Switch active AI provider |
| `/model <name>` | Switch active model identifier |
| `/playtest [start\|stop]` | Control Roblox Studio playtest sessions |
| `/verify` | Run visual QA and examine runtime logs |
| `/undo <checkpointId>` | Roll back file mutations to previous turn |
| `/sessions [id]` | View recent sessions or resume previous chat |
| `/compact` | Compact turn history to free context window space |
| `/agent <plan\|build>` | Switch between read-only planning and build mode |
| `/help` | Show command list and keyboard shortcuts |

---

## Headless CLI Usage

Run tasks in scripts or CI without the interactive interface:

```sh
# Run a single prompt headlessly
vectiscode run "Add a leaderstats script in ServerScriptService"

# Emit streaming JSONL events for tooling integration
vectiscode run "Inspect workspace remotes" --format json
```

---

## Project Architecture

- `apps/cli/`: Terminal UI (Ink), command router, and local runtime entry points.
- `packages/core/`: Agent loop, SQLite session store, OS keychain vault, permission gating.
- `packages/providers/`: Direct adapters for Anthropic, OpenAI, Google, Groq, DeepSeek, and Ollama.
- `packages/roblox/`: Studio MCP stdio transport, 27 tool definitions, diff engine, and checkpoints.
- `apps/site/`: Static documentation and release portal.

---

## Contributing & Verification

To run tests and verify the complete monorepo locally:

```sh
npm ci
npm run typecheck
npm test
npm run verify
```

MIT Licensed.
