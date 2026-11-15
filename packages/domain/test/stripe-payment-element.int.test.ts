import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { schema, withTenant } from "@bs/db";
import { startTestDb, type TestDb } from "@bs/db/test-env";
import { seedPlatformStaff } from "@bs/db/test-fixtures";
import { STORE_PERMISSIONS } from "@bs/auth";
import {
  confirmHostedReturn,
  createRuntime,
  getStripeElementsConfig,
  orderTokenHash,
  provisionTenant,
  saveStripeCredentials,
  setPaymentProviderActive,
  startHostedPayment,
  testPaymentProviderConnection,
  updatePlatformPaymentProvider,
  type Runtime,
  type TenantContext,
} from "../src/index.ts";

// Stripe Payment Element at the store checkout (ADR-048): a saved publishable key opts the store in; a PaymentIntent is reused
// while it can still be paid, replaced when cancelled, and settled only from what Stripe itself reports for this order.
let env: TestDb;
let rtPlatform: Runtime;
let rtWeb: Runtime;
let withKey: TenantContext;
let withoutKey: TenantContext;

const SK = "sk_test_51EmbeddedSecretKey1234567890";
const PK = "pk_test_EmbeddedPublishable1234567890";
const WHSEC = "whsec_embeddedtestsecret1";
const opts = { baseUrl: "https://shop.example" };

function ctxFor(t: { tenantId: string; ownerId: string }): TenantContext {
  return {
    tenantId: t.tenantId,
    storeStatus: "live",
    actor: { type: "staff", userId: t.ownerId },
    roles: ["store_owner"],
    permissions: [...STORE_PERMISSIONS],
    requestId: "req-stripe-embedded",
  };
}

interface FakeIntent {
  status: string;
  client_secret: string;
  amount: number;
  amount_received: number;
  currency: string;
  metadata: Record<string, string>;
}
interface FakeSession {
  status: string;
  payment_status: string;
  amount_total: number;
  currency: string;
  client_reference_id: string;
  payment_intent?: string;
}
interface FakeState {
  intents: Record<string, FakeIntent>;
  sessions: Record<string, FakeSession>;
  creates: Array<{ path: string; form: URLSearchParams; idempotencyKey: string }>;
  next: number;
}
const freshState = (next: number): FakeState => ({ intents: {}, sessions: {}, creates: [], next });

/** A tiny Stripe: creates PaymentIntents and hosted sessions, reads them back, answers the connection test. */
function fakeStripe(state: FakeState, orderIdFor: () => string): typeof fetch {
  const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { "Content-Type": "application/json" } });
  return (async (url: string, init?: RequestInit) => {
    const u = new URL(url);
    if (u.pathname === "/v1/balance") return json({ livemode: false });
    if (init?.method === "POST" && (u.pathname === "/v1/payment_intents" || u.pathname === "/v1/checkout/sessions")) {
      const form = new URLSearchParams(String(init.body));
      const headers = init.headers as Record<string, string>;
      state.creates.push({ path: u.pathname, form, idempotencyKey: headers["Idempotency-Key"] ?? "" });
      if (u.pathname === "/v1/payment_intents") {
        const id = `pi_test_${++state.next}`;
        state.intents[id] = {
          status: "requires_payment_method",
          client_secret: `${id}_secret`,
          amount: Number(form.get("amount")),
          amount_received: 0,
          currency: form.get("currency") ?? "inr",
          metadata: { order_id: form.get("metadata[order_id]") ?? "" },
        };
        return json({ id, status: "requires_payment_method", client_secret: `${id}_secret` });
      }
      const id = `cs_test_${++state.next}`;
      state.sessions[id] = {
        status: "open",
        payment_status: "unpaid",
        amount_total: Number(form.get("line_items[0][price_data][unit_amount]")),
        currency: form.get("line_items[0][price_data][currency]") ?? "inr",
        client_reference_id: orderIdFor(),
      };
      return json({ id, status: "open", url: `https://checkout.stripe.com/c/pay/${id}` });
    }
    const pi = u.pathname.match(/^\/v1\/payment_intents\/([^/]+)$/);
    if (pi && state.intents[pi[1]!]) return json(state.intents[pi[1]!]);
    const m = u.pathname.match(/^\/v1\/checkout\/sessions\/([^/]+)$/);
    const found = m ? state.sessions[m[1]!] : undefined;
    if (found) return json(found);
    return json({ error: { message: "no route" } }, 404);
  }) as unknown as typeof fetch;
}

async function seedOrder(c: TenantContext, n: string, amount = 25000) {
  const orderId = crypto.randomUUID();
  const token = `ord_test_${n}_${crypto.randomUUID()}`;
  await withTenant(rtWeb._db.db, c.tenantId, async (tx) => {
    await tx.insert(schema.orders).values({
      id: orderId,
      tenantId: c.tenantId,
      number: `STR-${n}`,
      email: "buyer@example.com",
      phone: "9876543210",
      subtotal: amount,
      grandTotal: amount,
      shippingAddress: { name: "Buyer" },
    });
    await tx.insert(schema.paymentIntents).values({ tenantId: c.tenantId, orderId, provider: "stripe", amount, currency: "INR", status: "created" });
    await tx.insert(schema.actionTokens).values({
      tenantId: c.tenantId,
      purpose: "order_view",
      targetId: orderId,
      tokenHash: orderTokenHash(token),
      expiresAt: new Date(Date.now() + 3600_000),
    });
  });
  return { orderId, token };
}

async function readOrder(c: TenantContext, orderId: string) {
  return withTenant(rtWeb._db.db, c.tenantId, async (tx) => {
    const [o] = await tx.select().from(schema.orders).where(and(eq(schema.orders.tenantId, c.tenantId), eq(schema.orders.id, orderId)));
    return o;
  });
}
async function readIntent(c: TenantContext, orderId: string) {
  return withTenant(rtWeb._db.db, c.tenantId, async (tx) => {
    const [i] = await tx.select().from(schema.paymentIntents).where(and(eq(schema.paymentIntents.tenantId, c.tenantId), eq(schema.paymentIntents.orderId, orderId)));
    return i;
  });
}

async function activate(c: TenantContext, publishableKey: string | undefined) {
  await saveStripeCredentials(rtWeb, c, { secretKey: SK, webhookSecret: WHSEC, ...(publishableKey ? { publishableKey } : {}) });
  await testPaymentProviderConnection(rtWeb, c, "stripe", { fetchFn: fakeStripe(freshState(0), () => "") });
  await setPaymentProviderActive(rtWeb, c, "stripe", true);
}

beforeAll(async () => {
  env = await startTestDb();
  rtPlatform = createRuntime({ service: "platform", databaseUrl: env.as("app_platform"), poolMax: 5 });
  rtWeb = createRuntime({ service: "web", databaseUrl: env.as("app_rw"), poolMax: 5 });
  const adminId = (await seedPlatformStaff(rtPlatform._db.db, { email: "stripe-emb-admin@platform.test", role: "platform_admin" })).userId;
  const a = await provisionTenant(rtPlatform, { storeName: "Stripe Embedded A", slug: "stripe-emb-a", owner: { email: "a@stripe-emb.test", name: "A" }, planCode: "starter", source: "platform_admin" });
  const b = await provisionTenant(rtPlatform, { storeName: "Stripe Embedded B", slug: "stripe-emb-b", owner: { email: "b@stripe-emb.test", name: "B" }, planCode: "starter", source: "platform_admin" });
  withKey = ctxFor(a);
  withoutKey = ctxFor(b);
  await updatePlatformPaymentProvider(rtPlatform, adminId, { provider: "stripe", enabled: true });
  await activate(withKey, PK);
  await activate(withoutKey, undefined);
}, 240_000);

afterAll(async () => {
  await rtPlatform?.close();
  await rtWeb?.close();
  await env?.stop();
});

describe("Stripe Payment Element (real DB, faked Stripe)", () => {
  it("a store with a publishable key gets a PaymentIntent to confirm in the page, and its id is saved", async () => {
    const { orderId, token } = await seedOrder(withKey, "1");
    const state = freshState(0);
    const started = await startHostedPayment(rtWeb, withKey.tenantId, orderId, "stripe", { ...opts, orderToken: token }, { fetchFn: fakeStripe(state, () => orderId) });
    expect(started.checkoutUrl).toBeUndefined();
    expect(started.stripeElements).toMatchObject({ clientSecret: "pi_test_1_secret", publishableKey: PK });
    expect(started.stripeElements?.jsUrl).toMatch(/^https:\/\/js\.stripe\.com\//);
    expect(state.creates[0]!.path).toBe("/v1/payment_intents");
    const form = state.creates[0]!.form;
    expect(form.get("amount")).toBe("25000");
    expect(form.get("metadata[order_id]")).toBe(orderId);
    expect(form.has("success_url")).toBe(false);
    expect((await readIntent(withKey, orderId))?.providerOrderId).toBe("pi_test_1");
    expect(JSON.stringify(started)).not.toContain(SK);
  });

  it("the checkout page learns the public key and script only for a store that saved one", async () => {
    expect(await getStripeElementsConfig(rtWeb._db.db, withKey.tenantId)).toMatchObject({ publishableKey: PK });
    expect(await getStripeElementsConfig(rtWeb._db.db, withoutKey.tenantId)).toBeNull();
  });

  it("opening it again while it can still be paid shows the same payment instead of creating a second one", async () => {
    const { orderId, token } = await seedOrder(withKey, "2");
    const state = freshState(10);
    const fetchFn = fakeStripe(state, () => orderId);
    const first = await startHostedPayment(rtWeb, withKey.tenantId, orderId, "stripe", { ...opts, orderToken: token }, { fetchFn });
    const second = await startHostedPayment(rtWeb, withKey.tenantId, orderId, "stripe", { ...opts, orderToken: token }, { fetchFn });
    expect(second.stripeElements?.clientSecret).toBe(first.stripeElements?.clientSecret);
    expect(state.creates.length).toBe(1);
  });

  it("a cancelled PaymentIntent is replaced by a new one under a different idempotency key", async () => {
    const { orderId, token } = await seedOrder(withKey, "3");
    const state = freshState(20);
    const fetchFn = fakeStripe(state, () => orderId);
    const first = await startHostedPayment(rtWeb, withKey.tenantId, orderId, "stripe", { ...opts, orderToken: token }, { fetchFn });
    state.intents["pi_test_21"]!.status = "canceled";
    const second = await startHostedPayment(rtWeb, withKey.tenantId, orderId, "stripe", { ...opts, orderToken: token }, { fetchFn });
    expect(second.stripeElements?.clientSecret).not.toBe(first.stripeElements?.clientSecret);
    expect(state.creates.length).toBe(2);
    expect(state.creates[1]!.idempotencyKey).not.toBe(state.creates[0]!.idempotencyKey);
    expect((await readIntent(withKey, orderId))?.providerOrderId).toBe("pi_test_22");
  });

  it("refuses to open a payment for an order Stripe already shows as paid", async () => {
    const { orderId, token } = await seedOrder(withKey, "4");
    const state = freshState(30);
    const fetchFn = fakeStripe(state, () => orderId);
    await startHostedPayment(rtWeb, withKey.tenantId, orderId, "stripe", { ...opts, orderToken: token }, { fetchFn });
    Object.assign(state.intents["pi_test_31"]!, { status: "succeeded", amount_received: 25000 });
    await expect(startHostedPayment(rtWeb, withKey.tenantId, orderId, "stripe", { ...opts, orderToken: token }, { fetchFn })).rejects.toThrow(/already paid/i);
  });

  it("a store without a publishable key keeps the hosted redirect", async () => {
    const { orderId, token } = await seedOrder(withoutKey, "5");
    const state = freshState(40);
    const started = await startHostedPayment(rtWeb, withoutKey.tenantId, orderId, "stripe", { ...opts, orderToken: token }, { fetchFn: fakeStripe(state, () => orderId) });
    expect(started.stripeElements).toBeUndefined();
    expect(started.checkoutUrl).toBe("https://checkout.stripe.com/c/pay/cs_test_41");
    expect(state.creates[0]!.path).toBe("/v1/checkout/sessions");
    expect(state.creates[0]!.form.get("cancel_url")).toContain("/api/storefront/checkout/abandon");
  });

  it("the shopper's return settles the order only from Stripe's record of this order, with the right amount", async () => {
    const mine = await seedOrder(withKey, "6");
    const other = await seedOrder(withKey, "7");
    const state = freshState(50);
    const fetchFn = fakeStripe(state, () => "");
    await startHostedPayment(rtWeb, withKey.tenantId, mine.orderId, "stripe", { ...opts, orderToken: mine.token }, { fetchFn });
    await startHostedPayment(rtWeb, withKey.tenantId, other.orderId, "stripe", { ...opts, orderToken: other.token }, { fetchFn });

    // Unpaid return: ignored, the order stays unpaid.
    expect(await confirmHostedReturn(rtWeb, withKey.tenantId, "stripe", { orderToken: mine.token }, { fetchFn })).toBe("ignored");
    expect((await readOrder(withKey, mine.orderId))?.paymentStatus).not.toBe("paid");

    // Paid for a different amount: not settled.
    Object.assign(state.intents["pi_test_51"]!, { status: "succeeded", amount_received: 100 });
    await confirmHostedReturn(rtWeb, withKey.tenantId, "stripe", { orderToken: mine.token }, { fetchFn }).catch(() => undefined);
    expect((await readOrder(withKey, mine.orderId))?.paymentStatus).not.toBe("paid");

    // Paid in full: settled; a second return changes nothing.
    Object.assign(state.intents["pi_test_51"]!, { amount_received: 25000 });
    await confirmHostedReturn(rtWeb, withKey.tenantId, "stripe", { orderToken: mine.token }, { fetchFn });
    expect((await readOrder(withKey, mine.orderId))?.paymentStatus).toBe("paid");
    await confirmHostedReturn(rtWeb, withKey.tenantId, "stripe", { orderToken: mine.token }, { fetchFn });
    expect((await readOrder(withKey, mine.orderId))?.paymentStatus).toBe("paid");
    // The other order, with its own unpaid PaymentIntent, is untouched.
    expect((await readOrder(withKey, other.orderId))?.paymentStatus).not.toBe("paid");
  });

  it("a PaymentIntent that belongs to another order cannot settle this one", async () => {
    const mine = await seedOrder(withKey, "8");
    const state = freshState(60);
    const fetchFn = fakeStripe(state, () => "");
    await startHostedPayment(rtWeb, withKey.tenantId, mine.orderId, "stripe", { ...opts, orderToken: mine.token }, { fetchFn });
    Object.assign(state.intents["pi_test_61"]!, { status: "succeeded", amount_received: 25000, metadata: { order_id: crypto.randomUUID() } });
    await expect(confirmHostedReturn(rtWeb, withKey.tenantId, "stripe", { orderToken: mine.token }, { fetchFn })).rejects.toThrow(/does not belong/i);
    expect((await readOrder(withKey, mine.orderId))?.paymentStatus).not.toBe("paid");
  });
});
