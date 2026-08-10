---
name: shipping-and-launch
description: Prepares production launches. Use when preparing to deploy to production after a code change. Use when you need a pre-deploy checklist, monitoring setup, staging rollout, or rollback strategy.
---

# Shipping and Launch

## Overview

Ship with confidence. Every deployment should be reversible, observable, and incremental. The goal is not just to deploy -- it is to deploy safely, with verification in place and a rollback plan ready.

## When to Use

- Deploying to production after a production-facing change
- Releasing a significant feature to users
- Any deployment that carries risk (all of them)

## The Pre-Deploy Checklist

### One-Command Deploy (Recommended)
```bash
node scripts/deploy-verify.mjs            # checks + deploy both
node scripts/deploy-verify.mjs api        # checks + deploy api only
node scripts/deploy-verify.mjs web        # checks + deploy web only
node scripts/deploy-verify.mjs --check    # checks only, skip deploy
```

This script chains typecheck -> build -> test -> deploy and exits non-zero on any failure.

### Manual Steps (if needed separately)

### Code Quality
- [ ] All tests pass: `npm test -- --run`
- [ ] Typecheck passes: `npm run typecheck`
- [ ] Lint passes: `npm run lint`
- [ ] Build succeeds: `npm run build`
- [ ] No `console.log` debugging statements in production code
- [ ] No TODO comments that should be resolved before deploy

### Provider-Specific Checks
- [ ] Any new provider API keys are in Secret Manager
- [ ] Model routing in `configuredProviderForModel()` handles all cases
- [ ] providerTrace metadata includes provider, model, thinking level
- [ ] New provider tested with the matrix smoke test: `node scripts/nvidia-thinking-matrix.mjs`
- [ ] Fallback paths work if the provider returns 504/timeout

### Infrastructure
- [ ] Environment variables set in production Secret Manager (not env files)
- [ ] No secrets in version control
- [ ] database migrations ready if applicable

### Rollback Plan
- [ ] Previous deployment can be reverted: `gcloud run deploy [service] --image=[previous-image]`
- [ ] Feature flag exists for this change (if risky)
- [ ] Rollback steps documented below

## Rollback Strategy

Every deployment needs a rollback plan before it happens:

```markdown
## Rollback Plan

### Trigger Conditions
- Error rate spikes after deploy
- Provider returns 504 for previously working models
- User-reported issues for the changed feature

### Rollback Steps
1. Revert the code change and redeploy: `npm run deploy` (or specific: `npm run deploy:api`)
2. Verify rollback: health check, error monitoring
3. Communicate: notify if user-facing impact

### Time to Rollback
- Code revert + redeploy: < 5 minutes
```

## Feature Flag Strategy

Ship behind feature flags when the change is risky or incomplete:
- Deploy with flag OFF (code is in production but inactive)
- Enable for testing
- Gradual rollout
- Monitor at each stage
- Clean up flag within 2 weeks of full rollout

## Staged Rollout Sequence

1. Deploy to production
2. Verify health: health check endpoint, error monitoring
3. Enable for internal testing (if feature flag)
4. Full rollout
5. Monitor for 1 hour post-deploy

### Post-Deploy Verification

In the first hour after deploy:
- [ ] Health endpoint returns 200
- [ ] Error monitoring dashboard: no new error types
- [ ] Test the critical user flow manually (send a chat)
- [ ] Verify providerTrace metadata appears correctly
- [ ] Check latency is normal for each provider

## Red Flags

- Deploying without a rollback plan
- No monitoring or error reporting
- Big-bang releases (everything at once)
- No one monitoring the deploy for the first hour
- "It's Friday afternoon, let's ship it"

## Verification

Before deploying:
- [ ] Pre-deploy checklist completed
- [ ] Rollback plan documented
- [ ] Tests pass, typecheck passes, build succeeds

After deploying:
- [ ] Health check returns 200
- [ ] Error rate is normal
- [ ] Critical user flow works
- [ ] Rollback can be executed quickly if needed
