import { createHmac } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { schema, withTenant } from "@bs/db";
import { startTestDb, type TestDb } from "@bs/db/test-env";
import { seedPlatformStaff } from "@bs/db/test-fixtures";
import { STORE_PERMISSIONS } from "@bs/auth";
import {
  createRuntime,
  provisionTenant,
  updatePlatformPaymentProvider,
  saveRazorpayCredentials,
  testPaymentProviderConnection,
  setPaymentProviderActive,
  getStorefrontPaymentOptions,
  confirmRazorpayPayment,
  settleRazorpayPayment,
  orderTokenHash,
  type Runtime,
  type TenantContext,
} from "../src/index.ts";

// Razorpay at checkout: availability rules, signed browser confirmation, idempotent and amount-checked settling.
let env: TestDb;
let rtPlatform: Runtime;
let rtWeb: Runtime;
let adminId: string;
let ctx: TenantContext;
let other: TenantContext;

const KEY_ID = "rzp_live_ABCDEF123456";
const KEY_SECRET = "live-secret-value-123";
const okFetch = (async () => new Response("{}", { status: 200 })) as unknown as typeof fetch;

function ctxFor(t: { tenantId: string; ownerId: string }): TenantContext {
  return {
    tenantId: t.tenantId,
    storeStatus: "live",
    actor: { type: "staff", userId: t.ownerId },
    roles: ["store_owner"],
    permissions: [...STORE_PERMISSIONS],
    requestId: "req-rzp-checkout",
  };
}

const sign = (secret: string, orderId: string, paymentId: string) =>
  createHmac("sha256", secret).update(`${orderId}|${paymentId}`).digest("hex");

/** An unpaid online order with a Razorpay order id already attached (so no network call is needed). */
async function seedOnlineOrder(c: TenantContext, n: string, rzpOrderId: string, amount = 25000) {
  const orderId = crypto.randomUUID();
  const token = `ord_test_${n}_${crypto.randomUUID()}`;
  await withTenant(rtWeb._db.db, c.tenantId, async (tx) => {
    await tx.insert(schema.orders).values({
      id: orderId,
      tenantId: c.tenantId,
      number: `RZP-${n}`,
      email: "buyer@example.com",
      phone: "9876543210",
      subtotal: amount,
      grandTotal: amount,
      shippingAddress: { name: "Buyer" },
    });
    await tx.insert(schema.paymentIntents).values({
      tenantId: c.tenantId,
      orderId,
      provider: "razorpay",
      amount,
      currency: "INR",
      status: "created",
      providerOrderId: rzpOrderId,
    });
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
    const [o] = await tx
      .select()
      .from(schema.orders)
      .where(and(eq(schema.orders.tenantId, c.tenantId), eq(schema.orders.id, orderId)));
    return o;
  });
}

beforeAll(async () => {
  env = await startTestDb();
  rtPlatform = createRuntime({ service: "platform", databaseUrl: env.as("app_platform"), poolMax: 5 });
  rtWeb = createRuntime({ service: "web", databaseUrl: env.as("app_rw"), poolMax: 5 });
  adminId = (await seedPlatformStaff(rtPlatform._db.db, { email: "rzp-admin@platform.test", role: "platform_admin" })).userId;
  const a = await provisionTenant(rtPlatform, {
    storeName: "Rzp Store A",
    slug: "rzp-store-a",
    owner: { email: "owner-a@rzp.test", name: "A" },
    planCode: "starter",
    source: "platform_admin",
  });
  const b = await provisionTenant(rtPlatform, {
    storeName: "Rzp Store B",
    slug: "rzp-store-b",
    owner: { email: "owner-b@rzp.test", name: "B" },
    planCode: "starter",
    source: "platform_admin",
  });
  ctx = ctxFor(a);
  other = ctxFor(b);
  await updatePlatformPaymentProvider(rtPlatform, adminId, { provider: "razorpay", enabled: true, liveModeAllowed: true });
  await saveRazorpayCredentials(rtWeb, ctx, { keyId: KEY_ID, keySecret: KEY_SECRET });
  await testPaymentProviderConnection(rtWeb, ctx, "razorpay", { fetchFn: okFetch });
  await setPaymentProviderActive(rtWeb, ctx, "razorpay", true);
}, 180_000);

afterAll(async () => {
  await rtPlatform?.close();
  await rtWeb?.close();
  await env?.stop();
});

describe("Razorpay checkout availability (real DB)", () => {
  it("is offered when the store activated it with live keys and the platform allows live mode", async () => {
    expect((await getStorefrontPaymentOptions(rtWeb, ctx.tenantId)).online.available).toBe(true);
  });

  it("is hidden when live mode is closed or the provider is off, and never offered to a store without keys", async () => {
    await updatePlatformPaymentProvider(rtPlatform, adminId, { provider: "razorpay", enabled: true, liveModeAllowed: false });
    expect((await getStorefrontPaymentOptions(rtWeb, ctx.tenantId)).online.available).toBe(false);
    await updatePlatformPaymentProvider(rtPlatform, adminId, { provider: "razorpay", enabled: false });
    expect((await getStorefrontPaymentOptions(rtWeb, ctx.tenantId)).online.available).toBe(false);
    await updatePlatformPaymentProvider(rtPlatform, adminId, { provider: "razorpay", enabled: true, liveModeAllowed: true });
    expect((await getStorefrontPaymentOptions(rtWeb, ctx.tenantId)).online.available).toBe(true);
    expect((await getStorefrontPaymentOptions(rtWeb, other.tenantId)).online.available).toBe(false);
  });
});

describe("Razorpay payment confirmation (real DB)", () => {
  it("confirms a correctly signed payment once, marks the order paid, and is a no-op the second time", async () => {
    const { orderId, token } = await seedOnlineOrder(ctx, "1", "order_AAA111");
    const input = {
      orderToken: token,
      razorpayOrderId: "order_AAA111",
      razorpayPaymentId: "pay_AAA111",
      razorpaySignature: sign(KEY_SECRET, "order_AAA111", "pay_AAA111"),
    };
    expect(await confirmRazorpayPayment(rtWeb, ctx.tenantId, input)).toBe("paid");
    expect(await readOrder(ctx, orderId)).toMatchObject({ status: "confirmed", paymentStatus: "paid" });
    expect(await confirmRazorpayPayment(rtWeb, ctx.tenantId, input)).toBe("already_paid");
  });

  it("rejects a bad signature, a signature from another secret, and a payment for a different order", async () => {
    const a = await seedOnlineOrder(ctx, "2", "order_BBB222");
    const b = await seedOnlineOrder(ctx, "3", "order_CCC333");
    const base = { orderToken: a.token, razorpayOrderId: "order_BBB222", razorpayPaymentId: "pay_BBB222" };
    await expect(confirmRazorpayPayment(rtWeb, ctx.tenantId, { ...base, razorpaySignature: "f".repeat(64) })).rejects.toThrow(/could not be verified/i);
    await expect(
      confirmRazorpayPayment(rtWeb, ctx.tenantId, { ...base, razorpaySignature: sign("wrong", "order_BBB222", "pay_BBB222") }),
    ).rejects.toThrow(/could not be verified/i);
    // A genuinely signed payment for order B cannot settle order A.
    await expect(
      confirmRazorpayPayment(rtWeb, ctx.tenantId, {
        orderToken: a.token,
        razorpayOrderId: "order_CCC333",
        razorpayPaymentId: "pay_CCC333",
        razorpaySignature: sign(KEY_SECRET, "order_CCC333", "pay_CCC333"),
      }),
    ).rejects.toThrow(/does not belong/i);
    expect((await readOrder(ctx, a.orderId))?.paymentStatus).toBe("pending");
    expect((await readOrder(ctx, b.orderId))?.paymentStatus).toBe("pending");
  });

  it("another store cannot settle this store's order", async () => {
    const a = await seedOnlineOrder(ctx, "4", "order_DDD444");
    await expect(
      confirmRazorpayPayment(rtWeb, other.tenantId, {
        orderToken: a.token,
        razorpayOrderId: "order_DDD444",
        razorpayPaymentId: "pay_DDD444",
        razorpaySignature: sign(KEY_SECRET, "order_DDD444", "pay_DDD444"),
      }),
    ).rejects.toThrow();
    expect((await readOrder(ctx, a.orderId))?.paymentStatus).toBe("pending");
  });

  it("the webhook path settles the same way, refuses a mismatched amount, and is idempotent", async () => {
    const a = await seedOnlineOrder(ctx, "5", "order_EEE555", 25000);
    const db = rtWeb._db.db;
    expect(await settleRazorpayPayment(db, ctx.tenantId, { providerOrderId: "order_EEE555", providerPaymentId: "pay_E1", amount: 100, source: "webhook" })).toBe("ignored");
    expect((await readOrder(ctx, a.orderId))?.paymentStatus).toBe("pending");
    expect(await settleRazorpayPayment(db, ctx.tenantId, { providerOrderId: "order_EEE555", providerPaymentId: "pay_E2", amount: 25000, source: "webhook" })).toBe("paid");
    expect(await settleRazorpayPayment(db, ctx.tenantId, { providerOrderId: "order_EEE555", providerPaymentId: "pay_E2", amount: 25000, source: "webhook" })).toBe("already_paid");
    expect(await settleRazorpayPayment(db, ctx.tenantId, { providerOrderId: "order_UNKNOWN", providerPaymentId: "pay_X", source: "webhook" })).toBe("ignored");
  });
});
