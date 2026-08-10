import { beforeEach, describe, expect, it } from "vitest";
import { createPlanCheckoutSession, handleConstructedStripeEvent, lineItemForPlan, priceIdForPlan } from "../services/billing.js";
import { calculateUsageCostCredits, config } from "../services/config.js";
import {
  fixedTopUpPricePerThousand,
  planAmountCents,
  planCreditEconomics,
  studioCustomTopUpPricePerThousand
} from "../services/pricing.js";
import { store } from "../services/store.js";
import type { PlanName } from "../types.js";

describe("pricing and billing safety", () => {
  beforeEach(async () => {
    await store.reset();
  });

  it("always uses inline price data for clean checkout descriptions", () => {
    const originalProPriceId = config.stripe.proPriceId;
    const originalProAnnualPriceId = config.stripe.proAnnualPriceId;

    try {
      config.stripe.proPriceId = "price_pro_monthly_test";
      config.stripe.proAnnualPriceId = "price_pro_annual_test";

      expect(priceIdForPlan("pro", "monthly")).toBe("price_pro_monthly_test");
      expect(priceIdForPlan("pro", "annual")).toBe("price_pro_annual_test");

      const annual = lineItemForPlan("pro", "annual") as any;
      expect(annual.price_data.unit_amount).toBe(planAmountCents("pro", "annual"));
      expect(annual.price_data.recurring.interval).toBe("year");
      expect(annual.price_data.product_data.description).toContain("billed annually");

      config.stripe.proAnnualPriceId = "";
      const fallback = lineItemForPlan("pro", "annual") as any;
      expect(fallback.price_data.unit_amount).toBe(planAmountCents("pro", "annual"));
      expect(fallback.price_data.recurring.interval).toBe("year");
    } finally {
      config.stripe.proPriceId = originalProPriceId;
      config.stripe.proAnnualPriceId = originalProAnnualPriceId;
    }
  });

  it("blocks new checkout sessions for workspaces with active subscriptions", async () => {
    const user = await store.ensurePrivateOwner();
    const org = await store.fetchOrganizationForUser(user.id);
    expect(org).toBeTruthy();
    await store.updateOrganizationBilling(org!.id, {
      stripeCustomerId: "cus_active_subscription_test",
      stripeSubscriptionId: "sub_active_subscription_test",
      stripeSubscriptionStatus: "active"
    });
    const updated = await store.fetchOrganization(org!.id);

    await expect(createPlanCheckoutSession(user, updated!, "pro", "monthly")).rejects.toMatchObject({
      message: expect.stringContaining("already has an active Stripe subscription"),
      statusCode: 409
    });
  });

  it("does not grant top-up credits twice when a checkout session is replayed", async () => {
    const user = await store.ensurePrivateOwner();
    const org = await store.fetchOrganizationForUser(user.id);
    expect(org).toBeTruthy();
    org!.plan = "studio";
    await store.saveOrganization(org!);
    const startingBalance = await store.getCreditBalance(org!.id);

    const session = {
      id: "cs_test_topup_replay",
      mode: "payment",
      payment_status: "paid",
      client_reference_id: org!.id,
      customer: "cus_test",
      subscription: null,
      amount_total: 200,
      currency: "usd",
      metadata: {
        type: "top_up",
        userId: user.id,
        organizationId: org!.id,
        pack: "small"
      }
    };

    await handleConstructedStripeEvent({
      id: "evt_test_topup_1",
      type: "checkout.session.completed",
      livemode: false,
      data: { object: session }
    } as any);
    await handleConstructedStripeEvent({
      id: "evt_test_topup_2",
      type: "checkout.session.completed",
      livemode: false,
      data: { object: session }
    } as any);

    expect(await store.getCreditBalance(org!.id)).toBe(startingBalance + 1000);
    const processed = await store.fetchStripeProcessedEvents();
    expect(processed.some((event) => event.stripeSessionId === session.id && event.duplicateIgnoredAt)).toBe(true);
  });

  it("reclaims stale processing Stripe events for webhook retry recovery", async () => {
    const staleCreatedAt = new Date(Date.now() - 20 * 60 * 1000).toISOString();
    const eventId = "evt_test_stale_processing";
    const recordId = `stripe_event_${eventId}`;

    expect(await store.claimStripeProcessedEvent({
      id: recordId,
      stripeEventId: eventId,
      eventType: "checkout.session.completed",
      action: "stripe_webhook_event",
      status: "processing",
      metadata: { attempt: 1 },
      createdAt: staleCreatedAt
    })).toBe(true);

    expect(await store.claimStripeProcessedEvent({
      id: recordId,
      stripeEventId: eventId,
      eventType: "checkout.session.completed",
      action: "stripe_webhook_event",
      status: "processing",
      metadata: { attempt: 2 },
      createdAt: new Date().toISOString()
    })).toBe(true);

    const processed = await store.fetchStripeProcessedEvents();
    const reclaimed = processed.find((event) => event.id === recordId);
    expect(reclaimed?.status).toBe("processing");
    expect(reclaimed?.metadata?.attempt).toBe(2);
    expect(reclaimed?.metadata?.previousClaimedAt).toBe(staleCreatedAt);
    expect(typeof reclaimed?.metadata?.reclaimedFromProcessingAt).toBe("string");
  });

  it("stores billing cycle from subscription webhooks", async () => {
    const originalProAnnualPriceId = config.stripe.proAnnualPriceId;

    try {
      config.stripe.proAnnualPriceId = "price_pro_annual_cycle_test";
      const user = await store.ensurePrivateOwner();
      const org = await store.fetchOrganizationForUser(user.id);
      expect(org).toBeTruthy();
      await store.updateOrganizationBilling(org!.id, { stripeCustomerId: "cus_cycle_test" });

      await handleConstructedStripeEvent({
        id: "evt_test_subscription_cycle",
        type: "customer.subscription.updated",
        livemode: false,
        data: {
          object: {
            id: "sub_cycle_test",
            customer: "cus_cycle_test",
            status: "active",
            metadata: { plan: "pro", billingCycle: "annual" },
            cancel_at_period_end: false,
            items: {
              data: [{
                current_period_end: 1_900_000_000,
                price: {
                  id: "price_pro_annual_cycle_test",
                  unit_amount: planAmountCents("pro", "annual"),
                  currency: "usd",
                  recurring: { interval: "year" }
                }
              }]
            }
          }
        }
      } as any);

      const updated = await store.fetchOrganization(org!.id);
      expect(updated?.plan).toBe("pro");
      expect(updated?.billingCycle).toBe("annual");
      expect(updated?.stripePriceId).toBe("price_pro_annual_cycle_test");
    } finally {
      config.stripe.proAnnualPriceId = originalProAnnualPriceId;
    }
  });

  it("uses Stripe price identity before subscription metadata when syncing plans", async () => {
    const originalProPriceId = config.stripe.proPriceId;
    const originalStudioPriceId = config.stripe.studioPriceId;

    try {
      config.stripe.proPriceId = "price_pro_metadata_guard_test";
      config.stripe.studioPriceId = "price_studio_metadata_guard_test";
      const user = await store.ensurePrivateOwner();
      const org = await store.fetchOrganizationForUser(user.id);
      expect(org).toBeTruthy();
      await store.updateOrganizationBilling(org!.id, { stripeCustomerId: "cus_metadata_guard_test" });

      await handleConstructedStripeEvent({
        id: "evt_test_subscription_metadata_guard",
        type: "customer.subscription.updated",
        livemode: false,
        data: {
          object: {
            id: "sub_metadata_guard_test",
            customer: "cus_metadata_guard_test",
            status: "active",
            metadata: { plan: "studio", billingCycle: "monthly" },
            cancel_at_period_end: false,
            items: {
              data: [{
                current_period_end: 1_900_000_000,
                price: {
                  id: "price_pro_metadata_guard_test",
                  unit_amount: planAmountCents("pro", "monthly"),
                  currency: "usd",
                  recurring: { interval: "month" }
                }
              }]
            }
          }
        }
      } as any);

      const updated = await store.fetchOrganization(org!.id);
      expect(updated?.plan).toBe("pro");
      expect(updated?.stripePriceId).toBe("price_pro_metadata_guard_test");
    } finally {
      config.stripe.proPriceId = originalProPriceId;
      config.stripe.studioPriceId = originalStudioPriceId;
    }
  });

  it("does not grant a paid plan for an unknown subscription price", async () => {
    const user = await store.ensurePrivateOwner();
    const org = await store.fetchOrganizationForUser(user.id);
    expect(org).toBeTruthy();
    org!.plan = "studio";
    await store.saveOrganization(org!);
    await store.updateOrganizationBilling(org!.id, { stripeCustomerId: "cus_unknown_price_test" });

    await handleConstructedStripeEvent({
      id: "evt_test_subscription_unknown_price",
      type: "customer.subscription.updated",
      livemode: false,
      data: {
        object: {
          id: "sub_unknown_price_test",
          customer: "cus_unknown_price_test",
          status: "active",
          metadata: { plan: "studio", billingCycle: "monthly" },
          cancel_at_period_end: false,
          items: {
            data: [{
              current_period_end: 1_900_000_000,
              price: {
                id: "price_unknown_plan_test",
                unit_amount: 100,
                currency: "usd",
                recurring: { interval: "month" }
              }
            }]
          }
        }
      }
    } as any);

    const updated = await store.fetchOrganization(org!.id);
    expect(updated?.plan).toBe("free");
    expect(updated?.stripePriceId).toBe("price_unknown_plan_test");
  });

  it("keeps annual full-usage economics above the 15 percent floor", () => {
    const paidPlans: Array<Exclude<PlanName, "free">> = ["starter", "pro", "studio"];
    const sampleInputTokens = 20_000;
    const sampleOutputTokens = 5_000;

    for (const plan of paidPlans) {
      const monthly = planCreditEconomics(plan, "monthly");
      const annual = planCreditEconomics(plan, "annual");
      const monthlyCredits = calculateUsageCostCredits("gemini-3.5-flash", sampleInputTokens, sampleOutputTokens, monthly.creditValueUsd, monthly.targetMargin);
      const annualCredits = calculateUsageCostCredits("gemini-3.5-flash", sampleInputTokens, sampleOutputTokens, annual.creditValueUsd, annual.targetMargin);
      expect(monthly.creditValueUsd).toBeCloseTo(planAmountCents(plan, "monthly") / 100 / (plan === "starter" ? 4000 : plan === "pro" ? 10000 : 20000), 6);
      expect(annualCredits).toEqual(monthlyCredits);

      const monthlyRevenue = annual.monthlyEquivalentAmountCents / 100;
      const providerCost = monthlyRevenue * (1 - annual.targetMargin);
      const stripeFeeMonthly = (((planAmountCents(plan, "annual") / 100) * 0.015) + 0.25) / 12;
      const afterStripeMargin = (monthlyRevenue - providerCost - stripeFeeMonthly) / monthlyRevenue;
      expect(afterStripeMargin).toBeGreaterThanOrEqual(0.15);
    }
  });

  it("keeps fixed and Studio discounted top-ups margin-positive", () => {
    const studioAnnual = planCreditEconomics("studio", "annual");
    const modeledProviderCostPerThousand = 1000 * studioAnnual.creditValueUsd * (1 - studioAnnual.targetMargin);

    expect(fixedTopUpPricePerThousand()).toBe(2);
    expect(studioCustomTopUpPricePerThousand()).toBe(1.4);
    expect(fixedTopUpPricePerThousand()).toBeGreaterThan(modeledProviderCostPerThousand);
    expect(studioCustomTopUpPricePerThousand()).toBeGreaterThan(modeledProviderCostPerThousand);
  });

  it("session claim does not populate top-level stripeEventId to prevent unique constraints in production", async () => {
    const user = await store.ensurePrivateOwner();
    const org = await store.fetchOrganizationForUser(user.id);
    expect(org).toBeTruthy();
    org!.plan = "studio";
    await store.saveOrganization(org!);

    const session = {
      id: "cs_test_unique_constraint",
      mode: "payment",
      payment_status: "paid",
      client_reference_id: org!.id,
      customer: "cus_test",
      subscription: null,
      amount_total: 200,
      currency: "usd",
      metadata: {
        type: "top_up",
        userId: user.id,
        organizationId: org!.id,
        pack: "small"
      }
    };

    await handleConstructedStripeEvent({
      id: "evt_test_unique_1",
      type: "checkout.session.completed",
      livemode: false,
      data: { object: session }
    } as any);

    const processed = await store.fetchStripeProcessedEvents();
    const sessionRecord = processed.find((r) => r.stripeSessionId === session.id);
    expect(sessionRecord).toBeTruthy();
    expect(sessionRecord!.stripeEventId).toBeUndefined();
    expect(sessionRecord!.metadata?.stripeEventId).toBe("evt_test_unique_1");
  });
});
