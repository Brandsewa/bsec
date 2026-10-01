import { eq, and, sql } from "drizzle-orm";
import {
  discounts,
  discountRedemptions,
  withTenant,
  type Db,
} from "@bs/db";
import type { Runtime } from "../runtime.ts";
import type { TenantContext } from "../context.ts";

export interface ValidateDiscountInput {
  code: string;
  cartSubtotal: number; // in paise
  cartTotalQty: number;
  customerId?: string | undefined;
}

export interface AppliedDiscountResult {
  valid: boolean;
  discountId?: string | undefined;
  code?: string | undefined;
  title?: string | undefined;
  type?: string | undefined;
  discountAmount: number; // in paise (goods discounts; 0 for free shipping)
  /** True for a free-shipping code: the shipping charge is waived instead of reducing the goods total. */
  freeShipping?: boolean | undefined;
  reason?: string | undefined;
}

export interface RedeemDiscountInput {
  discountId: string;
  orderId: string;
  customerId?: string | undefined;
  amount: number; // in paise
}

/**
 * Validates a discount code against cart subtotal, minimum quantity, usage limits and active window.
 */
export async function validateDiscount(
  rt: Runtime,
  ctx: TenantContext,
  input: ValidateDiscountInput,
  tx?: Db,
): Promise<AppliedDiscountResult> {
  if (tx) {
    return evaluateDiscount(tx, ctx.tenantId, input);
  }
  return withTenant(rt._db.db, ctx.tenantId, (db) => evaluateDiscount(db, ctx.tenantId, input));
}

/** The rules for one code, on a connection that is already scoped to the tenant. */
export async function evaluateDiscount(db: Db, tenantId: string, input: ValidateDiscountInput): Promise<AppliedDiscountResult> {
  const codeNormalized = input.code.trim();

  const [discount] = await db
    .select()
    .from(discounts)
    .where(and(eq(discounts.tenantId, tenantId), eq(discounts.code, codeNormalized)));

  if (!discount) {
    return { valid: false, discountAmount: 0, reason: "Discount code not found" };
  }

  if (discount.status !== "active") {
    return { valid: false, discountAmount: 0, reason: `Discount code is ${discount.status}` };
  }

  const now = new Date();
  if (discount.startsAt && discount.startsAt > now) {
    return { valid: false, discountAmount: 0, reason: "Discount is not yet active" };
  }
  if (discount.endsAt && discount.endsAt < now) {
    return { valid: false, discountAmount: 0, reason: "Discount has expired" };
  }

  if (discount.minSubtotal && input.cartSubtotal < discount.minSubtotal) {
    return {
      valid: false,
      discountAmount: 0,
      reason: `Minimum order subtotal of ₹${(discount.minSubtotal / 100).toFixed(2)} required`,
    };
  }

  if (discount.minQty && input.cartTotalQty < discount.minQty) {
    return {
      valid: false,
      discountAmount: 0,
      reason: `Minimum order quantity of ${discount.minQty} items required`,
    };
  }

  if (discount.usageLimit !== null && discount.usedCount >= discount.usageLimit) {
    return { valid: false, discountAmount: 0, reason: "Discount usage limit has been reached" };
  }

  // Rules the checkout cannot apply yet are refused with a clear reason rather than guessed at.
  const appliesTo = (discount.appliesTo as { type?: string } | null)?.type ?? "all";
  if (appliesTo !== "all") {
    return { valid: false, discountAmount: 0, reason: "This code can't be used at checkout yet" };
  }
  if (discount.type === "buy_x_get_y") {
    return { valid: false, discountAmount: 0, reason: "This offer can't be used at checkout yet" };
  }

  // Calculate discount amount in paise
  let discountAmount = 0;
  if (discount.type === "percent") {
    discountAmount = Math.round((input.cartSubtotal * Math.min(100, Math.max(0, discount.value))) / 100);
  } else if (discount.type === "fixed") {
    discountAmount = Math.min(input.cartSubtotal, discount.value);
  } else if (discount.type !== "free_shipping") {
    return { valid: false, discountAmount: 0, reason: "This code can't be used at checkout yet" };
  }

  return {
    valid: true,
    discountId: discount.id,
    code: discount.code ?? undefined,
    title: discount.title,
    type: discount.type,
    discountAmount,
    ...(discount.type === "free_shipping" ? { freeShipping: true } : {}),
  };
}

/**
 * Atomically redeems a discount against its usage limit (PLAN §11.2, §15 Concurrency Proof).
 * Uses guarded UPDATE ... WHERE used_count < usage_limit RETURNING id.
 */
export async function redeemDiscount(
  rt: Runtime,
  ctx: TenantContext,
  input: RedeemDiscountInput,
  tx?: Db,
): Promise<{ success: boolean; redemptionId?: string | undefined; reason?: string | undefined }> {
  const runner = async (db: Db) => {
    // 1. Guarded atomic update incrementing used_count only if limit allows
    const updateRes = await db.execute<{ id: string; used_count: number; usage_limit: number | null }>(sql`
      UPDATE discounts
         SET used_count = used_count + 1,
             updated_at = now()
       WHERE tenant_id = ${ctx.tenantId}::uuid
         AND id = ${input.discountId}::uuid
         AND (usage_limit IS NULL OR used_count < usage_limit)
      RETURNING id, used_count, usage_limit;
    `);

    const updated = updateRes.rows[0];
    if (!updated) {
      return { success: false, reason: "Discount usage limit reached or discount not found" };
    }

    // 2. Insert discount redemption audit row
    const [redemption] = await db
      .insert(discountRedemptions)
      .values({
        tenantId: ctx.tenantId,
        discountId: input.discountId,
        orderId: input.orderId,
        customerId: input.customerId ?? null,
        amount: input.amount,
      })
      .returning({ id: discountRedemptions.id });

    return {
      success: true,
      redemptionId: redemption?.id,
    };
  };

  if (tx) {
    return runner(tx);
  }
  return withTenant(rt._db.db, ctx.tenantId, runner);
}
