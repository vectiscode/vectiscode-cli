# vectiscode

Find out why your Claude Code and Codex limits drain, and what to change.

```sh
npx vectiscode
```

vectiscode reads the session logs that Claude Code and Codex already keep on your computer and tells you where your usage went:

- **Long chats.** How much ran with more than 150k tokens of context, which chats grew biggest, how often they were compacted, and what starting fresh chats at 150k would really have saved once each new chat pays to load its setup again.
- **Always-on context.** How big a new chat is before you type anything, what that setup is made of (tool definitions, system prompt, skills list, CLAUDE.md), and which tools were sent with every request but never called.
- **Tool results.** What the files Claude read, the commands it ran and the screenshots it took cost you: each result is written to the cache once and re-read by every later step. By tool, with the biggest single result.
- **Cache after breaks.** What it cost to come back to a big chat after its cache expired.
- **Helpers and subagents.** How much went to each helper type and to workflows.
- **Codex limits.** Your latest 5-hour and weekly readings, and how much of a weekly limit each chat used, taken from the real percentages Codex logs after every turn.

Each finding comes with a fix.

Nothing leaves your computer. There is no account, no telemetry and no network call, and the logs are only read, never changed.

## Did the change work?

Changed a setting, trimmed your MCP servers, started using fresh chats? Compare the days before with the days since:

```sh
npx vectiscode compare 2026-10-17
```

```
Claude Code                     before     after
  units per request              0.098     0.092  −7%
  units per active hour           11.7      19.2  +65%
  average context                 244k      195k  −20%
  usage past 150k context          67%       66%
  new chats start at               74k       69k  −6%
  compactions per chat             2.0       2.0
```

It looks at the 7 days before the date (change that with `--days`) and everything since. Rates are per request and per active hour, so periods of different lengths still compare. More parallel work raises usage per hour even when each request got cheaper, as in the example above.

## Options

| Option | |
|---|---|
| `compare <date>` | compare before and after a date (with `--days`: how many days before, default 7) |
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
