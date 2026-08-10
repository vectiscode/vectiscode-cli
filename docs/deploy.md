# Deploying VectisCode

## Architecture

```
vectiscode.com          -> Cloudflare Pages
api.vectiscode.com      -> Hugging Face Space
database                -> Supabase Postgres
attachment bytes        -> Supabase Storage
login                   -> Firebase Auth
billing                 -> Stripe
AI providers            -> Google Vertex AI, Yunwu, Xiaomi, DeepSeek, and direct providers
```

Google Vertex AI is the preferred Gemini provider when `GOOGLE_CLOUD_PROJECT` is configured. Firebase supplies web authentication. Do not enable Firestore or deploy the API to Cloud Run.

## Free-tier cost rules

Supabase Free does not charge usage overages, but projects can be restricted if they keep exceeding quota. Keep `FREE_TIER_MODE=true` until paid quotas and monitoring are intentionally enabled. `PUBLIC_SIGNUPS_ENABLED=true` allows new users to sign up.

## Supabase

The database schema, tables, indexes, triggers, and storage buckets are automatically reconciled during API startup using a secure connection to the database.

- `public.vectis_collections`, the private service-role document table used by the API
- indexes for collection and JSON queries
- the private `vectis-attachments` Storage bucket

Production startup requires `SUPABASE_DB_URL` and applies the idempotent `supabase/schema.sql` before serving traffic. A missing connection URL or failed schema reconciliation blocks startup instead of silently running against an outdated schema.

Token-safe helper commands (for local/manual checks):

```
npm run supabase:list
npm run supabase:apply-schema
```

`supabase:list` requires `SUPABASE_ACCESS_TOKEN`. `supabase:apply-schema` requires `SUPABASE_DB_URL` (direct/pooled connection string). Do not commit either value.

Set these Hugging Face Space secrets and variables:

```
DATABASE_MODE=supabase
SUPABASE_URL=...
SUPABASE_SERVICE_ROLE_KEY=...
SUPABASE_STORAGE_BUCKET=vectis-attachments
FREE_TIER_MODE=true
DURABLE_RATE_LIMITS=true
JSON_BODY_LIMIT=2mb
MAX_SNAPSHOTS_PER_PROJECT=2
PUBLIC_SIGNUPS_ENABLED=true
ADMIN_EMAILS=ardatest4@gmail.com
SENTRY_DSN=...
```

Set `HF_TOKEN` locally or use the local Git credential manager. `npm run deploy:api` pushes a clean deployment commit to the `juicy123/vectiscode` Hugging Face Space and embeds the source repository commit for health verification.

## Firebase Login

Set Firebase web app config on the API service. The frontend receives this public config from `/auth/config`.

```
FIREBASE_PROJECT_ID=...
FIREBASE_API_KEY=...
FIREBASE_AUTH_DOMAIN=...
FIREBASE_APP_ID=...
FIREBASE_STORAGE_BUCKET=...
FIREBASE_MESSAGING_SENDER_ID=...
```

## Stripe

The live Stripe account already has active VectisCode prices and an enabled webhook for:

```
https://api.vectiscode.com/stripe/webhook
```

Configure these as Hugging Face Space secrets and variables:

```
STRIPE_SECRET_KEY=...
STRIPE_WEBHOOK_SECRET=...
STRIPE_STARTER_PRICE_ID=price_1TYwCEKST7p18B964rulr68V
STRIPE_STARTER_ANNUAL_PRICE_ID=price_1TYwCFKST7p18B96STgFxcy5
STRIPE_PRO_PRICE_ID=price_1TYwCHKST7p18B96CZcTbLmO
STRIPE_PRO_ANNUAL_PRICE_ID=price_1TYwCIKST7p18B96WpjzwBBp
STRIPE_STUDIO_PRICE_ID=price_1TYwCJKST7p18B96YrPd1dgN
STRIPE_STUDIO_ANNUAL_PRICE_ID=price_1TYwCKKST7p18B96SVO94yEz
STRIPE_TOP_UP_SMALL_PRICE_ID=price_1TYwCMKST7p18B96wNcRz4Oh
STRIPE_TOP_UP_LARGE_PRICE_ID=price_1TYwCNKST7p18B96yoZRAUHI
STRIPE_PRO_CURRENCY=usd
```

Webhook events:

- `checkout.session.completed`
- `customer.subscription.created`
- `customer.subscription.updated`
- `customer.subscription.deleted`

Production readiness fails if Stripe secrets are missing.

## Cloudflare Pages

Build and deploy the frontend with:

```
npm run deploy:web
```

Cloudflare Pages variables:

```
VITE_API_URL=https://api.vectiscode.com
VITE_WS_URL=wss://api.vectiscode.com/ws
VITE_SENTRY_DSN=...
```

## Verify

Before shipping code:

```
node scripts/deploy-verify.mjs --check
```

For a full deploy:

```
node scripts/deploy-verify.mjs
```

Health checks:

- `https://api.vectiscode.com/health`
- `https://api.vectiscode.com/readiness`
- `https://api.vectiscode.com/auth/config`
- `https://vectiscode.com`

`/readiness` must return `ok: true` in production.
