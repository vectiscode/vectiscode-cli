# Operations Runbook

Use this runbook for production backup, restore testing, canary verification, and incidents.

## Routine checks

- Run `node scripts/deploy-verify.mjs --check` before release.
- Run `npm run canary:production` after release.
- Review `https://api.vectiscode.com/readiness` and Sentry errors daily during beta.
- Review provider latency, patch success, refund rate, Studio apply failures, and client errors in Admin.

## Backup

Database and private Storage objects must be backed up together.

1. Install PostgreSQL client tools so `pg_dump` and `pg_restore` are available.
2. Set `SUPABASE_DB_URL`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, and `BACKUP_OUTPUT_DIR`.
3. Keep `BACKUP_OUTPUT_DIR` outside this repository and inside encrypted storage.
4. Run `npm run backup:check`.
5. Run `npm run backup:create`.
6. Confirm the generated manifest, `database.dump`, and Storage object count.
7. Copy the completed backup to a second encrypted location with restricted access.

Do not commit dumps, manifests, attachment objects, or database credentials.

Recommended beta schedule:

- Daily database and Storage backup.
- Retain seven daily, four weekly, and three monthly recovery points.
- Run a restore test at least monthly and before a major billing or persistence release.

## Restore verification

Archive validation does not modify a database:

```text
npm run restore:verify -- C:\secure-backups\vectis-YYYY-MM-DD
```

For a real restore test, provision a disposable database, set `RESTORE_DATABASE_URL`, set `RESTORE_CONFIRM_TARGET=disposable`, then run the same command. Never point `RESTORE_DATABASE_URL` at production.

After database restore, restore Storage objects into a disposable bucket and verify attachment metadata resolves to existing objects. Record the date, archive, duration, and result in the operations log.

## Production canary

`npm run canary:production` verifies release identity, readiness, Supabase mode, Stripe configuration, authentication configuration, security headers, and the published Studio connector.

The following remain manual because they require a real account, payment method, or Roblox Studio place:

- Sign in and sign out through Firebase.
- Complete a Stripe test-mode checkout or a controlled live purchase, confirm webhook entitlement, cancel it, and confirm the portal state.
- Pair a throwaway Studio place, upload a snapshot, generate a change set, review it, apply it, undo it, and upload Visual QA evidence.
- Repeat apply and undo on a copy of one real project.

Never run a live charge or modify a real Studio project without selecting the account, price, place, and rollback point first.

## Incident response

1. Stop additional damage. Disable public signups, affected AI routes, or checkout through existing configuration flags where possible.
2. Preserve evidence. Record UTC start time, release SHA, request IDs, affected users, provider responses, and Sentry event IDs.
3. Classify the incident: authentication, billing, data integrity, Studio application, provider outage, or frontend availability.
4. Roll back the application release if the current SHA caused the failure. Do not roll back the database without a verified compatibility plan.
5. For data integrity incidents, take a fresh backup before repair and test the repair against a disposable restore.
6. Communicate scope and workaround to affected users. Do not claim resolution until health, readiness, canary, and the affected workflow pass.
7. Write a short post-incident report with cause, detection gap, correction, and a regression test.

## Recovery targets

During beta, use an initial recovery point objective of 24 hours and a recovery time objective of 4 hours. Tighten both after measured restore exercises show that the process can support it.
