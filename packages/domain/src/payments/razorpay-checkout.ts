import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { and, desc, eq, gt, isNull } from "drizzle-orm";
import { schema, withTenant, QUEUE_NAMES, type Db } from "@bs/db";
import { RazorpayProvider, decryptSecret } from "@bs/payments";
import type { Runtime } from "../runtime.ts";
import { commitReservation } from "../catalog/inventory-reservations.ts";
import { getTenantPaymentMethods } from "../admin/payment-methods.ts";
import { readPlatformProviderState } from "../admin/payment-providers.ts";

/**
 * Razorpay at the storefront checkout (ADMIN-IMPROVEMENTS-PLAN §6.4, ADR-008, ADR-006).
 *
 * The store's own keys (tenant_secrets) are used, never platform or environment keys: money goes to the merchant's
 * Razorpay account. The Razorpay order is created after the shop order has committed (no provider call inside the order
 * transaction); the shopper pays in Razorpay's own modal; the browser callback and the signed webhook both end in
 * `settleRazorpayPayment`, which is idempotent and checks the amount, so whichever arrives first wins.
 */

export interface RazorpayCheckoutParams {
  keyId: string;
  orderId: string;
  amount: number;
  currency: string;
  name: string;
  email: string;
  phone: string;
}

interface StoreRazorpayKeys {
  keyId: string;
  keySecret: string;
}

/** Decrypts only this store's Razorpay keys; unlike the generic loader it never falls back to environment keys. */
async function loadStoreKeys(db: Db, tenantId: string): Promise<StoreRazorpayKeys | null> {
  const rows = await withTenant(db, tenantId, (tx) =>
    tx
      .select({ keyName: schema.tenantSecrets.keyName, ciphertext: schema.tenantSecrets.ciphertext, iv: schema.tenantSecrets.iv })
      .from(schema.tenantSecrets)
      .where(and(eq(schema.tenantSecrets.tenantId, tenantId), eq(schema.tenantSecrets.provider, "razorpay"))),
  );
  let keyId: string | undefined;
  let keySecret: string | undefined;
  for (const r of rows) {
    try {
      const v = decryptSecret({ ciphertext: r.ciphertext, iv: r.iv });
      if (r.keyName === "key_id" || r.keyName === "keyId") keyId = v;
      if (r.keyName === "key_secret" || r.keyName === "keySecret") keySecret = v;
    } catch {
      // an undecryptable row counts as missing
    }
  }
  return keyId && keySecret ? { keyId, keySecret } : null;
}

/**
 * Whether Razorpay may be offered and used at this store's checkout right now: the store has activated it, the
 * platform offers it (and allows live mode when the store's keys are live), and the store's keys are saved.
 */
export async function isRazorpayCheckoutReady(db: Db, tenantId: string): Promise<boolean> {
  const methods = await withTenant(db, tenantId, (tx) => getTenantPaymentMethods(tx, tenantId));
  const method = methods.find((m) => m.provider === "razorpay");
  if (!method || method.status !== "active") return false;
  const platform = await readPlatformProviderState(db, "razorpay");
  if (!platform.enabled) return false;
  if (method.mode === "live" && !platform.liveModeAllowed) return false;
  return (await loadStoreKeys(db, tenantId)) !== null;
}

export function orderTokenHash(token: string): string {
  return createHash("sha256").update(token.trim()).digest("hex");
}

async function orderIdForToken(db: Db, tenantId: string, token: string): Promise<string | null> {
  return withTenant(db, tenantId, async (tx) => {
    const [row] = await tx
      .select({ targetId: schema.actionTokens.targetId })
      .from(schema.actionTokens)
      .where(
        and(
          eq(schema.actionTokens.tenantId, tenantId),
          eq(schema.actionTokens.purpose, "order_view"),
          eq(schema.actionTokens.tokenHash, orderTokenHash(token)),
          gt(schema.actionTokens.expiresAt, new Date()),
        ),
      );
    return row?.targetId ?? null;
  });
}

/**
 * Creates (or returns the existing) Razorpay order for a placed, unpaid shop order and gives the browser what the
 * Razorpay modal needs. The amount is the order's grand total as stored by the server, never anything the client sent.
 */
export async function startRazorpayPayment(rt: Runtime, tenantId: string, orderId: string): Promise<RazorpayCheckoutParams> {
  const db = rt._db.db;
  if (!(await isRazorpayCheckoutReady(db, tenantId))) {
    throw new Error("Bad Request: Online payment is not available for this store. Please choose another way to pay.");
  }
  const keys = await loadStoreKeys(db, tenantId);
  if (!keys) throw new Error("Bad Request: Online payment is not available for this store.");

  const loaded = await withTenant(db, tenantId, async (tx) => {
    const [order] = await tx.select().from(schema.orders).where(and(eq(schema.orders.tenantId, tenantId), eq(schema.orders.id, orderId)));
    if (!order) return null;
    const [intent] = await tx
      .select()
      .from(schema.paymentIntents)
      .where(and(eq(schema.paymentIntents.tenantId, tenantId), eq(schema.paymentIntents.orderId, orderId), eq(schema.paymentIntents.provider, "razorpay")))
      .orderBy(desc(schema.paymentIntents.createdAt))
      .limit(1);
    return { order, intent };
  });
  if (!loaded || !loaded.intent) throw new Error("Not Found: this order has no online payment to complete");
  const { order, intent } = loaded;
  if (order.status === "cancelled") throw new Error("Bad Request: this order was cancelled");
  if (order.paymentStatus === "paid" || intent.status === "captured") throw new Error("Bad Request: this order is already paid");

  const common = { keyId: keys.keyId, currency: intent.currency, name: order.number, email: order.email, phone: order.phone };

  if (intent.providerOrderId) {
    return { ...common, orderId: intent.providerOrderId, amount: Number(intent.amount) };
  }

  const provider = new RazorpayProvider({ keyId: keys.keyId, keySecret: keys.keySecret });
  const created = await provider.createIntent(
    { tenantId },
    { id: orderId, number: order.number, currency: intent.currency, grandTotal: intent.amount, email: order.email, phone: order.phone },
  );

  // Another request may have created one at the same time; the first to store its id wins and the rest reuse it.
  const stored = await withTenant(db, tenantId, async (tx) => {
    const updated = await tx
      .update(schema.paymentIntents)
      .set({ providerOrderId: created.providerOrderId, updatedAt: new Date() })
      .where(and(eq(schema.paymentIntents.tenantId, tenantId), eq(schema.paymentIntents.id, intent.id), isNull(schema.paymentIntents.providerOrderId)))
      .returning({ id: schema.paymentIntents.id });
    if (updated.length > 0) return created.providerOrderId;
    const [again] = await tx
      .select({ providerOrderId: schema.paymentIntents.providerOrderId })
      .from(schema.paymentIntents)
      .where(and(eq(schema.paymentIntents.tenantId, tenantId), eq(schema.paymentIntents.id, intent.id)));
    return again?.providerOrderId ?? created.providerOrderId;
  });

  return { ...common, orderId: stored, amount: Number(intent.amount) };
}

/** Same as `startRazorpayPayment`, for the shopper's order link (the token proves they placed the order). */
export async function startRazorpayPaymentByToken(rt: Runtime, tenantId: string, orderToken: string): Promise<RazorpayCheckoutParams> {
  const orderId = await orderIdForToken(rt._db.db, tenantId, orderToken);
  if (!orderId) throw new Error("Not Found: order not found");
  return startRazorpayPayment(rt, tenantId, orderId);
}

export interface SettleInput {
  /** The provider's order id the payment belongs to (Razorpay order, Stripe Checkout Session, PayPal order). */
  providerOrderId: string;
  providerPaymentId: string;
  /** Amount the provider reports for the payment, in minor units, when known; checked against the order. */
  amount?: number | undefined;
  /** Currency the provider reports, when known; checked against the order (ADR-040: a wrong currency is never accepted). */
  currency?: string | undefined;
  /** Which provider took the payment. Defaults to Razorpay. */
  provider?: "razorpay" | "stripe" | "paypal" | undefined;
  source: "browser" | "webhook" | "return";
  /** Used to send the order confirmation once the order is paid (online orders are not announced before that). */
  jobs?: { send(queue: string, data: object): Promise<unknown> } | undefined;
}

const PROVIDER_LABEL: Record<string, string> = { razorpay: "Razorpay", stripe: "Stripe", paypal: "PayPal" };

export type SettleResult = "paid" | "already_paid" | "ignored";

/**
 * Marks the shop order paid and confirmed. Idempotent: a second call (browser plus webhook, or a webhook retry) is a
 * no-op. A payment whose amount does not match the order is recorded but never marks it paid.
 */
export async function settleRazorpayPayment(db: Db, tenantId: string, input: SettleInput): Promise<SettleResult> {
  return settleProviderPayment(db, tenantId, input);
}

/** The same idempotent, amount- and currency-checked settle for every online provider. */
export async function settleProviderPayment(db: Db, tenantId: string, input: SettleInput): Promise<SettleResult> {
  const provider = input.provider ?? "razorpay";
  const label = PROVIDER_LABEL[provider] ?? provider;
  const outcome = await withTenant(db, tenantId, async (tx): Promise<{ result: SettleResult; orderId?: string }> => {
    const [intent] = await tx
      .select()
      .from(schema.paymentIntents)
      .where(and(eq(schema.paymentIntents.tenantId, tenantId), eq(schema.paymentIntents.providerOrderId, input.providerOrderId), eq(schema.paymentIntents.provider, provider)))
      .limit(1);
    if (!intent) return { result: "ignored" };

    const [order] = await tx.select().from(schema.orders).where(and(eq(schema.orders.tenantId, tenantId), eq(schema.orders.id, intent.orderId))).for("update");
    if (!order) return { result: "ignored" };
    if (intent.status === "captured" || order.paymentStatus === "paid") return { result: "already_paid", orderId: order.id };

    const currencyWrong = input.currency !== undefined && input.currency.toUpperCase() !== intent.currency.toUpperCase();
    if (currencyWrong || (input.amount !== undefined && input.amount !== Number(intent.amount))) {
      await tx.insert(schema.orderEvents).values({
        tenantId,
        orderId: order.id,
        type: "payment.amount_mismatch",
        message: `A ${label} payment did not match the order total and was not accepted. Check it in your ${label} dashboard.`,
        actorType: "system",
        data: {
          providerPaymentId: input.providerPaymentId,
          expected: Number(intent.amount),
          received: input.amount ?? null,
          expectedCurrency: intent.currency,
          receivedCurrency: input.currency ?? null,
        },
      });
      return { result: "ignored" };
    }

    await tx.update(schema.paymentIntents).set({ status: "captured", updatedAt: new Date() }).where(eq(schema.paymentIntents.id, intent.id));
    await tx.insert(schema.paymentAttempts).values({
      tenantId,
      intentId: intent.id,
      providerPaymentId: input.providerPaymentId,
      method: provider,
      status: "captured",
      raw: { source: input.source },
    });

    if (order.status === "pending") {
      await tx
        .update(schema.orders)
        .set({ status: "confirmed", paymentStatus: "paid", updatedAt: new Date() })
        .where(eq(schema.orders.id, order.id));
    } else {
      await tx.update(schema.orders).set({ paymentStatus: "paid", updatedAt: new Date() }).where(eq(schema.orders.id, order.id));
    }
    // The cart was kept open while payment was pending (see placeOrder); now that it is paid it is converted and emptied.
    if (order.cartId) {
      const [cart] = await tx.select({ status: schema.carts.status }).from(schema.carts).where(eq(schema.carts.id, order.cartId)).limit(1);
      if (cart && cart.status !== "converted") {
        await tx.delete(schema.cartItems).where(eq(schema.cartItems.cartId, order.cartId));
        await tx
          .update(schema.carts)
          .set({ status: "converted", lastActivityAt: new Date(), ...(cart.status === "abandoned" ? { recoveredAt: new Date() } : {}) })
          .where(eq(schema.carts.id, order.cartId));
      }
    }
    await tx.insert(schema.orderEvents).values({
      tenantId,
      orderId: order.id,
      type: "payment.captured",
      message: `Payment received through ${label}`,
      actorType: "system",
      data: { provider, providerPaymentId: input.providerPaymentId, source: input.source },
    });
    return { result: "paid", orderId: order.id };
  });

  // Stock is committed after the order is saved as paid (same order as the existing webhook path).
  if (outcome.result === "paid" && outcome.orderId) {
    await commitReservation(db, tenantId, { orderId: outcome.orderId });
    await input.jobs?.send(QUEUE_NAMES.ORDER_CREATED, { orderId: outcome.orderId, tenantId });
  }
  return outcome.result;
}

/** Checks Razorpay's signature over `order_id|payment_id` with the store's key secret (constant-time compare). */
export function verifyRazorpaySignature(keySecret: string, providerOrderId: string, providerPaymentId: string, signature: string): boolean {
  const expected = createHmac("sha256", keySecret).update(`${providerOrderId}|${providerPaymentId}`).digest("hex");
  const a = Buffer.from(expected, "utf8");
  const b = Buffer.from(signature, "utf8");
  return a.length === b.length && timingSafeEqual(a, b);
}

export interface ConfirmRazorpayInput {
  orderToken: string;
  razorpayOrderId: string;
  razorpayPaymentId: string;
  razorpaySignature: string;
}

/** Called by the browser after the Razorpay modal succeeds; trusts only the signature made with the store's secret. */
export async function confirmRazorpayPayment(rt: Runtime, tenantId: string, input: ConfirmRazorpayInput): Promise<SettleResult> {
  const db = rt._db.db;
  const orderId = await orderIdForToken(db, tenantId, input.orderToken);
  if (!orderId) throw new Error("Not Found: order not found");
  const keys = await loadStoreKeys(db, tenantId);
  if (!keys) throw new Error("Bad Request: online payment is not set up for this store");

  // The Razorpay order must be this order's own, so a valid payment for another order cannot settle this one.
  const owned = await withTenant(db, tenantId, async (tx) => {
    const [intent] = await tx
      .select({ id: schema.paymentIntents.id })
      .from(schema.paymentIntents)
      .where(
        and(
          eq(schema.paymentIntents.tenantId, tenantId),
          eq(schema.paymentIntents.orderId, orderId),
          eq(schema.paymentIntents.providerOrderId, input.razorpayOrderId),
        ),
      );
    return Boolean(intent);
  });
  if (!owned) throw new Error("Bad Request: this payment does not belong to the order");
  if (!verifyRazorpaySignature(keys.keySecret, input.razorpayOrderId, input.razorpayPaymentId, input.razorpaySignature)) {
    throw new Error("Bad Request: the payment could not be verified");
  }
  return settleRazorpayPayment(db, tenantId, {
    providerOrderId: input.razorpayOrderId,
    providerPaymentId: input.razorpayPaymentId,
    source: "browser",
    jobs: rt._jobs,
  });
}
