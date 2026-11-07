import { eq, and, inArray, isNull, or, sql } from "drizzle-orm";
import {
  discounts,
  discountRedemptions,
  markets,
  orderDiscountApplications,
  tenants,
  withTenant,
  type Db,
} from "@bs/db";
import type { Runtime } from "../runtime.ts";
import type { TenantContext } from "../context.ts";
import {
  evaluateDiscounts,
  type EngineApplication,
  type EngineDiscount,
  type EngineRejection,
} from "../discounts/engine.ts";

export interface ValidateDiscountInput {
  code: string;
  cartSubtotal: number; // in paise
  cartTotalQty: number;
  customerId?: string | undefined;
  currency?: string | undefined;
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

export interface CartDiscountsInput {
  /** Codes the shopper typed (none for a plain cart: automatic discounts still apply). */
  codes: string[];
  cartSubtotal: number;
  cartTotalQty: number;
  currency?: string | undefined;
  /** Known shopper, for per-customer limits. A guest is enforced again when the order is placed. */
  customerId?: string | null | undefined;
}

export interface CartDiscountsResult {
  applications: EngineApplication[];
  rejections: EngineRejection[];
}

/** The store's own currency: the base market's, or the tenant's before markets exist. */
async function baseCurrencyOf(db: Db, tenantId: string): Promise<string> {
  const [base] = await db
    .select({ currency: markets.currency })
    .from(markets)
    .where(and(eq(markets.tenantId, tenantId), eq(markets.isBase, true)))
    .limit(1);
  if (base) return base.currency;
  const [t] = await db.select({ currency: tenants.currency }).from(tenants).where(eq(tenants.id, tenantId)).limit(1);
  return (t?.currency ?? "INR").toUpperCase();
}

/**
 * Everything that applies to a cart: the codes the shopper typed plus the store's automatic discounts, run through the
 * engine (ADR-045) on a connection already scoped to the tenant.
 */
export async function evaluateCartDiscounts(db: Db, tenantId: string, input: CartDiscountsInput): Promise<CartDiscountsResult> {
  const codes = input.codes.map((c) => c.trim()).filter(Boolean);
  const rows = await db
    .select()
    .from(discounts)
    .where(
      and(
        eq(discounts.tenantId, tenantId),
        or(
          // Automatic discounts that can run, and any code the shopper typed (so a stopped code gets its reason).
          and(isNull(discounts.code), eq(discounts.status, "active")),
          codes.length > 0 ? inArray(discounts.code, codes) : undefined,
        ),
      ),
    );

  const customerUses: Record<string, number> = {};
  if (input.customerId && rows.length > 0) {
    const used = await db
      .select({ discountId: discountRedemptions.discountId, n: sql<number>`count(*)::int` })
      .from(discountRedemptions)
      .where(
        and(
          eq(discountRedemptions.tenantId, tenantId),
          eq(discountRedemptions.customerId, input.customerId),
          inArray(discountRedemptions.discountId, rows.map((r) => r.id)),
        ),
      )
      .groupBy(discountRedemptions.discountId);
    for (const u of used) customerUses[u.discountId] = u.n;
  }

  const currency = (input.currency ?? "INR").toUpperCase();
  const engineRows: EngineDiscount[] = rows.map((d) => ({
    id: d.id,
    code: d.code ?? null,
    title: d.title,
    type: d.type,
    value: d.value,
    minSubtotal: d.minSubtotal ?? null,
    minQty: d.minQty ?? null,
    usageLimit: d.usageLimit,
    usedCount: d.usedCount,
    perCustomerLimit: d.perCustomerLimit,
    combinable: d.combinable,
    startsAt: d.startsAt,
    endsAt: d.endsAt,
    status: d.status,
    appliesTo: d.appliesTo,
    createdAt: d.createdAt,
  }));

  return evaluateDiscounts({
    discounts: engineRows,
    codes,
    cart: { subtotal: input.cartSubtotal, itemCount: input.cartTotalQty, currency, baseCurrency: await baseCurrencyOf(db, tenantId) },
    customerUses,
    now: new Date(),
  });
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

/** The rules for one typed code, on a connection that is already scoped to the tenant. Automatic discounts are not part of this answer. */
export async function evaluateDiscount(db: Db, tenantId: string, input: ValidateDiscountInput): Promise<AppliedDiscountResult> {
  const code = input.code.trim();
  const res = await evaluateCartDiscounts(db, tenantId, {
    codes: [code],
    cartSubtotal: input.cartSubtotal,
    cartTotalQty: input.cartTotalQty,
    currency: input.currency,
    customerId: input.customerId,
  });
  const app = res.applications.find((a) => !a.automatic && a.code !== null && a.code.toUpperCase() === code.toUpperCase());
  if (!app) {
    const why = res.rejections.find((r) => r.code === code.toUpperCase());
    return { valid: false, discountAmount: 0, reason: why?.reason ?? "Discount code not found" };
  }
  return {
    valid: true,
    discountId: app.discountId,
    code: app.code ?? undefined,
    title: app.title,
    type: app.type,
    discountAmount: app.amount,
    ...(app.freeShipping ? { freeShipping: true } : {}),
  };
}

/**
 * Atomically redeems a discount against its usage limits (PLAN §11.2, §15 Concurrency Proof).
 * The discount row is locked first, so two orders using the same code serialise: the total limit and the per-customer
 * limit are both checked under that lock. A failure must roll the order back (checkout throws).
 */
export async function redeemDiscount(
  rt: Runtime,
  ctx: TenantContext,
  input: RedeemDiscountInput,
  tx?: Db,
): Promise<{ success: boolean; redemptionId?: string | undefined; reason?: string | undefined }> {
  const runner = async (db: Db) => {
    // 1. Lock the discount row; it is also where the per-customer limit is read.
    const locked = await db.execute<{ per_customer_limit: number | null }>(sql`
      SELECT per_customer_limit
        FROM discounts
       WHERE tenant_id = ${ctx.tenantId}::uuid
         AND id = ${input.discountId}::uuid
         FOR UPDATE;
    `);
    const row = locked.rows[0];
    if (!row) return { success: false, reason: "Discount usage limit reached or discount not found" };

    if (input.customerId && row.per_customer_limit !== null) {
      const [mine] = await db
        .select({ n: sql<number>`count(*)::int` })
        .from(discountRedemptions)
        .where(
          and(
            eq(discountRedemptions.tenantId, ctx.tenantId),
            eq(discountRedemptions.discountId, input.discountId),
            eq(discountRedemptions.customerId, input.customerId),
          ),
        );
      if ((mine?.n ?? 0) >= row.per_customer_limit) {
        return { success: false, reason: "You have already used this code" };
      }
    }

    // 2. Guarded atomic update incrementing used_count only if limit allows
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

    // 3. Insert discount redemption audit row
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

/** Copies what each discount did to the order, so the order carries it after the discount changes. */
export async function recordOrderDiscountApplications(
  db: Db,
  tenantId: string,
  orderId: string,
  applications: Array<Pick<EngineApplication, "discountId" | "code" | "title" | "type" | "discountClass"> & { amount: number; shippingAmount: number }>,
): Promise<void> {
  if (applications.length === 0) return;
  await db.insert(orderDiscountApplications).values(
    applications.map((a) => ({
      tenantId,
      orderId,
      discountId: a.discountId,
      code: a.code,
      title: a.title,
      discountClass: a.discountClass,
      type: a.type,
      amount: a.amount,
      shippingAmount: a.shippingAmount,
    })),
  );
}
