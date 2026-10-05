import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { schema, withTenant } from "@bs/db";
import { startTestDb, type TestDb } from "@bs/db/test-env";
import {
  createRuntime,
  getCheckoutSettings,
  updateCheckoutSettings,
  getOrderSettings,
  updateOrderSettings,
  placeOrder,
  createAdminDraftOrder,
  provisionTenant,
  type Runtime,
  type TenantContext,
} from "../src/index.ts";
import { addToCart, getOrCreateCart } from "../src/storefront/cart.ts";

let env: TestDb;
let rtPlatform: Runtime;
let rtWeb: Runtime;
let storeA: { tenantId: string; ownerId: string };
let storeB: { tenantId: string; ownerId: string };
let variantA: string;

const ctxFor = (s: { tenantId: string; ownerId: string }, permissions = ["settings.read", "checkout.manage", "orders.settings.manage", "orders.write"]): TenantContext => ({
  tenantId: s.tenantId,
  storeStatus: "live",
  actor: { type: "staff", userId: s.ownerId },
  roles: ["store_owner"],
  permissions,
  requestId: "req-checkout-settings-test",
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
  storeA = await mkStore("chk-a");
  storeB = await mkStore("chk-b");

  // Create product, variant, and add inventory to store locations for checkout tests
  await withTenant(rtWeb._db.db, storeA.tenantId, async (tx) => {
    const [p] = await tx
      .insert(schema.products)
      .values({
        tenantId: storeA.tenantId,
        title: "Test Shirt",
        slug: "test-shirt",
        status: "active",
      })
      .returning();
    const [v] = await tx
      .insert(schema.variants)
      .values({
        tenantId: storeA.tenantId,
        productId: p!.id,
        title: "Default",
        sku: "TSHIRT-1",
        price: 50000n, // ₹500
      })
      .returning();
    variantA = v!.id;

    const locs = await tx.select().from(schema.locations).where(eq(schema.locations.tenantId, storeA.tenantId));
    for (const loc of locs) {
      await tx.insert(schema.inventoryLevels).values({
        tenantId: storeA.tenantId,
        variantId: variantA,
        locationId: loc.id,
        onHand: 100,
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

describe("Checkout & Order Settings: Parity & Defaults", () => {
  it("returns default checkout settings when none saved in DB", async () => {
    const ctx = ctxFor(storeB);
    const settings = await getCheckoutSettings(rtWeb, ctx);
    expect(settings.v).toBe(1);
    expect(settings.guestCheckout).toBe(true);
    expect(settings.accountCreation).toBe("after_completed_order");
    expect(settings.phoneRequired).toBe(true);
    expect(settings.addressLine2).toBe("optional");
    expect(settings.companyName).toBe("hidden");
    expect(settings.marketingEmail.enabled).toBe(false);
    expect(settings.abandoned.recoveryEnabled).toBe(false);
    expect(settings.abandoned.detectAfterMinutes).toBe(60);
  });

  it("returns default order processing settings when order_settings is null", async () => {
    const ctx = ctxFor(storeB);
    const orders = await getOrderSettings(rtWeb, ctx);
    expect(orders.stockHoldMinutes).toBe(30);
    expect(orders.minimumOrderPaise).toBe(0);
  });
});

describe("Checkout Settings: Permissions & Invariants", () => {
  it("rejects updates from staff lacking checkout.manage", async () => {
    const ctxViewer: TenantContext = {
      ...ctxFor(storeA),
      permissions: ["analytics.read"],
    };
    await expect(updateCheckoutSettings(rtWeb, ctxViewer, { guestCheckout: false })).rejects.toThrow(/Forbidden/);
  });

  it("updates checkout settings and records an audit log row with diff", async () => {
    const ctx = ctxFor(storeA);
    const updated = await updateCheckoutSettings(rtWeb, ctx, {
      addressLine2: "hidden",
      marketingEmail: {
        enabled: true,
        label: "Get exclusive updates",
      },
    });

    expect(updated.addressLine2).toBe("hidden");
    expect(updated.marketingEmail.enabled).toBe(true);
    expect(updated.marketingEmail.label).toBe("Get exclusive updates");

    const auditRows = await withTenant(rtWeb._db.db, storeA.tenantId, (tx) =>
      tx.select().from(schema.auditLogs).where(and(eq(schema.auditLogs.tenantId, storeA.tenantId), eq(schema.auditLogs.action, "checkout_settings.update"))),
    );
    expect(auditRows.length).toBeGreaterThanOrEqual(1);
    const last = auditRows.at(-1)!;
    expect(last.diff).toBeDefined();
    expect(JSON.stringify(last.diff)).not.toMatch(/secret|password/i);
  });

  it("enforces optimistic concurrency (stale update rejected)", async () => {
    const ctx = ctxFor(storeA);
    const initial = await getCheckoutSettings(rtWeb, ctx);

    // Concurrent update advances the timestamp
    await updateCheckoutSettings(rtWeb, ctx, { addressLine2: "optional" });

    // Stale update with old timestamp must fail
    await expect(
      updateCheckoutSettings(rtWeb, ctx, {
        addressLine2: "hidden",
        expectedUpdatedAt: initial.updatedAt,
      }),
    ).rejects.toThrow(/updated by someone else/);
  });
});

describe("Order Settings: Minimum Order & Stock Hold Enforcement", () => {
  it("updates stockHoldMinutes and minimumOrderPaise", async () => {
    const ctx = ctxFor(storeA);
    const updated = await updateOrderSettings(rtWeb, ctx, {
      stockHoldMinutes: 45,
      minimumOrderPaise: 100000, // ₹1,000 minimum
    });

    expect(updated.stockHoldMinutes).toBe(45);
    expect(updated.minimumOrderPaise).toBe(100000);
  });

  it("enforces minimum order value in checkout placeOrder", async () => {
    const shopperCtx: TenantContext = {
      tenantId: storeA.tenantId,
      storeStatus: "live",
      actor: { type: "anonymous" },
      roles: [],
      permissions: [],
      requestId: "req-shopper-min",
    };
    const cart = await getOrCreateCart(rtWeb, shopperCtx, "cart_min_order_tok");
    // Add 1 item of ₹500 (below ₹1,000 minimum)
    await addToCart(rtWeb, shopperCtx, { token: cart.token, variantId: variantA, quantity: 1 });

    await expect(
      placeOrder(rtWeb, shopperCtx, {
        cartToken: cart.token,
        idempotencyKey: `idem-min-fail-${Date.now()}`,
        email: "customer@example.com",
        phone: "9876543210",
        paymentMethod: "cod",
        fullName: "Test Customer",
        addressLine1: "123 Street",
        city: "Bengaluru",
        state: "Karnataka",
        pincode: "560001",
      }),
    ).rejects.toThrow(/below the minimum required order amount/);
  });

  it("exempts admin draft orders from minimum order value", async () => {
    const ctx = ctxFor(storeA);
    // 1 item of ₹500 should succeed for admin draft order
    const draft = await createAdminDraftOrder(rtWeb, ctx, {
      email: "exempt@example.com",
      shippingAddress: {
        line1: "123 Admin Way",
        city: "Delhi",
        stateCode: "DL",
        pincode: "110001",
      },
      items: [{ variantId: variantA, quantity: 1 }],
    });

    expect(draft.orderId).toBeDefined();
  });
});
