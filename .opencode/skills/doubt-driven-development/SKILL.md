---
name: doubt-driven-development
description: Subjects non-trivial decisions to a fresh-context adversarial review before they stand. Use when correctness matters more than speed, when working in unfamiliar code, when stakes are high, or when a confident output would be cheaper to verify now than to debug later.
---

# Doubt-Driven Development

## Overview

A confident answer is not a correct one. Long sessions accumulate context that quietly turns assumptions into facts without anyone noticing. Doubt-driven development materializes a fresh-context reviewer -- biased to disprove, not approve -- before any non-trivial output stands.

This is not a final code review. It is an in-flight posture: non-trivial decisions get cross-examined while course-correction is still cheap.

## When to Use

A decision is non-trivial when it meets any of these criteria:
- It introduces or modifies branching logic
- It crosses a module or service boundary (e.g. changing the provider router contract)
- It asserts a property the type system cannot verify (thread safety, ordering, invariants)
- Its blast radius is irreversible (deploy, data migration, public API change)
- It adds a new AI provider, thinking mode, or credit-costing path

Apply when about to:
- Make an architectural decision under uncertainty
- Commit non-trivial code
- Claim a non-obvious fact ("this is safe", "this matches the provider API spec")
- Work in code you don't fully understand (e.g. the NIM chat_template_kwargs format)

When NOT to use: mechanical operations (renaming, formatting), following a clear unambiguous instruction, one-line changes, pure tooling operations.

## The Process

```
Doubt cycle:
- [ ] Step 1: CLAIM -- state the claim + why it matters
- [ ] Step 2: EXTRACT -- isolate the artifact + contract, strip reasoning
- [ ] Step 3: DOUBT -- get a fresh-context review from me
- [ ] Step 4: RECONCILE -- classify every finding against the artifact
- [ ] Step 5: STOP -- met stop condition (trivial findings, 3 cycles, or override)
```

### Step 1: CLAIM

Name the decision in 2-3 lines:

```
CLAIM: "The new provider's chat_template_kwargs format matches what
        NVIDIA NIM expects for this model family."
WHY THIS MATTERS: Wrong format means 400 Bad Request for every user.
```

### Step 2: EXTRACT

Give me just the artifact and the contract -- not the journey. The artifact is the diff or function. The contract is what it must satisfy. Strip your reasoning.

### Step 3: DOUBT

I will review the artifact adversarially:
- Unstated assumptions
- Edge cases not handled
- Hidden coupling or shared state
- Ways the contract could be violated
- Existing conventions this might break
- Failure modes under unexpected input

### Step 4: RECONCILE

For each finding, classify:
1. **Valid + actionable** -- real issue requiring a change. Fix it, re-loop.
2. **Valid trade-off** -- issue is real but cost of fixing exceeds cost of accepting. Document explicitly.
3. **Noise** -- reviewer flagged something correct under context the reviewer lacked. Move on.

### Step 5: STOP

Stop when:
- Next iteration returns only trivial findings
- 3 cycles completed (escalate to user)
- User explicitly says "ship it"

## Common Rationalizations

| Rationalization | Reality |
|---|---|
| "I'm confident, skip the doubt step" | Confidence correlates poorly with correctness. Moments of certainty are when blind spots hide. |
| "Spawning a review is expensive" | Debugging a wrong deploy is more expensive. |
| "I'll do it at the end with a review" | Review is a final gate. Doubt catches wrong directions early when fix is cheap. |

## Red Flags

- Doubting only after committing -- that is a review, not doubt-driven development
- Treating reviewer output as authoritative without re-reading the artifact text
- Looping more than 3 cycles without escalating
- Skipping doubt under time pressure on a high-stakes decision
