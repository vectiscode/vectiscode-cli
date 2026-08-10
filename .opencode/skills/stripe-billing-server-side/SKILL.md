---
name: stripe-billing-server-side
description: Use when touching Stripe code, price IDs, webhook handlers, the credit ledger, or the plan catalog. Covers the server-only Stripe setup, webhook signature verification, planAllowsPremiumModels gating, and the credit decrement pattern. Do NOT use for frontend Stripe Elements - the project uses server-side only.
---

# Stripe Billing (Server-Side Only)

## Setup

Stripe is server-side only. The web UI never touches Stripe.js or Elements. All checkout and customer portal flows are redirects to Stripe-hosted pages.

Required env vars in Render:

```
STRIPE_SECRET_KEY=
STRIPE_WEBHOOK_SECRET=
STRIPE_PRICE_ID_<PLAN>=...
```

## Plan catalog

Plans live in `apps/api/src/services/plans.ts`:

```ts
export const planCatalog = {
  free: { ... },
  pro: { ... },
  team: { ... },
};
```

Each plan has credits, premium-model access, and price ID. The `planAllowsPremiumModels(plan)` function gates Yunwu and other premium providers.

## Webhook flow

`apps/api/src/services/billing.ts` exposes `handleStripeWebhook(req, res)`:

1. Verify signature with `STRIPE_WEBHOOK_SECRET`
2. Switch on `event.type`:
   - `customer.subscription.created` - log subscription
   - `customer.subscription.updated` - update plan
   - `customer.subscription.deleted` - downgrade to free
   - `invoice.paid` - refresh credit allowance
   - `invoice.payment_failed` - mark account
3. Post to Discord via `discordBot.postMilestone` if relevant

Webhook endpoint: `POST /billing/webhook`. Signature verification is mandatory - reject unsigned requests with 400.

## Credit accounting

`apps/api/src/services/usageAccounting.ts` merges and normalizes AI usage into the credit ledger. The `store` layer persists ledger entries. `topUpPacks` in `plans.ts` define one-time credit purchases.

To check if a user can make a call:

```ts
const allowed = await store.checkCredits(userId, costCredits);
if (!allowed) return res.status(402).json({ error: "insufficient_credits" });
```

## Rules

- Never log the full Stripe response - redact PII
- Always verify webhook signatures. Unsigned = reject
- Never store `STRIPE_SECRET_KEY` in the web app
- Never expose the customer portal URL builder to the client
- Update `planCatalog` and `topUpPacks` together when adding a plan
- Credit costs are defined in `services/config.ts` (e.g. `GENERATED_ICON_COST_CREDITS`)

## Critical files

- `apps/api/src/services/billing.ts` - webhook + Stripe client
- `apps/api/src/services/plans.ts` - plan catalog, topUpPacks
- `apps/api/src/services/pricing.ts` - price display
- `apps/api/src/services/usageAccounting.ts` - credit ledger
- `apps/api/src/routes/billing.ts` - HTTP routes
