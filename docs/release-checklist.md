# Vectis Code Release Checklist

Use this for private alpha, invite-only early access, and public beta decisions.

## Private alpha

- `npm run test`
- `npm run typecheck`
- `npm run build`
- Start the app locally with `npm run dev`.
- Open `https://api.vectiscode.com/readiness` and review all warnings.
- Confirm Firebase login or private owner login works.
- Confirm the Studio plugin pairs, syncs at least one script, receives a reviewed patch, applies it, and can undo the last patch.
- Clear local data before handing the machine or test workspace to another tester.

## Invite-only early access

- Deploy the API behind HTTPS.
- Deploy the web app behind HTTPS.
- Set `WEB_APP_URL` and `API_BASE_URL` to deployed HTTPS URLs.
- Set `COOKIE_SECURE=true`.
- Set `ALLOW_PRIVATE_OWNER_LOGIN=false`.
- Set `ALLOW_LOCAL_FILE_STORE=false`.
- Set `DATABASE_MODE=supabase` and confirm the deployed API can read/write Supabase.
- Apply `supabase/schema.sql` and confirm attachment bytes can write to the `vectis-attachments` Supabase Storage bucket.
- Configure Stripe: `STRIPE_SECRET_KEY`, `STRIPE_PRO_PRICE_ID`, and `STRIPE_WEBHOOK_SECRET`.
- Configure at least one external auth provider.
- Configure at least one non-Google AI provider, preferably Yunwu.
- Update the Studio plugin endpoint field to the deployed API URL.
- Confirm `GET /readiness` returns `ok: true`.

## Public beta

- Confirm Stripe Checkout, signed webhooks, subscription entitlements, cancellation, portal access, and top-ups pass a controlled production canary.
- Confirm durable Supabase rate limiting is enabled in production.
- Run `npm run backup:check`, create a database and Storage backup, and record a successful disposable restore test using `docs/operations-runbook.md`.
- Confirm Sentry receives API and browser errors and the incident runbook has a named operator.
- Run `npm run audit:bundle` and confirm dependency audit findings have no unaccepted high-severity runtime advisory.
- Publish clear tester terms, privacy policy, and data deletion flow.
- Do not launch paid public consumer sales with fake provider details, missing mandatory provider identity, or an AI-generated address.
- Run a manual Roblox Studio QA pass on a throwaway place and one real project copy.
- Run `npm run canary:production` and record the deployed source SHA.
