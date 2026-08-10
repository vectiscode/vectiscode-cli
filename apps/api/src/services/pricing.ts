import type { PlanName } from "../types.js";
import { planCatalog } from "./plans.js";

export type BillingCycle = "monthly" | "annual";

export const MONTHLY_TARGET_MARGIN = 0.25;
export const ANNUAL_TARGET_MARGIN = 0.175;
export const CREDIT_VALUE_USD = 0.00125;
export const CREDIT_VALUE_USD_RETAIL = 0.002;
export const MODEL_CREDIT_MARGIN_MULTIPLIER = 1.6;
export const FIXED_TOP_UP_CENTS_PER_CREDIT = 0.2;
export const STUDIO_CUSTOM_TOP_UP_CENTS_PER_CREDIT = 0.14;

export const monthlyPlanAmountCents: Record<Exclude<PlanName, "free">, number> = {
  starter: 799,
  pro: 1899,
  studio: 2899
};

export const annualPlanAmountCents: Record<Exclude<PlanName, "free">, number> = {
  starter: 7199,
  pro: 17999,
  studio: 26399
};

export function planAmountCents(plan: PlanName, billingCycle: BillingCycle) {
  if (plan === "free") return 0;
  return billingCycle === "annual" ? annualPlanAmountCents[plan] : monthlyPlanAmountCents[plan];
}

export function monthlyEquivalentAmountCents(plan: PlanName, billingCycle: BillingCycle) {
  const amount = planAmountCents(plan, billingCycle);
  return billingCycle === "annual" ? amount / 12 : amount;
}

export function planCreditEconomics(planName: PlanName | string | undefined, billingCycle: BillingCycle | string | undefined = "monthly") {
  const plan = planCatalog[(planName as PlanName) || "free"] ?? planCatalog.free;
  const normalizedCycle: BillingCycle = billingCycle === "annual" ? "annual" : "monthly";
  
  // Align credit economics across billing cycles (1 credit = 1 credit everywhere).
  // Credit value and target margin are calculated based on standard monthly pricing
  // to ensure perfectly fair and consistent credit consumption rates.
  const monthlyEquivalent = monthlyEquivalentAmountCents(plan.name, normalizedCycle);
  const standardMonthlyEquivalent = monthlyEquivalentAmountCents(plan.name, "monthly");
  const creditValueUsd = plan.creditsPerMonth > 0
    ? standardMonthlyEquivalent / 100 / plan.creditsPerMonth
    : CREDIT_VALUE_USD;

  return {
    creditValueUsd: plan.name === "free" ? CREDIT_VALUE_USD : creditValueUsd,
    targetMargin: plan.name === "free" ? 0 : MONTHLY_TARGET_MARGIN,
    monthlyEquivalentAmountCents: monthlyEquivalent,
    billingCycle: normalizedCycle
  };
}

export function studioCustomTopUpPricePerThousand() {
  return Number((STUDIO_CUSTOM_TOP_UP_CENTS_PER_CREDIT * 10).toFixed(2));
}

export function fixedTopUpPricePerThousand() {
  return Number((FIXED_TOP_UP_CENTS_PER_CREDIT * 10).toFixed(2));
}
