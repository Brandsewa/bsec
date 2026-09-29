import { createHash, randomBytes, randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import {
  actionTokens,
  locations,
  orderEvents,
  orderItems,
  orders,
  paymentIntents,
  withTenant,
  QUEUE_NAMES,
} from "@bs/db";
import type { Runtime } from "../runtime.ts";
import type { TenantContext } from "../context.ts";
import { clearCart, getOrCreateCart } from "../storefront/cart.ts";
import { reserveInventory } from "../catalog/inventory-reservations.ts";
import { allocateSequenceNumber } from "./sequences.ts";
import { calculateShippingRate } from "./shipping-rates.ts";
import { withIdempotencyKey } from "../system/idempotency.ts";
import { isFeatureEnabled, FeatureDisabledError } from "../features.ts";

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
  shippingMethod?: "standard" | "express" | undefined;
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
    // 1. Fetch cart
    const cart = await getOrCreateCart(rt, ctx, input.cartToken, tx);
    if (!cart || cart.items.length === 0) {
      throw new Error("Cannot place order with empty cart");
    }

    // 2. Calculate amounts (in paise) using canonical shipping calculation (PLAN §5.4, §7 / M7)
    const subtotal = cart.subtotal;
    const shipping = calculateShippingRate(subtotal, (input.shippingMethod as "standard" | "express") ?? "standard");
    const shippingTotal = shipping.amount;
    const isCod = input.paymentMethod === "cod";
    const codFee = isCod ? 5000 : 0; // ₹50 default COD fee
    const grandTotal = subtotal + shippingTotal + codFee;

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

    // 5. Allocate gapless sequential order number (PLAN §11.2)
    const seq = await allocateSequenceNumber(tx, tenantId, "order", "", {
      defaultPrefix: "ORD-",
      defaultPadding: 5,
    });

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

    // 7. Insert Order Items
    for (const it of cart.items) {
      await tx.insert(orderItems).values({
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
      message: isCod ? "Order placed via Cash on Delivery" : "Order placed awaiting payment",
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
  if (input.idempotencyKey) {
    const res = await withIdempotencyKey(
      rt._db.db,
      tenantId,
      "/api/storefront/checkout/place-order",
      input.idempotencyKey,
      input,
      executeOrderPlacement,
    );
    return res.body;
  }

  const res = await withTenant(rt._db.db, tenantId, executeOrderPlacement);
  return res.body;
}
