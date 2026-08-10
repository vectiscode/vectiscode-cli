---
name: incremental-implementation
description: Delivers changes in thin vertical slices. Use when implementing any feature or change that touches more than one file. Use when you're about to write a large block of code at once, or when a task feels too big to land in a single step.
---

# Incremental Implementation

## Overview

Build in thin vertical slices -- implement one piece, test it, verify it, then expand. Avoid implementing an entire feature in one pass. Each increment should leave the system in a working, testable state.

## When to Use

- Implementing any multi-file change
- Building a new feature from a task breakdown
- Refactoring existing code
- Any time you're tempted to write more than ~100 lines before testing

## The Increment Cycle

For each slice:

1. **Implement** the smallest complete piece of functionality
2. **Test** -- run the relevant tests (`npm test -- --grep "pattern"`)
3. **Verify** -- confirm typecheck (`npm run typecheck`), lint (`npm run lint`), build (`npm run build`)
4. **Commit** -- save progress with a descriptive message
5. **Move to the next slice** -- carry forward, don't restart

## Slicing Strategies

### Vertical Slices (Preferred)

Build one complete path through the stack:

```
Slice 1: Add provider enum + type (types.ts) + wire into factory
Slice 2: Implement provider class with basic streaming
Slice 3: Add thinking / reasoning_effort handling
Slice 4: Wire into app.ts route handler with providerTrace metadata
Slice 5: Add frontend badge rendering in ChatWorkspace.tsx
```

Each slice delivers working end-to-end functionality that can be tested independently.

### Risk-First Slicing

Tackle the riskiest piece first:

```
Slice 1: Prove the NVIDIA NIM streaming connection works (highest risk)
Slice 2: Add provider-specific chat_template_kwargs format
Slice 3: Add thinking level routing and timeout handling
Slice 4: Add official provider fallback (officialProviderFor)
```

If Slice 1 fails (e.g. 504 timeout), you discover it before investing in Slices 2-4.

## Implementation Rules

### Rule 0: Simplicity First

Before writing any code, ask: "What is the simplest thing that could work?" Implement the naive, obviously-correct version first. Optimize only after correctness is proven with tests.

### Rule 0.5: Scope Discipline

Touch only what the task requires. Do NOT:
- "Clean up" code adjacent to your change
- Refactor imports in files you're not modifying
- Add features not in scope because they "seem useful"

If you notice something worth improving outside your task scope, note it as a follow-up -- don't fix it in this increment.

### Rule 1: One Thing at a Time

Each increment changes one logical thing. Don't mix adding a new provider class with refactoring the config factory.

### Rule 2: Keep It Compilable

After each increment, the project must typecheck and tests must pass. Don't leave the codebase in a broken state between slices.

### Rule 3: Rollback-Friendly

Each increment should be independently revertable. Additive changes (new files, new functions) are easy to revert. Modifications to existing code should be minimal and focused.

## Working with Agents

```
"Let's implement the new provider class.

Start with just the API type definitions and the class skeleton.
Don't touch the route handler or frontend yet -- we'll do that in the next slice.

After implementing, run `npm run typecheck` to verify."
```

Be explicit about what is in scope and what is NOT in scope for each increment.

## Increment Checklist

After each increment, verify:
- [ ] The change does one thing and does it completely
- [ ] Typecheck passes (`npm run typecheck`)
- [ ] Lint passes (`npm run lint`)
- [ ] Tests pass (`npm test`)
- [ ] The new functionality works as expected
- [ ] The change is committed with a descriptive message

## Red Flags

- More than 100 lines of code written without running tests
- Multiple unrelated changes in a single increment
- "Let me just quickly add this too" scope expansion
- Skipping the test/verify step to move faster
- Build or typecheck broken between increments
