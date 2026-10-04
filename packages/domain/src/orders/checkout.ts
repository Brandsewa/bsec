import { createHash, randomBytes, randomUUID } from "node:crypto";
import { and, eq, inArray, sql } from "drizzle-orm";
import {
  actionTokens,
  carts,
  customers,
  locations,
  orderEvents,
  orderItems,
  orders,
  paymentIntents,
  products,
  tenants,
  variants,
  withTenant,
  QUEUE_NAMES,
} from "@bs/db";
import type { Runtime } from "../runtime.ts";
import type { TenantContext } from "../context.ts";
import { clearCart, getOrCreateCart } from "../storefront/cart.ts";
import { reserveInventory } from "../catalog/inventory-reservations.ts";
import { allocateOrderNumber } from "../admin/order-settings.ts";
import { redeemDiscount } from "./discounts.ts";
import { allocateDiscount, priceOrder } from "./pricing.ts";
import { getTenantShippingRates } from "./shipping-rates.ts";
import { withIdempotencyKey } from "../system/idempotency.ts";
import { isFeatureEnabled, FeatureDisabledError } from "../features.ts";
import { readStoreConfig } from "../admin/store-config.ts";
import { trackSoftQuotaUsage } from "../system/quotas.ts";
import { isCheckoutAllowed } from "../system/tenant-lifecycle.ts";

export interface PlaceOrderInput {
  cartToken: string;
  idempotencyKey?: string | undefined;
  email: string;
  phone: string;
  fullName: string;
  addressLine1: string;
  addressLine2?: string | undefined;
  city: string;
  state: string;
  pincode: string;
  country?: string | undefined;
  /** Method id of one of the store's shipping rates; the first configured rate when omitted. */
  shippingMethod?: string | undefined;
  paymentMethod: "cod" | "razorpay" | "online";
  notes?: string | undefined;
  customerId?: string | undefined;
}

export interface PlaceOrderResult {
  success: boolean;
  orderId: string;
  orderNumber: string;
  status: string;
  paymentMethod: string;
  subtotal: number;
  /** Goods discount taken off by a code (0 when none or when the code was free shipping). */
  discountTotal?: number | undefined;
  shippingTotal: number;
  codFee: number;
  grandTotal: number;
  currency: string;
  orderToken: string;
  redirectUrl: string;
  codToken?: string | undefined;
  razorpay?: {
    keyId: string;
    orderId: string;
    amount: number;
    currency: string;
  } | undefined;
}

/**
 * End-to-end checkout order placement service (PLAN §11 / M4).
 *
 * Sequence:
 * 1. Idempotency check: if key supplied, execute inside withIdempotencyKey
 * 2. Fetch cart and validate it contains items
 * 3. Reserve inventory for all items using guarded atomic UPDATE
 * 4. Allocate gapless sequential order number
 * 5. Create order and order items
 * 6. Initialize payment intent (COD or Razorpay)
 * 7. Generate action tokens for guest order view & COD confirmation
 * 8. Record audit order event
 * 9. Clear cart
 * 10. Enqueue order.created job
 */
export async function placeOrder(
  rt: Runtime,
  ctx: TenantContext,
  input: PlaceOrderInput,
): Promise<PlaceOrderResult> {
  const tenantId = ctx.tenantId;

  const checkoutEnabled = await isFeatureEnabled(rt._db.db, tenantId, "checkout");
  if (!checkoutEnabled) {
    throw new FeatureDisabledError("checkout", "Checkout is currently disabled for this store");
  }

  const executeOrderPlacement = async (tx: typeof rt._db.db): Promise<{ status: number; body: PlaceOrderResult }> => {
    // Assert tenant lifecycle allows checkout (PLAN §6.4)
    const [t] = await tx
      .select({ status: tenants.status })
      .from(tenants)
      .where(eq(tenants.id, tenantId))
      .limit(1);
    if (t && !isCheckoutAllowed(t.status)) {
      throw new Error(`Checkout is not available for store in '${t.status}' state`);
    }

    // 1. Fetch cart
    const cart = await getOrCreateCart(rt, ctx, input.cartToken, tx);
    if (!cart || cart.items.length === 0) {
      throw new Error("Cannot place order with empty cart");
    }

    // A code that was applied but is no longer valid must not quietly change the price: the shopper is told.
    if (cart.discountNotice) {
      throw new Error(`Bad Request: ${cart.discountNotice}. Remove the code to continue.`);
    }

    // 2. Calculate amounts (in paise) using canonical shipping calculation (PLAN §5.4, §7 / M7)
    const subtotal = cart.subtotal;
    const resolvedRates = await getTenantShippingRates(tx, tenantId, subtotal);
    if (input.shippingMethod && !resolvedRates.some((r) => r.method === input.shippingMethod)) {
      throw new Error("Bad Request: the chosen shipping method is not available for this store");
    }
    const shipping = (input.shippingMethod ? resolvedRates.find((r) => r.method === input.shippingMethod) : undefined) ?? resolvedRates[0];
    const shippingBase = shipping ? shipping.amount : 0;
    const isCod = input.paymentMethod === "cod";
    const storeConfig = await readStoreConfig(tx);
    if (isCod && !storeConfig.cod.enabled) {
      throw new Error("Cash on delivery is not available for this store");
    }
    const codFee = isCod ? storeConfig.cod.feePaise : 0;
    // The same function the cart and checkout pages use, so the total shown is the total charged.
    const pricing = priceOrder({
      subtotal,
      shipping: shippingBase,
      codFee,
      discount: cart.discount ? { type: cart.discount.type, discountAmount: cart.discount.amount } : null,
    });
    const { shippingTotal, grandTotal, discountTotal } = pricing;

    // 3. Find default inventory location for tenant
    const [loc] = await tx
      .select({ id: locations.id })
      .from(locations)
      .where(eq(locations.tenantId, tenantId))
      .orderBy(sql`${locations.isDefault} DESC, ${locations.createdAt} ASC`)
      .limit(1);

    if (!loc) {
      throw new Error("No inventory location found for store");
    }
    const locationId = loc.id;

    // 4. Load variant configuration to identify pre-order and inventory policies
    const orderId = randomUUID();
    const variantIds = cart.items.map((it) => it.variantId);
    const variantRows = await tx
      .select({
        id: variants.id,
        trackInventory: variants.trackInventory,
        allowBackorder: variants.allowBackorder,
        preorderEnabled: variants.preorderEnabled,
        preorderShipsOn: variants.preorderShipsOn,
        priceOnRequest: products.priceOnRequest,
      })
      .from(variants)
      .innerJoin(
        products,
        and(eq(products.tenantId, variants.tenantId), eq(products.id, variants.productId)),
      )
      .where(and(eq(variants.tenantId, tenantId), inArray(variants.id, variantIds)));

    if (variantRows.some((v) => v.priceOnRequest)) {
      throw new Error("This product is price on request and cannot be ordered through standard checkout");
    }

    const variantMap = new Map(variantRows.map((v) => [v.id, v]));

    // Limited variants that track inventory, do not allow backorder and are not pre-orders must reserve stock.
    // Pre-orders commit stock when goods arrive, not at checkout time (ORDERS-PREORDERS-PLAN §3.2 rule 8).
    const reserveItems = cart.items
      .filter((it) => {
        const v = variantMap.get(it.variantId);
        if (!v) return true;
        if (v.preorderEnabled) return false;
        if (v.allowBackorder) return false;
        if (!v.trackInventory) return false;
        return true;
      })
      .map((it) => ({
        variantId: it.variantId,
        locationId,
        qty: it.quantity,
      }));

    if (reserveItems.length > 0) {
      await reserveInventory(tx, tenantId, reserveItems, {
        orderId,
        cartId: cart.id,
      });
    }

    // Determine latest ships_on date across all pre-order items (mixed carts rule: latest date applies)
    let orderShipsOn: string | null = null;
    for (const it of cart.items) {
      const v = variantMap.get(it.variantId);
      if (v?.preorderEnabled && v.preorderShipsOn) {
        const lineDate = typeof v.preorderShipsOn === "string" ? v.preorderShipsOn : (v.preorderShipsOn as Date).toISOString().slice(0, 10);
        if (!orderShipsOn || lineDate > orderShipsOn) {
          orderShipsOn = lineDate;
        }
      }
    }

    // 5. Allocate gapless sequential order number respecting store settings (PLAN §11.2, ORDERS-SETTINGS-PLAN §4.1)
    const seq = await allocateOrderNumber(tx, tenantId);

    // 5b. Resolve or create customer (PLAN §0b)
    let effectiveCustomerId = input.customerId ?? null;
    const checkoutEmail = input.email?.trim().toLowerCase();
    const checkoutPhone = input.phone?.trim() ? input.phone.trim().replace(/\D/g, "") : null;
    const checkoutName = input.fullName?.trim() || "";

    if (!effectiveCustomerId && (checkoutEmail || checkoutPhone)) {
      // Find existing customer by email, then by phone
      let existingCust: typeof customers.$inferSelect | undefined;
      if (checkoutEmail) {
        const [byEmail] = await tx
          .select()
          .from(customers)
          .where(and(eq(customers.tenantId, tenantId), eq(customers.email, checkoutEmail)))
          .limit(1);
        existingCust = byEmail;
      }
      if (!existingCust && checkoutPhone) {
        const [byPhone] = await tx
          .select()
          .from(customers)
          .where(and(eq(customers.tenantId, tenantId), eq(customers.phone, checkoutPhone)))
          .limit(1);
        existingCust = byPhone;
      }

      if (existingCust) {
        // Blocked customers cannot check out; the message stays neutral so the store's reason is not disclosed.
        if (existingCust.status !== "active") {
          throw new Error("Your order could not be completed. Please contact the store for help.");
        }
        effectiveCustomerId = existingCust.id;
        // Never overwrite existing name or phone if already populated; fill only when empty
        const updates: Record<string, unknown> = {};
        if (!existingCust.name && checkoutName) {
          updates.name = checkoutName;
        }
        if (!existingCust.phone && checkoutPhone) {
          const [phoneTaken] = await tx
            .select({ id: customers.id })
            .from(customers)
            .where(and(eq(customers.tenantId, tenantId), eq(customers.phone, checkoutPhone)))
            .limit(1);
          if (!phoneTaken || phoneTaken.id === existingCust.id) {
            updates.phone = checkoutPhone;
          }
        }
        if (Object.keys(updates).length > 0) {
          updates.updatedAt = new Date();
          await tx
            .update(customers)
            .set(updates)
            .where(and(eq(customers.tenantId, tenantId), eq(customers.id, existingCust.id)));
        }
      } else if (checkoutEmail) {
        let safePhone = checkoutPhone;
        if (checkoutPhone) {
          const [phoneTaken] = await tx
            .select({ id: customers.id })
            .from(customers)
            .where(and(eq(customers.tenantId, tenantId), eq(customers.phone, checkoutPhone)))
            .limit(1);
          if (phoneTaken) {
            safePhone = null;
          }
        }

        const [newGuest] = await tx
          .insert(customers)
          .values({
            tenantId,
            email: checkoutEmail,
            phone: safePhone,
            name: checkoutName,
            isGuest: true,
            emailVerified: false,
            phoneVerified: false,
            acceptsMarketing: false,
            marketingState: "not_subscribed",
          })
          .returning({ id: customers.id });
        if (newGuest) {
          effectiveCustomerId = newGuest.id;
        }
      }
    }

    // 6. Insert Order
    await tx.insert(orders).values({
      id: orderId,
      tenantId,
      number: seq.formatted,
      customerId: effectiveCustomerId,
      email: input.email,
      phone: input.phone,
      currency: "INR",
      status: "pending",
      paymentStatus: isCod ? "cod_pending" : "pending",
      fulfillmentStatus: "unfulfilled",
      subtotal,
      discountTotal,
      shippingTotal,
      codFee,
      grandTotal,
      shipsOn: orderShipsOn,
      shippingAddress: {
        fullName: input.fullName,
        addressLine1: input.addressLine1,
        addressLine2: input.addressLine2,
        city: input.city,
        state: input.state,
        pincode: input.pincode,
        country: input.country ?? "IN",
      },
      billingAddress: {
        fullName: input.fullName,
        addressLine1: input.addressLine1,
        addressLine2: input.addressLine2,
        city: input.city,
        state: input.state,
        pincode: input.pincode,
        country: input.country ?? "IN",
      },
      placeOfSupplyState: input.state,
      source: "web",
      cartId: cart.id,
      idempotencyKey: input.idempotencyKey ?? null,
    });

    // 7. Insert Order Items (a goods discount is split across the lines in proportion to their totals)
    const lineDiscounts = allocateDiscount(cart.items.map((it) => it.lineTotal), discountTotal);
    for (const [index, it] of cart.items.entries()) {
      const v = variantMap.get(it.variantId);
      const lineShipsOn = v?.preorderEnabled && v.preorderShipsOn
        ? (typeof v.preorderShipsOn === "string" ? v.preorderShipsOn : (v.preorderShipsOn as Date).toISOString().slice(0, 10))
        : null;

      await tx.insert(orderItems).values({
        discountAmount: lineDiscounts[index] ?? 0,
        tenantId,
        orderId,
        variantId: it.variantId,
        productTitle: it.product.title,
        variantTitle: it.variant.title,
        sku: it.variant.sku,
        quantity: it.quantity,
        unitPrice: it.unitPriceSnapshot,
        total: it.lineTotal,
        shipsOn: lineShipsOn,
      });
    }

    // 7b. Redeem the code against its usage limit in the same transaction: if someone else just used the last
    // redemption this order (and its stock reservation) is rolled back and the shopper is told.
    if (cart.discount) {
      const redeemed = await redeemDiscount(
        rt,
        ctx,
        { discountId: cart.discount.discountId, orderId, ...(input.customerId ? { customerId: input.customerId } : {}), amount: pricing.discountValue },
        tx,
      );
      if (!redeemed.success) {
        throw new Error(`Bad Request: code ${cart.discount.code} is no longer available. Remove it to continue.`);
      }
    }

    // 8. Payment Intent
    const intentId = randomUUID();
    const providerOrderId = !isCod ? `rzp_order_${orderId.replace(/-/g, "").slice(0, 14)}` : null;

    await tx.insert(paymentIntents).values({
      id: intentId,
      tenantId,
      orderId,
      provider: isCod ? "cod" : "razorpay",
      amount: grandTotal,
      currency: "INR",
      status: isCod ? "cod_pending" : "created",
      providerOrderId: providerOrderId ?? null,
      idempotencyKey: input.idempotencyKey ?? null,
    });

    // 9. Action Tokens (COD confirmation & order guest tracking)
    let codRawToken: string | undefined;
    if (isCod) {
      codRawToken = `cod_${randomBytes(24).toString("hex")}`;
      const codHash = createHash("sha256").update(codRawToken).digest("hex");
      await tx.insert(actionTokens).values({
        tenantId,
        purpose: "cod_confirmation",
        targetId: orderId,
        tokenHash: codHash,
        expiresAt: new Date(Date.now() + 48 * 3600 * 1000), // 48h
      });
    }

    const orderViewRawToken = `ord_${randomBytes(24).toString("hex")}`;
    const orderViewHash = createHash("sha256").update(orderViewRawToken).digest("hex");
    await tx.insert(actionTokens).values({
      tenantId,
      purpose: "order_view",
      targetId: orderId,
      tokenHash: orderViewHash,
      expiresAt: new Date(Date.now() + 30 * 86400 * 1000), // 30 days
    });

    // 10. Audit event
    await tx.insert(orderEvents).values({
      tenantId,
      orderId,
      type: "order.create",
      message:
        (isCod ? "Order placed via Cash on Delivery" : "Order placed awaiting payment") +
        (cart.discount ? ` with code ${cart.discount.code}${pricing.shippingDiscount > 0 ? " (free shipping)" : ""}` : ""),
      actorType: "customer",
      data: {
        paymentMethod: input.paymentMethod,
        grandTotal,
      },
    });

    // 11. Mark cart converted and, if it was abandoned, mark recovered (ORDERS-ABANDONED-CHECKOUTS-PLAN §4.1)
    const [cartRow] = await tx
      .select({ status: carts.status })
      .from(carts)
      .where(eq(carts.id, cart.id))
      .limit(1);

    const isAbandoned = cartRow?.status === "abandoned";

    await tx
      .update(carts)
      .set({
        status: "converted",
        lastActivityAt: sql`now()`,
        ...(isAbandoned ? { recoveredAt: sql`now()` } : {}),
      })
      .where(eq(carts.id, cart.id));

    // Clear cart items
    await clearCart(rt, ctx, input.cartToken, tx);

    // 12. Enqueue order.created job if boss runtime is present
    if (rt._jobs) {
      await rt._jobs.send(QUEUE_NAMES.ORDER_CREATED, { orderId, tenantId });
    }

    const resultBody: PlaceOrderResult = {
      success: true,
      orderId,
      orderNumber: seq.formatted,
      status: "pending",
      paymentMethod: input.paymentMethod,
      subtotal,
      discountTotal,
      shippingTotal,
      codFee,
      grandTotal,
      currency: "INR",
      orderToken: orderViewRawToken,
      redirectUrl: `/orders/${orderViewRawToken}/thank-you`,
      codToken: codRawToken,
      razorpay: !isCod && providerOrderId ? {
        keyId: "rzp_test_key",
        orderId: providerOrderId,
        amount: grandTotal,
        currency: "INR",
      } : undefined,
    };

    return { status: 201, body: resultBody };
  };

  // If idempotency key provided, run with deduplication
  let resultBody: PlaceOrderResult;
  if (input.idempotencyKey) {
    const res = await withIdempotencyKey(
      rt._db.db,
      tenantId,
      "/api/storefront/checkout/place-order",
      input.idempotencyKey,
      input,
      executeOrderPlacement,
    );
    resultBody = res.body;
  } else {
    const res = await withTenant(rt._db.db, tenantId, executeOrderPlacement);
    resultBody = res.body;
  }

  // Soft quota tracking runs after transaction commit:
  // never blocks checkout and never takes a second pool connection inside an open transaction.
  // quota_events is platform-owned, so it is written on the self-service (app_saas) connection;
  // without it (not configured) tracking is skipped.
  if (rt._saasDb) {
    try {
      const orderCountRes = await withTenant(rt._db.db, tenantId, (tx) =>
        tx.execute<{ count: string }>(
          sql`SELECT COUNT(*)::text as count FROM orders WHERE tenant_id = ${tenantId} AND created_at >= date_trunc('month', now());`,
        ),
      );
      const monthlyOrders = parseInt(orderCountRes.rows[0]?.count ?? "1", 10);
      await trackSoftQuotaUsage(rt._saasDb.db, {
        tenantId,
        quotaKey: "orders_month",
        current: monthlyOrders,
      });
    } catch {
      // Soft quota tracking failure never impedes checkout completion
    }
  }

  return resultBody;
}
