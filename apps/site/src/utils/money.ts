import type { BillingCycle, PlanName } from "../types";

const monthlyPlanCents: Record<Exclude<PlanName, "free">, number> = {
  starter: 799,
  pro: 1899,
  studio: 2899
};

const annualPlanCents: Record<Exclude<PlanName, "free">, number> = {
  starter: 7199,
  pro: 17999,
  studio: 26399
};

export function billingCurrency(currency?: string | null) {
  return "usd";
}

export function formatMoneyFromCents(cents: number, currency?: string | null) {
  const code = billingCurrency(currency).toUpperCase();
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: code
    }).format(cents / 100);
  } catch {
    return `${code} ${(cents / 100).toFixed(2)}`;
  }
}

function planName(value: string): PlanName | undefined {
  return value === "free" || value === "starter" || value === "pro" || value === "studio" ? value : undefined;
}

export function planMonthlyPriceCents(input: {
  planName: string;
  monthlyPrice?: number;
  monthlyPriceCents?: number;
  annualPriceCents?: number;
  billingCycle: BillingCycle;
}) {
  const name = planName(input.planName);
  if (!name || name === "free") return 0;
  if (input.billingCycle === "annual") {
    return Math.floor((input.annualPriceCents ?? annualPlanCents[name]) / 12);
  }
  return input.monthlyPriceCents ?? monthlyPlanCents[name] ?? Math.round((input.monthlyPrice ?? 0) * 100);
}

export function planAnnualPriceCents(input: {
  planName: string;
  monthlyPrice?: number;
  monthlyPriceCents?: number;
  annualPriceCents?: number;
}) {
  const name = planName(input.planName);
  if (!name || name === "free") return 0;
  return input.annualPriceCents ?? annualPlanCents[name];
}

export function planPriceLabel(input: {
  planName: string;
  monthlyPrice?: number;
  monthlyPriceCents?: number;
  annualPriceCents?: number;
  billingCycle: BillingCycle;
  currency?: string | null;
}) {
  return formatMoneyFromCents(planMonthlyPriceCents(input), input.currency);
}

export function planPriceCaption(input: {
  planName: string;
  monthlyPrice?: number;
  monthlyPriceCents?: number;
  annualPriceCents?: number;
  billingCycle: BillingCycle;
  currency?: string | null;
}) {
  const name = planName(input.planName);
  if (!name || name === "free") return "Free forever";
  if (input.billingCycle === "monthly") return "billed monthly as a subscription";

  const annualCents = planAnnualPriceCents(input);
  const monthlyCents = input.monthlyPriceCents ?? monthlyPlanCents[name] ?? Math.round((input.monthlyPrice ?? 0) * 100);
  const savings = monthlyCents > 0
    ? Math.max(0, Math.round((1 - annualCents / (monthlyCents * 12)) * 100))
    : 0;
  return `billed ${formatMoneyFromCents(annualCents, input.currency)} yearly (${savings}% savings)`;
}
