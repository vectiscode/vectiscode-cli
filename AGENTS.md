# Project Instructions

I maintain this file myself. Every time I learn something about this project, I update it so future sessions start smarter. If I missed something or got something wrong, tell me once and I will fix it here permanently.

## Project Overview

Vectis Code is a Roblox creator AI workspace. Web app at vectiscode.com, Express API at api.vectiscode.com, Roblox Studio plugin in `plugins/roblox-studio/`. AI generates Luau change sets; Studio plugin lets creators review and apply them inside Studio.

## Tech Stack (pinned)

See the relevant `package.json` for exact versions. This is the source of truth.

- Node + TypeScript
- Express
- React + Vite
- react-router-dom
- Zod
- Supabase (Postgres)
- Stripe
- Firebase
- Sentry
- ws
- vitest + Playwright
- Luau (Roblox Studio plugin)

## Project Structure

- `apps/api/src/routes/` - thin Express handlers (admin, auth, billing, chat, projects, studio, discord)
- `apps/api/src/services/` - business logic. `aiProvider.ts` is 8k+ lines, the hot spot
- `apps/api/src/services/store.ts` - persistence (Supabase prod, JSON dev)
- `apps/web/src/components/` - React views
- `plugins/roblox-studio/` - Luau connector only, no business logic
- `scripts/` - deploy + smoke + benchmark scripts
- `supabase/` - DB migrations and schema
- `docs/` - architecture, deploy, release checklist
- `.opencode/skills/` - project-specific skills (opencode loads these automatically)

## Canonical Commands

- `node scripts/deploy-verify.mjs` - chains typecheck + build + test + deploy
- `node scripts/deploy-verify.mjs api` - api only
- `node scripts/deploy-verify.mjs web` - web only
- `node scripts/deploy-verify.mjs --check` - checks only, no deploy
- `npm run typecheck` - tsc per workspace
- `npm run test` - vitest in apps/api
- `npm run test:visual` - playwright in apps/web
- `npm run dashboard:providers` - provider health
- `npm run smoke:models` - chat smoke across providers
- `npm run smoke:thinking` - thinking matrix smoke
- `node scripts/search-vectis-users.mjs <substring>` - find a user in vectis_collections by email or name
- `node scripts/dump-all-vectis-users.mjs` - list every user with their evidence, projects, and org membership

## Efficient Agent Workflow

- Start non-trivial repo work with the memory quick pass, then inspect only the current files and symbols needed for the request. Re-verify unstable external facts live instead of re-reading unrelated repo areas.
- Use `rg` to locate symbols and bounded file reads for context. Do not dump whole large sources, generated files, or broad recursive search results unless the task specifically needs them.
- Decide whether the request is answer-only, diagnosis, or implementation before acting. Answer-only work stays read-only. Diagnosis inspects and explains without patching unless a fix is requested.
- Batch connected edits. Run focused tests while iterating, then run `node scripts/deploy-verify.mjs` once after the final code change. Use `--check` for a requested audit or health claim, not merely because a read-only question names this repo.
- Keep `gpt-5.6-terra` at Medium for scoped investigation, routine fixes, and coordination. Escalate to a stronger model or higher reasoning only for cross-cutting design, ambiguous root causes, security-sensitive changes, or repeated failed attempts. Return to the default after the hard subtask.
- Prefer the project's existing skills and scripts when their scope matches the request. Do not build a new helper, repeat discovery, or add dependencies when an established path already provides the needed evidence.

## Boundaries

### Always

- Run `node scripts/deploy-verify.mjs` after any code change. Local dev is NOT a deploy
- Add or update tests when changing code
- Read `apps/api/src/services/aiProvider.ts` carefully before touching AI flows
- Pin provider behavior with a config flag, not a hard-coded branch
- Use the project logger (`createLogger({ service })`), not `console.log`
- Preserve the existing import order: external, internal, types
- When changing prompts in `aiProvider.ts`, also update the model status note in `apps/api/src/services/config.ts`
- Use the shared persona and JSON rules in `aiProvider.ts` (`vectisCorePersona`, `thinkingSystemPrompt`, `jsonOutputRules`) instead of hard-coding persona lines in each provider
- Position Vectis as AI change-set review, not file sync. Roblox Studio Script Sync (June 2026) commoditized on-disk script mirroring. Lead with review-before-apply, per-patch rollback, 40+ instance classes, Visual QA. Do not market "no manual copy-pasting" or "external editor" angles
- Keep the Content-Security-Policy directives in `apps/api/src/csp.ts` (`WEB_CSP`) and `apps/web/public/_headers` identical. Always run `npm run test` to verify they remain synchronized.


### Ask First

- Adding new dependencies
- Changing Stripe price IDs, webhook secrets, or env var names
- Changing the Supabase schema
- Changing deploy scripts (`scripts/huggingface-deploy.mjs`, `scripts/cloudflare-pages-deploy.mjs`)
- Changing the public model picker lineup
- Renaming env vars or production URLs

### Never

- Use em dashes. Use a plain hyphen instead
- Pin `NVIDIA_API_KEY` to "latest" - use `vectis-nvidia-api-key:1`
- Commit secrets, `.env`, or live Stripe/Roblox keys
- Edit `codex-*.log`, `scratch_diff*.txt`, or `fix-*.js` in repo root
- Force-push to main
- Mark a deploy done after `npm run dev`. Local dev is NOT a deploy
- Add `chat_template_kwargs` to NVIDIA NIM requests. Use top-level `reasoning_effort`
- Switch to a fallback model when a direct provider times out. Fail clean
- Make buttons or cards grow/move on hover (no translateY, scale, or padding changes on :hover)

## Code Style

- TypeScript strict mode. No `any` - use `unknown` and narrow
- Named exports only in `apps/api/src/`
- Keep `apps/api/src/services/aiProvider.ts` under 9k lines. Extract intent, prompts, providers, validators into separate files when it grows
- Imperative language in this file. Imperative > prose

## Testing

- Unit: vitest in `apps/api/src/tests`. Single file: `npx vitest run src/tests/<file>.test.ts`
- Visual: playwright in `apps/web/tests`
- Connector roundtrip: `npm run verify:connector`
- Bridge perf: `npm run audit:bridge`
- Provider smoke: `npm run smoke:models`, `npm run smoke:thinking`
- All tests must pass before deploy

## Deploy Rules (MANDATORY - READ THIS FIRST)

After any code or production-facing config change, you MUST deploy before ending your turn unless the user explicitly says "do not deploy."

**Do NOT just run `npm run dev` and call it done. Local dev server is NOT a deploy.**

### What counts as a "code change" that requires deploy

- Editing any `.ts`, `.tsx`, `.lua`, `.mjs`, `.json` (non-lockfile) file in `apps/`
- Changing the Dockerfile, `package.json` scripts, or `docs/deploy.md`
- Modifying prompt templates, validation rules, or provider config

### What does NOT require deploy

- Editing `AGENTS.md`, `README.md`, `.gitignore`, docs, scripts in `scripts/`
- Changing `.env` (local only)
- Editing `.opencode/skills/` (these are agent context, not runtime code)

### Rules

- If typecheck, build, or tests fail, fix the issue first - never deploy broken code
- Never change environment variables or production URLs without explicit permission
- API deploys to Hugging Face Spaces via `scripts/huggingface-deploy.mjs`
- Web deploys to Cloudflare Pages via `scripts/cloudflare-pages-deploy.mjs`

## Critical Files

- `apps/api/src/app.ts:1` - Express bootstrap, route registration, startup migrations
- `apps/api/src/services/aiProvider.ts:1` - 8k-line multi-provider engine
- `apps/api/src/services/store.ts:1` - persistence layer (Supabase + JSON)
- `apps/api/src/services/safety.ts:1` - Luau validator
- `apps/api/src/services/config.ts:1` - model registry, provider selection, thinking mapping
- `apps/api/src/services/billing.ts:1` - Stripe webhook handler
- `apps/api/src/services/plans.ts` - plan catalog, topUpPacks
- `apps/web/src/components/ChatWorkspace.tsx:1` - main AI chat UI
- `plugins/roblox-studio/VectisCodeConnector.lua:1` - Studio bridge entry
- `scripts/deploy-verify.mjs:1` - mandatory deploy chain

## Data Source Map

Two user surfaces in production. Pick the right one before searching for a person.

| Surface | Storage | What lives there | How to query |
|---|---|---|---|
| App users (admin panel) | Supabase `vectis_collections` table, `collection_name='users'`, JSONB `data` column | Every account the app has ever created: firebase, google, private. Fields: `id`, `email`, `displayName`, `authProvider` (`firebase`/`google`/`private`), `googleUserId` or `googleUserIds[]`, `robloxUserId`, `status`, `createdAt`, `lastSeenAt`. | `node scripts/search-vectis-users.mjs <email-or-name>` |
| Auth identities (low-level) | Supabase `auth.users` (GoTrue) | Only direct Google-OAuth signups. Most app users are NOT here. Use only for diagnosing Supabase Auth bugs. | `GET /auth/v1/admin/users` with service role key |

Signups do not emit `customerEvidence`. A brand-new user is invisible in the admin panel until they create a project, send a message, or hit any tracked event. If you need to know "who signed up this week", query `vectis_collections` and sort by `createdAt` - do not query `auth.users`.

## Model Status

The single source of truth for available models is `apps/api/src/services/config.ts` (`aiModels` array). Do not maintain a separate model list in this file.

Run `npm run smoke:models` and `npm run smoke:thinking` to verify live provider status before trusting any model status claims.

Key principles (durable rules):
- Google Vertex AI is the default provider for Gemini models when `GOOGLE_CLOUD_PROJECT` is configured; Yunwu is the fallback
- Vertex auth uses ADC (`gcloud auth application-default login`) locally and `GOOGLE_APPLICATION_CREDENTIALS` in prod
- Eval-only suffixed model ids (`-yunwu`/`-google`) force a specific provider for A/B comparison
- `googleVertexModelName()` in `config.ts` maps internal model ids to Vertex publisher model names
- NVIDIA NIM gates thinking on top-level `reasoning_effort`, not `chat_template_kwargs`
- `nvidiaAnswerMaxTokens` is 8192 (off) / 16384 (on); `nvidiaPatchMaxTokens` is 16384
- MiMo uses `thinking: { type: "enabled" | "disabled" }`, not `reasoning_effort`; MiMo fetch gets AbortController timeout, patch gets full 600s
- DeepSeek routes to direct API (not NVIDIA NIM) when `DEEPSEEK_API_KEY` is configured
- GLM routes only when a direct Z.AI key is configured; the NVIDIA route is held due to multi-minute stalls
- Frontend NVIDIA labels: Off, High, Max
- Thinking system prompt: "Think step by step, then give a thorough analysis with specific, actionable recommendations"

## Common Pitfalls

| Symptom | Cause | Fix |
|---|---|---|
| NVIDIA NIM returns no thinking | Sent `chat_template_kwargs` | Remove; only top-level `reasoning_effort` works |
| GLM hangs 300s on HF Spaces | Used NVIDIA NIM route | Hold GLM; route through fallback when no Z.AI key |
| Chat answers truncated at ~512 tokens | `nvidiaAnswerMaxTokens` was 512 non-thinking | Use 8192 (off) / 16384 (on) |
| Eval kills HF Spaces request | Provider hung past 300s | `providerTimeoutMs: 120_000` in eval handler |
| Stream cancels early on partial thinking | `streamContentIsUsable` threshold too low | 200+ chars and 3+ sentences required |
| Deploy "succeeds" but app is broken | Only ran `npm run dev` | Run `node scripts/deploy-verify.mjs` |
| Vertex returns 403 billing not enabled | GCP project missing billing | Enable billing at console.developers.google.com/billing |
| Vertex ADC fails in prod | No GOOGLE_APPLICATION_CREDENTIALS | Set env var to service account JSON key path |
| Studio patch never applies | Plugin pointing to localhost | Confirm endpoint is `https://api.vectiscode.com` |
| Shop preview rejected unfairly | Validator flags safe product that only deducts currency | Allowed when request did not explicitly require gameplay perks |
| Shop UI has white checkerboard background | Model chose wrong backdrop | Prompt + validator reject; require cart/basket/bag launcher center-left |
| Intermittent pixelated web font | Non-standard `font-weight: 450` triggered variable-font interpolation | Use `font-weight: 500` and add `font-synthesis: none` to body |
| New signups invisible in admin panel | Signup route does not write `customerEvidence` | Query `vectis_collections` directly, or add a `signup` event in the auth route |
