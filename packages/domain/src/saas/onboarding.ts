import { eq, sql } from "drizzle-orm";
import { schema, withTenant } from "@bs/db";
import type { Runtime } from "../runtime.ts";
import type { TenantContext } from "../context.ts";

export interface OnboardingSteps {
  store_created: boolean;
  product_added: boolean;
  payment_configured: boolean;
  domain_connected: boolean;
  first_order_received: boolean;
  [key: string]: boolean;
}

export interface OnboardingProgressResult {
  steps: OnboardingSteps;
  completedCount: number;
  totalCount: number;
  dismissed: boolean;
  allCompleted: boolean;
}

const DEFAULT_STEPS: OnboardingSteps = {
  store_created: true,
  product_added: false,
  payment_configured: false,
  domain_connected: false,
  first_order_received: false,
};

/**
 * Retrieves the current onboarding setup checklist progress for the tenant (PLAN §5.2, §8).
 * Automatically updates step completion by inspecting tenant state (products, payments, domains, orders).
 */
export async function getOnboardingProgress(
  rt: Runtime,
  ctx: TenantContext,
): Promise<OnboardingProgressResult> {
  const db = rt._db.db;
  const tenantId = ctx.tenantId;

  return await withTenant(db, tenantId, async (tx) => {
    // 1. Fetch current stored progress
    const [progress] = await tx
      .select()
      .from(schema.onboardingProgress)
      .where(eq(schema.onboardingProgress.tenantId, tenantId))
      .limit(1);

    const steps: OnboardingSteps = {
      ...DEFAULT_STEPS,
      ...((progress?.steps as OnboardingSteps) ?? {}),
    };

    // 2. Dynamic state detection: check if products exist
    if (!steps.product_added) {
      const prodRes = await tx.execute<{ count: string }>(sql`
        SELECT count(*)::text as count FROM products WHERE tenant_id = ${tenantId} LIMIT 1;
      `);
      if (parseInt(prodRes.rows[0]?.count ?? "0", 10) > 0) {
        steps.product_added = true;
      }
    }

    // 3. Dynamic state detection: check if custom domain exists
    if (!steps.domain_connected) {
      const domainRes = await tx.execute<{ count: string }>(sql`
        SELECT count(*)::text as count FROM domains
        WHERE tenant_id = ${tenantId} AND type != 'subdomain' AND status = 'active'
        LIMIT 1;
      `);
      if (parseInt(domainRes.rows[0]?.count ?? "0", 10) > 0) {
        steps.domain_connected = true;
      }
    }

    // 4. Dynamic state detection: check if first order received
    if (!steps.first_order_received) {
      const orderRes = await tx.execute<{ count: string }>(sql`
        SELECT count(*)::text as count FROM orders WHERE tenant_id = ${tenantId} LIMIT 1;
      `);
      if (parseInt(orderRes.rows[0]?.count ?? "0", 10) > 0) {
        steps.first_order_received = true;
      }
    }

    // 5. Dynamic state detection: check if payment configured (Razorpay or COD)
    if (!steps.payment_configured) {
      const settingsRes = await tx.execute<{ checkout: { cod?: { enabled?: boolean } } }>(sql`
        SELECT checkout FROM store_settings WHERE tenant_id = ${tenantId} LIMIT 1;
      `);
      if (settingsRes.rows[0]?.checkout?.cod?.enabled) {
        steps.payment_configured = true;
      }
    }

    // Persist any updated steps
    if (progress) {
      await tx
        .update(schema.onboardingProgress)
        .set({
          steps,
          updatedAt: new Date(),
        })
        .where(eq(schema.onboardingProgress.tenantId, tenantId));
    } else {
      await tx.insert(schema.onboardingProgress).values({
        tenantId,
        steps,
      });
    }

    const stepKeys = ["store_created", "product_added", "payment_configured", "domain_connected", "first_order_received"];
    const completedCount = stepKeys.filter((k) => steps[k]).length;
    const totalCount = stepKeys.length;

    return {
      steps,
      completedCount,
      totalCount,
      dismissed: progress?.dismissed ?? false,
      allCompleted: completedCount === totalCount,
    };
  });
}

/**
 * Dismisses the onboarding checklist from the Store Admin Home screen.
 */
export async function dismissOnboardingProgress(
  rt: Runtime,
  ctx: TenantContext,
): Promise<{ success: boolean }> {
  const db = rt._db.db;
  const tenantId = ctx.tenantId;

  await withTenant(db, tenantId, async (tx) => {
    await tx
      .update(schema.onboardingProgress)
      .set({ dismissed: true, updatedAt: new Date() })
      .where(eq(schema.onboardingProgress.tenantId, tenantId));
  });

  return { success: true };
}
