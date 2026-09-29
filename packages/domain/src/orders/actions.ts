import { createHash } from "node:crypto";
import { and, eq, gt, isNull } from "drizzle-orm";
import { actionTokens, withTenant } from "@bs/db";
import type { Runtime } from "../runtime.ts";
import type { TenantContext } from "../context.ts";
import { transitionOrder } from "./state-machine.ts";
import { commitReservation } from "../catalog/inventory-reservations.ts";

export interface ConfirmCodResult {
  success: boolean;
  orderId: string;
}

/**
 * Confirm a Cash on Delivery order via single-use action token link (PLAN §5.7, §11.1).
 */
export async function confirmCodOrder(
  rt: Runtime,
  ctx: TenantContext,
  rawToken: string,
): Promise<ConfirmCodResult> {
  const tokenHash = createHash("sha256").update(rawToken.trim()).digest("hex");
  const tenantId = ctx.tenantId;

  return await withTenant(rt._db.db, tenantId, async (tx) => {
    // Single guarded UPDATE claims the token, so two concurrent clicks cannot both succeed.
    const [actionToken] = await tx
      .update(actionTokens)
      .set({ usedAt: new Date() })
      .where(
        and(
          eq(actionTokens.tenantId, tenantId),
          eq(actionTokens.purpose, "cod_confirmation"),
          eq(actionTokens.tokenHash, tokenHash),
          isNull(actionTokens.usedAt),
          gt(actionTokens.expiresAt, new Date()),
        ),
      )
      .returning();

    if (!actionToken) {
      throw new Error("Invalid, expired, or already used COD confirmation link");
    }

    const orderId = actionToken.targetId;

    // Transition order to confirmed
    await transitionOrder(rt, ctx, orderId, {
      type: "order.confirm",
      reason: "COD confirmed via customer action link",
    });

    // Commit inventory reservation
    await commitReservation(rt._db.db, tenantId, { orderId });

    return {
      success: true,
      orderId,
    };
  });
}
