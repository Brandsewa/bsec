/**
 * Test helpers for packages that must not import @bs/db themselves (hard rule 2) but test against a real database:
 * the capability layer and its adapters. Only tests import this entry.
 */
import { sql } from "drizzle-orm";
import type { Runtime } from "../src/runtime.ts";

export { startTestDb, type TestDb } from "@bs/db/test-env";

/** Sets a per-store quota override (needs a runtime that connects as app_platform). Used to lift limits that a fast test would hit. */
export async function setQuotaOverrideForTest(platformRuntime: Runtime, tenantId: string, quotaKey: string, value: number): Promise<void> {
  await platformRuntime._db.db.execute(
    sql`INSERT INTO tenant_quota_overrides (tenant_id, quota_key, value) VALUES (${tenantId}, ${quotaKey}, ${value}) ON CONFLICT (tenant_id, quota_key) DO UPDATE SET value = ${value}`,
  );
}
