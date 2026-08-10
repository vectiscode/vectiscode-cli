import type { PlanName } from "../types.js";

export type LegacyPlanName = PlanName | "developer";

export const planNames = ["free", "starter", "pro", "studio"] as const;

export const planCatalog: Record<PlanName, {
  name: PlanName;
  label: string;
  priceUsd: number;
  creditsPerWeek: number;
  creditsPerMonth: number;
  maxProjects: number;
  premiumModels: boolean;
  planMode: boolean;
  usageOptimizer: boolean;
  luauGuard: boolean;
  topUps: boolean;
  description: string;
  effectiveCreditCost: number;
  targetMargin: number;
}> = {
  free: {
    name: "free",
    label: "Free",
    priceUsd: 0,
    creditsPerWeek: 50,
    creditsPerMonth: 200,
    maxProjects: Number.MAX_SAFE_INTEGER,
    premiumModels: false,
    planMode: false,
    usageOptimizer: false,
    luauGuard: false,
    topUps: false,
    description: "Try Studio sync and basic AI with a small weekly credit allowance.",
    effectiveCreditCost: 0.00125,
    targetMargin: 0
  },
  starter: {
    name: "starter",
    label: "Starter",
    priceUsd: 7.99,
    creditsPerWeek: 1000,
    creditsPerMonth: 4000,
    maxProjects: Number.MAX_SAFE_INTEGER,
    premiumModels: false,
    planMode: false,
    usageOptimizer: false,
    luauGuard: false,
    topUps: false,
    description: "More monthly capacity for learning, iteration, and smaller games, split into weekly refills.",
    effectiveCreditCost: 0.001998,
    targetMargin: 0.25
  },
  pro: {
    name: "pro",
    label: "Pro",
    priceUsd: 18.99,
    creditsPerWeek: 2500,
    creditsPerMonth: 10000,
    maxProjects: Number.MAX_SAFE_INTEGER,
    premiumModels: true,
    planMode: true,
    usageOptimizer: true,
    luauGuard: false,
    topUps: false,
    description: "Premium models, Plan Mode, generated icons, and weekly refill capacity for serious Roblox creators.",
    effectiveCreditCost: 0.001899,
    targetMargin: 0.25
  },
  studio: {
    name: "studio",
    label: "Studio",
    priceUsd: 28.99,
    creditsPerWeek: 5000,
    creditsPerMonth: 20000,
    maxProjects: Number.MAX_SAFE_INTEGER,
    premiumModels: true,
    planMode: true,
    usageOptimizer: true,
    luauGuard: true,
    topUps: true,
    description: "Higher monthly capacity, generated icons, and the only plan with extra usage packs.",
    effectiveCreditCost: 0.00145,
    targetMargin: 0.25
  }
};

export const topUpPacks = {
  small: {
    id: "small",
    label: "Small usage pack",
    credits: 1000,
    priceUsd: 2
  },
  large: {
    id: "large",
    label: "Large usage pack",
    credits: 3500,
    priceUsd: 7
  }
} as const;

export type TopUpPackId = keyof typeof topUpPacks;

export function normalizePlanName(plan: string | undefined): PlanName {
  if (plan === "developer") return "studio";
  return planNames.includes(plan as PlanName) ? (plan as PlanName) : "free";
}

export function planFor(plan: string | undefined) {
  return planCatalog[normalizePlanName(plan)];
}

export function planAllowsPremiumModels(plan: string | undefined) {
  return planFor(plan).premiumModels;
}

export function planAllowsPlanMode(plan: string | undefined) {
  return planFor(plan).planMode;
}

export function planAllowsTopUps(plan: string | undefined) {
  return planFor(plan).topUps;
}

export function planAllowsUsageOptimization(plan: string | undefined) {
  return planFor(plan).usageOptimizer;
}

export function planAllowsLuauGuard(plan: string | undefined) {
  return planFor(plan).luauGuard;
}
