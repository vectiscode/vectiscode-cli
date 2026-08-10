---
name: deploy-verify-pipeline
description: Use before any deploy, when scripts/deploy-verify.mjs fails, or when adding/changing a deploy script. Covers the typecheck -> build -> test -> verify:connector -> audit:bridge -> test:visual -> deploy chain, Hugging Face Spaces (API) and Cloudflare Pages (web) target specifics, and the NVIDIA_API_KEY secret version pin.
---

# Deploy Verify Pipeline

## The single command

```
node scripts/deploy-verify.mjs          # both api + web
node scripts/deploy-verify.mjs api      # api only
node scripts/deploy-verify.mjs web      # web only
node scripts/deploy-verify.mjs --check  # checks only, skip deploy
```

This script chains: typecheck -> build -> test -> verify:connector -> audit:bridge -> test:visual -> deploy. It exits non-zero on any failure. Fix the issue and re-run.

**Local dev is NOT a deploy.** Never claim a deploy is done after `npm run dev`.

## Pipeline stages

| Stage | API | Web | Why |
|---|---|---|---|
| typecheck | tsc -p apps/api | tsc -p apps/web | catch type errors |
| build | tsc -p apps/api | vite build | produce artifacts |
| test | vitest | (skipped, see playwright) | unit coverage |
| verify:connector | runs | runs | pairing code roundtrip |
| audit:bridge | runs | runs | studio bridge perf |
| test:visual | (skipped) | playwright | UI smoke |
| deploy:api | huggingface-deploy.mjs | (skipped) | push to HF Spaces |
| deploy:web | (skipped) | cloudflare-pages-deploy.mjs | push to Cloudflare Pages |
| deploy:health | runs | runs | post-deploy health check |

## Target specifics

### Hugging Face Spaces (API)

- Deploy script: `scripts/huggingface-deploy.mjs`
- Pushes a clean single-commit copy of the API to the HF Space Git repo
- Requires `HF_TOKEN` in `.env` with write access to the Space
- Secret pinning: `NVIDIA_API_KEY` is pinned to `vectis-nvidia-api-key:1`, NOT `latest`
- Migrations run on startup via `app.ts` self-heal

### Cloudflare Pages (web)

- Build command: `npm run build`
- Output dir: `apps/web/dist`
- The build also runs `sync:connector` to embed the latest plugin source
- Static asset CDN: Cloudflare

## Health check

`scripts/post-deploy-health-check.mjs` runs after both deploys:

- `GET https://api.vectiscode.com/diagnostics` - API + provider + storage status
- `GET https://vectiscode.com` - web loads
- `GET /readiness` - env readiness report

## Rules

- Never deploy with a failing typecheck, build, or test
- Never deploy with `NVIDIA_API_KEY` pinned to "latest"
- Never change env vars or production URLs without explicit permission
- Never edit `scripts/deploy-verify.mjs` to skip a stage
- After ANY code change, run `node scripts/deploy-verify.mjs` before ending the turn
- If a deploy fails, do NOT pretend it succeeded

## Critical files

- `scripts/deploy-verify.mjs` - the chain
- `scripts/huggingface-deploy.mjs` - API deploy
- `scripts/cloudflare-pages-deploy.mjs` - web deploy
- `scripts/post-deploy-health-check.mjs` - health gate
- `scripts/sync-connector.mjs` - plugin source embed
- `docs/deploy.md` - human-facing deploy guide
