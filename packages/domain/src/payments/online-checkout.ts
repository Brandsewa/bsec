import { and, desc, eq } from "drizzle-orm";
import { schema, withTenant, type Db } from "@bs/db";
import { PayPalProvider, StripeProvider } from "@bs/payments";
import type { Runtime } from "../runtime.ts";
import { readPlatformProviderState } from "../admin/payment-providers.ts";
import { getTenantPaymentSecrets } from "./credentials.ts";
import { orderTokenHash, settleProviderPayment, type SettleResult } from "./razorpay-checkout.ts";

/**
 * Stripe and PayPal at the storefront checkout (ADR-040 section 5, ADR-008).
 *
 * Both use the provider's hosted page (a redirect), so no card or wallet data touches our pages and no provider script is
 * added to the storefront. The provider order is created after the shop order has committed, with the store's own
 * credentials from tenant_secrets (never environment keys): money goes to the merchant's own account. The shopper's
 * return and the signed webhook both end in `settleProviderPayment`, which is idempotent and checks amount and currency.
 */
export type HostedProvider = "stripe" | "paypal";

async function methodState(db: Db, tenantId: string, provider: HostedProvider) {
  const [row] = await withTenant(db, tenantId, (tx) =>
    tx
      .select({ status: schema.paymentMethods.status, mode: schema.paymentMethods.mode })
      .from(schema.paymentMethods)
      .where(and(eq(schema.paymentMethods.tenantId, tenantId), eq(schema.paymentMethods.provider, provider)))
      .limit(1),
  );
  return row;
}

/** Whether the provider may be offered and used at this store right now (activated, platform-enabled, live allowed, keys saved). */
export async function isHostedProviderReady(db: Db, tenantId: string, provider: HostedProvider): Promise<boolean> {
  const method = await methodState(db, tenantId, provider);
  if (!method || method.status !== "active") return false;
  const platform = await readPlatformProviderState(db, provider);
  if (!platform.enabled) return false;
  if (method.mode === "live" && !platform.liveModeAllowed) return false;
  const creds = await getTenantPaymentSecrets(db, tenantId, provider);
  return provider === "paypal" ? Boolean(creds.keyId && creds.keySecret) : Boolean(creds.keySecret);
}

async function orderIdForToken(db: Db, tenantId: string, token: string): Promise<string | null> {
  return withTenant(db, tenantId, async (tx) => {
    const [row] = await tx
      .select({ targetId: schema.actionTokens.targetId })
      .from(schema.actionTokens)
      .where(and(eq(schema.actionTokens.tenantId, tenantId), eq(schema.actionTokens.purpose, "order_view"), eq(schema.actionTokens.tokenHash, orderTokenHash(token))));
    return row?.targetId ?? null;
  });
}

export interface HostedPaymentStart {
  checkoutUrl: string;
}

/** Creates (or re-creates, idempotently) the provider order for a placed, unpaid shop order and returns the hosted payment URL. */
export async function startHostedPayment(
  rt: Runtime,
  tenantId: string,
  orderId: string,
  provider: HostedProvider,
  opts: { baseUrl: string; orderToken: string; storeName?: string | undefined },
  deps: { fetchFn?: typeof fetch | undefined } = {},
): Promise<HostedPaymentStart> {
  const db = rt._db.db;
  if (!(await isHostedProviderReady(db, tenantId, provider))) {
    throw new Error("Bad Request: This payment method is not available for the store right now. Please choose another way to pay.");
  }
  const loaded = await withTenant(db, tenantId, async (tx) => {
    const [order] = await tx.select().from(schema.orders).where(and(eq(schema.orders.tenantId, tenantId), eq(schema.orders.id, orderId)));
    if (!order) return null;
    const [intent] = await tx
      .select()
      .from(schema.paymentIntents)
      .where(and(eq(schema.paymentIntents.tenantId, tenantId), eq(schema.paymentIntents.orderId, orderId), eq(schema.paymentIntents.provider, provider)))
      .orderBy(desc(schema.paymentIntents.createdAt))
      .limit(1);
    return { order, intent };
  });
  if (!loaded || !loaded.intent) throw new Error("Not Found: this order has no online payment to complete");
  const { order, intent } = loaded;
  if (order.status === "cancelled") throw new Error("Bad Request: this order was cancelled");
  if (order.paymentStatus === "paid" || intent.status === "captured") throw new Error("Bad Request: this order is already paid");

  const creds = await getTenantPaymentSecrets(db, tenantId, provider);
  const base = opts.baseUrl.replace(/\/+$/, "");
  const thankYou = `${base}/orders/${encodeURIComponent(opts.orderToken)}/thank-you`;
  const forPayment = { id: orderId, number: order.number, currency: intent.currency, grandTotal: intent.amount, email: order.email, phone: order.phone };

  let providerOrderId: string;
  let checkoutUrl: string | null;
  if (provider === "stripe") {
    const stripe = new StripeProvider({
      secretKey: creds.keySecret,
      successUrl: `${base}/api/storefront/checkout/return?provider=stripe&token=${encodeURIComponent(opts.orderToken)}`,
      cancelUrl: `${thankYou}?payment=cancelled`,
      fetchFn: deps.fetchFn,
    });
    const created = await stripe.createIntent({ tenantId }, forPayment);
    providerOrderId = created.providerOrderId;
    checkoutUrl = (created.meta?.checkoutUrl as string | null | undefined) ?? null;
  } else {
    const method = await methodState(db, tenantId, "paypal");
    const paypal = new PayPalProvider({
      clientId: creds.keyId,
      clientSecret: creds.keySecret,
      mode: method?.mode === "live" ? "live" : "sandbox",
      brandName: opts.storeName,
      fetchFn: deps.fetchFn,
      returnUrl: `${base}/api/storefront/checkout/return?provider=paypal&token=${encodeURIComponent(opts.orderToken)}`,
      cancelUrl: `${thankYou}?payment=cancelled`,
    });
    const created = await paypal.createIntent({ tenantId }, forPayment);
    providerOrderId = created.providerOrderId;
    checkoutUrl = (created.meta?.checkoutUrl as string | null | undefined) ?? null;
  }
  if (!checkoutUrl) throw new Error("Bad Request: The payment provider did not return a payment page. Please try again.");

  await withTenant(db, tenantId, (tx) =>
    tx
      .update(schema.paymentIntents)
      .set({ providerOrderId, status: "created", updatedAt: new Date() })
      .where(and(eq(schema.paymentIntents.tenantId, tenantId), eq(schema.paymentIntents.id, intent.id))),
  );
  return { checkoutUrl };
}

/**
 * The shopper came back from the provider's page. Settles from what the provider itself reports (a Stripe Checkout Session
 * read with the store's secret key, or a PayPal capture), never from anything in the return URL.
 */
export async function confirmHostedReturn(
  rt: Runtime,
  tenantId: string,
  provider: HostedProvider,
  input: { orderToken: string; paypalOrderId?: string | undefined },
  deps: { fetchFn?: typeof fetch | undefined } = {},
): Promise<SettleResult> {
  const db = rt._db.db;
  const orderId = await orderIdForToken(db, tenantId, input.orderToken);
  if (!orderId) throw new Error("Not Found: order not found");
  const intent = await withTenant(db, tenantId, async (tx) => {
    const [row] = await tx
      .select()
      .from(schema.paymentIntents)
      .where(and(eq(schema.paymentIntents.tenantId, tenantId), eq(schema.paymentIntents.orderId, orderId), eq(schema.paymentIntents.provider, provider)))
      .orderBy(desc(schema.paymentIntents.createdAt))
      .limit(1);
    return row ?? null;
  });
  if (!intent || !intent.providerOrderId) throw new Error("Not Found: this order has no online payment to confirm");
  const creds = await getTenantPaymentSecrets(db, tenantId, provider);

  if (provider === "stripe") {
    const session = await new StripeProvider({ secretKey: creds.keySecret, fetchFn: deps.fetchFn }).retrieveSession(intent.providerOrderId);
    if (session.orderId !== null && session.orderId !== orderId) throw new Error("Bad Request: this payment does not belong to the order");
    if (session.paymentStatus !== "paid") return "ignored";
    return settleProviderPayment(db, tenantId, {
      provider: "stripe",
      providerOrderId: intent.providerOrderId,
      providerPaymentId: session.paymentIntentId ?? intent.providerOrderId,
      ...(session.amountTotal !== null ? { amount: session.amountTotal } : {}),
      ...(session.currency ? { currency: session.currency } : {}),
      source: "return",
    });
  }

  // PayPal: the order id in the return URL must be this order's own, so a valid approval for another order cannot settle it.
  if (input.paypalOrderId && input.paypalOrderId !== intent.providerOrderId) throw new Error("Bad Request: this payment does not belong to the order");
  const method = await methodState(db, tenantId, "paypal");
  const paypal = new PayPalProvider({ clientId: creds.keyId, clientSecret: creds.keySecret, mode: method?.mode === "live" ? "live" : "sandbox", fetchFn: deps.fetchFn });
  const captured = await paypal.captureOrder(intent.providerOrderId);
  if (captured.status !== "captured" || !captured.captureId) return "ignored";
  return settleProviderPayment(db, tenantId, {
    provider: "paypal",
    providerOrderId: intent.providerOrderId,
    providerPaymentId: captured.captureId,
    ...(captured.amount !== undefined ? { amount: captured.amount } : {}),
    ...(captured.currency ? { currency: captured.currency } : {}),
    source: "return",
  });
}

/** The PayPal mode the store chose ("sandbox" until the platform allows live). Used to pick PayPal's API host. */
export async function storePayPalMode(db: Db, tenantId: string): Promise<"sandbox" | "live"> {
  const method = await methodState(db, tenantId, "paypal");
  return method?.mode === "live" ? "live" : "sandbox";
}
