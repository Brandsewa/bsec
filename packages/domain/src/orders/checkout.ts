import { createHash, randomBytes, randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import {
  actionTokens,
  locations,
  orderEvents,
  orderItems,
  orders,
  paymentIntents,
  tenants,
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

    // 4. Reserve inventory atomically (PLAN §11.3)
    const orderId = randomUUID();
    const reserveItems = cart.items.map((it) => ({
      variantId: it.variantId,
      locationId,
      qty: it.quantity,
    }));

    await reserveInventory(tx, tenantId, reserveItems, {
      orderId,
      cartId: cart.id,
    });

    // 5. Allocate gapless sequential order number respecting store settings (PLAN §11.2, ORDERS-SETTINGS-PLAN §4.1)
    const seq = await allocateOrderNumber(tx, tenantId);

    // 6. Insert Order
    await tx.insert(orders).values({
      id: orderId,
      tenantId,
      number: seq.formatted,
      customerId: input.customerId ?? null,
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

    // 11. Clear cart
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
