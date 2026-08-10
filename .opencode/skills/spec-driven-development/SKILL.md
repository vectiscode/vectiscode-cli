---
name: spec-driven-development
description: Creates specs before coding. Use when starting a new feature, provider integration, or significant refactor with no specification yet. Use when requirements are unclear, ambiguous, or only exist as a vague idea.
---

# Spec-Driven Development

## Overview

Write a structured specification before writing any code. The spec defines what we are building, why, and how we will know it is done. Code without a spec is guessing.

## When to Use

- Starting a new feature or provider integration
- Requirements are ambiguous or incomplete
- The change touches multiple files across apps/api and apps/web
- You are about to make an architectural decision (e.g. new provider class, new routing logic)
- The task would take more than 30 minutes to implement

## The Gated Workflow

```
SPECIFY --> PLAN --> TASKS --> IMPLEMENT
```

Do not advance to the next phase until the current one is validated.

### Phase 1: Specify

Write a spec covering these areas:

1. **Objective** -- What are we building and why? Success criteria?
2. **Commands** -- Build: `npm run build`, Test: `npm test`, Typecheck: `npm run typecheck`, Lint: `npm run lint`, Dev: `npm run dev:web`/`npm run dev:api`
3. **Project Structure** -- Source code in `apps/api/src/` and `apps/web/src/`, tests co-located or in `tests/` dirs, types in `types.ts`
4. **Code Style** -- Use named exports, functional components with hooks, strict TypeScript
5. **Testing Strategy** -- Vitest for backend unit/integration, API tests against Express app, eval tests for provider/planning correctness, smoke scripts for model health. Run `npm test -- --run` before commit
6. **Boundaries**:
   - Always: Run typecheck before commit, follow provider routing in `configuredProviderForModel()`, add `providerTrace` metadata for new providers
   - Ask first: Changing deploy config, adding environment variables, modifying existing provider class signatures
   - Never: Commit secrets, change production URLs without permission, skip deploying after production changes

**Surface assumptions immediately:**
```
ASSUMPTIONS I'M MAKING:
1. The new provider follows OpenAI-compatible chat completions format
2. API key is stored in Secret Manager, not env vars
3. The thinking API uses the same shape as existing providers
4. Frontend badge goes in ChatWorkspace.tsx alongside existing providerTraceLabel()
```

### Phase 2: Plan

Generate a technical implementation plan:
1. Identify major components and their dependencies
2. Determine implementation order (provider class -> config -> app.ts wiring -> frontend)
3. Note risks (timeouts, API differences, auth)

### Phase 3: Tasks

Break the plan into discrete tasks, each completable in a focused session:
```
- [ ] Task: Define types in types.ts
  - Acceptance: New type added, existing tests still pass
  - Verify: npm run typecheck
  - Files: apps/api/src/types.ts, apps/web/src/types.ts
- [ ] Task: Implement provider class in aiProvider.ts
  - Acceptance: Class extends base, implements required methods
  - Verify: npm test -- --run
  - Files: apps/api/src/services/aiProvider.ts
```

### Phase 4: Implement

Execute tasks following `incremental-implementation`.

## Keeping the Spec Alive

- Update the spec when decisions change -- update the spec first, then implement
- The spec is a living document, not a one-time artifact

## Red Flags

- Starting to code without any written requirements
- Making architectural decisions without documenting them
- Asking "should I just start building?" before clarifying what "done" means
- Implementing features not mentioned in any spec

## Verification

- [ ] The spec covers objective, structure, style, testing, and boundaries
- [ ] Success criteria are specific and testable
- [ ] The spec is saved alongside the code
