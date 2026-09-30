export type SizeTier = "XS" | "S" | "M" | "L";

/**
 * The one plan -> size tier mapping. It matches the limits advertised on each plan (migration 0012):
 * Starter 500 products / 1 domain = tier S, Growth 5,000 / 3 = M, Pro 25,000 / 10 = L.
 * Provisioning, the billing webhook and plan changes must all use this, never their own copy.
 * XS is the restricted tier a store drops to when its trial lapses.
 */
export const TIER_FOR_PLAN: Record<string, SizeTier> = {
  starter: "S",
  growth: "M",
  pro: "L",
};

export const LAPSED_TRIAL_TIER: SizeTier = "XS";

export function tierForPlan(planCode: string | undefined | null): SizeTier {
  return (planCode && TIER_FOR_PLAN[planCode.toLowerCase()]) || "S";
}
