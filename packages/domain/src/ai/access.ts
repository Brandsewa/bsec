/**
 * Who may use AI access (ADR-050 decision 4): the store's plan must include it (`plans.features.ai_access`, the same way custom
 * fields read `features.custom_fields`, so Super Admin can change plans without code) and the `ai_access` feature flag must be on
 * (global kill switch and per-store override, ADR-011).
 */
import { sql } from "drizzle-orm";
import type { Db } from "@bs/db";
import { isFeatureEnabled } from "../features.ts";

export const AI_FLAG_KEY = "ai_access";

export async function aiAccessEntitled(db: Db, tenantId: string): Promise<boolean> {
  const res = await db.execute<{ features: Record<string, unknown> | string | null }>(sql`
    SELECT p.features
      FROM subscriptions s
      JOIN plans p ON p.id = s.plan_id
     WHERE s.tenant_id = ${tenantId}
       AND s.status IN ('active', 'trialing', 'past_due')
     ORDER BY s.created_at DESC
     LIMIT 1
  `);
  const raw = res.rows[0]?.features;
  const features = typeof raw === "string" ? (JSON.parse(raw) as Record<string, unknown>) : (raw ?? {});
  return features["ai_access"] === true;
}

export async function aiFlagEnabled(db: Db, tenantId: string): Promise<boolean> {
  return isFeatureEnabled(db, tenantId, AI_FLAG_KEY);
}
