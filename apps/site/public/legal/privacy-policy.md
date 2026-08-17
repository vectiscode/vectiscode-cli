# Privacy Policy | VectisCode

**Last updated: August 17, 2026**

This Privacy Policy describes how VectisCode handles data when you use the VectisCode CLI application, documentation, and static website (collectively, the "Software").

VectisCode is an open-source, local-first coding assistant designed specifically for Roblox Studio development.

---

## 1. Local-First Architecture

VectisCode runs locally on your computer.

- **Source Code & Files**: Your project files, scripts, assets, and file diffs remain entirely on your local machine. VectisCode does not operate any intermediary proxy servers that capture or store your source code.
- **API Credentials**: API keys and OAuth tokens for third-party AI providers (such as OpenAI, Anthropic, Google, OpenRouter, xAI) are stored securely using your operating system's native keychain (Windows Credential Manager / macOS Keychain / Linux Secret Service) or loaded from local environment variables. They are never transmitted to VectisCode.
- **Sessions & Checkpoints**: Session transcripts, tool execution receipts, and file checkpoints are stored in a local SQLite database on your device.

---

## 2. Third-Party AI Providers

When you use VectisCode, your prompts, selected project context (such as relevant script contents and Studio DataModel structure), and tool parameters are sent directly from your machine to the AI provider endpoint you have configured (for example, OpenAI, Anthropic, Google, or your own local Ollama instance).

Your interactions with these providers are governed by their respective privacy policies and terms of service:
- **Anthropic**: [https://www.anthropic.com/privacy](https://www.anthropic.com/privacy)
- **OpenAI**: [https://openai.com/privacy](https://openai.com/privacy)
- **Google AI**: [https://policies.google.com/privacy](https://policies.google.com/privacy)
- **OpenRouter**: [https://openrouter.ai/privacy](https://openrouter.ai/privacy)

---

## 3. Roblox Studio Connection

VectisCode communicates with Roblox Studio locally on your computer via the official Model Context Protocol (MCP) using local standard input/output (`stdio`) streams. No game assets, place files, or Studio telemetry are sent to VectisCode servers.

---

## 4. Website Analytics & Cookies

The VectisCode website (`vectiscode.com`) is a static informational site. We do not use third-party tracking pixels, advertising cookies, or cross-site tracking.

---

## 5. Contact

For questions regarding this policy or the VectisCode project, visit our GitHub repository at [https://github.com/vectiscode/vectiscode-cli](https://github.com/vectiscode/vectiscode-cli) or email **contact@vectiscode.com**.
