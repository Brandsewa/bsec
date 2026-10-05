import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { schema, withTenant } from "@bs/db";
import { startTestDb, type TestDb } from "@bs/db/test-env";
import {
  createRuntime,
  getCustomerAccountSettings,
  updateCustomerAccountSettings,
  registerCustomer,
  loginCustomer,
  requestCustomerOtp,
  getOrderReturnsByToken,
  requestReturnByToken,
  cancelOrderByToken,
  createAdminDraftOrder,
  advanceAdminOrder,
  provisionTenant,
  type Runtime,
  type TenantContext,
} from "../src/index.ts";
import { enableTenantFlags } from "./helpers/feature-flags.ts";

let env: TestDb;
let rtPlatform: Runtime;
let rtWeb: Runtime;
let storeA: { tenantId: string; ownerId: string };
let storeB: { tenantId: string; ownerId: string };
let variantA: string;

const ctxFor = (s: { tenantId: string; ownerId: string }, permissions = ["settings.read", "checkout.manage", "orders.write"]): TenantContext => ({
  tenantId: s.tenantId,
  storeStatus: "live",
  actor: { type: "staff", userId: s.ownerId },
  roles: ["store_owner"],
  permissions,
  requestId: "req-cust-settings-test",
});

async function mkStore(prefix: string) {
  const uniqueSlug = `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  const r = await provisionTenant(rtPlatform, {
    storeName: uniqueSlug,
    slug: uniqueSlug,
    owner: { email: `owner@${uniqueSlug}.test`, name: "Owner" },
    planCode: "starter",
    source: "platform_admin",
  });
  return { tenantId: r.tenantId, ownerId: r.ownerId };
}

beforeAll(async () => {
  env = await startTestDb();
  rtPlatform = createRuntime({ service: "platform", databaseUrl: env.as("app_platform"), poolMax: 5 });
  rtWeb = createRuntime({ service: "web", databaseUrl: env.as("app_rw"), poolMax: 5 });
  storeA = await mkStore("acc-a");
  storeB = await mkStore("acc-b");
  await enableTenantFlags(rtPlatform._db.db, storeA.tenantId, ["settings.customer_accounts"]);

  // Create product and variant in Store A for order tests
  await withTenant(rtWeb._db.db, storeA.tenantId, async (tx) => {
    const [p] = await tx
      .insert(schema.products)
      .values({
        tenantId: storeA.tenantId,
        title: "Test Jeans",
        slug: "test-jeans",
        status: "active",
      })
      .returning();
    const [v] = await tx
      .insert(schema.variants)
      .values({
        tenantId: storeA.tenantId,
        productId: p!.id,
        title: "32/Blue",
        sku: "JEANS-1",
        price: 99900n,
      })
      .returning();
    variantA = v!.id;

    // Add inventory
    const locs = await tx.select().from(schema.locations).where(eq(schema.locations.tenantId, storeA.tenantId));
    for (const loc of locs) {
      await tx.insert(schema.inventoryLevels).values({
        tenantId: storeA.tenantId,
        variantId: variantA,
        locationId: loc.id,
        onHand: 50,
        reserved: 0,
      });
    }
  });
}, 180_000);

afterAll(async () => {
  await rtWeb?.close();
  await rtPlatform?.close();
  await env?.stop();
});

describe("Customer Account Settings: Defaults & Invariants", () => {
  it("returns defaults when no table row exists", async () => {
    const ctx = ctxFor(storeB);
    const settings = await getCustomerAccountSettings(rtWeb, ctx);
    expect(settings.showSignInLinks).toBe(true);
    expect(settings.emailPasswordEnabled).toBe(true);
    expect(settings.phoneOtpEnabled).toBe(true);
    expect(settings.allowSelfServeReturns).toBe(true);
    expect(settings.allowSelfServeCancellation).toBe(false);
    expect(settings.version).toBe(1);
  });

  it("rejects update if caller lacks checkout.manage", async () => {
    const ctxViewer: TenantContext = {
      ...ctxFor(storeA),
      permissions: ["analytics.read"],
    };
    await expect(updateCustomerAccountSettings(rtWeb, ctxViewer, { showSignInLinks: false })).rejects.toThrow(/Forbidden/);
  });

  it("rejects disabling both email password and phone otp login", async () => {
    const ctx = ctxFor(storeA);
    await expect(
      updateCustomerAccountSettings(rtWeb, ctx, {
        emailPasswordEnabled: false,
        phoneOtpEnabled: false,
      }),
    ).rejects.toThrow(/At least one customer sign-in method/);
  });

  it("updates settings and enforces optimistic concurrency", async () => {
    const ctx = ctxFor(storeA);
    const initial = await getCustomerAccountSettings(rtWeb, ctx);

    const updated = await updateCustomerAccountSettings(rtWeb, ctx, {
      allowSelfServeCancellation: true,
      expectedVersion: initial.version,
    });
    expect(updated.allowSelfServeCancellation).toBe(true);
    expect(updated.version).toBe(initial.version + 1);

    // Stale version rejected
    await expect(
      updateCustomerAccountSettings(rtWeb, ctx, {
        allowSelfServeCancellation: false,
        expectedVersion: initial.version,
      }),
    ).rejects.toThrow(/updated by someone else/);
  });
});

describe("Customer Sign-in Enforcement", () => {
  it("rejects password registration and login when emailPasswordEnabled is false", async () => {
    const ctx = ctxFor(storeA);
    await updateCustomerAccountSettings(rtWeb, ctx, {
      emailPasswordEnabled: false,
      phoneOtpEnabled: true,
    });

    await expect(
      registerCustomer(rtWeb._db.db, storeA.tenantId, {
        email: "testpwd@example.com",
        password: "securePassword123!",
        name: "Test Customer",
      }),
    ).rejects.toThrow(/Email and password registration is disabled/);

    await expect(
      loginCustomer(rtWeb._db.db, storeA.tenantId, {
        email: "testpwd@example.com",
        password: "securePassword123!",
      }),
    ).rejects.toThrow(/Email and password sign-in is disabled/);

    // Re-enable
    await updateCustomerAccountSettings(rtWeb, ctx, {
      emailPasswordEnabled: true,
    });
  });

  it("rejects phone OTP requests when phoneOtpEnabled is false", async () => {
    const ctx = ctxFor(storeA);
    await updateCustomerAccountSettings(rtWeb, ctx, {
      emailPasswordEnabled: true,
      phoneOtpEnabled: false,
    });

    await expect(
      requestCustomerOtp(rtWeb._db.db, storeA.tenantId, "+919876543210"),
    ).rejects.toThrow(/Phone OTP sign-in is disabled/);

    // Re-enable
    await updateCustomerAccountSettings(rtWeb, ctx, {
      phoneOtpEnabled: true,
    });
  });
});

describe("Self-Serve Returns Enforcement", () => {
  it("disables return requests when allowSelfServeReturns is false", async () => {
    const ctx = ctxFor(storeA);

    // Create a delivered order with token
    const draft = await createAdminDraftOrder(rtWeb, ctx, {
      email: "returns-test@example.com",
      shippingAddress: {
        line1: "123 Return St",
        city: "Bengaluru",
        stateCode: "KA",
        pincode: "560001",
      },
      items: [{ variantId: variantA, quantity: 1 }],
    });
    await advanceAdminOrder(rtWeb, ctx, { id: draft.orderId, to: "delivered" });

    // Generate an order_view token
    const token = "tok-returns-test-" + Date.now();
    const tokenHash = createHash("sha256").update(token).digest("hex");
    await withTenant(rtWeb._db.db, storeA.tenantId, async (tx) => {
      await tx.insert(schema.actionTokens).values({
        tenantId: storeA.tenantId,
        purpose: "order_view",
        tokenHash,
        targetId: draft.orderId,
        expiresAt: new Date(Date.now() + 86400000),
      });
    });

    // Check with returns enabled
    await updateCustomerAccountSettings(rtWeb, ctx, { allowSelfServeReturns: true });
    const viewEnabled = await getOrderReturnsByToken(rtWeb, storeA.tenantId, token);
    expect(viewEnabled).not.toBeNull();
    expect(viewEnabled!.canRequest).toBe(true);

    // Turn self-serve returns OFF
    await updateCustomerAccountSettings(rtWeb, ctx, { allowSelfServeReturns: false });
    const viewDisabled = await getOrderReturnsByToken(rtWeb, storeA.tenantId, token);
    expect(viewDisabled).not.toBeNull();
    expect(viewDisabled!.canRequest).toBe(false);

    // Submitting a return request must be refused server-side
    const [line] = viewDisabled!.items;
    await expect(
      requestReturnByToken(rtWeb, ctx, {
        token,
        reason: "Defective item",
        items: [{ orderItemId: line!.id, quantity: 1 }],
      }),
    ).rejects.toThrow(/Self-service returns are disabled/);
  });
});

describe("Self-Serve Order Cancellation (Slice 4E)", () => {
  it("cancels pending order, voids COD payment, releases stock, and audits action", async () => {
    const ctx = ctxFor(storeA);
    await updateCustomerAccountSettings(rtWeb, ctx, { allowSelfServeCancellation: true });

    // Create an unfulfilled COD draft order
    const draft = await createAdminDraftOrder(rtWeb, ctx, {
      email: "cancel-test@example.com",
      shippingAddress: {
        line1: "123 Cancel Rd",
        city: "Bengaluru",
        stateCode: "KA",
        pincode: "560001",
      },
      items: [{ variantId: variantA, quantity: 1 }],
    });

    // Generate an order_view token
    const token = "tok-cancel-test-" + Date.now();
    const tokenHash = createHash("sha256").update(token).digest("hex");
    await withTenant(rtWeb._db.db, storeA.tenantId, async (tx) => {
      await tx.insert(schema.actionTokens).values({
        tenantId: storeA.tenantId,
        purpose: "order_view",
        tokenHash,
        targetId: draft.orderId,
        expiresAt: new Date(Date.now() + 86400000),
      });
    });

    const res = await cancelOrderByToken(rtWeb, storeA.tenantId, token, { reason: "Changed mind" });
    expect(res.success).toBe(true);
    expect(res.status).toBe("cancelled");

    // Verify order in DB is cancelled
    const [order] = await withTenant(rtWeb._db.db, storeA.tenantId, (tx) =>
      tx.select().from(schema.orders).where(eq(schema.orders.id, draft.orderId)),
    );
    expect(order?.status).toBe("cancelled");
    expect(order?.cancelReason).toBe("Changed mind");

    // Verify audit log has customer action
    const auditRows = await withTenant(rtWeb._db.db, storeA.tenantId, (tx) =>
      tx.select().from(schema.auditLogs).where(and(eq(schema.auditLogs.tenantId, storeA.tenantId), eq(schema.auditLogs.action, "orders.cancel"))),
    );
    const lastAudit = auditRows.at(-1);
    expect(lastAudit).toBeDefined();
    expect(lastAudit?.actorType).toBe("customer");
  });

  it("refuses cancellation when allowSelfServeCancellation is false", async () => {
    const ctx = ctxFor(storeA);
    await updateCustomerAccountSettings(rtWeb, ctx, { allowSelfServeCancellation: false });

    const draft = await createAdminDraftOrder(rtWeb, ctx, {
      email: "cancel-refuse@example.com",
      shippingAddress: { line1: "123 Rd", city: "Delhi", stateCode: "DL", pincode: "110001" },
      items: [{ variantId: variantA, quantity: 1 }],
    });

    const token = "tok-cancel-refuse-" + Date.now();
    const tokenHash = createHash("sha256").update(token).digest("hex");
    await withTenant(rtWeb._db.db, storeA.tenantId, async (tx) => {
      await tx.insert(schema.actionTokens).values({
        tenantId: storeA.tenantId,
        purpose: "order_view",
        tokenHash,
        targetId: draft.orderId,
        expiresAt: new Date(Date.now() + 86400000),
      });
    });

    await expect(cancelOrderByToken(rtWeb, storeA.tenantId, token)).rejects.toThrow(/Self-service order cancellation is disabled/);
  });
});
