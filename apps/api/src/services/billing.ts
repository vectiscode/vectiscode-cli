import Stripe from "stripe";
import { randomUUID } from "node:crypto";
import type { Organization, PlanName, User } from "../types.js";
import { config } from "./config.js";
import { createLogger } from "./logger.js";
import { normalizePlanName, planCatalog, planAllowsTopUps, topUpPacks, type TopUpPackId } from "./plans.js";

const log = createLogger({ service: "billing" });
import {
  annualPlanAmountCents,
  fixedTopUpPricePerThousand,
  planAmountCents,
  planCreditEconomics,
  STUDIO_CUSTOM_TOP_UP_CENTS_PER_CREDIT,
  studioCustomTopUpPricePerThousand,
  type BillingCycle
} from "./pricing.js";
import { store } from "./store.js";

let stripeClient: Stripe | undefined;
type TopUpInput = { pack: TopUpPackId } | { usagePercent: number } | { credits: number };
const studioWeeklyCredits = planCatalog.studio.creditsPerWeek;
const configuredPaymentMethods = [
  "alipay",
  "amazon_pay",
  "apple_pay",
  "bacs_debit",
  "bancontact",
  "billie",
  "bizum",
  "blik",
  "card",
  "cartes_bancaires",
  "crypto",
  "customer_balance",
  "eps",
  "giropay",
  "google_pay",
  "ideal",
  "kakao_pay",
  "klarna",
  "kr_card",
  "link",
  "mb_way",
  "mobilepay",
  "multibanco",
  "naver_pay",
  "oxxo",
  "p24",
  "pay_by_bank",
  "payco",
  "paypal",
  "pix",
  "revolut_pay",
  "samsung_pay",
  "satispay",
  "sepa_debit",
  "sofort",
  "swish",
  "twint",
  "upi",
  "us_bank_account",
  "wechat_pay"
] as const;

function stripe() {
  if (!config.stripe.secretKey) {
    throw new Error("Stripe is not configured. Set STRIPE_SECRET_KEY.");
  }

  if (!stripeClient) {
    stripeClient = new Stripe(config.stripe.secretKey);
  }

  return stripeClient;
}

export function stripeConfigured() {
  return Boolean(config.stripe.secretKey);
}

function checkoutPaymentMethodConfiguration() {
  if (config.stripe.paymentMethodConfigurationId) {
    return { payment_method_configuration: config.stripe.paymentMethodConfigurationId };
  }
  return {
    payment_method_types: ["card", "link"] as any[]
  };
}

function configuredPriceIdsAreUsable() {
  const currency = config.stripe.proCurrency.toLowerCase();
  return currency === "eur" || currency === "usd";
}

export async function getBillingStatus(organization: Organization) {
  const hasSubscription = Boolean(organization.stripeSubscriptionId);
  let cancelAtPeriodEnd = false;
  let status = organization.stripeSubscriptionStatus ?? "not_configured";

  if (stripeConfigured() && organization.stripeSubscriptionId) {
    try {
      const subscription = await stripe().subscriptions.retrieve(organization.stripeSubscriptionId);
      status = subscription.status;
      cancelAtPeriodEnd = Boolean(subscription.cancel_at_period_end);
    } catch {
      status = organization.stripeSubscriptionStatus ?? "unknown";
    }
  }

  return {
    plan: normalizePlanName(organization.plan),
    stripeConfigured: stripeConfigured(),
    hasCustomer: Boolean(organization.stripeCustomerId),
    hasSubscription,
    subscriptionStatus: status,
    currentPeriodEnd: organization.billingCurrentPeriodEnd,
    billingCycle: organization.billingCycle ?? billingCycleForPriceId(organization.stripePriceId) ?? "monthly",
    stripePriceId: organization.stripePriceId,
    canManageBilling: stripeConfigured() && Boolean(organization.stripeCustomerId),
    canCancel: stripeConfigured() && hasSubscription && !cancelAtPeriodEnd,
    cancelAtPeriodEnd
  };
}

export async function cancelSubscriptionAtPeriodEnd(organization: Organization) {
  if (!stripeConfigured()) {
    return {
      ok: false,
      status: await getBillingStatus(organization),
      message: "No Stripe subscription is linked to this workspace."
    };
  }

  if (!organization.stripeSubscriptionId) {
    return {
      ok: false,
      status: await getBillingStatus(organization),
      message: "No Stripe subscription is linked to this workspace."
    };
  }

  const subscription = await stripe().subscriptions.update(organization.stripeSubscriptionId, {
    cancel_at_period_end: true
  });

  await store.updateOrganizationBilling(organization.id, {
    stripeSubscriptionStatus: subscription.status,
    billingCurrentPeriodEnd: periodEnd(subscription)
  });

  return {
    ok: true,
    status: await getBillingStatus({
      ...organization,
      stripeSubscriptionStatus: subscription.status,
      billingCurrentPeriodEnd: periodEnd(subscription)
    })
  };
}

export function priceIdForPlan(plan: PlanName, billingCycle: BillingCycle) {
  if (plan === "free") return "";
  if (billingCycle === "annual") {
    if (plan === "starter") return config.stripe.starterAnnualPriceId;
    if (plan === "studio") return config.stripe.studioAnnualPriceId;
    return config.stripe.proAnnualPriceId;
  }
  if (plan === "starter") return config.stripe.starterPriceId;
  if (plan === "studio") return config.stripe.studioPriceId;
  return config.stripe.proPriceId;
}

function billingCycleForPriceId(priceId?: string | null): BillingCycle | undefined {
  if (!priceId) return undefined;
  if ([config.stripe.starterAnnualPriceId, config.stripe.proAnnualPriceId, config.stripe.studioAnnualPriceId].includes(priceId)) {
    return "annual";
  }
  if ([config.stripe.starterPriceId, config.stripe.proPriceId, config.stripe.studioPriceId].includes(priceId)) {
    return "monthly";
  }
  return undefined;
}

function billingCycleForSubscription(subscription: Stripe.Subscription): BillingCycle {
  const metadataCycle = subscription.metadata?.billingCycle;
  if (metadataCycle === "annual" || metadataCycle === "monthly") return metadataCycle;
  const price = subscription.items.data[0]?.price;
  const fromPriceId = billingCycleForPriceId(price?.id);
  if (fromPriceId) return fromPriceId;
  if (price?.recurring?.interval === "year") return "annual";
  return "monthly";
}

function planForConfiguredPriceId(priceId?: string | null): Exclude<PlanName, "free"> | undefined {
  if (!priceId) return undefined;
  if (priceId === config.stripe.starterPriceId || priceId === config.stripe.starterAnnualPriceId) return "starter";
  if (priceId === config.stripe.proPriceId || priceId === config.stripe.proAnnualPriceId) return "pro";
  if (priceId === config.stripe.studioPriceId || priceId === config.stripe.studioAnnualPriceId) return "studio";
  return undefined;
}

function priceMatchesPlan(price: Stripe.Price | undefined, plan: PlanName, billingCycle: BillingCycle) {
  if (!price || plan === "free") return false;
  const expectedInterval = billingCycle === "annual" ? "year" : "month";
  return price.currency === config.stripe.proCurrency
    && price.unit_amount === planAmountCents(plan, billingCycle)
    && price.recurring?.interval === expectedInterval;
}

function planFromSubscriptionPrice(subscription: Stripe.Subscription): PlanName | undefined {
  const price = subscription.items.data[0]?.price;
  const priceIdPlan = planForConfiguredPriceId(price?.id);
  if (priceIdPlan) {
    const priceCycle = billingCycleForPriceId(price?.id) ?? billingCycleForSubscription(subscription);
    if (priceMatchesPlan(price, priceIdPlan, priceCycle)) return priceIdPlan;
    log.warn("Configured Stripe price did not match expected plan economics", {
      subscriptionId: subscription.id,
      priceId: price?.id,
      claimedPlan: priceIdPlan,
      unitAmount: price?.unit_amount,
      currency: price?.currency,
      interval: price?.recurring?.interval
    });
    return undefined;
  }

  const metadataPlan = normalizePlanName(subscription.metadata?.plan);
  const metadataCycle = billingCycleForSubscription(subscription);
  if (metadataPlan !== "free" && priceMatchesPlan(price, metadataPlan, metadataCycle)) {
    return metadataPlan;
  }
  return undefined;
}

export function lineItemForPlan(plan: PlanName, billingCycle: BillingCycle) {
  const planInfo = planCatalog[plan];

  const cycleLabel = billingCycle === "annual" ? "billed annually" : "billed monthly";
  const description = `${planInfo.description} ${cycleLabel}.`;

  return {
    quantity: 1,
    price_data: {
      currency: config.stripe.proCurrency,
      unit_amount: planAmountCents(plan, billingCycle),
      product_data: {
        name: `vectiscode ${planInfo.label}`,
        description
      },
      recurring: {
        interval: billingCycle === "annual" ? "year" as const : "month" as const
      }
    }
  };
}

function priceIdForTopUp(pack: TopUpPackId) {
  if (!configuredPriceIdsAreUsable()) return "";
  return pack === "small" ? config.stripe.topUpSmallPriceId : config.stripe.topUpLargePriceId;
}

function amountCentsForTopUp(pack: TopUpPackId) {
  return pack === "small" ? config.stripe.topUpSmallAmountCents : config.stripe.topUpLargeAmountCents;
}

function lineItemForTopUp(pack: TopUpPackId) {
  const priceId = priceIdForTopUp(pack);
  const packInfo = topUpPacks[pack];
  if (priceId) {
    return { price: priceId, quantity: 1 };
  }

  return {
    quantity: 1,
    price_data: {
      currency: config.stripe.proCurrency,
      unit_amount: amountCentsForTopUp(pack),
      product_data: {
        name: `vectiscode ${packInfo.label}`,
        description: "One-time extra usage pack for Studio workspaces."
      }
    }
  };
}

function creditsForUsagePercent(usagePercent: number) {
  return Math.round((studioWeeklyCredits * usagePercent) / 100);
}

function amountCentsForCredits(credits: number) {
  return Math.round(credits * STUDIO_CUSTOM_TOP_UP_CENTS_PER_CREDIT);
}

function amountCentsForUsagePercent(usagePercent: number) {
  return amountCentsForCredits(creditsForUsagePercent(usagePercent));
}

function lineItemForCustomTopUp(usagePercent: number) {
  return {
    quantity: 1,
    price_data: {
      currency: config.stripe.proCurrency,
      unit_amount: amountCentsForUsagePercent(usagePercent),
      product_data: {
        name: `vectiscode Studio weekly refill ${usagePercent}%`,
        description: `${usagePercent}% extra weekly capacity at the Studio refill rate.`
      }
    }
  };
}

function lineItemForCustomCredits(credits: number) {
  return {
    quantity: 1,
    price_data: {
      currency: config.stripe.proCurrency,
      unit_amount: amountCentsForCredits(credits),
      product_data: {
        name: `vectiscode Extra Usage`,
        description: "Extra Studio usage available after checkout at the Studio discounted refill rate."
      }
    }
  };
}

async function ensureCustomer(user: User, organization: Organization) {
  if (organization.stripeCustomerId) {
    try {
      const customer = await stripe().customers.retrieve(organization.stripeCustomerId);
      if (customer && !customer.deleted) {
        return organization.stripeCustomerId;
      }
    } catch (e) {
      log.warn("Stripe customer lookup failed, creating fresh customer", { customerId: organization.stripeCustomerId, error: String(e) });
    }
  }

  const customer = await stripe().customers.create({
    email: user.email,
    name: user.name,
    metadata: {
      userId: user.id,
      organizationId: organization.id
    }
  });

  await store.updateOrganizationBilling(organization.id, { stripeCustomerId: customer.id });
  return customer.id;
}

export async function createPlanCheckoutSession(user: User, organization: Organization, plan: PlanName, billingCycle: BillingCycle = "annual") {
  if (plan === "free") {
    throw new Error("Free does not require checkout.");
  }

  const activeSubscriptionStates = new Set(["active", "trialing", "past_due", "unpaid", "checkout_completed"]);
  if (organization.stripeSubscriptionId && activeSubscriptionStates.has(organization.stripeSubscriptionStatus ?? "")) {
    throw Object.assign(
      new Error("This workspace already has an active Stripe subscription. Use the billing portal to manage plan changes."),
      { statusCode: 409 }
    );
  }

  const customerId = await ensureCustomer(user, organization);
  const planInfo = planCatalog[plan];
  const cycleLabel = billingCycle === "annual" ? "billed annually" : "billed monthly";
  const billingLabel = `${planInfo.label} plan, ${cycleLabel}.`;

  const session = await stripe().checkout.sessions.create({
    mode: "subscription",
    customer: customerId,
    client_reference_id: organization.id,
    line_items: [lineItemForPlan(plan, billingCycle)],
    success_url: config.stripe.successUrl,
    cancel_url: config.stripe.cancelUrl,
    allow_promotion_codes: true,
    payment_method_collection: "always",
    ...checkoutPaymentMethodConfiguration(),
    custom_text: {
      submit: { message: billingLabel }
    },
    metadata: {
      userId: user.id,
      organizationId: organization.id,
      plan,
      billingCycle
    },
    subscription_data: {
      metadata: {
        userId: user.id,
        organizationId: organization.id,
        plan,
        billingCycle
      }
    }
  });

  return session;
}

export async function createTopUpCheckoutSession(user: User, organization: Organization, input: TopUpInput) {
  if (!planAllowsTopUps(organization.plan)) {
    throw new Error("Extra usage is only available on Studio.");
  }

  const customerId = await ensureCustomer(user, organization);
  const isCustomTopUp = "usagePercent" in input || "credits" in input;

  let credits: number;
  if ("credits" in input) {
    credits = input.credits;
  } else if ("usagePercent" in input) {
    credits = creditsForUsagePercent(input.usagePercent);
  } else {
    credits = 0;
  }

  const lineItem = isCustomTopUp
    ? ("credits" in input ? lineItemForCustomCredits(input.credits) : lineItemForCustomTopUp(input.usagePercent))
    : lineItemForTopUp(input.pack);

  return stripe().checkout.sessions.create({
    mode: "payment",
    customer: customerId,
    client_reference_id: organization.id,
    line_items: [lineItem],
    success_url: config.stripe.successUrl,
    cancel_url: config.stripe.cancelUrl,
    ...checkoutPaymentMethodConfiguration(),
    metadata: isCustomTopUp
      ? {
          type: "custom_top_up",
          userId: user.id,
          organizationId: organization.id,
          credits: String(credits),
          ...("usagePercent" in input ? { usagePercent: String(input.usagePercent) } : {})
        }
      : {
          type: "top_up",
          userId: user.id,
          organizationId: organization.id,
          pack: input.pack
        }
  });
}

export async function createBillingPortalSession(organization: Organization) {
  if (!organization.stripeCustomerId) {
    throw new Error("No Stripe customer exists for this workspace yet.");
  }

  return stripe().billingPortal.sessions.create({
    customer: organization.stripeCustomerId,
    return_url: config.stripe.portalReturnUrl
  });
}

function stripeStringId(value: string | { id: string } | null | undefined) {
  if (!value) return undefined;
  return typeof value === "string" ? value : value.id;
}

async function firstUserIdForOrganization(organizationId: string) {
  const members = await store.fetchMembersForOrganization(organizationId);
  return members[0]?.userId;
}

async function recordStripeBillingEvidence(input: {
  organizationId?: string;
  userId?: string;
  action: string;
  status?: string | null;
  amountCredits?: number;
  stripeCustomerId?: string;
  stripeSubscriptionId?: string;
  stripeSessionId?: string;
  metadata?: Record<string, unknown>;
}) {
  if (!input.organizationId && !input.userId) return;
  await store.saveCustomerEvidence({
    id: `evidence_${randomUUID()}`,
    userId: input.userId ?? (input.organizationId ? await firstUserIdForOrganization(input.organizationId) : undefined),
    organizationId: input.organizationId,
    type: "billing",
    action: input.action,
    route: "/stripe/webhook",
    method: "POST",
    status: input.status ?? undefined,
    amountCredits: input.amountCredits,
    stripeCustomerId: input.stripeCustomerId,
    stripeSubscriptionId: input.stripeSubscriptionId,
    stripeSessionId: input.stripeSessionId,
    metadata: input.metadata,
    createdAt: new Date().toISOString()
  });
}

function planForSubscription(subscription: Stripe.Subscription): PlanName {
  if (subscription.status === "active" || subscription.status === "trialing") {
    return planFromSubscriptionPrice(subscription) ?? "free";
  }
  return "free";
}

function periodEnd(subscription: Stripe.Subscription) {
  const value = subscription.items.data[0]?.current_period_end;
  return value ? new Date(value * 1000).toISOString() : undefined;
}

type PriceSpec = {
  key: string;
  label: string;
  plan?: PlanName;
  cycle: BillingCycle | "one_time";
  expectedCheckoutMode: "subscription" | "payment";
  priceId: string;
  baseAmountCents: number;
  saleAmountCents: number;
};

function configuredPriceSpecs(): PriceSpec[] {
  return [
    {
      key: "starter_monthly",
      label: "Starter monthly",
      plan: "starter",
      cycle: "monthly",
      expectedCheckoutMode: "subscription",
      priceId: config.stripe.starterPriceId,
      baseAmountCents: planAmountCents("starter", "monthly"),
      saleAmountCents: planAmountCents("starter", "monthly")
    },
    {
      key: "starter_annual",
      label: "Starter annual",
      plan: "starter",
      cycle: "annual",
      expectedCheckoutMode: "subscription",
      priceId: config.stripe.starterAnnualPriceId,
      baseAmountCents: annualPlanAmountCents.starter,
      saleAmountCents: annualPlanAmountCents.starter
    },
    {
      key: "pro_monthly",
      label: "Pro monthly",
      plan: "pro",
      cycle: "monthly",
      expectedCheckoutMode: "subscription",
      priceId: config.stripe.proPriceId,
      baseAmountCents: planAmountCents("pro", "monthly"),
      saleAmountCents: planAmountCents("pro", "monthly")
    },
    {
      key: "pro_annual",
      label: "Pro annual",
      plan: "pro",
      cycle: "annual",
      expectedCheckoutMode: "subscription",
      priceId: config.stripe.proAnnualPriceId,
      baseAmountCents: annualPlanAmountCents.pro,
      saleAmountCents: annualPlanAmountCents.pro
    },
    {
      key: "studio_monthly",
      label: "Studio monthly",
      plan: "studio",
      cycle: "monthly",
      expectedCheckoutMode: "subscription",
      priceId: config.stripe.studioPriceId,
      baseAmountCents: planAmountCents("studio", "monthly"),
      saleAmountCents: planAmountCents("studio", "monthly")
    },
    {
      key: "studio_annual",
      label: "Studio annual",
      plan: "studio",
      cycle: "annual",
      expectedCheckoutMode: "subscription",
      priceId: config.stripe.studioAnnualPriceId,
      baseAmountCents: annualPlanAmountCents.studio,
      saleAmountCents: annualPlanAmountCents.studio
    },
    {
      key: "top_up_small",
      label: "Small usage pack",
      cycle: "one_time",
      expectedCheckoutMode: "payment",
      priceId: config.stripe.topUpSmallPriceId,
      baseAmountCents: config.stripe.topUpSmallAmountCents,
      saleAmountCents: config.stripe.topUpSmallAmountCents
    },
    {
      key: "top_up_large",
      label: "Large usage pack",
      cycle: "one_time",
      expectedCheckoutMode: "payment",
      priceId: config.stripe.topUpLargePriceId,
      baseAmountCents: config.stripe.topUpLargeAmountCents,
      saleAmountCents: config.stripe.topUpLargeAmountCents
    }
  ];
}

function stripeTime(timestamp?: number | null) {
  return timestamp ? new Date(timestamp * 1000).toISOString() : undefined;
}

function monthlyRecurringAmount(subscription: Stripe.Subscription) {
  if (!["active", "trialing", "past_due", "unpaid"].includes(subscription.status)) return 0;
  return subscription.items.data.reduce((total, item) => {
    const price = item.price;
    const amount = price.unit_amount ?? 0;
    const quantity = item.quantity ?? 1;
    if (price.recurring?.interval === "year") return total + Math.round((amount * quantity) / 12);
    if (price.recurring?.interval === "month") return total + amount * quantity;
    return total;
  }, 0);
}

function checkoutPriceIdCoverage() {
  const paidPlans: Exclude<PlanName, "free">[] = ["starter", "pro", "studio"];
  const cycles: BillingCycle[] = ["monthly", "annual"];
  const missing = paidPlans.flatMap((plan) =>
    cycles
      .filter((cycle) => !priceIdForPlan(plan, cycle))
      .map((cycle) => `${plan}_${cycle}`)
  );
  return {
    allConfigured: missing.length === 0,
    missing
  };
}

function modeledFullUsageMargin(plan: Exclude<PlanName, "free">, billingCycle: BillingCycle) {
  const economics = planCreditEconomics(plan, billingCycle);
  const monthlyRevenue = economics.monthlyEquivalentAmountCents / 100;
  const providerCost = monthlyRevenue * (1 - economics.targetMargin);
  const planAmount = planAmountCents(plan, billingCycle) / 100;
  const stripeFeeMonthly = billingCycle === "annual"
    ? ((planAmount * 0.015) + 0.25) / 12
    : (monthlyRevenue * 0.015) + 0.25;
  const margin = monthlyRevenue > 0
    ? (monthlyRevenue - providerCost - stripeFeeMonthly) / monthlyRevenue
    : 0;
  return {
    plan,
    billingCycle,
    monthlyRevenueUsd: Number(monthlyRevenue.toFixed(4)),
    creditValueUsd: Number(economics.creditValueUsd.toFixed(6)),
    targetMargin: economics.targetMargin,
    estimatedStripeFeeUsd: Number(stripeFeeMonthly.toFixed(4)),
    estimatedProviderCostUsd: Number(providerCost.toFixed(4)),
    estimatedFullUsageMargin: Number(margin.toFixed(4))
  };
}

async function captureAdminStripe<T>(errors: string[], label: string, task: () => Promise<T>, fallback: T) {
  try {
    return await task();
  } catch (error) {
    errors.push(`${label}: ${error instanceof Error ? error.message : "Stripe request failed"}`);
    return fallback;
  }
}

function methodRowsFromConfiguration(configuration: any) {
  return configuredPaymentMethods
    .map((method) => {
      const value = configuration?.[method];
      if (!value?.display_preference) return undefined;
      return {
        method,
        available: Boolean(value.available),
        preference: String(value.display_preference.preference ?? "unknown"),
        value: String(value.display_preference.value ?? "unknown"),
        status: value.available && value.display_preference.value === "on"
          ? "active"
          : value.display_preference.value === "on"
            ? "requested"
            : "off"
      };
    })
    .filter(Boolean);
}

export async function getAdminPaymentOverview() {
  await store.ready();
  const errors: string[] = [];
  const localUsersPage = await store.fetchUsersWithStatsPage({ limit: 100 });
  const localUsers = localUsersPage.users;

  if (!stripeConfigured()) {
    return {
      generatedAt: new Date().toISOString(),
      configured: false,
      errors,
      security: {
        secretConfigured: false,
        webhookSecretConfigured: Boolean(config.stripe.webhookSecret),
        secretExposedToClient: false,
        webhookSignatureRequired: true,
        checkoutCreatedServerSide: true,
        secretStorage: config.isProduction ? "deployment environment variable" : "server environment only",
        keyKind: "missing"
      },
      localWorkspaces: localUsers,
      localWorkspacesTotal: localUsersPage.total,
      localWorkspacesTruncated: Boolean(localUsersPage.nextCursor)
    };
  }

  const client = stripe() as any;
  const [account, prices, webhookEndpoints, paymentConfigurations, subscriptions, sessions, customers] = await Promise.all([
    captureAdminStripe<any | null>(errors, "account", () => client.accounts.retrieve(), null),
    Promise.all(configuredPriceSpecs().map(async (spec) => {
      if (!spec.priceId) return { ...spec, configured: false };
      const price = await captureAdminStripe(errors, `price ${spec.key}`, () => stripe().prices.retrieve(spec.priceId), null);
      let productName = "";
      let productId = typeof price?.product === "string" ? price.product : price?.product?.id;
      if (productId) {
        const product = await captureAdminStripe(errors, `product ${productId}`, () => stripe().products.retrieve(productId), null);
        productName = product?.name ?? "";
      }

      return {
        ...spec,
        configured: true,
        active: Boolean(price?.active),
        livemode: Boolean(price?.livemode),
        currency: price?.currency,
        unitAmount: price?.unit_amount,
        type: price?.type,
        recurringInterval: price?.recurring?.interval,
        lookupKey: price?.lookup_key,
        productId,
        productName,
        matchesExpectedAmount: price?.unit_amount === spec.saleAmountCents,
        monthlyIsSubscription: spec.cycle === "monthly"
          ? price?.type === "recurring" && price?.recurring?.interval === "month"
          : undefined,
        salePercent: 0
      };
    })),
    captureAdminStripe<any>(errors, "webhook endpoints", () => stripe().webhookEndpoints.list({ limit: 20 }), { data: [] }),
    captureAdminStripe<any>(errors, "payment method configurations", () => client.paymentMethodConfigurations.list({ limit: 10 }), { data: [] }),
    captureAdminStripe<any>(errors, "subscriptions", () => stripe().subscriptions.list({ status: "all", limit: 50 }), { data: [] }),
    captureAdminStripe<any>(errors, "checkout sessions", () => stripe().checkout.sessions.list({ limit: 30 }), { data: [] }),
    captureAdminStripe<any>(errors, "customers", () => stripe().customers.list({ limit: 50 }), { data: [] })
  ]);

  const stripeSubscriptions = subscriptions.data as Stripe.Subscription[];
  const processedEvents = await store.fetchStripeProcessedEvents(200);
  const priceIdCoverage = checkoutPriceIdCoverage();
  const subscriptionRows = stripeSubscriptions.map((subscription) => {
    const item = subscription.items.data[0];
    const cycle = billingCycleForSubscription(subscription);
    return {
      id: subscription.id,
      customerId: typeof subscription.customer === "string" ? subscription.customer : subscription.customer.id,
      status: subscription.status,
      cancelAtPeriodEnd: Boolean(subscription.cancel_at_period_end),
      priceId: item?.price.id,
      billingCycle: cycle,
      amount: item?.price.unit_amount,
      currency: item?.price.currency,
      interval: item?.price.recurring?.interval,
      currentPeriodEnd: periodEnd(subscription),
      createdAt: stripeTime(subscription.created),
      metadataPlan: subscription.metadata?.plan
    };
  });
  const mrrCents = stripeSubscriptions.reduce((total, subscription) => total + monthlyRecurringAmount(subscription), 0);
  const statusCounts = subscriptionRows.reduce((acc: Record<string, number>, subscription) => {
    acc[subscription.status] = (acc[subscription.status] ?? 0) + 1;
    return acc;
  }, {});

  const paymentMethodConfigurations = paymentConfigurations.data.map((configuration: any) => {
    const methods = methodRowsFromConfiguration(configuration);
    return {
      id: configuration.id,
      name: configuration.name,
      active: Boolean(configuration.active),
      isDefault: Boolean(configuration.is_default),
      livemode: Boolean(configuration.livemode),
      application: configuration.application ?? null,
      parent: configuration.parent ?? null,
      usedByCheckout: configuration.id === config.stripe.paymentMethodConfigurationId,
      methods,
      counts: {
        active: methods.filter((method: any) => method.status === "active").length,
        requested: methods.filter((method: any) => method.status === "requested").length,
        off: methods.filter((method: any) => method.status === "off").length,
        total: methods.length
      }
    };
  });

  return {
    generatedAt: new Date().toISOString(),
    configured: true,
    account: account
      ? {
          id: account.id,
          country: account.country,
          defaultCurrency: account.default_currency,
          chargesEnabled: Boolean(account.charges_enabled),
          payoutsEnabled: Boolean(account.payouts_enabled),
          detailsSubmitted: Boolean(account.details_submitted)
        }
      : null,
    sale: {
      percentOff: 0,
      appliesTo: "None",
      annualAlsoIncludes: "None"
    },
    checkout: {
      planMode: "subscription",
      monthlyMode: "subscription",
      annualMode: "subscription",
      topUpMode: "payment",
      dynamicPaymentMethods: true,
      checkoutUsesConfiguredPriceIds: priceIdCoverage.allConfigured,
      missingConfiguredPriceIds: priceIdCoverage.missing,
      inlinePriceFallbackActive: !priceIdCoverage.allConfigured,
      checkoutCurrency: config.stripe.proCurrency,
      paymentMethodCollection: "always for subscriptions",
      paymentMethodConfigurationId: config.stripe.paymentMethodConfigurationId || null
    },
    security: {
      secretConfigured: true,
      webhookSecretConfigured: Boolean(config.stripe.webhookSecret),
      secretExposedToClient: false,
      webhookSignatureRequired: true,
      checkoutCreatedServerSide: true,
      secretStorage: config.isProduction ? "deployment environment variable" : "server environment only",
      keyKind: config.stripe.secretKey.startsWith("rk_live")
        ? "restricted_live"
        : config.stripe.secretKey.startsWith("sk_live")
          ? "secret_live"
          : config.stripe.secretKey.startsWith("rk_test")
            ? "restricted_test"
            : "secret_test_or_custom"
    },
    prices,
    webhooks: webhookEndpoints.data.map((endpoint: Stripe.WebhookEndpoint) => ({
      id: endpoint.id,
      url: endpoint.url,
      status: endpoint.status,
      apiVersion: endpoint.api_version,
      enabledEvents: endpoint.enabled_events,
      livemode: endpoint.livemode,
      createdAt: stripeTime(endpoint.created)
    })),
    paymentMethodConfigurations,
    subscriptions: {
      total: subscriptionRows.length,
      statusCounts,
      estimatedMrrCents: mrrCents,
      estimatedArrCents: mrrCents * 12,
      rows: subscriptionRows
    },
    webhookProcessing: {
      processedEventCount: processedEvents.filter((event) => event.processedAt).length,
      duplicateIgnoredCount: processedEvents.filter((event) => event.duplicateIgnoredAt).length,
      latestDuplicateIgnoredEvent: processedEvents.find((event) => event.duplicateIgnoredAt) ?? null
    },
    economics: {
      fullUsageMargins: (["starter", "pro", "studio"] as const).flatMap((plan) => [
        modeledFullUsageMargin(plan, "monthly"),
        modeledFullUsageMargin(plan, "annual")
      ]),
      topUps: {
        fixedPricePerThousandUsd: fixedTopUpPricePerThousand(),
        studioCustomPricePerThousandUsd: studioCustomTopUpPricePerThousand(),
        studioCustomDiscountedForStudio: true
      }
    },
    checkoutSessions: sessions.data.map((session: Stripe.Checkout.Session) => ({
      id: session.id,
      mode: session.mode,
      status: session.status,
      paymentStatus: session.payment_status,
      customerId: typeof session.customer === "string" ? session.customer : session.customer?.id,
      subscriptionId: typeof session.subscription === "string" ? session.subscription : session.subscription?.id,
      amountTotal: session.amount_total,
      currency: session.currency,
      createdAt: stripeTime(session.created),
      plan: session.metadata?.plan,
      billingCycle: session.metadata?.billingCycle
    })),
    customers: {
      sampled: customers.data.length,
      rows: customers.data.map((customer: Stripe.Customer) => ({
        id: customer.id,
        email: customer.email,
        name: customer.name,
        createdAt: stripeTime(customer.created),
        delinquent: Boolean(customer.delinquent)
      }))
    },
    localWorkspaces: localUsers.map((user) => ({
      id: user.id,
      name: user.name,
      email: user.email,
      plan: user.plan,
      credits: user.credits,
      projects: user.projects,
      organizationId: (user as any).organizationId,
      stripeCustomerId: (user as any).stripeCustomerId,
      stripeSubscriptionId: (user as any).stripeSubscriptionId,
      stripeSubscriptionStatus: (user as any).stripeSubscriptionStatus,
      stripePriceId: (user as any).stripePriceId,
      billingCycle: (user as any).billingCycle,
      billingCurrentPeriodEnd: (user as any).billingCurrentPeriodEnd
    })),
    localWorkspacesTotal: localUsersPage.total,
    localWorkspacesTruncated: Boolean(localUsersPage.nextCursor),
    errors
  };
}

async function syncSubscription(subscription: Stripe.Subscription) {
  const customerId = typeof subscription.customer === "string" ? subscription.customer : subscription.customer.id;
  const organization =
    (await store.findOrganizationByStripeSubscription(subscription.id)) ??
    (await store.findOrganizationByStripeCustomer(customerId));
  if (!organization) return;

  const billingCycle = billingCycleForSubscription(subscription);
  const plan = planForSubscription(subscription);
  await store.updateOrganizationBilling(organization.id, {
    plan,
    stripeCustomerId: customerId,
    stripeSubscriptionId: subscription.id,
    stripeSubscriptionStatus: subscription.status,
    stripePriceId: subscription.items.data[0]?.price.id,
    billingCycle,
    billingCurrentPeriodEnd: periodEnd(subscription)
  });
  await recordStripeBillingEvidence({
    organizationId: organization.id,
    action: "stripe_subscription_synced",
    status: subscription.status,
    stripeCustomerId: customerId,
    stripeSubscriptionId: subscription.id,
    metadata: {
      plan,
      billingCycle,
      priceId: subscription.items.data[0]?.price.id,
      cancelAtPeriodEnd: subscription.cancel_at_period_end,
      currentPeriodEnd: periodEnd(subscription)
    }
  });
}

function stripeProcessedEventId(eventId: string) {
  return `stripe_event_${eventId}`;
}

function stripeProcessedSessionId(sessionId: string) {
  return `stripe_session_${sessionId}`;
}

async function claimStripeEvent(event: Stripe.Event) {
  return store.claimStripeProcessedEvent({
    id: stripeProcessedEventId(event.id),
    stripeEventId: event.id,
    eventType: event.type,
    action: "stripe_webhook_event",
    status: "processing",
    metadata: {
      livemode: event.livemode
    },
    createdAt: new Date().toISOString()
  });
}

async function claimStripeSession(event: Stripe.Event, session: Stripe.Checkout.Session, organizationId?: string) {
  return store.claimStripeProcessedEvent({
    id: stripeProcessedSessionId(session.id),
    stripeSessionId: session.id,
    eventType: event.type,
    action: "stripe_checkout_session",
    status: "processing",
    organizationId,
    metadata: {
      stripeEventId: event.id,
      mode: session.mode,
      type: session.metadata?.type,
      plan: session.metadata?.plan,
      billingCycle: session.metadata?.billingCycle
    },
    createdAt: new Date().toISOString()
  });
}

async function finishStripeEvent(event: Stripe.Event, patch: Record<string, unknown> = {}) {
  await store.finishStripeProcessedEvent(stripeProcessedEventId(event.id), {
    metadata: {
      livemode: event.livemode,
      ...patch
    }
  });
}

async function finishStripeSession(session: Stripe.Checkout.Session, patch: Record<string, unknown> = {}) {
  const amountPatch = typeof patch.amountCredits === "number" ? { amountCredits: patch.amountCredits } : {};
  await store.finishStripeProcessedEvent(stripeProcessedSessionId(session.id), {
    ...amountPatch,
    metadata: {
      mode: session.mode,
      type: session.metadata?.type,
      plan: session.metadata?.plan,
      billingCycle: session.metadata?.billingCycle,
      ...patch
    }
  });
}

export async function handleConstructedStripeEvent(event: Stripe.Event) {
  const eventClaimed = await claimStripeEvent(event);
  if (!eventClaimed) {
    return { received: true, type: event.type, duplicate: true };
  }

  if (event.type === "checkout.session.completed" || event.type === "checkout.session.async_payment_succeeded") {
    const session = event.data.object as Stripe.Checkout.Session;
    const organizationId = session.metadata?.organizationId || session.client_reference_id || undefined;

    const isPaymentMode = session.mode === "payment";
    const isPaid = session.payment_status === "paid";

    if (isPaymentMode && !isPaid) {
      await recordStripeBillingEvidence({
        organizationId,
        userId: session.metadata?.userId,
        action: "stripe_checkout_session_pending",
        status: "pending",
        stripeCustomerId: stripeStringId(session.customer),
        stripeSubscriptionId: stripeStringId(session.subscription),
        stripeSessionId: session.id,
        metadata: {
          eventId: event.id,
          mode: session.mode,
          type: session.metadata?.type,
          plan: session.metadata?.plan,
          billingCycle: session.metadata?.billingCycle,
          paymentStatus: session.payment_status
        }
      });
      await finishStripeEvent(event, { pendingSessionId: session.id });
      return { received: true, type: event.type };
    }

    const sessionClaimed = await claimStripeSession(event, session, organizationId);
    if (!sessionClaimed) {
      await recordStripeBillingEvidence({
        organizationId,
        userId: session.metadata?.userId,
        action: "stripe_checkout_session_duplicate_ignored",
        status: "duplicate_ignored",
        stripeCustomerId: stripeStringId(session.customer),
        stripeSubscriptionId: stripeStringId(session.subscription),
        stripeSessionId: session.id,
        metadata: {
          eventId: event.id,
          mode: session.mode,
          type: session.metadata?.type,
          plan: session.metadata?.plan,
          billingCycle: session.metadata?.billingCycle
        }
      });
      await finishStripeEvent(event, { duplicateSessionId: session.id });
      return { received: true, type: event.type, duplicate: true };
    }

    if (session.metadata?.type === "custom_top_up" && organizationId && isPaid) {
      const credits = Number(session.metadata.credits);
      const usagePercent = session.metadata.usagePercent ? Number(session.metadata.usagePercent) : undefined;
      if (Number.isFinite(credits) && credits > 0) {
        const roundedCredits = Math.round(credits);
        const grant = await store.addCreditsOnce(
          `ledger_stripe_${session.id}_custom_top_up`,
          organizationId,
          roundedCredits,
          `Studio custom usage top-up: ${usagePercent !== undefined && Number.isFinite(usagePercent) ? `${usagePercent}%` : "custom amount"}`
        );
        await recordStripeBillingEvidence({
          organizationId,
          userId: session.metadata.userId,
          action: grant.applied ? "stripe_custom_top_up_completed" : "stripe_custom_top_up_duplicate_ignored",
          status: grant.applied ? session.payment_status : "duplicate_ignored",
          amountCredits: roundedCredits,
          stripeCustomerId: stripeStringId(session.customer),
          stripeSubscriptionId: stripeStringId(session.subscription),
          stripeSessionId: session.id,
          metadata: {
            amountTotal: session.amount_total,
            currency: session.currency,
            credits: roundedCredits,
            usagePercent,
            mode: session.mode,
            ledgerApplied: grant.applied
          }
        });
        await finishStripeSession(session, { amountCredits: roundedCredits, ledgerApplied: grant.applied });
      }
    }

    if (session.metadata?.type === "top_up" && organizationId && isPaid) {
      const pack = session.metadata.pack as TopUpPackId | undefined;
      if (pack && topUpPacks[pack]) {
        const grant = await store.addCreditsOnce(
          `ledger_stripe_${session.id}_top_up_${pack}`,
          organizationId,
          topUpPacks[pack].credits,
          `Studio usage top-up: ${topUpPacks[pack].label}`
        );
        await recordStripeBillingEvidence({
          organizationId,
          userId: session.metadata.userId,
          action: grant.applied ? "stripe_top_up_completed" : "stripe_top_up_duplicate_ignored",
          status: grant.applied ? session.payment_status : "duplicate_ignored",
          amountCredits: topUpPacks[pack].credits,
          stripeCustomerId: stripeStringId(session.customer),
          stripeSubscriptionId: stripeStringId(session.subscription),
          stripeSessionId: session.id,
          metadata: {
            amountTotal: session.amount_total,
            currency: session.currency,
            pack,
            mode: session.mode,
            ledgerApplied: grant.applied
          }
        });
        await finishStripeSession(session, { amountCredits: topUpPacks[pack].credits, ledgerApplied: grant.applied });
      }
    }

    if (organizationId && session.mode === "subscription" && typeof session.customer === "string") {
      const requestedPlan = session.metadata?.plan ? normalizePlanName(session.metadata.plan) : undefined;
      const requestedBillingCycle = session.metadata?.billingCycle === "monthly" || session.metadata?.billingCycle === "annual"
        ? session.metadata.billingCycle
        : "monthly";
      await store.updateOrganizationBilling(organizationId, {
        stripeCustomerId: session.customer,
        stripeSubscriptionId: typeof session.subscription === "string" ? session.subscription : undefined,
        stripeSubscriptionStatus: "checkout_completed"
      });
      await recordStripeBillingEvidence({
        organizationId,
        userId: session.metadata?.userId,
        action: "stripe_subscription_checkout_completed",
        status: session.payment_status || session.status,
        stripeCustomerId: session.customer,
        stripeSubscriptionId: stripeStringId(session.subscription),
        stripeSessionId: session.id,
        metadata: {
          amountTotal: session.amount_total,
          currency: session.currency,
          requestedPlan,
          requestedBillingCycle,
          mode: session.mode
        }
      });
      await finishStripeSession(session, { requestedPlan, requestedBillingCycle });
    }
    await finishStripeSession(session);
  }

  if (
    event.type === "customer.subscription.created" ||
    event.type === "customer.subscription.updated" ||
    event.type === "customer.subscription.deleted"
  ) {
    await syncSubscription(event.data.object as Stripe.Subscription);
  }

  await finishStripeEvent(event);
  return { received: true, type: event.type };
}

export async function handleStripeWebhook(signature: string | undefined, rawBody: Buffer) {
  if (!config.stripe.webhookSecret) {
    throw new Error("Stripe webhook secret is not configured.");
  }
  if (!signature) {
    throw new Error("Missing Stripe signature.");
  }

  const event = await stripe().webhooks.constructEventAsync(rawBody, signature, config.stripe.webhookSecret);
  return handleConstructedStripeEvent(event);
}
