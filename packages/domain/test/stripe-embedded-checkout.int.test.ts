import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { schema, withTenant } from "@bs/db";
import { startTestDb, type TestDb } from "@bs/db/test-env";
import { seedPlatformStaff } from "@bs/db/test-fixtures";
import { STORE_PERMISSIONS } from "@bs/auth";
import {
  confirmHostedReturn,
  createRuntime,
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

// Stripe Embedded Checkout at the store checkout: a saved publishable key opts the store in; sessions are reused while open,
// replaced when expired, and settled only from what Stripe itself reports for this order.
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

interface FakeSession {
  status: string;
  payment_status: string;
  client_secret: string;
  amount_total: number;
  currency: string;
  client_reference_id: string;
  payment_intent?: string;
}
interface FakeState {
  sessions: Record<string, FakeSession>;
  creates: Array<{ form: URLSearchParams; idempotencyKey: string }>;
  next: number;
}
const freshState = (next: number): FakeState => ({ sessions: {}, creates: [], next });

/** A tiny Stripe: creates sessions, reads them back, answers the connection test. */
function fakeStripe(state: FakeState, orderIdFor: () => string): typeof fetch {
  const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { "Content-Type": "application/json" } });
  return (async (url: string, init?: RequestInit) => {
    const u = new URL(url);
    if (u.pathname === "/v1/balance") return json({ livemode: false });
    if (u.pathname === "/v1/checkout/sessions" && init?.method === "POST") {
      const form = new URLSearchParams(String(init.body));
      const headers = init.headers as Record<string, string>;
      state.creates.push({ form, idempotencyKey: headers["Idempotency-Key"] ?? "" });
      const id = `cs_test_${++state.next}`;
      const embedded = form.get("ui_mode") === "embedded";
      state.sessions[id] = {
        status: "open",
        payment_status: "unpaid",
        client_secret: `${id}_secret`,
        amount_total: Number(form.get("line_items[0][price_data][unit_amount]")),
        currency: form.get("line_items[0][price_data][currency]") ?? "inr",
        client_reference_id: orderIdFor(),
      };
      return json(embedded ? { id, status: "open", client_secret: `${id}_secret` } : { id, status: "open", url: `https://checkout.stripe.com/c/pay/${id}` });
    }
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

describe("Stripe Embedded Checkout (real DB, faked Stripe)", () => {
  it("a store with a publishable key gets an embedded form with a return URL and no cancel URL, and the session id is saved", async () => {
    const { orderId, token } = await seedOrder(withKey, "1");
    const state = freshState(0);
    const started = await startHostedPayment(rtWeb, withKey.tenantId, orderId, "stripe", { ...opts, orderToken: token }, { fetchFn: fakeStripe(state, () => orderId) });
    expect(started.checkoutUrl).toBeUndefined();
    expect(started.stripeEmbedded).toMatchObject({ clientSecret: "cs_test_1_secret", publishableKey: PK });
    expect(started.stripeEmbedded?.jsUrl).toMatch(/^https:\/\/js\.stripe\.com\//);
    const form = state.creates[0]!.form;
    expect(form.get("ui_mode")).toBe("embedded");
    expect(form.get("cancel_url")).toBeNull();
    expect(form.get("return_url")).toContain(`/api/storefront/checkout/return?provider=stripe&ot=${encodeURIComponent(token)}`);
    expect(form.get("return_url")).toContain("{CHECKOUT_SESSION_ID}");
    expect(form.get("line_items[0][price_data][unit_amount]")).toBe("25000");
    expect((await readIntent(withKey, orderId))?.providerOrderId).toBe("cs_test_1");
    expect(JSON.stringify(started)).not.toContain(SK);
  });

  it("opening it again while the session is still open shows the same form instead of creating a second session", async () => {
    const { orderId, token } = await seedOrder(withKey, "2");
    const state = freshState(10);
    const fetchFn = fakeStripe(state, () => orderId);
    const first = await startHostedPayment(rtWeb, withKey.tenantId, orderId, "stripe", { ...opts, orderToken: token }, { fetchFn });
    const second = await startHostedPayment(rtWeb, withKey.tenantId, orderId, "stripe", { ...opts, orderToken: token }, { fetchFn });
    expect(second.stripeEmbedded?.clientSecret).toBe(first.stripeEmbedded?.clientSecret);
    expect(state.creates.length).toBe(1);
  });

  it("an expired session is replaced by a new one under a different idempotency key", async () => {
    const { orderId, token } = await seedOrder(withKey, "3");
    const state = freshState(20);
    const fetchFn = fakeStripe(state, () => orderId);
    const first = await startHostedPayment(rtWeb, withKey.tenantId, orderId, "stripe", { ...opts, orderToken: token }, { fetchFn });
    state.sessions["cs_test_21"]!.status = "expired";
    const second = await startHostedPayment(rtWeb, withKey.tenantId, orderId, "stripe", { ...opts, orderToken: token }, { fetchFn });
    expect(second.stripeEmbedded?.clientSecret).not.toBe(first.stripeEmbedded?.clientSecret);
    expect(state.creates.length).toBe(2);
    expect(state.creates[1]!.idempotencyKey).not.toBe(state.creates[0]!.idempotencyKey);
    expect((await readIntent(withKey, orderId))?.providerOrderId).toBe("cs_test_22");
  });

  it("refuses to open a form for an order Stripe already shows as paid", async () => {
    const { orderId, token } = await seedOrder(withKey, "4");
    const state = freshState(30);
    const fetchFn = fakeStripe(state, () => orderId);
    await startHostedPayment(rtWeb, withKey.tenantId, orderId, "stripe", { ...opts, orderToken: token }, { fetchFn });
    Object.assign(state.sessions["cs_test_31"]!, { status: "complete", payment_status: "paid" });
    await expect(startHostedPayment(rtWeb, withKey.tenantId, orderId, "stripe", { ...opts, orderToken: token }, { fetchFn })).rejects.toThrow(/already paid/i);
  });

  it("a store without a publishable key keeps the hosted redirect", async () => {
    const { orderId, token } = await seedOrder(withoutKey, "5");
    const state = freshState(40);
    const started = await startHostedPayment(rtWeb, withoutKey.tenantId, orderId, "stripe", { ...opts, orderToken: token }, { fetchFn: fakeStripe(state, () => orderId) });
    expect(started.stripeEmbedded).toBeUndefined();
    expect(started.checkoutUrl).toBe("https://checkout.stripe.com/c/pay/cs_test_41");
    expect(state.creates[0]!.form.get("ui_mode")).toBeNull();
    expect(state.creates[0]!.form.get("cancel_url")).toContain("/api/storefront/checkout/abandon");
  });

  it("the shopper's return settles the order only from Stripe's record of this order, with the right amount", async () => {
    const mine = await seedOrder(withKey, "6");
    const other = await seedOrder(withKey, "7");
    const state = freshState(50);
    let current = mine.orderId;
    const fetchFn = fakeStripe(state, () => current);
    await startHostedPayment(rtWeb, withKey.tenantId, mine.orderId, "stripe", { ...opts, orderToken: mine.token }, { fetchFn });
    current = other.orderId;
    await startHostedPayment(rtWeb, withKey.tenantId, other.orderId, "stripe", { ...opts, orderToken: other.token }, { fetchFn });

    // Unpaid return: ignored, the order stays unpaid.
    expect(await confirmHostedReturn(rtWeb, withKey.tenantId, "stripe", { orderToken: mine.token }, { fetchFn })).toBe("ignored");
    expect((await readOrder(withKey, mine.orderId))?.paymentStatus).not.toBe("paid");

    // Paid for a different amount: not settled.
    Object.assign(state.sessions["cs_test_51"]!, { status: "complete", payment_status: "paid", amount_total: 100, payment_intent: "pi_x" });
    await confirmHostedReturn(rtWeb, withKey.tenantId, "stripe", { orderToken: mine.token }, { fetchFn }).catch(() => undefined);
    expect((await readOrder(withKey, mine.orderId))?.paymentStatus).not.toBe("paid");

    // Paid in full: settled; a second return changes nothing.
    Object.assign(state.sessions["cs_test_51"]!, { amount_total: 25000 });
    await confirmHostedReturn(rtWeb, withKey.tenantId, "stripe", { orderToken: mine.token }, { fetchFn });
    expect((await readOrder(withKey, mine.orderId))?.paymentStatus).toBe("paid");
    await confirmHostedReturn(rtWeb, withKey.tenantId, "stripe", { orderToken: mine.token }, { fetchFn });
    expect((await readOrder(withKey, mine.orderId))?.paymentStatus).toBe("paid");
    // The other order, with its own unpaid session, is untouched.
    expect((await readOrder(withKey, other.orderId))?.paymentStatus).not.toBe("paid");
  });
});
