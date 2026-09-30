import { sql } from "drizzle-orm";
import type { Db } from "@bs/db";

export interface TrialExpirySweepResult {
  inspected: number;
  expired: number;
  expiredSubscriptionIds: string[];
}

/**
 * Subscription Trial Expiry Sweep Job (PLAN §6.4, §14).
 * Identifies subscriptions in 'trialing' status whose trial period has elapsed (current_period_end <= now()).
 * Transitions expired trials to 'past_due' status in the platform subscriptions table.
 */
export async function runTrialExpirySweep(db: Db): Promise<TrialExpirySweepResult> {
  const expiredRows = await db.execute<{
    id: string;
    tenant_id: string;
  }>(sql`
    UPDATE subscriptions
    SET status = 'past_due', updated_at = now()
    WHERE status = 'trialing'
      AND current_period_end IS NOT NULL
      AND current_period_end <= now()
    RETURNING id, tenant_id;
  `);

  const expiredSubscriptionIds = expiredRows.rows.map((r) => r.id);

  return {
    inspected: expiredRows.rows.length,
    expired: expiredRows.rows.length,
    expiredSubscriptionIds,
  };
}
