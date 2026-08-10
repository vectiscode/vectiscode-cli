# VectisCode

VectisCode is a local-first Roblox coding agent. It runs in your terminal, connects directly to your chosen AI provider, and uses Roblox Studio's native MCP server for Studio-aware inspection and edits.

```sh
npm install -g vectiscode@alpha
vectiscode providers login openai
vectiscode studio connect
vectiscode
```

API keys are saved only in the operating system keychain. VectisCode does not upload prompts, source code, tool arguments, diffs, or credentials to a Vectis account.

Source and documentation: https://github.com/vectiscode/vectiscode-cli
