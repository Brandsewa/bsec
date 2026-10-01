import { sql } from "drizzle-orm";
import type { Db } from "@bs/db";
import { LAPSED_TRIAL_TIER } from "./plan-tiers.ts";

export interface TrialExpirySweepResult {
  inspected: number;
  expired: number;
  expiredSubscriptionIds: string[];
}

/**
 * Subscription Trial Expiry Sweep Job (PLAN §6.4, §14).
 * Finds subscriptions in 'trialing' status whose trial period has elapsed (current_period_end <= now()),
 * moves them to 'past_due' and drops the store to the restricted XS size tier. Both changes happen in one
 * transaction. Storefront and checkout keep working (quotas never block checkout); admin-side creation
 * is then limited by the XS tier. Paying (webhook) restores the plan's tier.
 * Must run on the self-service (app_saas) connection: it writes platform-owned tables.
 */
export async function runTrialExpirySweep(db: Db): Promise<TrialExpirySweepResult> {
  return db.transaction(async (tx) => {
    const expiredRows = await tx.execute<{ id: string; tenant_id: string }>(sql`
      UPDATE subscriptions
      SET status = 'past_due', updated_at = now()
      WHERE status = 'trialing'
        AND current_period_end IS NOT NULL
        AND current_period_end <= now()
      RETURNING id, tenant_id;
    `);

    for (const row of expiredRows.rows) {
      await tx.execute(sql`
        INSERT INTO tenant_size_tiers (tenant_id, tier)
        VALUES (${row.tenant_id}, ${LAPSED_TRIAL_TIER})
        ON CONFLICT (tenant_id) DO UPDATE SET tier = ${LAPSED_TRIAL_TIER}, updated_at = now();
      `);
    }

    return {
      inspected: expiredRows.rows.length,
      expired: expiredRows.rows.length,
      expiredSubscriptionIds: expiredRows.rows.map((r) => r.id),
    };
  });
}
