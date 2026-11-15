import { and, desc, eq } from "drizzle-orm";
import { schema, withTenant, type Db } from "@bs/db";
import { PayPalProvider, STRIPE_JS_URL, StripeProvider } from "@bs/payments";
import type { Runtime } from "../runtime.ts";
import { readPlatformProviderState } from "../admin/payment-providers.ts";
import { getTenantPaymentSecrets } from "./credentials.ts";
import { orderTokenHash, settleProviderPayment, startRazorpayPaymentByToken, type SettleResult } from "./razorpay-checkout.ts";

/**
 * Stripe and PayPal at the storefront checkout (ADR-040 section 5, ADR-008).
 *
 * PayPal, and Stripe without a publishable key, use the provider's hosted page (a redirect), so no card or wallet data touches
 * our pages and no provider script is added to the storefront. Stripe with a publishable key saved uses the Payment Element
 * (ADR-047): Stripe's own iframe fields sit in our checkout page (card data still never touches our code), Stripe.js is loaded
 * only at checkout, and the payment is a PaymentIntent. The provider order is created after the shop order has committed, with
 * the store's own credentials from tenant_secrets (never environment keys): money goes to the merchant's own account. The
 * shopper's return and the signed webhook both end in `settleProviderPayment`, which is idempotent and checks amount and currency.
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

export interface StripeElementsStart {
  /** The PaymentIntent's client secret, which the checkout page confirms with the Payment Element. */
  clientSecret: string;
  /** Public by design; the checkout page needs it to start Stripe.js. */
  publishableKey: string;
  /** The Stripe.js release that matches the pinned API version (see STRIPE_JS_TRAIN). */
  jsUrl: string;
}

/**
 * What the checkout page needs to show the Payment Element before the order exists, or null when the store has no publishable
 * key (then Stripe uses the hosted page). Only public values leave the server.
 */
export async function getStripeElementsConfig(db: Db, tenantId: string): Promise<{ publishableKey: string; jsUrl: string } | null> {
  if (!(await isHostedProviderReady(db, tenantId, "stripe"))) return null;
  const creds = await getTenantPaymentSecrets(db, tenantId, "stripe");
  return creds.keyId ? { publishableKey: creds.keyId, jsUrl: STRIPE_JS_URL } : null;
}

/** Either a page to redirect to, or (Stripe with a publishable key) a payment to confirm in the checkout page. */
export interface HostedPaymentStart {
  checkoutUrl?: string;
  stripeElements?: StripeElementsStart;
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
  // Cancelling on the provider's page sends the shopper back to checkout, not to an order (the held order is cancelled).
  const cancelled = `${base}/api/storefront/checkout/abandon?ot=${encodeURIComponent(opts.orderToken)}`;
  const forPayment = { id: orderId, number: order.number, currency: intent.currency, grandTotal: intent.amount, email: order.email, phone: order.phone };

  let providerOrderId: string;
  let checkoutUrl: string | null;
  if (provider === "stripe") {
    const returnUrl = `${base}/api/storefront/checkout/return?provider=stripe&ot=${encodeURIComponent(opts.orderToken)}`;
    // A saved publishable key means the merchant opted in to the Payment Element.
    if (creds.keyId && creds.keySecret) {
      const reader = new StripeProvider({ secretKey: creds.keySecret, fetchFn: deps.fetchFn });
      let replacedPi = false;
      // Reload or "Pay now" while an earlier payment is still open: show the same one, so the shopper cannot end up with two.
      if (intent.providerOrderId?.startsWith("pi_")) {
        const existing = await reader.retrievePaymentIntent(intent.providerOrderId).catch(() => null);
        if (existing && existing.clientSecret) {
          return { stripeElements: { clientSecret: existing.clientSecret, publishableKey: creds.keyId, jsUrl: STRIPE_JS_URL } };
        }
        if (existing && (existing.status === "succeeded" || existing.status === "processing")) throw new Error("Bad Request: this order is already paid");
        replacedPi = true;
      }
      // A cancelled PaymentIntent cannot be paid: its replacement needs its own idempotency key, or Stripe would hand back the old one.
      const stripe = new StripeProvider({
        secretKey: creds.keySecret,
        uiMode: "elements",
        idempotencySalt: replacedPi ? Date.now().toString(36) : undefined,
        fetchFn: deps.fetchFn,
      });
      const created = await stripe.createIntent({ tenantId }, forPayment);
      if (!created.clientSecret) throw new Error("Bad Request: The payment provider did not return a payment form. Please try again.");
      await withTenant(db, tenantId, (tx) =>
        tx
          .update(schema.paymentIntents)
          .set({ providerOrderId: created.providerOrderId, status: "created", updatedAt: new Date() })
          .where(and(eq(schema.paymentIntents.tenantId, tenantId), eq(schema.paymentIntents.id, intent.id))),
      );
      return { stripeElements: { clientSecret: created.clientSecret, publishableKey: creds.keyId, jsUrl: STRIPE_JS_URL } };
    }
    const stripe = new StripeProvider({
      secretKey: creds.keySecret,
      successUrl: returnUrl,
      cancelUrl: cancelled,
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
      returnUrl: `${base}/api/storefront/checkout/return?provider=paypal&ot=${encodeURIComponent(opts.orderToken)}`,
      cancelUrl: cancelled,
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

  if (provider === "stripe" && intent.providerOrderId.startsWith("pi_")) {
    // Payment Element: read the PaymentIntent the shopper just confirmed, with the store's key.
    const pi = await new StripeProvider({ secretKey: creds.keySecret, fetchFn: deps.fetchFn }).retrievePaymentIntent(intent.providerOrderId);
    if (pi.orderId !== null && pi.orderId !== orderId) throw new Error("Bad Request: this payment does not belong to the order");
    if (pi.status !== "succeeded") return "ignored";
    return settleProviderPayment(db, tenantId, {
      provider: "stripe",
      providerOrderId: intent.providerOrderId,
      providerPaymentId: intent.providerOrderId,
      amount: pi.amountReceived,
      currency: pi.currency,
      source: "return",
      jobs: rt._jobs,
    });
  }
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
      jobs: rt._jobs,
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
    jobs: rt._jobs,
  });
}

/** The PayPal mode the store chose ("sandbox" until the platform allows live). Used to pick PayPal's API host. */
export async function storePayPalMode(db: Db, tenantId: string): Promise<"sandbox" | "live"> {
  const method = await methodState(db, tenantId, "paypal");
  return method?.mode === "live" ? "live" : "sandbox";
}

export type StartedPayment =
  | { kind: "razorpay"; razorpay: Awaited<ReturnType<typeof startRazorpayPaymentByToken>> }
  | { kind: "hosted"; checkoutUrl: string }
  | { kind: "stripe_elements"; stripe: StripeElementsStart };

/**
 * "Pay now" for an unpaid online order, whichever provider the order was placed with. The provider comes from the order's own
 * payment intent, never from the request, so a shopper cannot move an order to another gateway.
 */
export async function startPaymentByToken(
  rt: Runtime,
  tenantId: string,
  orderToken: string,
  opts: { baseUrl: string; storeName?: string | undefined },
): Promise<StartedPayment> {
  const db = rt._db.db;
  const orderId = await orderIdForToken(db, tenantId, orderToken);
  if (!orderId) throw new Error("Not Found: order not found");
  const [intent] = await withTenant(db, tenantId, (tx) =>
    tx
      .select({ provider: schema.paymentIntents.provider })
      .from(schema.paymentIntents)
      .where(and(eq(schema.paymentIntents.tenantId, tenantId), eq(schema.paymentIntents.orderId, orderId)))
      .orderBy(desc(schema.paymentIntents.createdAt))
      .limit(1),
  );
  if (!intent) throw new Error("Not Found: this order has no online payment to complete");
  if (intent.provider === "stripe" || intent.provider === "paypal") {
    const started = await startHostedPayment(rt, tenantId, orderId, intent.provider, { baseUrl: opts.baseUrl, orderToken, storeName: opts.storeName });
    if (started.stripeElements) return { kind: "stripe_elements", stripe: started.stripeElements };
    if (!started.checkoutUrl) throw new Error("Bad Request: The payment provider did not return a payment page. Please try again.");
    return { kind: "hosted", checkoutUrl: started.checkoutUrl };
  }
  if (intent.provider === "razorpay") return { kind: "razorpay", razorpay: await startRazorpayPaymentByToken(rt, tenantId, orderToken) };
  throw new Error("Bad Request: this order does not need an online payment");
}
