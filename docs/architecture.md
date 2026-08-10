# Architecture

## Flow

1. A creator signs into the web app and opens a project.
2. Roblox Studio plugin creates a pairing code through `POST /studio/connect`.
3. The web app claims the pairing code for the selected project through `POST /projects/:projectId/studio/claim`.
4. The plugin uploads a snapshot of scripts and key instances through `POST /studio/snapshot`.
5. The creator asks the AI for a feature in the web app.
6. The API builds project context, calls the selected AI provider, validates the generated change set, stores it as `ready_for_review`, and returns it.
7. The plugin polls `GET /studio/session/:sessionId/pending-patches?connectorToken=...`.
8. The creator approves a task in the web app. The plugin applies the reviewed task automatically, records a local rollback boundary, and reports live task status.
9. The plugin reports `POST /studio/changes/:id/apply-result` and stores task observations for the web timeline.
10. If the creator opted into Visual QA, the plugin captures the Studio viewport and uploads hidden task evidence through `POST /studio/task-runs/:taskRunId/screenshots`.

All plugin-side reads and writes require the connector token. Pairing codes expire quickly, connector sessions expire, and the plugin clears stored session data when the API rejects its token.

## MVP boundaries

- Scripts, folders, remotes, Tools, editable map geometry, lights, prompts, world UI, and structural StarterGui UI are supported.
- No 3D asset generation yet.
- Generated code is never applied before web review. After approval, Studio Bridge applies it automatically and keeps rollback history.
- Viewport screenshots are optional task evidence. Roblox Studio permission is requested only after the creator explicitly enables Visual QA.
- Production authentication uses Firebase Google login, with Roblox OAuth optional when configured.
- Local JSON persistence is for development only. Production persistence uses Supabase Postgres plus Supabase Storage.
- Stripe Checkout, Billing Portal, and signed webhooks manage Pro subscription state.

## Release gates

- `npm run test`, `npm run typecheck`, and `npm run build` must pass.
- `GET /readiness` must return `ok: true` in the target environment.
- Production must use HTTPS for `WEB_APP_URL` and `API_BASE_URL`.
- `ALLOW_PRIVATE_OWNER_LOGIN=false` in production.
- `ALLOW_LOCAL_FILE_STORE=false` in production.
- `DATABASE_MODE=supabase` in production.
- `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are configured on the API service.
- Stripe billing variables must be configured before selling Pro access.
- The Studio plugin API endpoint must point at the deployed API, not a local server.

## Differentiators vs native file sync

Vectis Code is not a file-sync tool. Roblox Studio Script Sync (full release June 2026) commoditized bidirectional on-disk mirroring for Script, LocalScript, ModuleScript, and Folder instances. Do not market Vectis as file sync, external-editor integration, or "no manual copy-pasting." Those axes are now free and native.

The durable wedges are:

- **AI change-set generation** across 40+ instance classes (parts, UI, lights, prompts, remotes, Tools, animations), not just scripts.
- **Review before apply, always on.** Generated change sets wait in a web review queue with file-by-file diffs. Nothing touches Studio until the creator approves. Script Sync has no review gate; whatever is on disk lands in Studio.
- **Per-patch rollback.** Every applied patch is versioned and individually reversible. Script Sync's "conflict resolution" is a one-shot keep-Studio-vs-keep-disk at sync time, not per-change undo.
- **Structured project-tree context for the AI.** Vectis uploads paths, classes, properties, and sources as a single snapshot the AI reads. Script Sync puts files on disk; an external AI still has to be pointed at them.
- **Automatic Studio Output error fixes.** Vectis reads recent Studio warnings/errors and proposes direct fixes. Script Sync has no concept of Studio Output.
- **Optional Visual QA.** Viewport screenshots after apply, as task evidence. Script Sync has no AI feedback loop.

Risk to watch: if Roblox ships an in-Studio AI assistant on top of Script Sync, the review-gate and per-patch rollback wedges compress. Plan product direction around that, not around file sync.
