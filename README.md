# vectiscode

Find out why your Claude Code and Codex limits drain, and what to change.

```sh
npx vectiscode
```

vectiscode reads the session logs that Claude Code and Codex already keep on your computer and tells you where your usage went:

- **Long chats.** How much ran with more than 150k tokens of context, which chats grew biggest, and how often they were compacted. Every step in a chat re-reads the whole chat, so late steps cost far more than early ones.
- **Always-on context.** How big a new chat is before you type anything, what that setup is made of (tool definitions, system prompt, skills list, CLAUDE.md), and which tools were sent with every request but never called.
- **Cache after breaks.** What it cost to come back to a big chat after its cache expired.
- **Helpers and subagents.** How much went to each helper type and to workflows.
- **Codex limits.** Your latest 5-hour and weekly readings, and how much of a weekly limit each chat used, taken from the real percentages Codex logs after every turn.

Each finding comes with a fix.

Nothing leaves your computer. There is no account, no telemetry and no network call, and the logs are only read, never changed.

## Options

| Option | |
|---|---|
| `--days <n>` | look at the last n days (default 30) |
| `--since <date>` | look at everything since a date, like `2026-10-01` |
| `--json` | print the full report as JSON |
| `--claude-dir <dir>` | Claude Code folder (default `$CLAUDE_CONFIG_DIR` or `~/.claude`) |
| `--codex-dir <dir>` | Codex folder (default `$CODEX_HOME` or `~/.codex`) |

## How the numbers work

- **Claude Code** logs the tokens of every request. vectiscode weighs them with API list prices and calls the result *units* (API-equivalent dollars). When Claude Code's own cost records are in the logs, the prices are checked against them, so the units stay right when prices change. Plans are not billed this way; units are a common scale for comparing requests, chats and habits.
- **Codex** logs how much of your 5-hour and weekly limits you have used after every turn. vectiscode credits each turn with the change, so its Codex numbers are real percentages, not estimates. If you switch between ChatGPT accounts, each account's window is counted separately.
- **Setup sizes** are estimated from the characters in the logs, so they are approximate.

## Requirements

Node 22 or newer. Built and tested on Windows; Claude Code and Codex write the same logs on macOS and Linux.

## Status

Early. If a number looks wrong for your logs, please open an issue.

## License

MIT
