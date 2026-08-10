---
name: planning-and-task-breakdown
description: Breaks work into ordered tasks with acceptance criteria. Use when you have a spec or clear requirements and need to break work into implementable tasks. Use when a task feels too large to start, when you need to estimate scope, or when parallel work is possible.
---

# Planning and Task Breakdown

## Overview

Decompose work into small, verifiable tasks with explicit acceptance criteria. Every task should be small enough to implement, test, and verify in a single focused session.

## When to Use

- You have a spec and need to break it into implementable units
- A task feels too large or vague to start
- Work needs to happen across apps/api and apps/web
- The implementation order is not obvious

## The Planning Process

### Step 1: Enter Plan Mode

Read-only exploration first. Read the relevant codebase sections, identify existing patterns, map dependencies. Do NOT write code during planning.

Check existing files:
- `apps/api/src/services/aiProvider.ts` -- provider class patterns
- `apps/api/src/services/config.ts` -- model routing
- `apps/api/src/types.ts` -- type definitions
- `apps/web/src/components/ChatWorkspace.tsx` -- frontend rendering
- `apps/api/src/app.ts` -- route handler wiring

### Step 2: Identify Dependencies

Map what depends on what. For a provider change:
```
Type definitions (types.ts)
    |
    v
Provider class (aiProvider.ts)
    |
    v
Config routing (config.ts)
    |
    v
App route handler (app.ts)
    |
    v
Frontend badge (ChatWorkspace.tsx)
```

### Step 3: Slice Vertically

Build one complete feature path at a time. For a new provider integration:
```
Slice 1: Types + Provider class (backend only, can test in isolation)
Slice 2: Config routing + factory wire-up (config.ts)
Slice 3: Route handler + providerTrace metadata (app.ts)
Slice 4: Frontend provider badge rendering
```

### Step 4: Write Tasks

Each task follows this structure:

```markdown
## Task: [Short title]

**Acceptance criteria:**
- [ ] Specific, testable condition
- [ ] Specific, testable condition

**Verification:**
- [ ] npm run typecheck
- [ ] npm test -- --run
- [ ] Manual: run the matrix smoke test

**Files likely touched:**
- apps/api/src/services/aiProvider.ts
```

### Step 5: Order and Checkpoint

Add explicit checkpoints between phases:
```markdown
## Checkpoint: After backend implementation
- [ ] npm run typecheck passes
- [ ] npm test -- --run passes all tests
- [ ] New provider smoke test succeeds
```

## Task Sizing

| Size | Files | Scope |
|------|-------|-------|
| XS | 1 | Single function or config change |
| S | 1-2 | One component or endpoint |
| M | 3-5 | One feature slice |
| L | 5-8 | Multi-component feature -- break down further |

## Red Flags

- Starting implementation without a written task list
- Tasks that say "implement the feature" without acceptance criteria
- No verification steps in the plan
- All tasks are L-sized or larger
- Dependency order is not considered

## Verification

- [ ] Every task has acceptance criteria
- [ ] Every task has a verification step
- [ ] Task dependencies are identified and ordered
- [ ] Checkpoints exist between major phases
