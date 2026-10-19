import { listPublicPlans, saasDb } from "@bs/domain";
import type { LandingPlan } from "@/components/marketing/landing/content.ts";
import { server } from "@/server/runtime.ts";

/** Live plans for the marketing pages; an empty list makes them fall back to the seeded plan values. */
export async function loadLandingPlans(): Promise<LandingPlan[]> {
  try {
    const { rt } = server();
    const rows = await listPublicPlans(saasDb(rt));
    return rows.map((p) => ({
      code: p.code,
      name: p.name,
      monthlyPaise: p.priceMonthlyPaise,
      yearlyPaise: p.priceYearlyPaise,
      limits: p.limits,
    }));
  } catch {
    return [];
  }
}
