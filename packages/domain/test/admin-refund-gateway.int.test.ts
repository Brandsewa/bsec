import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { schema, withTenant } from "@bs/db";
import { startTestDb, type TestDb } from "@bs/db/test-env";
import { seedPlatformStaff } from "@bs/db/test-fixtures";
import { STORE_PERMISSIONS } from "@bs/auth";
import {
  createRuntime,
  provisionTenant,
  refundAdminOrder,
  saveRazorpayCredentials,
  saveStripeCredentials,
  updatePlatformPaymentProvider,
  type Runtime,
  type TenantContext,
} from "../src/index.ts";

// Admin refunds of online payments go back through the gateway with the store's own keys, or not at all.
let env: TestDb;
let rt: Runtime;
let ctx: TenantContext;

function ctxFor(t: { tenantId: string; ownerId: string }): TenantContext {
  return { tenantId: t.tenantId, storeStatus: "live", actor: { type: "staff", userId: t.ownerId }, roles: ["store_owner"], permissions: [...STORE_PERMISSIONS], requestId: "req-refund-gw" };
}

/** A paid order whose online payment was captured (the gateway payment id sits on the captured attempt). */
async function seedPaid(provider: "razorpay" | "stripe" | "manual", providerPaymentId: string | null, amount = 20000) {
  const orderId = crypto.randomUUID();
  await withTenant(rt._db.db, ctx.tenantId, async (tx) => {
    await tx.insert(schema.orders).values({
      id: orderId,
      tenantId: ctx.tenantId,
      number: `RF-${orderId.slice(0, 6)}`,
      email: "buyer@example.com",
      phone: "9876543210",
      status: "confirmed",
      paymentStatus: "paid",
      subtotal: amount,
      grandTotal: amount,
      shippingAddress: { name: "Buyer" },
    });
    const [intent] = await tx.insert(schema.paymentIntents).values({ tenantId: ctx.tenantId, orderId, provider, amount, currency: "INR", status: "captured" }).returning();
    if (providerPaymentId) {
      await tx.insert(schema.paymentAttempts).values({ tenantId: ctx.tenantId, intentId: intent!.id, providerPaymentId, method: provider, status: "captured", raw: {} });
    }
  });
  return orderId;
}

const refundsOf = (orderId: string) =>
  withTenant(rt._db.db, ctx.tenantId, (tx) => tx.select().from(schema.refunds).where(and(eq(schema.refunds.tenantId, ctx.tenantId), eq(schema.refunds.orderId, orderId))));
const orderOf = (orderId: string) =>
  withTenant(rt._db.db, ctx.tenantId, async (tx) => {
    const [o] = await tx.select().from(schema.orders).where(and(eq(schema.orders.tenantId, ctx.tenantId), eq(schema.orders.id, orderId)));
    return o;
  });

beforeAll(async () => {
  env = await startTestDb();
  const platform = createRuntime({ service: "platform", databaseUrl: env.as("app_platform"), poolMax: 5 });
  rt = createRuntime({ service: "web", databaseUrl: env.as("app_rw"), poolMax: 5 });
  const adminId = (await seedPlatformStaff(platform._db.db, { email: "refund-gw@platform.test", role: "platform_admin" })).userId;
  const t = await provisionTenant(platform, { storeName: "Refund GW", slug: "refund-gw", owner: { email: "o@refund-gw.test", name: "O" }, planCode: "starter", source: "platform_admin" });
  ctx = ctxFor(t);
  await updatePlatformPaymentProvider(platform, adminId, { provider: "razorpay", enabled: true, liveModeAllowed: true });
  await updatePlatformPaymentProvider(platform, adminId, { provider: "stripe", enabled: true });
  await saveRazorpayCredentials(rt, ctx, { keyId: "rzp_live_REFUND123456", keySecret: "refund-secret-value-1" });
  await saveStripeCredentials(rt, ctx, { secretKey: "sk_test_51RefundSecretKey1234567890", webhookSecret: "whsec_refundtestsecret1" });
  await platform.close();
}, 240_000);

afterAll(async () => {
  await rt?.close();
  await env?.stop();
});

describe("admin refund of an online payment (real DB, faked gateways)", () => {
  it("Razorpay: refunds the captured payment at Razorpay and records its refund id", async () => {
    const orderId = await seedPaid("razorpay", "pay_RF1");
    const seen: Array<{ id: string; body: Record<string, unknown> }> = [];
    const client = {
      payments: {
        refund: async (id: string, body: Record<string, unknown>) => {
          seen.push({ id, body });
          return { id: "rfnd_1", status: "processed", amount: 20000 };
        },
      },
    };
    await refundAdminOrder(rt, ctx, { id: orderId, amount: 20000, reason: "Customer asked" }, { razorpayClient: client });
    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({ id: "pay_RF1", body: { amount: 20000 } });
    const [r] = await refundsOf(orderId);
    expect(r).toMatchObject({ providerRefundId: "rfnd_1", method: "original_payment_method", status: "succeeded", amount: 20000 });
    expect((await orderOf(orderId))?.paymentStatus).toBe("refunded");
  });

  it("Razorpay refusing the refund leaves everything as it was", async () => {
    const orderId = await seedPaid("razorpay", "pay_RF2");
    const client = {
      payments: {
        refund: async () => {
          throw new Error("The payment has been fully refunded already");
        },
      },
    };
    await expect(refundAdminOrder(rt, ctx, { id: orderId, amount: 20000 }, { razorpayClient: client })).rejects.toThrow(/Razorpay could not refund/);
    expect(await refundsOf(orderId)).toHaveLength(0);
    expect((await orderOf(orderId))?.paymentStatus).toBe("paid");
  });

  it("Stripe: refunds the payment intent with the amount and a stable idempotency key", async () => {
    const orderId = await seedPaid("stripe", "pi_RF3");
    const calls: Array<{ url: string; body: URLSearchParams; key: string }> = [];
    const fetchFn = (async (url: string, init: RequestInit) => {
      calls.push({ url, body: new URLSearchParams(String(init.body)), key: (init.headers as Record<string, string>)["Idempotency-Key"] ?? "" });
      return new Response(JSON.stringify({ id: "re_1", status: "succeeded", amount: 20000 }), { status: 200, headers: { "Content-Type": "application/json" } });
    }) as unknown as typeof fetch;
    await refundAdminOrder(rt, ctx, { id: orderId, amount: 20000 }, { fetchFn });
    expect(calls[0]!.url).toBe("https://api.stripe.com/v1/refunds");
    expect(calls[0]!.body.get("payment_intent")).toBe("pi_RF3");
    expect(calls[0]!.body.get("amount")).toBe("20000");
    expect(calls[0]!.key).toContain("bsec-refund-");
    expect((await refundsOf(orderId))[0]).toMatchObject({ providerRefundId: "re_1" });
  });

  it("Stripe declining rolls the refund back", async () => {
    const orderId = await seedPaid("stripe", "pi_RF4");
    const fetchFn = (async () => new Response(JSON.stringify({ error: { message: "charge_already_refunded" } }), { status: 400, headers: { "Content-Type": "application/json" } })) as unknown as typeof fetch;
    await expect(refundAdminOrder(rt, ctx, { id: orderId, amount: 20000 }, { fetchFn })).rejects.toThrow(/Stripe could not refund/);
    expect(await refundsOf(orderId)).toHaveLength(0);
  });

  it("a manual payment, or one with no gateway payment id, is recorded without calling any gateway", async () => {
    const manual = await seedPaid("manual", null, 5000);
    const noPayment = await seedPaid("razorpay", null, 5000);
    const never = {
      payments: {
        refund: async () => {
          throw new Error("must not be called");
        },
      },
    };
    const fetchFn = (async () => {
      throw new Error("must not be called");
    }) as unknown as typeof fetch;
    await refundAdminOrder(rt, ctx, { id: manual, amount: 5000 }, { razorpayClient: never, fetchFn });
    await refundAdminOrder(rt, ctx, { id: noPayment, amount: 5000 }, { razorpayClient: never, fetchFn });
    expect((await refundsOf(manual))[0]?.providerRefundId).toBeNull();
    expect((await refundsOf(noPayment))[0]?.providerRefundId).toBeNull();
  });
});
