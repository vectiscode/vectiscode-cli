# VectisCode CLI

Local-first Roblox coding agent that connects directly to Roblox Studio through Studio's official MCP server.

## Installation

```sh
npm install -g vectiscode@alpha
```

## Setup & Quickstart

```sh
# 1. Store your provider API key in your OS keychain
vectiscode providers login anthropic   # or openai, google, groq, deepseek

# 2. Check environment and Studio connection
vectiscode doctor

# 3. Launch interactive terminal
vectiscode
```

## Features

- **Direct Studio MCP**: Talks to Studio over local stdio. Zero third-party web bridges or sync polling.
- **Diff Review & Rollback**: Review unified diffs before applying. Roll back any turn with `/undo <checkpointId>`.
- **Local & Private**: Credentials stay in your OS keychain. Prompts and code stay on your machine.
- **Provider Choice**: Use Claude 3.7 / 3.5 Sonnet, GPT-4o, Gemini 2.5 Pro, Llama 3.3, or local Ollama.

Documentation & Source: https://github.com/vectiscode/vectiscode-cli
