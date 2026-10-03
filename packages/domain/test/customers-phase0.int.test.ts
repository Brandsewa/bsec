import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { and, eq, sql } from "drizzle-orm";
import { schema, withTenant } from "@bs/db";
import { startTestDb, type TestDb } from "@bs/db/test-env";
import {
  createRuntime,
  provisionTenant,
  placeOrder,
  transitionOrder,
  getAdminCustomerDetail,
  setMarketingConsent,
  refreshCustomerMetrics,
  runCustomerMetricsSweep,
  verifyCustomerEmail,
  mintUnsubscribeToken,
  getUnsubscribeView,
  unsubscribeByToken,
  updateCustomerProfile,
  registerCustomer,
  subscribeNewsletter,
  createProduct,
  adjustInventory,
  listInventoryLevels,
  type Runtime,
  type TenantContext,
} from "../src/index.ts";
import { addToCart, getOrCreateCart } from "../src/storefront/cart.ts";
import { primaryCategory } from "./helpers/primary-category.ts";
import { STORE_PERMISSIONS } from "@bs/auth";

let env: TestDb;
let rtPlatform: Runtime;
let rtWeb: Runtime;
let ctxA: TenantContext;
let ctxB: TenantContext;
let variantAId: string;
let variantBId: string;

beforeAll(async () => {
  env = await startTestDb();
  rtPlatform = createRuntime({ service: "platform", databaseUrl: env.as("app_platform"), poolMax: 10 });
  rtWeb = createRuntime({ service: "web", databaseUrl: env.as("app_rw"), poolMax: 10 });

  // Provision Store A
  const tA = await provisionTenant(rtPlatform, {
    storeName: "Customers Phase 0 Store A",
    slug: "cust-store-a",
    owner: { email: "owner-a@cust.test", name: "Owner A" },
    planCode: "starter",
    source: "platform_admin",
  });
  ctxA = {
    tenantId: tA.tenantId,
    storeStatus: "live",
    actor: { type: "staff", userId: tA.ownerId },
    roles: ["store_owner"],
    permissions: [...STORE_PERMISSIONS],
    requestId: "req-cust-a",
  };

  // Provision Store B
  const tB = await provisionTenant(rtPlatform, {
    storeName: "Customers Phase 0 Store B",
    slug: "cust-store-b",
    owner: { email: "owner-b@cust.test", name: "Owner B" },
    planCode: "starter",
    source: "platform_admin",
  });
  ctxB = {
    tenantId: tB.tenantId,
    storeStatus: "live",
    actor: { type: "staff", userId: tB.ownerId },
    roles: ["store_owner"],
    permissions: [...STORE_PERMISSIONS],
    requestId: "req-cust-b",
  };

  // Setup sample products in Store A and Store B
  const catA = await primaryCategory(rtWeb, ctxA);
  const pA = await createProduct(rtWeb, ctxA, {
    title: "Product A",
    slug: "product-a",
    status: "active",
    primaryCategoryId: catA,
    variants: [{ title: "Default", sku: "SKU-A", price: 100000, trackInventory: true }],
  });
  variantAId = pA.variants[0]!.id;
  const locA = (await listInventoryLevels(rtWeb, ctxA, {})).items[0]!;
  await adjustInventory(rtWeb, ctxA, {
    variantId: variantAId,
    locationId: locA.locationId,
    quantityDelta: 100,
    reason: "received",
  });

  const catB = await primaryCategory(rtWeb, ctxB);
  const pB = await createProduct(rtWeb, ctxB, {
    title: "Product B",
    slug: "product-b",
    status: "active",
    primaryCategoryId: catB,
    variants: [{ title: "Default", sku: "SKU-B", price: 200000, trackInventory: true }],
  });
  variantBId = pB.variants[0]!.id;
  const locB = (await listInventoryLevels(rtWeb, ctxB, {})).items[0]!;
  await adjustInventory(rtWeb, ctxB, {
    variantId: variantBId,
    locationId: locB.locationId,
    quantityDelta: 100,
    reason: "received",
  });
});

afterAll(async () => {
  await rtPlatform?.close();
  await rtWeb?.close();
  await env?.stop();
});

describe("Phase 0a: Truthful customer metrics & sorting cache", () => {
  it("computes truthful metrics in real-time and updates cached columns via sweep / refresh", async () => {
    // 1. Create a customer in Store A
    const custEmail = "metrics-test@example.com";
    const [c] = await withTenant(rtWeb._db.db, ctxA.tenantId, async (tx) => {
      return await tx
        .insert(schema.customers)
        .values({
          tenantId: ctxA.tenantId,
          email: custEmail,
          name: "Metrics Shopper",
          isGuest: false,
          marketingState: "not_subscribed",
        })
        .returning();
    });
    expect(c).toBeDefined();
    const customerId = c!.id;

    // Initially metrics are 0
    let detail = await getAdminCustomerDetail(rtWeb, ctxA, { id: customerId });
    expect(detail.customer.ordersCount).toBe(0);
    expect(detail.customer.totalSpent).toBe(0);

    // 2. Place a COD order (placed -> payment_status: 'pending')
    const cart = await getOrCreateCart(rtWeb, ctxA);
    await addToCart(rtWeb, ctxA, { token: cart.token, variantId: variantAId, quantity: 1 });
    const placed = await placeOrder(rtWeb, ctxA, {
      cartToken: cart.token,
      idempotencyKey: `idem_metrics_1_${Date.now()}`,
      email: custEmail,
      phone: "9876543211",
      fullName: "Metrics Shopper",
      addressLine1: "123 MG Road",
      city: "Bengaluru",
      state: "Karnataka",
      pincode: "560001",
      paymentMethod: "cod",
    });

    // An uncollected COD order must NOT count towards metrics
    detail = await getAdminCustomerDetail(rtWeb, ctxA, { id: customerId });
    expect(detail.customer.ordersCount).toBe(0);
    expect(detail.customer.totalSpent).toBe(0);

    // 3. Collect COD payment (transitions payment_status to 'cod_collected')
    const [pi] = await withTenant(rtWeb._db.db, ctxA.tenantId, async (tx) => {
      return await tx.select().from(schema.paymentIntents).where(eq(schema.paymentIntents.orderId, placed.orderId));
    });
    expect(pi).toBeDefined();

    await transitionOrder(rtWeb, ctxA, placed.orderId, {
      type: "payment.cod_collect",
      intentId: pi!.id,
    });

    // Now order is counted: 1 order, ₹1000 (100000 paise)
    detail = await getAdminCustomerDetail(rtWeb, ctxA, { id: customerId });
    expect(detail.customer.ordersCount).toBe(1);
    expect(detail.customer.totalSpent).toBe(100000);

    // 4. Test partial refund: creates a refund of 30000 paise (₹300)
    await withTenant(rtWeb._db.db, ctxA.tenantId, async (tx) => {
      await tx.insert(schema.refunds).values({
        tenantId: ctxA.tenantId,
        orderId: placed.orderId,
        intentId: pi!.id,
        amount: 30000,
        status: "succeeded",
        reason: "customer_return",
      });
    });

    // Net spend reduces to 70000 paise (₹700), orders count remains 1
    detail = await getAdminCustomerDetail(rtWeb, ctxA, { id: customerId });
    expect(detail.customer.ordersCount).toBe(1);
    expect(detail.customer.totalSpent).toBe(70000);

    // 5. Cancel an order -> cancelling makes it not counted
    // Let's place a 2nd order and cancel it
    const cart2 = await getOrCreateCart(rtWeb, ctxA);
    await addToCart(rtWeb, ctxA, { token: cart2.token, variantId: variantAId, quantity: 1 });
    const placed2 = await placeOrder(rtWeb, ctxA, {
      cartToken: cart2.token,
      idempotencyKey: `idem_metrics_2_${Date.now()}`,
      email: custEmail,
      phone: "9876543211",
      fullName: "Metrics Shopper",
      addressLine1: "123 MG Road",
      city: "Bengaluru",
      state: "Karnataka",
      pincode: "560001",
      paymentMethod: "cod",
    });
    await transitionOrder(rtWeb, ctxA, placed2.orderId, { type: "order.confirm" });
    await transitionOrder(rtWeb, ctxA, placed2.orderId, { type: "order.cancel", reason: "customer_cancelled" });

    detail = await getAdminCustomerDetail(rtWeb, ctxA, { id: customerId });
    expect(detail.customer.ordersCount).toBe(1);
    expect(detail.customer.totalSpent).toBe(70000);

    // 6. Test refreshCustomerMetrics & runCustomerMetricsSweep
    const refreshed = await refreshCustomerMetrics(rtWeb._db.db, ctxA.tenantId, customerId);
    expect(refreshed?.ordersCount).toBe(1);
    expect(refreshed?.totalSpent).toBe(70000);

    const sweepResult = await runCustomerMetricsSweep(rtWeb._db.db, ctxA.tenantId);
    expect(sweepResult).toBeDefined();

    // Verify customer row cached columns match computed metrics
    const [rawCust] = await withTenant(rtWeb._db.db, ctxA.tenantId, async (tx) => {
      return await tx.select().from(schema.customers).where(eq(schema.customers.id, customerId));
    });
    expect(rawCust?.ordersCount).toBe(1);
    expect(rawCust?.totalSpent).toBe(70000);
  });
});

describe("Phase 0b: Guest customers & verified claim", () => {
  it("creates guest customer on storefront checkout, prevents order leak to unverified accounts, and claims on verification", async () => {
    const guestEmail = "guest-shopper@example.com";

    // 1. Guest checkout
    const cart = await getOrCreateCart(rtWeb, ctxA);
    await addToCart(rtWeb, ctxA, { token: cart.token, variantId: variantAId, quantity: 1 });
    const guestOrder = await placeOrder(rtWeb, ctxA, {
      cartToken: cart.token,
      idempotencyKey: `idem_guest_1_${Date.now()}`,
      email: guestEmail,
      phone: "9123456780",
      fullName: "Guest One",
      addressLine1: "456 Indiranagar",
      city: "Bengaluru",
      state: "Karnataka",
      pincode: "560038",
      paymentMethod: "cod",
    });
    expect(guestOrder.orderId).toBeDefined();

    const [o1] = await withTenant(rtWeb._db.db, ctxA.tenantId, async (tx) => {
      return await tx.select().from(schema.orders).where(eq(schema.orders.id, guestOrder.orderId));
    });
    expect(o1?.customerId).toBeDefined();
    const guestCustId = o1!.customerId!;

    // Check customer row is marked guest
    const [guestCust] = await withTenant(rtWeb._db.db, ctxA.tenantId, async (tx) => {
      return await tx.select().from(schema.customers).where(eq(schema.customers.id, guestCustId));
    });
    expect(guestCust?.isGuest).toBe(true);
    expect(guestCust?.name).toBe("Guest One");

    // 2. Second guest checkout with same email reuses customer row without overwriting existing name/phone
    const cart2 = await getOrCreateCart(rtWeb, ctxA);
    await addToCart(rtWeb, ctxA, { token: cart2.token, variantId: variantAId, quantity: 1 });
    const guestOrder2 = await placeOrder(rtWeb, ctxA, {
      cartToken: cart2.token,
      idempotencyKey: `idem_guest_2_${Date.now()}`,
      email: guestEmail,
      phone: "9999999999",
      fullName: "Attempted Name Overwrite",
      addressLine1: "456 Indiranagar",
      city: "Bengaluru",
      state: "Karnataka",
      pincode: "560038",
      paymentMethod: "cod",
    });
    const [o2] = await withTenant(rtWeb._db.db, ctxA.tenantId, async (tx) => {
      return await tx.select().from(schema.orders).where(eq(schema.orders.id, guestOrder2.orderId));
    });
    expect(o2?.customerId).toBe(guestCustId);

    const [guestCustAfter] = await withTenant(rtWeb._db.db, ctxA.tenantId, async (tx) => {
      return await tx.select().from(schema.customers).where(eq(schema.customers.id, guestCustId));
    });
    expect(guestCustAfter?.name).toBe("Guest One");
    expect(guestCustAfter?.phone).toBe("9123456780");

    // 3. Cross-store isolation: same email in Store B creates a separate customer row in Store B
    const cartB = await getOrCreateCart(rtWeb, ctxB);
    await addToCart(rtWeb, ctxB, { token: cartB.token, variantId: variantBId, quantity: 1 });
    const guestOrderB = await placeOrder(rtWeb, ctxB, {
      cartToken: cartB.token,
      idempotencyKey: `idem_guest_b_${Date.now()}`,
      email: guestEmail,
      phone: "9123456780",
      fullName: "Store B Guest",
      addressLine1: "789 Park Street",
      city: "Kolkata",
      state: "West Bengal",
      pincode: "700016",
      paymentMethod: "cod",
    });
    const [oB] = await withTenant(rtWeb._db.db, ctxB.tenantId, async (tx) => {
      return await tx.select().from(schema.orders).where(eq(schema.orders.id, guestOrderB.orderId));
    });
    expect(oB?.customerId).not.toBe(guestCustId);

    // 4. Registration claims guest row upon email verification
    // Generate an actionToken for email verification
    const { actionTokens } = schema;
    const tokenRaw = "claim_test_token_123456";
    const { createHash } = await import("node:crypto");
    const tokenHash = createHash("sha256").update(tokenRaw).digest("hex");

    await withTenant(rtWeb._db.db, ctxA.tenantId, async (tx) => {
      await tx.insert(actionTokens).values({
        tenantId: ctxA.tenantId,
        purpose: "email_verification",
        targetId: guestCustId,
        tokenHash,
        expiresAt: new Date(Date.now() + 3600_000),
      });
    });

    const verifyRes = await verifyCustomerEmail(rtWeb._db.db, ctxA.tenantId, tokenRaw);
    expect(verifyRes.success).toBe(true);

    const [claimedCust] = await withTenant(rtWeb._db.db, ctxA.tenantId, async (tx) => {
      return await tx.select().from(schema.customers).where(eq(schema.customers.id, guestCustId));
    });
    expect(claimedCust?.isGuest).toBe(false);
    expect(claimedCust?.emailVerified).toBe(true);
  });
});

describe("Phase 0c: One consent record with history", () => {
  it("records consent events, maintains 1:1 sync with accepts_marketing, and supports unsubscribe flow", async () => {
    const consentEmail = "consent-shopper@example.com";

    // 1. Newsletter signup creates or updates customer consent
    const newsletterSub = await subscribeNewsletter(rtWeb, ctxA, { email: consentEmail, source: "storefront_form" });
    expect(newsletterSub.success).toBe(true);

    // Fetch customer created
    const [c] = await withTenant(rtWeb._db.db, ctxA.tenantId, async (tx) => {
      return await tx.select().from(schema.customers).where(eq(schema.customers.email, consentEmail));
    });
    expect(c).toBeDefined();
    expect(c?.marketingState).toBe("subscribed");
    expect(c?.acceptsMarketing).toBe(true);
    expect(c?.marketingSource).toBe("storefront_form");

    // Check customer_consent_events history
    const events = await withTenant(rtWeb._db.db, ctxA.tenantId, async (tx) => {
      return await tx
        .select()
        .from(schema.customerConsentEvents)
        .where(eq(schema.customerConsentEvents.customerId, c!.id));
    });
    expect(events.length).toBeGreaterThanOrEqual(1);
    expect(events[0]?.state).toBe("subscribed");
    expect(events[0]?.source).toBe("storefront_form");

    // 2. Unsubscribe via token
    const unsubToken = await mintUnsubscribeToken(rtWeb._db.db, ctxA.tenantId, c!.id);
    expect(unsubToken).toBeDefined();

    const unsubView = await getUnsubscribeView(rtWeb._db.db, ctxA.tenantId, unsubToken);
    expect(unsubView.state).toBe("subscribed");

    const unsubSuccess = await unsubscribeByToken(rtWeb._db.db, ctxA.tenantId, unsubToken);
    expect(unsubSuccess).toBe(true);

    const [unsubCust] = await withTenant(rtWeb._db.db, ctxA.tenantId, async (tx) => {
      return await tx.select().from(schema.customers).where(eq(schema.customers.id, c!.id));
    });
    expect(unsubCust?.marketingState).toBe("unsubscribed");
    expect(unsubCust?.acceptsMarketing).toBe(false);

    // 3. Customer profile update sets marketing consent
    await updateCustomerProfile(rtWeb._db.db, ctxA.tenantId, c!.id, {
      name: "Consented Shopper",
      email: consentEmail,
      acceptsMarketing: true,
    });

    const [reOptCust] = await withTenant(rtWeb._db.db, ctxA.tenantId, async (tx) => {
      return await tx.select().from(schema.customers).where(eq(schema.customers.id, c!.id));
    });
    expect(reOptCust?.marketingState).toBe("subscribed");
    expect(reOptCust?.acceptsMarketing).toBe(true);

    // 4. Admin setting consent directly creates audit log and consent event
    const staffId = ctxA.actor.type === "staff" ? ctxA.actor.userId : "00000000-0000-0000-0000-000000000000";
    await setMarketingConsent(
      rtWeb,
      ctxA,
      {
        customerId: c!.id,
        state: "unsubscribed",
        source: "admin",
        actorType: "staff",
        actorId: staffId,
      },
    );

    const [adminUnsubCust] = await withTenant(rtWeb._db.db, ctxA.tenantId, async (tx) => {
      return await tx.select().from(schema.customers).where(eq(schema.customers.id, c!.id));
    });
    expect(adminUnsubCust?.marketingState).toBe("unsubscribed");
    expect(adminUnsubCust?.acceptsMarketing).toBe(false);

    // Verify staff audit_logs entry was created
    const staffAudits = await withTenant(rtWeb._db.db, ctxA.tenantId, async (tx) => {
      return await tx
        .select()
        .from(schema.auditLogs)
        .where(
          and(
            eq(schema.auditLogs.action, "customer.consent_changed"),
            eq(schema.auditLogs.targetId, c!.id),
          ),
        );
    });
    expect(staffAudits.length).toBeGreaterThanOrEqual(1);
    expect(staffAudits[0]?.actorType).toBe("staff");
  });
});

describe("Phase 0 verification additions", () => {
  async function guestCheckout(email: string, phone: string) {
    const cart = await getOrCreateCart(rtWeb, ctxA);
    await addToCart(rtWeb, ctxA, { token: cart.token, variantId: variantAId, quantity: 1 });
    return placeOrder(rtWeb, ctxA, {
      cartToken: cart.token,
      idempotencyKey: `idem_ver_${email}_${Date.now()}`,
      email,
      phone,
      fullName: "Backfill Guest",
      addressLine1: "1 Test Road",
      city: "Pune",
      state: "Maharashtra",
      pincode: "411001",
      paymentMethod: "cod",
    });
  }

  it("registering with the marketing box ticked goes through the consent writer (state, flag and history agree)", async () => {
    const email = `register-consent-${Date.now()}@example.com`;
    await registerCustomer(rtWeb._db.db, ctxA.tenantId, { email, name: "Reg Consent", acceptsMarketing: true }, { ip: "198.51.100.7" });
    const [c] = await withTenant(rtWeb._db.db, ctxA.tenantId, (tx) => tx.select().from(schema.customers).where(eq(schema.customers.email, email)));
    expect(c?.marketingState).toBe("subscribed");
    expect(c?.acceptsMarketing).toBe(true);
    const events = await withTenant(rtWeb._db.db, ctxA.tenantId, (tx) => tx.select().from(schema.customerConsentEvents).where(eq(schema.customerConsentEvents.customerId, c!.id)));
    expect(events.map((e) => e.state)).toEqual(["subscribed"]);

    const email2 = `register-noconsent-${Date.now()}@example.com`;
    await registerCustomer(rtWeb._db.db, ctxA.tenantId, { email: email2, name: "No Consent" }, { ip: "198.51.100.8" });
    const [c2] = await withTenant(rtWeb._db.db, ctxA.tenantId, (tx) => tx.select().from(schema.customers).where(eq(schema.customers.email, email2)));
    expect(c2?.marketingState).toBe("not_subscribed");
    expect(c2?.acceptsMarketing).toBe(false);
  });

  it("the guest backfill survives two order emails sharing a phone, and is idempotent", async () => {
    const stamp = Date.now();
    const emails = [`bf-one-${stamp}@example.com`, `bf-two-${stamp}@example.com`];
    for (const e of emails) await guestCheckout(e, "9000000555");
    const db = rtPlatform._db.db;
    // put the store back into its pre-migration state: orders without customers
    await db.execute(sql`UPDATE orders SET customer_id = NULL WHERE tenant_id = ${ctxA.tenantId} AND email IN (${emails[0]}, ${emails[1]})`);
    await db.execute(sql`DELETE FROM customers WHERE tenant_id = ${ctxA.tenantId} AND email IN (${emails[0]}, ${emails[1]})`);

    const file = readFileSync(new URL("../../db/migrations/0028_customers_phase0.sql", import.meta.url), "utf8");
    const start = file.indexOf('INSERT INTO "customers" ("tenant_id", "email", "phone", "name", "is_guest"');
    const end = file.indexOf("FROM ranked r;", start) + "FROM ranked r;".length;
    expect(start).toBeGreaterThan(-1);
    const statement = file.slice(start, end);

    await db.execute(sql.raw(statement));
    const rows = await db.execute(sql`SELECT email, phone, is_guest FROM customers WHERE tenant_id = ${ctxA.tenantId} AND email IN (${emails[0]}, ${emails[1]})`);
    expect(rows.rows.length).toBe(2);
    expect(rows.rows.every((r) => r.is_guest === true)).toBe(true);
    expect(rows.rows.filter((r) => r.phone !== null).length).toBe(1);

    await db.execute(sql.raw(statement));
    const again = await db.execute(sql`SELECT count(*)::int AS n FROM customers WHERE tenant_id = ${ctxA.tenantId} AND email IN (${emails[0]}, ${emails[1]})`);
    expect(again.rows[0]?.n).toBe(2);
  });
});
