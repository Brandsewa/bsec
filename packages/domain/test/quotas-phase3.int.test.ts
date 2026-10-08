import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import { schema } from "@bs/db";
import { startTestDb, type TestDb } from "@bs/db/test-env";
import { seedPlatformStaff } from "@bs/db/test-fixtures";
import {
  createRuntime,
  provisionTenant,
  resolveEffectiveQuota,
  getPlatformQuotaMatrix,
  createPlatformQuotaTier,
  updatePlatformQuotaTier,
  deactivatePlatformQuotaTier,
  updatePlatformQuotaLimits,
  updatePlatformQuotaDefinition,
  bulkChangePlatformTenantTier,
  type Runtime,
  type TenantContext,
  getOrCreateCart,
  addToCart,
  placeOrder,
} from "../src/index.ts";
import { createActiveProduct } from "./helpers/factories.ts";

let env: TestDb;
let rt: Runtime;
let rtPlatform: Runtime;
let tenantId: string;
let ownerId: string;
let variantId: string;
let _locationId: string;
let staffUserId: string;

beforeAll(async () => {
  env = await startTestDb();
  rt = createRuntime({ service: "web", databaseUrl: env.as("app_rw"), poolMax: 10 });
  rtPlatform = createRuntime({ service: "platform", databaseUrl: env.as("app_platform"), poolMax: 10 });

  const staff = await seedPlatformStaff(rtPlatform._db.db, {
    email: "admin-phase3@platform.test",
    role: "platform_admin",
  });
  staffUserId = staff.userId;

  const tenant = await provisionTenant(rtPlatform, {
    storeName: "Quota Tiers Test Store",
    slug: "quota-tiers-test-store",
    owner: { email: "owner@quota-tiers.test", name: "Quota Owner" },
    planCode: "starter",
    source: "platform_admin",
  });
  tenantId = tenant.tenantId;
  ownerId = tenant.ownerId;

  // Create a product for checkout test
  const ctx: TenantContext = {
    tenantId,
    storeStatus: "live",
    actor: { type: "staff", userId: ownerId },
    roles: ["store_owner"],
    permissions: ["products.write", "products.read", "orders.read", "orders.write"],
    requestId: "req-quota-setup",
  };

  const prod = await createActiveProduct(rt, ctx, {
    title: "Immunity Test Product",
    price: 150000,
    stock: 50,
  });
  variantId = prod.variantId;
  _locationId = prod.locationId;
}, 180_000);

afterAll(async () => {
  await rt?.close();
  await rtPlatform?.close();
  await env?.stop();
});

describe("Phase 3: Quota Tiers & Pricing Normalisation (SA-2 / ADR-025)", () => {
  it("backfill snapshot test: every quota definition limit matches quota_tier_limits before and after", async () => {
    const matrix = await getPlatformQuotaMatrix(rtPlatform);
    expect(matrix.tiers.length).toBeGreaterThanOrEqual(4);
    expect(matrix.definitions.length).toBeGreaterThanOrEqual(10);

    for (const def of matrix.definitions) {
      const xsLimit = matrix.limits.find((l) => l.tierCode === "XS" && l.quotaKey === def.key);
      const sLimit = matrix.limits.find((l) => l.tierCode === "S" && l.quotaKey === def.key);
      const mLimit = matrix.limits.find((l) => l.tierCode === "M" && l.quotaKey === def.key);
      const lLimit = matrix.limits.find((l) => l.tierCode === "L" && l.quotaKey === def.key);

      expect(xsLimit, `XS limit for ${def.key}`).toBeDefined();
      expect(xsLimit!.value).toBe(def.tierXs);

      expect(sLimit, `S limit for ${def.key}`).toBeDefined();
      expect(sLimit!.value).toBe(def.tierS);

      expect(mLimit, `M limit for ${def.key}`).toBeDefined();
      expect(mLimit!.value).toBe(def.tierM);

      expect(lLimit, `L limit for ${def.key}`).toBeDefined();
      expect(lLimit!.value).toBe(def.tierL);
    }
  });

  it("editing a limit changes resolveEffectiveQuota immediately", async () => {
    // Assign tenant to tier S
    await rtPlatform._db.db
      .update(schema.tenantSizeTiers)
      .set({ tier: "S", updatedAt: new Date() })
      .where(eq(schema.tenantSizeTiers.tenantId, tenantId));

    const before = await resolveEffectiveQuota(rt._db.db, tenantId, "products");
    expect(before.limit).toBe(500);

    // Update S tier limit to 750
    await updatePlatformQuotaLimits(rtPlatform, null, {
      updates: [{ tierCode: "S", quotaKey: "products", value: 750 }],
    });

    const after = await resolveEffectiveQuota(rt._db.db, tenantId, "products");
    expect(after.limit).toBe(750);
    expect(after.source).toBe("tier");
    expect(after.tier).toBe("S");

    // Reset back to 500
    await updatePlatformQuotaLimits(rtPlatform, null, {
      updates: [{ tierCode: "S", quotaKey: "products", value: 500 }],
    });
  });

  it("write-through invariant: updating XS/S/M/L limits keeps legacy quota_definitions columns populated", async () => {
    // Update M tier variants to 22000
    await updatePlatformQuotaLimits(rtPlatform, null, {
      updates: [{ tierCode: "M", quotaKey: "variants", value: 22000 }],
    });

    const [defRow] = await rtPlatform._db.db
      .select()
      .from(schema.quotaDefinitions)
      .where(eq(schema.quotaDefinitions.key, "variants"))
      .limit(1);

    expect(defRow?.tierM).toBe(22000);

    // Reset back to 20000
    await updatePlatformQuotaLimits(rtPlatform, null, {
      updates: [{ tierCode: "M", quotaKey: "variants", value: 20000 }],
    });
    const [defReset] = await rtPlatform._db.db
      .select()
      .from(schema.quotaDefinitions)
      .where(eq(schema.quotaDefinitions.key, "variants"))
      .limit(1);
    expect(defReset?.tierM).toBe(20000);
  });

  it("adding tier XL with pricing and assigning a tenant works end-to-end via real bulkChangePlatformTenantTier", async () => {
    const createRes = await createPlatformQuotaTier(rtPlatform, staffUserId, {
      code: "XL",
      name: "Extra Large (Hyper-growth)",
      description: "Dedicated resources for top merchants",
      sort: 5,
      priceMonthlyPaise: 99900, // ₹999 / mo
      priceYearlyPaise: 999000, // ₹9,990 / yr
      currency: "INR",
      isPublic: true,
    });
    expect(createRes.ok).toBe(true);
    expect(createRes.code).toBe("XL");

    // Update custom limits for XL
    await updatePlatformQuotaLimits(rtPlatform, staffUserId, {
      updates: [{ tierCode: "XL", quotaKey: "products", value: 50000 }],
    });

    // Assign tenant to XL via real domain service function
    const assignRes = await bulkChangePlatformTenantTier(
      rtPlatform,
      staffUserId,
      [tenantId],
      "XL",
      "TIER XL 1",
    );
    expect(assignRes.ok).toBe(true);
    expect(assignRes.updatedCount).toBe(1);
    expect(assignRes.tier).toBe("XL");

    const res = await resolveEffectiveQuota(rt._db.db, tenantId, "products");
    expect(res.limit).toBe(50000);
    expect(res.tier).toBe("XL");
    expect(res.source).toBe("tier");
  });

  it("bulkChangePlatformTenantTier refuses unknown and inactive tiers", async () => {
    // 1. Unknown tier code refusal
    await expect(
      bulkChangePlatformTenantTier(rtPlatform, staffUserId, [tenantId], "NONEXISTENT", "TIER NONEXISTENT 1"),
    ).rejects.toThrow(/Quota tier "NONEXISTENT" does not exist/);

    // 2. Inactive tier code refusal: create an inactive tier first
    await createPlatformQuotaTier(rtPlatform, staffUserId, {
      code: "INACTIVE_TEST",
      name: "Inactive Test Tier",
      sort: 99,
      priceMonthlyPaise: 0,
      priceYearlyPaise: 0,
      isPublic: false,
    });
    await deactivatePlatformQuotaTier(rtPlatform, staffUserId, "INACTIVE_TEST");

    await expect(
      bulkChangePlatformTenantTier(rtPlatform, staffUserId, [tenantId], "INACTIVE_TEST", "TIER INACTIVE_TEST 1"),
    ).rejects.toThrow(/Quota tier "INACTIVE_TEST" is inactive and cannot be assigned to stores/);
  });

  it("refuses to deactivate a tier that tenants are currently assigned to", async () => {
    // Tenant is currently on XL
    await expect(
      deactivatePlatformQuotaTier(rtPlatform, staffUserId, "XL"),
    ).rejects.toThrow(/Cannot deactivate tier "XL": 1 store\(s\) are currently on this tier/);

    // Reassign tenant back to XS via real domain service function
    const reassignRes = await bulkChangePlatformTenantTier(
      rtPlatform,
      staffUserId,
      [tenantId],
      "XS",
      "TIER XS 1",
    );
    expect(reassignRes.ok).toBe(true);

    // Now deactivation succeeds!
    const deactRes = await deactivatePlatformQuotaTier(rtPlatform, staffUserId, "XL");
    expect(deactRes.ok).toBe(true);

    const [xlRow] = await rtPlatform._db.db
      .select()
      .from(schema.quotaTiers)
      .where(eq(schema.quotaTiers.code, "XL"))
      .limit(1);
    expect(xlRow?.isActive).toBe(false);
  });

  it("unknown tier code falls back safely to XS tier threshold", async () => {
    // Assign tenant to non-existent tier
    await rtPlatform._db.db
      .update(schema.tenantSizeTiers)
      .set({ tier: "UNKNOWN_CUSTOM_TIER", updatedAt: new Date() })
      .where(eq(schema.tenantSizeTiers.tenantId, tenantId));

    const res = await resolveEffectiveQuota(rt._db.db, tenantId, "products");
    expect(res.limit).toBe(50); // XS default limit
    expect(res.tier).toBe("XS");
    expect(res.source).toBe("tier");
  });

  it("prices stored as integer paise, formatted as INR with round-trip precision", async () => {
    await updatePlatformQuotaTier(rtPlatform, null, {
      code: "S",
      priceMonthlyPaise: 49900,
      priceYearlyPaise: 499000,
    });

    const [sTier] = await rtPlatform._db.db
      .select()
      .from(schema.quotaTiers)
      .where(eq(schema.quotaTiers.code, "S"))
      .limit(1);

    expect(sTier?.priceMonthlyPaise).toBe(49900);
    expect(sTier?.priceYearlyPaise).toBe(499000);

    // Formatting check
    const formatInr = (paise: number) =>
      new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR" }).format(paise / 100);

    expect(formatInr(Number(sTier!.priceMonthlyPaise))).toContain("499");
    expect(formatInr(Number(sTier!.priceYearlyPaise))).toContain("4,990");
  });

  it("ADR-015 INVARIANT: quotas never block checkout or storefront even with hard quotas at 0", async () => {
    // Set ALL hard quotas to 0 via overrides
    const hardKeys = ["products", "variants", "orders_month", "storage_mb", "media_file_mb", "staff_seats", "custom_domains"];
    for (const k of hardKeys) {
      await rtPlatform._db.db.execute(sql`
        INSERT INTO tenant_quota_overrides (tenant_id, quota_key, value)
        VALUES (${tenantId}, ${k}, 0)
        ON CONFLICT (tenant_id, quota_key) DO UPDATE SET value = 0;
      `);
    }

    try {
      const storefrontCtx: TenantContext = {
        tenantId,
        storeStatus: "live",
        actor: { type: "anonymous" },
        roles: [],
        permissions: [],
        requestId: "req-zero-quota-chk",
      };

      // 1. Create cart
      const cart = await getOrCreateCart(rt, storefrontCtx);
      expect(cart.token).toBeDefined();

      // 2. Add item to cart
      const updatedCart = await addToCart(rt, storefrontCtx, {
        token: cart.token,
        variantId,
        quantity: 1,
      });
      expect(updatedCart.itemCount).toBe(1);

      // 3. Place order (Checkout)
      const order = await placeOrder(rt, storefrontCtx, {
        cartToken: cart.token,
        email: "zeroquota@customer.test",
        phone: "+919876543210",
        fullName: "Rahul Varma",
        addressLine1: "100 MG Road",
        city: "Bengaluru",
        state: "Karnataka",
        pincode: "560001",
        paymentMethod: "cod",
      });

      expect(order.success).toBe(true);
      expect(order.orderId).toBeDefined();
      expect(order.orderNumber).toBeDefined();
    } finally {
      // Clean up overrides
      await rtPlatform._db.db.execute(sql`
        DELETE FROM tenant_quota_overrides WHERE tenant_id = ${tenantId};
      `);
    }
  });

  it("updates quota definition metadata without altering code-defined keys", async () => {
    await updatePlatformQuotaDefinition(rtPlatform, null, {
      key: "products",
      description: "Total live active products in catalog",
      unit: "items",
      enforcement: "hard",
    });

    const [updated] = await rtPlatform._db.db
      .select()
      .from(schema.quotaDefinitions)
      .where(eq(schema.quotaDefinitions.key, "products"))
      .limit(1);

    expect(updated?.description).toBe("Total live active products in catalog");
    expect(updated?.unit).toBe("items");
    expect(updated?.enforcement).toBe("hard");

    // Reset back
    await updatePlatformQuotaDefinition(rtPlatform, null, {
      key: "products",
      description: "Catalog products",
      unit: "count",
      enforcement: "hard",
    });
  });
});
