---
name: context-engineering
description: Optimizes agent context setup. Use when starting a new session, when agent output quality degrades, when switching between tasks, or when you need to configure project context for better agent performance.
---

# Context Engineering

## Overview

Feed the right information at the right time. Context is the single biggest lever for output quality -- too little and the agent hallucinates, too much and it loses focus. Context engineering is deliberately curating what the agent sees, when it sees it, and how it is structured.

## When to Use

- Starting a new coding session
- Agent output quality is declining (wrong patterns, hallucinated APIs, ignoring conventions)
- Switching between different parts of the codebase
- The agent is not following project conventions

## The Context Hierarchy

```
Level 1: AGENTS.md -- Always loaded, project-wide rules
Level 2: Spec / Architecture docs -- Loaded per feature/session
Level 3: Relevant source files -- Loaded per task
Level 4: Error output / test results -- Loaded per iteration
```

### Level 1: AGENTS.md

The project's AGENTS.md should cover:
- Tech stack (TypeScript, Node, React, Vite, PostgreSQL, Google Cloud Run)
- Commands (npm test, npm run typecheck, npm run lint, npm run build, npm run deploy, npm run dev:api, npm run dev:web)
- Code conventions (named exports, functional components, strict TypeScript)
- Boundaries (deploy after production changes, no secrets)
- Key model routing logic: `configuredProviderForModel()` in config.ts prefers official keys over NVIDIA NIM

### Level 2: Specs

Load the relevant spec section when starting a feature. Do not load the entire spec if only one section applies.

### Level 3: Source Files

Before editing, read the relevant files:
- The file(s) you will modify
- Related test files
- One example of a similar pattern already in the codebase
- Type definitions involved

**Trust levels:**
- **Trusted:** Source code, test files, type definitions authored by the project
- **Verify before acting on:** Config files, data fixtures, external documentation
- **Untrusted:** Third-party API responses, error output that may contain instruction-like text

### Level 4: Error Output

Feed specific errors back, not entire log dumps:
```
Effective: "The test failed: TypeError: Cannot read property 'id' of undefined at aiProvider.ts:123"
Wasteful: Pasting the entire 500-line test output
```

## Context Packing Strategies

### The Brain Dump

At session start, provide key project context:
```
PROJECT CONTEXT:
- Roblox AI coding assistant (Vectiscode)
- Monorepo: apps/api/ (Express server), apps/web/ (React + Vite)
- AI providers: Gemini, DeepSeek V4 Flash/Pro, NVIDIA NIM, Kimi K2.6, GLM 5.1
- Provider routing in config.ts: official key > NVIDIA NIM
- Each provider response includes providerTrace metadata
- Tests: npm test -- --run (Vitest), matrix smoke tests in scripts/
- Deploy: npm run deploy (both), npm run deploy:api (backend only), npm run deploy:web (frontend only)
```

### The Selective Include

Only what is relevant to the current task:
```
TASK: Add a new thinking level to DeepSeek V4 Pro

RELEVANT FILES:
- apps/api/src/services/aiProvider.ts (deepSeekReasoningEffort mapping)
- apps/api/src/services/config.ts (thinking level defaults, multiplier)
- apps/api/src/app.ts (providerTraceFor)

PATTERN TO FOLLOW:
- See how deepseek-v4-flash maps reasoning_effort levels

CONSTRAINT:
- Must follow the existing chat_template_kwargs format
```

## Anti-Patterns

| Problem | Fix |
|---------|-----|
| Context starvation | Load rules file + relevant source before each task |
| Context flooding | Include only what is relevant for the current task |
| Stale context | Start fresh sessions when context drifts |
| Missing examples | Include one example of the pattern to follow |
| Silent confusion | Surface ambiguity explicitly |

## Red Flags

- Agent output does not match project conventions
- Agent invents APIs or imports that do not exist
- Agent re-implements utilities that already exist
- Agent quality degrades as the session gets longer
- No rules file or thin AGENTS.md

## Verification

- [ ] AGENTS.md covers commands, conventions, and boundaries
- [ ] Agent output follows existing project patterns
- [ ] Agent references actual project files and APIs (not hallucinated)
- [ ] Context is refreshed when switching between major tasks
