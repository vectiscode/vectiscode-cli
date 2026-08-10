---
name: supabase-self-healing-migrations
description: Use when changing the Supabase schema, writing new migrations, or troubleshooting startup DB connection failures on Hugging Face Spaces. Covers the IPv6 connection handling, automatic self-healing migrations in apps/api/src/app.ts, the DATABASE_MODE=supabase vs local JSON split, and the supabase/ directory layout. Do NOT use for general SQL help - go to a Postgres skill.
---

# Supabase + Self-Healing Migrations

## Storage modes

The API supports two storage modes via `DATABASE_MODE`:

- `supabase` - production. Connects over IPv6, runs migrations on startup
- `json` (or unset) - dev. Persists to local JSON files in `apps/api/data/`

The mode is selected at app boot. There is no live migration between modes.

## IPv6 on Hugging Face Spaces

Render's outbound networking is IPv6-first. The Supabase Postgres pooler requires `?pgbouncer=true&connection_limit=1` and the connection string must use the direct (not pooler) endpoint for migrations. The startup code in `app.ts` handles this:

```ts
const client = new Client({ connectionString, ssl: { rejectUnauthorized: false } });
await client.connect();  // retries with exponential backoff
```

## Self-healing migrations

`app.ts` runs migrations on boot:

1. Read `supabase/migrations/*.sql` in lexical order
2. Compare to `_migrations` table
3. Apply any unapplied migrations in a transaction
4. Record the new state in `_migrations`

If a migration fails, the app logs the error and retries on next boot. Migrations are idempotent - use `CREATE TABLE IF NOT EXISTS` and `ALTER TABLE ... ADD COLUMN IF NOT EXISTS`.

## Adding a migration

1. Create `supabase/migrations/<timestamp>_<name>.sql`
2. Use `IF NOT EXISTS` for safety
3. Test locally with `DATABASE_MODE=json` first
4. Push to staging, verify migration runs
5. Promote to production

## Local dev

```bash
DATABASE_MODE=json npm run dev
```

Data persists in `apps/api/data/`. To reset, delete that directory or use the profile/studio workspace-data purge controls in the web UI.

## Rules

- Always use `IF NOT EXISTS` for idempotency
- Never edit an already-applied migration - add a new one instead
- Never change the Supabase schema without explicit permission
- Never store secrets in migration files - use env vars and the secrets table
- Run `npm run supabase:apply-schema` only after the migration is tested locally

## Critical files

- `apps/api/src/app.ts` - migration runner (search for "migration" or "self-heal")
- `apps/api/src/services/store.ts` - dual-mode store
- `supabase/migrations/` - SQL migrations in lexical order
- `supabase/schema.sql` - canonical schema reference
- `scripts/supabase-apply-schema.mjs` - apply schema from local
- `scripts/supabase-list-projects.mjs` - list configured projects
