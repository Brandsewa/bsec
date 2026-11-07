import { eq, and, inArray, isNull, ne, or, sql } from "drizzle-orm";
import {
  customers,
  discountCodes,
  discounts,
  discountRedemptions,
  markets,
  orderDiscountApplications,
  orders,
  tenants,
  withTenant,
  type Db,
} from "@bs/db";
import type { Runtime } from "../runtime.ts";
import type { TenantContext } from "../context.ts";
import { parseDiscountAppliesTo } from "@bs/contracts/discount-rules";
import {
  ANONYMOUS,
  evaluateDiscounts,
  type EngineApplication,
  type EngineBulkCode,
  type EngineCustomer,
  type EngineDiscount,
  type EngineLine,
  type EngineRejection,
} from "../discounts/engine.ts";
import { collectionIdsByProduct } from "../discounts/scope.ts";

export interface ValidateDiscountInput {
  code: string;
  lines?: CartDiscountLine[] | undefined;
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
  /** The generated code that was typed: it is marked used, once. */
  bulkCodeId?: string | undefined;
  orderId: string;
  customerId?: string | undefined;
  amount: number; // in paise
}

/** A cart line as the engine needs it (the loader adds collection membership). */
export interface CartDiscountLine {
  id: string;
  productId: string;
  quantity: number;
  unitPrice: number;
  lineTotal: number;
  onSale: boolean;
}

export interface CartDiscountsInput {
  /** Codes the shopper typed (none for a plain cart: automatic discounts still apply). */
  codes: string[];
  /** What is in the cart. Product-scoped discounts only touch matching lines. */
  lines?: CartDiscountLine[] | undefined;
  cartSubtotal: number;
  cartTotalQty: number;
  currency?: string | undefined;
  /** The market the cart is priced in; missing means the store's base market. */
  marketId?: string | null | undefined;
  /** Known shopper, for per-customer limits and audiences. A guest is enforced again when the order is placed. */
  customerId?: string | null | undefined;
  /** At checkout: a guest who matches no customer is a stranger, so a code for tagged or chosen customers is refused. */
  strict?: boolean | undefined;
}

export interface CartDiscountsResult {
  applications: EngineApplication[];
  rejections: EngineRejection[];
}

/** The store's own currency and its base market: the base market's, or the tenant's before markets exist. */
async function baseOf(db: Db, tenantId: string): Promise<{ currency: string; marketId: string | null }> {
  const [base] = await db
    .select({ id: markets.id, currency: markets.currency })
    .from(markets)
    .where(and(eq(markets.tenantId, tenantId), eq(markets.isBase, true)))
    .limit(1);
  if (base) return { currency: base.currency, marketId: base.id };
  const [t] = await db.select({ currency: tenants.currency }).from(tenants).where(eq(tenants.id, tenantId)).limit(1);
  return { currency: (t?.currency ?? "INR").toUpperCase(), marketId: null };
}

/**
 * Everything that applies to a cart: the codes the shopper typed plus the store's automatic discounts, run through the
 * engine (ADR-045) on a connection already scoped to the tenant.
 */
export async function evaluateCartDiscounts(db: Db, tenantId: string, input: CartDiscountsInput): Promise<CartDiscountsResult> {
  const codes = input.codes.map((c) => c.trim()).filter(Boolean);

  // Codes from a generated list point at their discount; a used one is still returned so the shopper hears why.
  const bulkRows =
    codes.length > 0
      ? await db
          .select({ id: discountCodes.id, discountId: discountCodes.discountId, code: discountCodes.code, usedAt: discountCodes.usedAt })
          .from(discountCodes)
          .where(and(eq(discountCodes.tenantId, tenantId), inArray(discountCodes.code, codes)))
      : [];
  const bulk: Record<string, EngineBulkCode> = {};
  for (const b of bulkRows) bulk[b.code.toUpperCase()] = { discountId: b.discountId, codeId: b.id, used: b.usedAt !== null };

  const rows = await db
    .select()
    .from(discounts)
    .where(
      and(
        eq(discounts.tenantId, tenantId),
        or(
          // Automatic discounts that can run, and any code the shopper typed (so a stopped code gets its reason).
          and(isNull(discounts.code), eq(discounts.usesCodeList, false), eq(discounts.status, "active")),
          codes.length > 0 ? inArray(discounts.code, codes) : undefined,
          bulkRows.length > 0 ? inArray(discounts.id, [...new Set(bulkRows.map((b) => b.discountId))]) : undefined,
        ),
      ),
    );

  // Who is shopping: tags and order history decide whether a code made for some customers is theirs.
  let customer: EngineCustomer = { ...ANONYMOUS, strict: input.strict === true };
  if (input.customerId) {
    const [c] = await db
      .select({ id: customers.id, tags: customers.tags })
      .from(customers)
      .where(and(eq(customers.tenantId, tenantId), eq(customers.id, input.customerId)))
      .limit(1);
    if (c) {
      // "New" means no order that was not cancelled: read from the orders themselves, not from the cached customer totals.
      const [prior] = await db
        .select({ id: orders.id })
        .from(orders)
        .where(and(eq(orders.tenantId, tenantId), eq(orders.customerId, c.id), ne(orders.status, "cancelled")))
        .limit(1);
      customer = { id: c.id, isNew: !prior, tags: c.tags, strict: input.strict === true };
    }
  }

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
    rules: d.rules,
    customerEligibility: d.customerEligibility,
    usesCodeList: d.usesCodeList,
    createdAt: d.createdAt,
  }));

  // Collection membership is read only for the collections some discount in play asks about.
  const wantedCollections = [
    ...new Set(
      engineRows.flatMap((d) => {
        const scope = parseDiscountAppliesTo(d.appliesTo);
        return scope?.type === "collections" ? scope.collectionIds : [];
      }),
    ),
  ];
  const cartLines = input.lines ?? [];
  const memberships = await collectionIdsByProduct(db, tenantId, [...new Set(cartLines.map((l) => l.productId))], wantedCollections);
  const lines: EngineLine[] = cartLines.map((l) => ({ ...l, collectionIds: memberships.get(l.productId) ?? [] }));

  const base = await baseOf(db, tenantId);
  return evaluateDiscounts({
    discounts: engineRows,
    codes,
    cart: { lines, subtotal: input.cartSubtotal, itemCount: input.cartTotalQty, currency, baseCurrency: base.currency, marketId: input.marketId ?? base.marketId },
    customerUses,
    customer,
    bulk,
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
    lines: input.lines,
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

    // 3. A code from a generated list is single use: the guarded update is what makes it so, under the same row lock.
    if (input.bulkCodeId) {
      const used = await db.execute<{ id: string }>(sql`
        UPDATE discount_codes
           SET used_at = now(), used_order_id = ${input.orderId}::uuid
         WHERE tenant_id = ${ctx.tenantId}::uuid
           AND id = ${input.bulkCodeId}::uuid
           AND used_at IS NULL
        RETURNING id;
      `);
      if (!used.rows[0]) return { success: false, reason: "This code has already been used" };
    }

    // 4. Insert discount redemption audit row
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
