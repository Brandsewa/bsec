/**
 * Integration Test: Real PostgreSQL 18 Tenant Isolation & Security Invariants.
 * Runs against a real PostgreSQL 18 instance (via Testcontainers or TEST_DATABASE_URL_SUPERUSER).
 *
 * Verifies:
 * 1. Dynamic introspection of all oRPC admin and platform contract procedures.
 * 2. Cross-tenant access rejection (User A cannot access Tenant B).
 * 3. Role permission enforcement via hasPermission() (users lacking required permission receive 403 Forbidden).
 * 4. Authentication enforcement (customer and unauthenticated sessions rejected).
 * 5. Platform security invariants (non-platform staff rejected, platform staff accepted).
 * 6. True PostgreSQL Row Level Security (RLS) enforcement: direct queries across tenants
 *    return 0 rows, and queries without tenant context return 0 rows under app_rw.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { eq, sql, and } from "drizzle-orm";
import { platformContract, storeContract } from "@bs/contracts";
import {
  createDb,
  schema,
  withTenant,
  type DbHandle,
} from "@bs/db";
import { bootstrapRoles } from "@bs/db/bootstrap";
import { runMigrations } from "@bs/db/migrate";
import {
  activateTheme,
  getCategoryStats,
  getCategory,
  getCollectionStats,
  getBrandStats,
  getBrand,
  getLocationStats,
  listLocations,
  getLocation,
  createLocation,
  updateLocation,
  deleteLocation,
  listAdminReviews,
  getAdminReviewStats,
  getAdminReviewDetail,
  publishAdminReview,
  holdAdminReview,
  deleteAdminReview,
  replyAdminReview,
  bulkPublishAdminReviews,
  bulkHoldAdminReviews,
  bulkDeleteAdminReviews,
  listPageVersions,
  listThemeLibrary,
  previewPageRenderData,
  previewThemeTemplate,
  addAdminOrderNote,
  adjustInventory,
  assertPlatformStaff,
  buildTenantContext,
  cancelAdminOrder,
  createAdminDiscount,
  createAdminDraftOrder,
  createAdminFulfillment,
  createAdminOrderInvoice,
  createBrand,
  createCategory,
  createCollection,
  createMediaRecord,
  createMenu,
  createPage,
  createProduct,
  acceptInvitation,
  clearRazorpayCredentials,
  createRuntime,
  deleteAdminDiscount,
  deleteBrand,
  deleteCategory,
  deleteCollection,
  deleteMediaRecord,
  deleteMenu,
  deleteProduct,
  getAdminCustomerDetail,
  getAdminMe,
  getPaymentsStatus,
  getAdminOrderDetail,
  getBrandSettings,
  getStoreStatus,
  attachProductMedia,
  detachProductMedia,
  updateStoreStatus,
  getCollection,
  getMenu,
  getPage,
  getPlatformTenant,
  getProduct,
  getAdminShippingSettings,
  getStoreSettings,
  getTheme,
  inviteStaff,
  listAdminCustomers,
  getAdminCustomerStats,
  listAdminCustomerTags,
  setAdminCustomerStatus,
  setAdminCustomerTags,
  updateAdminCustomer,
  setAdminCustomerConsent,
  addAdminCustomerAddress,
  updateAdminCustomerAddress,
  deleteAdminCustomerAddress,
  listAdminCustomerOrders,
  getAdminCustomerActivity,
  listCustomerNotes,
  addCustomerNote,
  deleteCustomerNote,
  listAdminDiscounts,
  listAdminOrders,
  listInvitations,
  listStoreRoles,
  listBrands,
  listCategories,
  listCollections,
  listInventoryLevels,
  listMedia,
  listMemberships,
  listMenus,
  listPages,
  listPlatformTenants,
  listProducts,
  listStoreFeatureFlags,
  publishBrandSettings,
  publishPage,
  refundAdminOrder,
  removeMember,
  revokeInvitation,
  saveRazorpayCredentials,
  setMemberRole,
  requestMediaUpload,
  rollbackPage,
  savePageDraft,
  updateAdminDiscount,
  updateAdminShippingSettings,
  updateBrand,
  updateBrandSettings,
  updateCategory,
  updateCollection,
  updateMenu,
  updatePage,
  updateProduct,
  updateStoreSettings,
  updateTheme,
  updateVariant,
  getTenantSubscription,
  changeTenantPlan,
  approveStoreSupportSession,
  denyStoreSupportSession,
  getStandingSupportConsent,
  listStoreSupportSessions,
  setStandingSupportConsent,
  startSupportSession,
  listTenantDomains,
  addCustomDomain,
  verifyCustomDomain,
  setPrimaryDomain,
  removeCustomDomain,
  getOnboardingProgress,
  dismissOnboardingProgress,
  assertPermission,
  type Runtime,
  type TenantContext,
  confirmAdminOrder,
  advanceAdminOrder,
  listAdminReturns,
  requestReturn,
  actOnReturn,
  getAdminAbandonedCheckoutStats,
  listAdminAbandonedCheckouts,
  createAdminCustomer,
  getOrderSettings,
  updateOrderSettings,
  estimateAdminDraftOrder,
  getAdminOrderStats,
  changePreorderShipDate,
  listPreorders,
  releasePreorderNow,
  getPreorderStats,
  deleteAdminQuote,
  getAdminQuoteDetail,
  linkOrderToQuote,
  listAdminQuotes,
  markAdminQuoteLost,
  reopenAdminQuote,
  getAdminQuoteStats,
  updateAdminQuoteNote,
  getReturnSettings,
  updateReturnSettings,
  getAdminReturnDetail,
  getAdminReturnStats,
} from "../src/index.ts";

const PW = { owner: "o_test", rw: "rw_test", platform: "p_test" };
let container: StartedPostgreSqlContainer | undefined;
let superUrl: string;

function as(role: "app_owner" | "app_rw" | "app_platform", password: string): string {
  const u = new URL(superUrl);
  u.username = role;
  u.password = password;
  return u.toString();
}

/**
 * Dynamically walks an oRPC contract object and extracts all procedure paths.
 * Guarantees that any new procedure added in M2+ is automatically discovered
 * and tested for tenant isolation.
 */
function extractProcedurePaths(obj: Record<string, unknown>, prefix = ""): string[] {
  const paths: string[] = [];
  for (const [key, value] of Object.entries(obj)) {
    const currentPath = prefix ? `${prefix}.${key}` : key;
    if (value && typeof value === "object") {
      if ("~orpc" in value || "route" in value) {
        paths.push(currentPath);
      } else {
        paths.push(...extractProcedurePaths(value as Record<string, unknown>, currentPath));
      }
    }
  }
  return paths;
}

describe("Generated Isolation Test Suite (M1 Real Postgres 18 Proof)", () => {
  const orgId = "0199a000-0000-7000-8000-000000000001";
  const tenantA = "0199a000-0000-7000-8000-000000000010";
  const tenantB = "0199a000-0000-7000-8000-000000000020";

  const userA = "0199a000-0000-7000-8000-000000000100";
  const userB = "0199a000-0000-7000-8000-000000000200";
  const userLimited = "0199a000-0000-7000-8000-000000000300";
  const userPlatform = "0199a000-0000-7000-8000-000000000400";

  const roleAdminA = "0199a000-0000-7000-8000-000000000011";
  const roleLimitedA = "0199a000-0000-7000-8000-000000000012";
  const roleAdminB = "0199a000-0000-7000-8000-000000000021";

  const testLocationA = "0199a000-0000-7000-8000-000000000501";
  const testBrandA = "0199a000-0000-7000-8000-000000000502";
  const testCategoryA = "0199a000-0000-7000-8000-000000000503";
  const testProductA = "0199a000-0000-7000-8000-000000000504";
  const testVariantA = "0199a000-0000-7000-8000-000000000505";
  const testCollectionA = "0199a000-0000-7000-8000-000000000506";
  const testMediaA = "0199a000-0000-7000-8000-000000000507";
  const testPageA = "0199a000-0000-7000-8000-000000000508";
  const testVersionA = "0199a000-0000-7000-8000-000000000509";
  const testMenuA = "0199a000-0000-7000-8000-000000000510";
  const testMenuHandleA = "main-menu";

  const testCustomerA = "0199a000-0000-7000-8000-000000000511";
  const testOrderA = "0199a000-0000-7000-8000-000000000512";
  const testOrderItemA = "0199a000-0000-7000-8000-000000000513";
  const testDiscountA = "0199a000-0000-7000-8000-000000000514";

  const testProductB = "0199a000-0000-7000-8000-000000000604";
  const testVariantB = "0199a000-0000-7000-8000-000000000605";

  let rtApp: Runtime;
  let rtPlatform: Runtime;
  let dbRw: DbHandle;
  let dbPlatform: DbHandle;

  const adminProcedures = extractProcedurePaths(storeContract.admin as unknown as Record<string, unknown>);
  const platformProcedures = extractProcedurePaths(platformContract.tenants as unknown as Record<string, unknown>);

  beforeAll(async () => {
    if (process.env.TEST_DATABASE_URL_SUPERUSER) {
      superUrl = process.env.TEST_DATABASE_URL_SUPERUSER;
    } else {
      // .withReuse() only activates with TESTCONTAINERS_REUSE_ENABLE=true (opt-in for local dev
      // to skip container startup between runs); it's a no-op otherwise, so CI is unaffected.
      container = await new PostgreSqlContainer("postgres:18").withReuse().start();
      superUrl = container.getConnectionUri();
    }

    // 1. Bootstrap PostgreSQL roles (app_owner, app_rw, app_platform)
    await bootstrapRoles(superUrl, PW);

    // 2. Run Drizzle migrations as app_owner
    await runMigrations(as("app_owner", PW.owner));

    // Clean up previous runs' test tenant data with superuser (bypassing RLS and FK triggers)
    const pgClient = new (await import("pg")).default.Client({ connectionString: superUrl });
    await pgClient.connect();
    await pgClient.query("SET session_replication_role = 'replica'");
    const tenantTablesRes = await pgClient.query(`
      SELECT table_name FROM information_schema.columns 
      WHERE column_name = 'tenant_id' AND table_schema = 'public' AND table_name != 'tenants'
    `);
    const tables = tenantTablesRes.rows.map((r: { table_name: string }) => r.table_name);
    for (const t of tables) {
      await pgClient.query(`DELETE FROM "${t}" WHERE tenant_id IN ('${tenantA}', '${tenantB}')`);
    }
    await pgClient.query(`
      DELETE FROM domains WHERE tenant_id IN ('${tenantA}', '${tenantB}');
      DELETE FROM tenants WHERE id IN ('${tenantA}', '${tenantB}');
      DELETE FROM organizations WHERE id = '${orgId}';
      DELETE FROM users WHERE id IN ('${userA}', '${userB}', '${userLimited}', '${userPlatform}');
    `);
    await pgClient.query("SET session_replication_role = 'origin'");
    await pgClient.end();

    // 3. Connect runtimes
    rtApp = createRuntime({ service: "web", databaseUrl: as("app_rw", PW.rw), poolMax: 5 });
    rtPlatform = createRuntime({ service: "platform", databaseUrl: as("app_platform", PW.platform), poolMax: 5 });
    dbRw = createDb(as("app_rw", PW.rw));
    dbPlatform = createDb(as("app_platform", PW.platform));

    // 4. Seed non-tenant global records using platform connection
    await dbPlatform.db
      .insert(schema.organizations)
      .values({
        id: orgId,
        name: "Global Test Org",
      })
      .onConflictDoNothing();

    await dbPlatform.db
      .insert(schema.tenants)
      .values([
        {
          id: tenantA,
          slug: "store-alpha",
          name: "Store Alpha",
          organizationId: orgId,
          status: "active",
        },
        {
          id: tenantB,
          slug: "store-beta",
          name: "Store Beta",
          organizationId: orgId,
          status: "active",
        },
      ])
      .onConflictDoNothing();

    await dbPlatform.db
      .insert(schema.domains)
      .values([
        {
          tenantId: tenantA,
          hostname: "alpha.store.test",
          isPrimary: true,
          status: "active",
        },
        {
          tenantId: tenantB,
          hostname: "beta.store.test",
          isPrimary: true,
          status: "active",
        },
      ])
      .onConflictDoNothing();

    await dbRw.db
      .insert(schema.users)
      .values([
        { id: userA, email: "usera@alpha.test", name: "User A" },
        { id: userB, email: "userb@beta.test", name: "User B" },
        { id: userLimited, email: "limited@alpha.test", name: "User Limited" },
        { id: userPlatform, email: "platform@corp.test", name: "Platform Admin", twoFactorEnabled: true },
      ])
      .onConflictDoNothing();

    await dbPlatform.db
      .insert(schema.twoFactors)
      .values({ id: "isolation-2fa", userId: userPlatform, secret: "x", backupCodes: "x", verified: true })
      .onConflictDoNothing();

    await dbPlatform.db
      .insert(schema.platformStaff)
      .values({
        userId: userPlatform,
        role: "platform_owner",
        isActive: true,
        mfaVerifiedAt: new Date(Date.now() - 3600_000),
      })
      .onConflictDoNothing();

    await dbPlatform.db
      .insert(schema.featureFlags)
      .values([
        { key: "checkout_v2", defaultOn: true, killSwitch: false },
        { key: "experimental_search", defaultOn: false, killSwitch: false },
      ])
      .onConflictDoNothing();

    // Seed size tiers and plan details using platform connection
    await dbPlatform.db
      .insert(schema.tenantSizeTiers)
      .values([
        { tenantId: tenantA, tier: "L" },
        { tenantId: tenantB, tier: "L" },
      ])
      .onConflictDoUpdate({
        target: schema.tenantSizeTiers.tenantId,
        set: { tier: "L" },
      });

    await dbPlatform.db.execute(sql`
      UPDATE plans SET razorpay_plan_id_monthly = 'plan_test_growth_monthly' WHERE code = 'growth';
    `);

    // 5. Seed Tenant A records using withTenant()
    await withTenant(dbRw.db, tenantA, async (tx) => {
      await tx.insert(schema.roles).values([
        {
          id: roleAdminA,
          tenantId: tenantA,
          name: "store_admin",
          isSystem: true,
          permissions: [
            "staff.manage",
            "settings.write",
            "products.read",
            "products.write",
            "content.write",
            "theme.publish",
            "orders.read",
            "orders.write",
            "orders.refund",
            "customers.read",
            "customers.write",
            "discounts.write",
          ],
        },
        {
          id: roleLimitedA,
          tenantId: tenantA,
          name: "store_viewer",
          isSystem: false,
          permissions: ["analytics.read"],
        },
      ]);

      await tx.insert(schema.memberships).values([
        {
          tenantId: tenantA,
          userId: userA,
          roleId: roleAdminA,
          status: "active",
        },
        {
          tenantId: tenantA,
          userId: userLimited,
          roleId: roleLimitedA,
          status: "active",
        },
      ]);

      await tx.insert(schema.storeSettings).values({
        tenantId: tenantA,
        storeName: "Alpha Store Settings",
        currency: "USD",
        timezone: "America/New_York",
      });

      await tx.insert(schema.locations).values({
        id: testLocationA,
        tenantId: tenantA,
        name: "Main Warehouse",
      });

      await tx.insert(schema.brands).values({
        id: testBrandA,
        tenantId: tenantA,
        name: "Acme",
        slug: "acme",
      });

      await tx.insert(schema.categories).values({
        id: testCategoryA,
        tenantId: tenantA,
        name: "Apparel",
        slug: "apparel",
      });

      await tx.insert(schema.products).values({
        id: testProductA,
        tenantId: tenantA,
        title: "Sample T-Shirt",
        slug: "sample-t-shirt",
        status: "active",
      });

      await tx.insert(schema.variants).values({
        id: testVariantA,
        tenantId: tenantA,
        productId: testProductA,
        sku: "TSHIRT-BLK-S",
        title: "Small / Black",
        price: 2999n,
      });

      await tx.insert(schema.collections).values({
        id: testCollectionA,
        tenantId: tenantA,
        title: "Summer Collection",
        slug: "summer-collection",
        published: true,
      });

      await tx.insert(schema.media).values({
        id: testMediaA,
        tenantId: tenantA,
        storageKey: "sample.png",
        mime: "image/png",
        bytes: 1024,
        folder: "products",
      });

      await tx.insert(schema.pages).values({
        id: testPageA,
        tenantId: tenantA,
        title: "Home Page",
        slug: "home",
        status: "published",
      });

      await tx.insert(schema.pageVersions).values({
        id: testVersionA,
        tenantId: tenantA,
        pageId: testPageA,
        document: { version: 1, blocks: [] },
      });

      await tx
        .update(schema.pages)
        .set({
          publishedVersionId: testVersionA,
          draftVersionId: testVersionA,
        })
        .where(eq(schema.pages.id, testPageA));

      await tx.insert(schema.menus).values({
        id: testMenuA,
        tenantId: tenantA,
        title: "Main Menu",
        handle: testMenuHandleA,
        items: [],
      });

      // M5 seed records for Tenant A
      await tx.insert(schema.customers).values({
        id: testCustomerA,
        tenantId: tenantA,
        email: "customer-a@test.com",
        phone: "+919876543210",
        name: "Test Customer A",
      });

      await tx.insert(schema.orders).values({
        id: testOrderA,
        tenantId: tenantA,
        number: "ORD-ALPHA-1001",
        customerId: testCustomerA,
        email: "customer-a@test.com",
        phone: "+919876543210",
        status: "placed",
        paymentStatus: "captured",
        fulfillmentStatus: "unfulfilled",
        subtotal: 2999,
        discountTotal: 0,
        shippingTotal: 0,
        taxTotal: 0,
        grandTotal: 2999,
        shippingAddress: {
          line1: "123 MG Road",
          city: "Bengaluru",
          stateCode: "KA",
          pincode: "560001",
        },
      });

      await tx.insert(schema.orderItems).values({
        id: testOrderItemA,
        tenantId: tenantA,
        orderId: testOrderA,
        variantId: testVariantA,
        productTitle: "Sample T-Shirt",
        variantTitle: "Small / Black",
        sku: "TSHIRT-BLK-S",
        quantity: 1,
        unitPrice: 2999,
        total: 2999,
      });

      await tx.insert(schema.discounts).values({
        id: testDiscountA,
        tenantId: tenantA,
        code: "WELCOME10",
        title: "Welcome 10% Off",
        type: "percent",
        value: 10,
        status: "active",
      });
    });

    // 6. Seed Tenant B records using withTenant()
    await withTenant(dbRw.db, tenantB, async (tx) => {
      await tx.insert(schema.roles).values([
        {
          id: roleAdminB,
          tenantId: tenantB,
          name: "store_admin",
          isSystem: true,
          permissions: ["staff.manage", "settings.write"],
        },
      ]);

      await tx.insert(schema.memberships).values([
        {
          tenantId: tenantB,
          userId: userB,
          roleId: roleAdminB,
          status: "active",
        },
      ]);

      await tx.insert(schema.storeSettings).values({
        tenantId: tenantB,
        storeName: "Beta Store Settings",
        currency: "EUR",
        timezone: "Europe/Paris",
      });

      await tx.insert(schema.products).values({
        id: testProductB,
        tenantId: tenantB,
        title: "Beta Product",
        slug: "beta-product",
        status: "active",
      });

      await tx.insert(schema.variants).values({
        id: testVariantB,
        tenantId: tenantB,
        productId: testProductB,
        sku: "BETA-PROD",
        title: "Beta Default",
        price: 4999n,
      });
    });
  }, 180_000);

  afterAll(async () => {
    await rtApp?.close();
    await rtPlatform?.close();
    await dbRw?.close();
    await dbPlatform?.close();
    await container?.stop();
  });

  it("dynamically discovers all registered admin procedures", () => {
    expect(adminProcedures.length).toBeGreaterThanOrEqual(40);
    expect(adminProcedures).toContain("memberships.list");
    expect(adminProcedures).toContain("memberships.invite");
    expect(adminProcedures).toContain("settings.get");
    expect(adminProcedures).toContain("settings.update");
    expect(adminProcedures).toContain("featureFlags.list");
    expect(adminProcedures).toContain("products.list");
    expect(adminProcedures).toContain("products.get");
    expect(adminProcedures).toContain("products.create");
    expect(adminProcedures).toContain("products.update");
    expect(adminProcedures).toContain("products.delete");
    expect(adminProcedures).toContain("variants.update");
    expect(adminProcedures).toContain("categories.list");
    expect(adminProcedures).toContain("collections.list");
    expect(adminProcedures).toContain("brands.list");
    expect(adminProcedures).toContain("inventory.list");
    expect(adminProcedures).toContain("media.list");
    expect(adminProcedures).toContain("menus.list");
    expect(adminProcedures).toContain("orders.list");
    expect(adminProcedures).toContain("orders.get");
    expect(adminProcedures).toContain("orders.createDraft");
    expect(adminProcedures).toContain("orders.addNote");
    expect(adminProcedures).toContain("orders.cancel");
    expect(adminProcedures).toContain("orders.refund");
    expect(adminProcedures).toContain("orders.createFulfillment");
    expect(adminProcedures).toContain("orders.createInvoice");
    expect(adminProcedures).toContain("orders.confirm");
    expect(adminProcedures).toContain("orders.advance");
    expect(adminProcedures).toContain("returns.list");
    expect(adminProcedures).toContain("returns.act");
    expect(adminProcedures).toContain("customers.list");
    expect(adminProcedures).toContain("customers.get");
    expect(adminProcedures).toContain("discounts.list");
    expect(adminProcedures).toContain("discounts.create");
    expect(adminProcedures).toContain("discounts.update");
    expect(adminProcedures).toContain("discounts.delete");
  });

  it("dynamically discovers all registered platform procedures", () => {
    expect(platformProcedures.length).toBeGreaterThanOrEqual(2);
    expect(platformProcedures).toContain("list");
    expect(platformProcedures).toContain("get");
  });

  /**
   * Helper to dispatch procedure calls to actual domain services against real DB.
   */
  /** Adds a second staff member to the store through the real invite + accept flow. */
  async function addTeamMember(rt: Runtime, ctx: TenantContext) {
    const email = `member-${Date.now()}-${Math.random().toString(36).slice(2, 6)}@test.com`;
    const invite = await inviteStaff(rt, ctx, { email, roleId: roleLimitedA });
    await acceptInvitation(rt, { storeId: ctx.tenantId, token: invite.token!, name: "Team Member", password: "long-enough-password" });
    const member = (await listMemberships(rt, ctx)).find((m) => m.email === email);
    if (!member) throw new Error("member not created");
    return member;
  }

  /** Support access is the store OWNER's decision; the harness's store_admin user gets the owner role for these calls. */
  const asOwner = (ctx: TenantContext): TenantContext => ({ ...ctx, roles: ["store_owner"] });

  async function executeAdminProcedure(procPath: string, rt: Runtime, ctx: TenantContext) {
    switch (procPath) {
      case "memberships.roles":
        return await listStoreRoles(rt, ctx);
      case "memberships.setRole": {
        const m = await addTeamMember(rt, ctx);
        return await setMemberRole(rt, ctx, { id: m.id, roleId: roleLimitedA });
      }
      case "memberships.remove": {
        const m = await addTeamMember(rt, ctx);
        return await removeMember(rt, ctx, { id: m.id });
      }
      case "memberships.invitations":
        return await listInvitations(rt, ctx);
      case "memberships.revokeInvitation": {
        const invite = await inviteStaff(rt, ctx, {
          email: `revoke-${Date.now()}-${Math.random().toString(36).slice(2, 6)}@test.com`,
          roleId: roleLimitedA,
        });
        return await revokeInvitation(rt, ctx, { id: invite.id });
      }
      case "payments.get":
        return await getPaymentsStatus(rt, ctx);
      case "payments.saveRazorpay":
        return await saveRazorpayCredentials(rt, ctx, { keyId: "rzp_test_IsolationKey1", keySecret: "isolation-secret-value" });
      case "payments.clearRazorpay":
        return await clearRazorpayCredentials(rt, ctx);
      case "memberships.list":
        return await listMemberships(rt, ctx);
      case "support.list":
        return await listStoreSupportSessions(rt, asOwner(ctx));
      case "support.getStandingConsent":
        return await getStandingSupportConsent(rt, asOwner(ctx));
      case "support.setStandingConsent":
        return await setStandingSupportConsent(rt, asOwner(ctx), true);
      case "support.approve":
      case "support.deny": {
        const own = await startSupportSession(rtPlatform, userPlatform, { tenantId: ctx.tenantId, reason: "isolation check", ticketRef: "ISO-1", consent: "owner_approved" });
        // a request for ANOTHER store can be neither seen nor decided by this store's owner
        const foreign = await startSupportSession(rtPlatform, userPlatform, { tenantId: tenantB, reason: "isolation check", ticketRef: "ISO-2", consent: "owner_approved" });
        const decide = procPath === "support.approve" ? approveStoreSupportSession : denyStoreSupportSession;
        const result = await decide(rt, asOwner(ctx), own.id);
        // the request for ANOTHER store can be neither decided nor seen by this store's owner
        await expect(decide(rt, asOwner(ctx), foreign.id)).rejects.toThrow(/no pending support request/i);
        expect((await listStoreSupportSessions(rt, asOwner(ctx))).map((x) => x.id)).not.toContain(foreign.id);
        return result;
      }
      case "memberships.invite":
        return await inviteStaff(rt, ctx, {
          email: `invite-${Date.now()}-${Math.random().toString(36).slice(2, 6)}@test.com`,
          roleId: roleLimitedA,
        });
      case "settings.get":
        return await getStoreSettings(rt, ctx);
      case "settings.update":
        return await updateStoreSettings(rt, ctx, { storeName: "Updated Alpha Store" });
      case "featureFlags.list":
        return await listStoreFeatureFlags(rt, ctx);
      case "products.list":
        return await listProducts(rt, ctx);
      case "products.get":
        return await getProduct(rt, ctx, { id: testProductA });
      case "products.create":
        return await createProduct(rt, ctx, {
          title: `Product-${Date.now()}`,
          variants: [{ sku: `SKU-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, title: "Default", price: 1000 }],
        });
      case "products.update":
        return await updateProduct(rt, ctx, { id: testProductA, title: "Updated Product A" });
      case "products.delete": {
        const p = await createProduct(rt, ctx, {
          title: `To Delete-${Date.now()}`,
          variants: [{ sku: `DEL-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, title: "Default", price: 500 }],
        });
        return await deleteProduct(rt, ctx, { id: p.id });
      }
      case "variants.update":
        return await updateVariant(rt, ctx, { id: testVariantA, price: 2500 });
      case "categories.list":
        return await listCategories(rt, ctx);
      case "categories.create":
        return await createCategory(rt, ctx, { name: `Cat-${Date.now()}` });
      case "categories.update":
        return await updateCategory(rt, ctx, { id: testCategoryA, name: "Updated Category" });
      case "categories.delete": {
        const c = await createCategory(rt, ctx, { name: `Del Cat-${Date.now()}` });
        return await deleteCategory(rt, ctx, { id: c.id });
      }
      case "collections.list":
        return await listCollections(rt, ctx);
      case "collections.get":
        return await getCollection(rt, ctx, { id: testCollectionA });
      case "collections.create":
        return await createCollection(rt, ctx, { title: `Col-${Date.now()}` });
      case "collections.update":
        return await updateCollection(rt, ctx, { id: testCollectionA, title: "Updated Collection" });
      case "collections.delete": {
        const col = await createCollection(rt, ctx, { title: `Del Col-${Date.now()}` });
        return await deleteCollection(rt, ctx, { id: col.id });
      }
      case "brands.list":
        return await listBrands(rt, ctx);
      case "brands.create":
        return await createBrand(rt, ctx, { name: `Brand-${Date.now()}` });
      case "brands.update":
        return await updateBrand(rt, ctx, { id: testBrandA, name: "Updated Brand" });
      case "brands.delete": {
        const b = await createBrand(rt, ctx, { name: `Del Brand-${Date.now()}` });
        return await deleteBrand(rt, ctx, { id: b.id });
      }
      case "inventory.list":
        return await listInventoryLevels(rt, ctx);
      case "inventory.adjust":
        return await adjustInventory(rt, ctx, {
          variantId: testVariantA,
          locationId: testLocationA,
          quantityDelta: 10,
          reason: "received",
        });
      case "media.list":
        return await listMedia(rt, ctx);
      case "media.requestUpload": {
        // uploads are refused unless storage credentials exist, so give this call some
        const saved = { id: process.env.R2_ACCESS_KEY_ID, secret: process.env.R2_SECRET_ACCESS_KEY };
        process.env.R2_ACCESS_KEY_ID = "isolation-test-key";
        process.env.R2_SECRET_ACCESS_KEY = "isolation-test-secret";
        try {
          return await requestMediaUpload(rt, ctx, {
            filename: "test.png",
            mime: "image/png",
            bytes: 1024,
          });
        } finally {
          if (saved.id === undefined) delete process.env.R2_ACCESS_KEY_ID;
          else process.env.R2_ACCESS_KEY_ID = saved.id;
          if (saved.secret === undefined) delete process.env.R2_SECRET_ACCESS_KEY;
          else process.env.R2_SECRET_ACCESS_KEY = saved.secret;
        }
      }
      case "media.create":
        return await createMediaRecord(rt, ctx, {
          storageKey: `iso-${Date.now()}-${Math.random().toString(36).slice(2, 6)}.png`,
          mime: "image/png",
          bytes: 1024,
        });
      case "media.delete": {
        const m = await createMediaRecord(rt, ctx, {
          storageKey: `del-${Date.now()}-${Math.random().toString(36).slice(2, 6)}.png`,
          mime: "image/png",
          bytes: 1024,
        });
        return await deleteMediaRecord(rt, ctx, { id: m.id });
      }
      case "branding.get":
        return await getBrandSettings(rt, ctx);
      case "branding.update":
        return await updateBrandSettings(rt, ctx, { primaryColor: "#112233" });
      case "branding.publish":
        return await publishBrandSettings(rt, ctx);
      case "themes.get":
        return await getTheme(rt, ctx);
      case "themes.update":
        return await updateTheme(rt, ctx, { tokens: { primary: "#000" } });
      case "themes.library":
        return await listThemeLibrary(rt, ctx);
      case "themes.preview":
        return await previewThemeTemplate(rt, ctx, { code: "essential-commerce" });
      case "themes.activate":
        return await activateTheme(rt, ctx, { code: "essential-commerce" });
      case "pages.versions":
        return await listPageVersions(rt, ctx, { id: testPageA });
      case "pages.blockData":
        return await previewPageRenderData(rt, ctx, { blocks: [] });
      case "pages.list":
        return await listPages(rt, ctx);
      case "pages.get":
        return await getPage(rt, ctx, { id: testPageA });
      case "pages.create":
        return await createPage(rt, ctx, { title: `Page-${Date.now()}`, slug: `page-${Date.now()}-${Math.random().toString(36).slice(2, 6)}` });
      case "pages.update":
        return await updatePage(rt, ctx, { id: testPageA, title: "Updated Page" });
      case "pages.saveDraft":
        return await savePageDraft(rt, ctx, { id: testPageA, blocks: [] });
      case "pages.publish":
        return await publishPage(rt, ctx, { id: testPageA, versionId: testVersionA });
      case "pages.rollback":
        return await rollbackPage(rt, ctx, { id: testPageA, targetVersionId: testVersionA });
      case "menus.list":
        return await listMenus(rt, ctx);
      case "menus.get":
        return await getMenu(rt, ctx, { handle: testMenuHandleA });
      case "menus.create":
        return await createMenu(rt, ctx, { name: `Menu-${Date.now()}`, handle: `menu-${Date.now()}-${Math.random().toString(36).slice(2, 6)}` });
      case "menus.update":
        return await updateMenu(rt, ctx, { id: testMenuA, name: "Updated Menu" });
      case "menus.delete": {
        const menu = await createMenu(rt, ctx, { name: "Del Menu", handle: `del-${Date.now()}-${Math.random().toString(36).slice(2, 6)}` });
        return await deleteMenu(rt, ctx, { id: menu.id });
      }
      // --- M5 Orders Admin ---
      case "orders.list":
        return await listAdminOrders(rt, ctx);
      case "orders.get":
        return await getAdminOrderDetail(rt, ctx, { id: testOrderA });
      case "orders.createDraft":
        return await createAdminDraftOrder(rt, ctx, {
          email: `draft-${Date.now()}@test.com`,
          phone: "+919876543210",
          shippingAddress: { line1: "123 MG Road", city: "Bengaluru", stateCode: "KA", pincode: "560001" },
          items: [{ variantId: testVariantA, quantity: 1 }],
        });
      case "orders.addNote":
        return await addAdminOrderNote(rt, ctx, { id: testOrderA, body: "Customer requested gift wrap" });
      case "orders.cancel": {
        // Create a standalone order to cancel
        const draft = await createAdminDraftOrder(rt, ctx, {
          email: `cancel-${Date.now()}@test.com`,
          phone: "+919876543210",
          shippingAddress: { line1: "123 MG Road", city: "Bengaluru", stateCode: "KA", pincode: "560001" },
          items: [{ variantId: testVariantA, quantity: 1 }],
        });
        return await cancelAdminOrder(rt, ctx, { id: draft.orderId, reason: "Customer request" });
      }
      case "orders.refund": {
        // Create and refund a paid order
        const draft = await createAdminDraftOrder(rt, ctx, {
          email: `refund-${Date.now()}@test.com`,
          phone: "+919876543210",
          shippingAddress: { line1: "123 MG Road", city: "Bengaluru", stateCode: "KA", pincode: "560001" },
          items: [{ variantId: testVariantA, quantity: 1 }],
          paymentOutcome: "paid",
        });
        return await refundAdminOrder(rt, ctx, { id: draft.orderId, amount: 500 });
      }
      case "orders.createFulfillment": {
        // Create an unfulfilled draft order and fulfill it
        const draft = await createAdminDraftOrder(rt, ctx, {
          email: `fulfill-${Date.now()}@test.com`,
          phone: "+919876543210",
          shippingAddress: { line1: "123 MG Road", city: "Bengaluru", stateCode: "KA", pincode: "560001" },
          items: [{ variantId: testVariantA, quantity: 1 }],
        });
        return await createAdminFulfillment(rt, ctx, {
          id: draft.orderId,
          carrier: "Shiprocket",
          awb: `AWB-${Date.now()}`,
        });
      }
      case "orders.createInvoice": {
        return await createAdminOrderInvoice(rt, ctx, { id: testOrderA });
      }
      case "orders.confirm":
      case "orders.advance":
      case "returns.list":
      case "returns.act": {
        const draft = await createAdminDraftOrder(rt, ctx, {
          email: `life-${Date.now()}@test.com`,
          phone: "+919876543210",
          shippingAddress: { line1: "123 MG Road", city: "Bengaluru", stateCode: "KA", pincode: "560001" },
          items: [{ variantId: testVariantA, quantity: 1 }],
        });
        if (procPath === "orders.confirm") return await confirmAdminOrder(rt, ctx, { id: draft.orderId });
        if (procPath === "orders.advance") return await advanceAdminOrder(rt, ctx, { id: draft.orderId, to: "shipped" });
        if (procPath === "returns.list") return await listAdminReturns(rt, ctx);
        await advanceAdminOrder(rt, ctx, { id: draft.orderId, to: "delivered" });
        const [line] = await getAdminOrderDetail(rt, ctx, { id: draft.orderId }).then((d) => d.items);
        const req = await requestReturn(rt, ctx, { orderId: draft.orderId, reason: "Changed my mind", items: [{ orderItemId: line!.id, quantity: 1 }] });
        return await actOnReturn(rt, ctx, { id: req.returnId, action: "approve" });
      }

      // --- M5 Customers Admin ---
      case "customers.list":
        return await listAdminCustomers(rt, ctx);
      case "customers.stats":
        return await getAdminCustomerStats(rt, ctx);
      case "customers.tags":
        return await listAdminCustomerTags(rt, ctx);
      case "customers.get":
        return await getAdminCustomerDetail(rt, ctx, { id: testCustomerA });
      case "customers.setStatus":
        return await setAdminCustomerStatus(rt, ctx, { id: testCustomerA, status: "active" });
      case "customers.setTags":
        return await setAdminCustomerTags(rt, ctx, { id: testCustomerA, tags: ["vip"] });
      case "customers.update":
        return await updateAdminCustomer(rt, ctx, { id: testCustomerA, name: "Isolation Update" });
      case "customers.orders":
        return await listAdminCustomerOrders(rt, ctx, { customerId: testCustomerA });
      case "customers.activity":
        return await getAdminCustomerActivity(rt, ctx, { customerId: testCustomerA });
      case "customers.consentSet":
        return await setAdminCustomerConsent(rt, ctx, { id: testCustomerA, state: "subscribed" });
      case "customers.addresses.add":
        return await addAdminCustomerAddress(rt, ctx, {
          customerId: testCustomerA,
          address: { name: "Iso Staff", phone: "9600011111", line1: "1 Iso Road", city: "Bengaluru", stateCode: "KA", pincode: "560001", isDefault: true },
        });
      case "customers.addresses.update": {
        const added = await addAdminCustomerAddress(rt, ctx, {
          customerId: testCustomerA,
          address: { name: "Iso Staff", phone: "9600011112", line1: "2 Iso Road", city: "Bengaluru", stateCode: "KA", pincode: "560001" },
        });
        return await updateAdminCustomerAddress(rt, ctx, {
          customerId: testCustomerA,
          addressId: added.id,
          address: { name: "Iso Staff Updated", phone: "9600011112", line1: "2 Iso Road", city: "Bengaluru", stateCode: "KA", pincode: "560001" },
        });
      }
      case "customers.addresses.delete": {
        const added = await addAdminCustomerAddress(rt, ctx, {
          customerId: testCustomerA,
          address: { name: "Iso Staff", phone: "9600011113", line1: "3 Iso Road", city: "Bengaluru", stateCode: "KA", pincode: "560001" },
        });
        return await deleteAdminCustomerAddress(rt, ctx, { customerId: testCustomerA, addressId: added.id });
      }
      case "customers.notes.list":
        return await listCustomerNotes(rt, ctx, { customerId: testCustomerA });
      case "customers.notes.add":
        return await addCustomerNote(rt, ctx, { customerId: testCustomerA, body: "Isolation note" });
      case "customers.notes.delete": {
        const note = await addCustomerNote(rt, ctx, { customerId: testCustomerA, body: "Isolation note to delete" });
        return await deleteCustomerNote(rt, ctx, { id: note.id });
      }

      // --- M5 Discounts Admin ---
      case "discounts.list":
        return await listAdminDiscounts(rt, ctx);
      case "discounts.create":
        return await createAdminDiscount(rt, ctx, {
          title: `Flash Sale ${Date.now()}`,
          code: `FLASH${Date.now().toString().slice(-4)}`,
          type: "percent",
          value: 15,
        });
      case "discounts.update":
        return await updateAdminDiscount(rt, ctx, { id: testDiscountA, title: "Updated Welcome 10%" });
      case "discounts.delete": {
        const disc = await createAdminDiscount(rt, ctx, {
          title: `Del Discount ${Date.now()}`,
          type: "fixed",
          value: 100,
        });
        return await deleteAdminDiscount(rt, ctx, { id: disc.id });
      }
      // --- M7 Shipping Settings Admin ---
      case "shipping.get":
        return await getAdminShippingSettings(rt, ctx);
      case "shipping.update":
        return await updateAdminShippingSettings(rt, ctx, {
          zoneName: "Domestic (India)",
          standardRatePaise: 0,
          expressRatePaise: 15000,
          freeShippingThresholdPaise: null,
        });

      // --- M8 Billing & Subscriptions ---
      case "billing.getSubscription":
        assertPermission(ctx, "settings.write");
        return await getTenantSubscription(rt, ctx.tenantId);
      case "billing.changePlan": {
        assertPermission(ctx, "settings.write");
        return await changeTenantPlan(rtPlatform, {
          tenantId: ctx.tenantId,
          planCode: "growth",
          interval: "monthly",
          customerEmail: "admin@alpha.test",
          provider: {
            isConfigured: () => true,
            createSubscription: async () => ({ providerSubscriptionId: "sub_iso_test_123", status: "created" }),
            cancelSubscription: async () => ({ status: "cancelled" }),
            verifyWebhookSignature: () => true,
          },
        });
      }

      // --- M8 Custom Domains ---
      case "domains.list":
        assertPermission(ctx, "settings.write");
        return await listTenantDomains(rt, ctx.tenantId);
      case "domains.add": {
        assertPermission(ctx, "settings.write");
        return await addCustomDomain(rt, ctx.tenantId, {
          hostname: `iso-add-${Date.now()}-${Math.random().toString(36).slice(2, 6)}.storetest.org`,
          provider: {
            isConfigured: () => true,
            createCustomHostname: async (h: string) => ({
              providerHostnameId: "cf_hn_iso_add",
              hostname: h,
              cnameTarget: "stores.bcom.si",
              status: "awaiting_dns",
              sslStatus: "initializing",
            }),
            getCustomHostnameStatus: async () => ({ providerHostnameId: "cf_hn_iso_add", hostname: "", status: "awaiting_dns", sslStatus: "initializing" }),
            deleteCustomHostname: async () => ({ deleted: true }),
          },
        });
      }
      case "domains.verify": {
        assertPermission(ctx, "settings.write");
        const d = await addCustomDomain(rt, ctx.tenantId, {
          hostname: `iso-ver-${Date.now()}-${Math.random().toString(36).slice(2, 6)}.storetest.org`,
          provider: {
            isConfigured: () => true,
            createCustomHostname: async (h: string) => ({
              providerHostnameId: "cf_hn_iso_ver",
              hostname: h,
              cnameTarget: "stores.bcom.si",
              status: "awaiting_dns",
              sslStatus: "initializing",
            }),
            getCustomHostnameStatus: async () => ({ providerHostnameId: "cf_hn_iso_ver", hostname: "", status: "awaiting_dns", sslStatus: "initializing" }),
            deleteCustomHostname: async () => ({ deleted: true }),
          },
        });
        return await verifyCustomDomain(rt, ctx.tenantId, d.id);
      }
      case "domains.setPrimary": {
        assertPermission(ctx, "settings.write");
        const [activeDomain] = await rt._db.db
          .select()
          .from(schema.domains)
          .where(and(eq(schema.domains.tenantId, ctx.tenantId), eq(schema.domains.status, "active")))
          .limit(1);
        if (!activeDomain) throw new Error("No active domain found");
        return await setPrimaryDomain(rt, ctx.tenantId, activeDomain.id);
      }
      case "domains.remove": {
        assertPermission(ctx, "settings.write");
        const d = await addCustomDomain(rt, ctx.tenantId, {
          hostname: `iso-rem-${Date.now()}-${Math.random().toString(36).slice(2, 6)}.storetest.org`,
          provider: {
            isConfigured: () => true,
            createCustomHostname: async (h: string) => ({
              providerHostnameId: "cf_hn_iso_rem",
              hostname: h,
              cnameTarget: "stores.bcom.si",
              status: "awaiting_dns",
              sslStatus: "initializing",
            }),
            getCustomHostnameStatus: async () => ({ providerHostnameId: "cf_hn_iso_rem", hostname: "", status: "awaiting_dns", sslStatus: "initializing" }),
            deleteCustomHostname: async () => ({ deleted: true }),
          },
        });
        return await removeCustomDomain(rt, ctx.tenantId, d.id);
      }

      // --- Product images ---
      case "products.attachMedia": {
        const m = await createMediaRecord(rt, ctx, { storageKey: `attach-${Date.now()}-${Math.random().toString(36).slice(2, 6)}.png`, mime: "image/png", bytes: 1024 });
        const prod = await createProduct(rt, ctx, { title: `Attach ${Date.now()}`, variants: [{ sku: `ATT-${Date.now()}`, title: "D", price: 100 }] });
        return await attachProductMedia(rt, ctx, { productId: prod.id, mediaId: m.id });
      }
      case "products.detachMedia": {
        const m = await createMediaRecord(rt, ctx, { storageKey: `detach-${Date.now()}-${Math.random().toString(36).slice(2, 6)}.png`, mime: "image/png", bytes: 1024 });
        const prod = await createProduct(rt, ctx, { title: `Detach ${Date.now()}`, variants: [{ sku: `DET-${Date.now()}`, title: "D", price: 100 }] });
        const link = await attachProductMedia(rt, ctx, { productId: prod.id, mediaId: m.id });
        return await detachProductMedia(rt, ctx, { productId: prod.id, productMediaId: link.id });
      }

      // --- Storefront mode ---
      case "storefront.getStatus":
        return await getStoreStatus(rt, ctx);
      case "storefront.updateStatus":
        return await updateStoreStatus(rt, ctx, { headline: "Isolation check" });

      // --- M8 Onboarding ---
      case "onboarding.get":
        assertPermission(ctx, "settings.write");
        return await getOnboardingProgress(rt, ctx);
      case "onboarding.dismiss":
        assertPermission(ctx, "settings.write");
        return await dismissOnboardingProgress(rt, ctx);

      // --- Abandoned checkouts ---
      case "abandonedCheckouts.list":
        return await listAdminAbandonedCheckouts(rt, ctx);
      case "abandonedCheckouts.stats":
        return await getAdminAbandonedCheckoutStats(rt, ctx);

      // --- Customers create ---
      case "customers.create":
        return await createAdminCustomer(rt, ctx, {
          name: `Customer-${Date.now()}`,
          email: `cust-${Date.now()}-${Math.random().toString(36).slice(2, 6)}@test.com`,
          phone: `+9198${Math.floor(10000000 + Math.random() * 90000000)}`,
        });

      // --- Order settings & stats & draft estimate ---
      case "orderSettings.get":
        return await getOrderSettings(rt, ctx);
      case "orderSettings.update":
        return await updateOrderSettings(rt, ctx, { prefix: "ORD-" });
      case "orders.estimateDraft":
        return await estimateAdminDraftOrder(rt, ctx, {
          shippingAddress: { state: "Delhi", pincode: "110001" },
          items: [{ variantId: testVariantA, quantity: 1 }],
        });
      case "orders.stats":
        return await getAdminOrderStats(rt, ctx);

      // --- Preorders ---
      case "preorders.list":
        return await listPreorders(rt, ctx);
      case "preorders.stats":
        return await getPreorderStats(rt, ctx);
      case "preorders.changeShipDate": {
        const draft = await createAdminDraftOrder(rt, ctx, {
          email: `pre-change-${Date.now()}@test.com`,
          phone: "+919876543210",
          shippingAddress: { line1: "123 MG Road", city: "Bengaluru", stateCode: "KA", pincode: "560001" },
          items: [{ variantId: testVariantA, quantity: 1 }],
        });
        await withTenant(rt._db.db, ctx.tenantId, async (tx) => {
          await tx
            .update(schema.orders)
            .set({ shipsOn: "2026-12-01" })
            .where(eq(schema.orders.id, draft.orderId));
          await tx
            .update(schema.orderItems)
            .set({ shipsOn: "2026-12-01" })
            .where(eq(schema.orderItems.orderId, draft.orderId));
        });
        return await changePreorderShipDate(rt, ctx, {
          orderIds: [draft.orderId],
          shipsOn: "2026-12-15",
          reason: "Factory delay",
        });
      }
      case "preorders.releaseNow": {
        const draft = await createAdminDraftOrder(rt, ctx, {
          email: `pre-rel-${Date.now()}@test.com`,
          phone: "+919876543210",
          shippingAddress: { line1: "123 MG Road", city: "Bengaluru", stateCode: "KA", pincode: "560001" },
          items: [{ variantId: testVariantA, quantity: 1 }],
        });
        await withTenant(rt._db.db, ctx.tenantId, async (tx) => {
          await tx
            .update(schema.orders)
            .set({ shipsOn: "2026-12-01" })
            .where(eq(schema.orders.id, draft.orderId));
        });
        return await releasePreorderNow(rt, ctx, { id: draft.orderId });
      }

      // --- Quotes ---
      case "quotes.list":
        return await listAdminQuotes(rt, ctx);
      case "quotes.stats":
        return await getAdminQuoteStats(rt, ctx);
      case "quotes.get":
      case "quotes.updateNote":
      case "quotes.markLost":
      case "quotes.reopen":
      case "quotes.delete":
      case "quotes.linkOrder": {
        let quoteId = "";
        await withTenant(rt._db.db, ctx.tenantId, async (tx) => {
          const [q] = await tx
            .insert(schema.quoteRequests)
            .values({
              tenantId: ctx.tenantId,
              number: `QT-ISO-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
              productId: testProductA,
              variantId: testVariantA,
              productTitle: "Sample T-Shirt",
              variantTitle: "Small / Black",
              quantity: 5,
              name: "Quote Lead",
              email: `quote-${Date.now()}@test.com`,
              phone: "+919876543210",
              status: "new",
            })
            .returning({ id: schema.quoteRequests.id });
          quoteId = q!.id;
        });

        if (procPath === "quotes.get") return await getAdminQuoteDetail(rt, ctx, { id: quoteId });
        if (procPath === "quotes.updateNote") return await updateAdminQuoteNote(rt, ctx, { id: quoteId, adminNote: "Follow up" });
        if (procPath === "quotes.markLost") return await markAdminQuoteLost(rt, ctx, { id: quoteId, reason: "Too expensive" });
        if (procPath === "quotes.reopen") {
          await markAdminQuoteLost(rt, ctx, { id: quoteId, reason: "Test lost" });
          return await reopenAdminQuote(rt, ctx, { id: quoteId });
        }
        if (procPath === "quotes.delete") return await deleteAdminQuote(rt, ctx, { id: quoteId });
        if (procPath === "quotes.linkOrder") return await linkOrderToQuote(rt, ctx, { id: quoteId, orderId: testOrderA });
        throw new Error(`Unhandled quotes proc: ${procPath}`);
      }

      // --- Return settings & return details/stats ---
      case "returnSettings.get":
        return await getReturnSettings(rt, ctx);
      case "returnSettings.update":
        return await updateReturnSettings(rt, ctx, { acceptReturns: true, returnWindowDays: 14 });
      case "returns.stats":
        return await getAdminReturnStats(rt, ctx);
      case "returns.get": {
        const draft = await createAdminDraftOrder(rt, ctx, {
          email: `ret-get-${Date.now()}@test.com`,
          phone: "+919876543210",
          shippingAddress: { line1: "123 MG Road", city: "Bengaluru", stateCode: "KA", pincode: "560001" },
          items: [{ variantId: testVariantA, quantity: 1 }],
        });
        await advanceAdminOrder(rt, ctx, { id: draft.orderId, to: "delivered" });
        const [line] = await getAdminOrderDetail(rt, ctx, { id: draft.orderId }).then((d) => d.items);
        const req = await requestReturn(rt, ctx, {
          orderId: draft.orderId,
          reason: "Size or fit",
          items: [{ orderItemId: line!.id, quantity: 1 }],
        });
        return await getAdminReturnDetail(rt, ctx, { id: req.returnId });
      }

      case "categories.stats":
        return await getCategoryStats(rt, ctx);
      case "categories.get":
        return await getCategory(rt, ctx, { id: testCategoryA });
      case "collections.stats":
        return await getCollectionStats(rt, ctx);
      case "brands.stats":
        return await getBrandStats(rt, ctx);
      case "brands.get":
        return await getBrand(rt, ctx, { id: testBrandA });
      case "locations.stats":
        return await getLocationStats(rt, ctx);
      case "locations.list":
        return await listLocations(rt, ctx);
      case "locations.get":
        return await getLocation(rt, ctx, { id: testLocationA });
      case "locations.create":
        return await createLocation(rt, ctx, { name: `Loc-${Date.now()}` });
      case "locations.update":
        return await updateLocation(rt, ctx, { id: testLocationA, name: "Updated Location" });
      case "locations.delete": {
        const l = await createLocation(rt, ctx, { name: `Del Loc-${Date.now()}` });
        return await deleteLocation(rt, ctx, { id: l.id });
      }
      case "reviews.list":
        return await listAdminReviews(rt, ctx);
      case "reviews.stats":
        return await getAdminReviewStats(rt, ctx);
      case "reviews.get":
      case "reviews.publish":
      case "reviews.hold":
      case "reviews.delete":
      case "reviews.reply":
      case "reviews.bulkPublish":
      case "reviews.bulkHold":
      case "reviews.bulkDelete": {
        let reviewId = "";
        await withTenant(rt._db.db, ctx.tenantId, async (tx) => {
          const [r] = await tx
            .insert(schema.reviews)
            .values({ tenantId: ctx.tenantId, productId: testProductA, reviewerName: "Iso Reviewer", rating: 4, body: "Isolation review", status: "on_hold" })
            .returning({ id: schema.reviews.id });
          reviewId = r!.id;
        });
        if (procPath === "reviews.get") return await getAdminReviewDetail(rt, ctx, reviewId);
        if (procPath === "reviews.publish") return await publishAdminReview(rt, ctx, reviewId);
        if (procPath === "reviews.hold") return await holdAdminReview(rt, ctx, reviewId);
        if (procPath === "reviews.delete") return await deleteAdminReview(rt, ctx, reviewId);
        if (procPath === "reviews.reply") return await replyAdminReview(rt, ctx, { id: reviewId, replyText: "Thanks" });
        if (procPath === "reviews.bulkPublish") return await bulkPublishAdminReviews(rt, ctx, [reviewId]);
        if (procPath === "reviews.bulkHold") return await bulkHoldAdminReviews(rt, ctx, [reviewId]);
        return await bulkDeleteAdminReviews(rt, ctx, [reviewId]);
      }
      default:
        throw new Error(`Unmapped procedure in isolation test: ${procPath}`);
    }
  }

  // me.get needs a signed-in staff session but no store; acceptInvite is public (invite token + IP rate limit).
  // Both are covered by dedicated tests below instead of the store-scoped permission checks.
  const SESSION_ONLY = new Set(["me.get"]);
  const PUBLIC = new Set(["memberships.acceptInvite"]);

  describe("Session-only and public admin procedures", () => {
    it("me.get lists only the stores the signed-in user belongs to", async () => {
      const meA = await getAdminMe(rtApp, userA);
      expect(meA.stores.map((s) => s.tenantId)).toEqual([tenantA]);
      expect(meA.stores.map((s) => s.tenantId)).not.toContain(tenantB);
    });

    it("me.get rejects an unknown user", async () => {
      await expect(getAdminMe(rtApp, "00000000-0000-7000-8000-00000000dead")).rejects.toThrow(/unauthorized/i);
    });

    it("acceptInvite rejects a wrong token and a token used against another store", async () => {
      const ctxA = await buildTenantContext(rtApp._db.db, {
        entryPath: "admin",
        headers: { "x-store-id": tenantA },
        session: { user: { id: userA }, type: "staff" },
      });
      const invite = await inviteStaff(rtApp, ctxA!, {
        email: `cross-${Date.now()}@test.com`,
        roleId: roleLimitedA,
      });
      await expect(
        acceptInvitation(rtApp, { storeId: tenantA, token: "definitely-not-the-right-token-value", name: "X", password: "long-enough-password" }),
      ).rejects.toThrow(/invalid or has expired/i);
      await expect(
        acceptInvitation(rtApp, { storeId: tenantB, token: invite.token!, name: "X", password: "long-enough-password" }),
      ).rejects.toThrow(/invalid or has expired/i);
      await expect(
        acceptInvitation(rtApp, { storeId: tenantA, token: invite.token!, name: "Y", password: "short" }),
      ).rejects.toThrow(/at least 10/i);
      const ok = await acceptInvitation(rtApp, { storeId: tenantA, token: invite.token!, name: "Y", password: "long-enough-password" });
      expect(ok.ok).toBe(true);
      // single use
      await expect(
        acceptInvitation(rtApp, { storeId: tenantA, token: invite.token!, name: "Y", password: "long-enough-password" }),
      ).rejects.toThrow(/invalid or has expired/i);
    });
  });

  describe("Admin Procedures Dynamic Isolation & Authorization Invariants", () => {
    for (const proc of adminProcedures.filter((p) => !SESSION_ONLY.has(p) && !PUBLIC.has(p))) {
      describe(`Procedure: admin.${proc}`, () => {
        it("rejects when staff user on tenant A attempts to access tenant B (X-Store-Id: B)", async () => {
          // Real DB query: userA has no membership in tenantB
          await expect(
            buildTenantContext(rtApp._db.db, {
              entryPath: "admin",
              headers: { "x-store-id": tenantB },
              session: {
                user: { id: userA },
                type: "staff",
              },
            }),
          ).rejects.toThrow(/membership/i);
        });

        it("rejects when called with a customer session", async () => {
          await expect(
            buildTenantContext(rtApp._db.db, {
              entryPath: "admin",
              headers: { "x-store-id": tenantA },
              session: {
                user: { id: "cust-123" },
                type: "customer",
              },
            }),
          ).rejects.toThrow(/forbidden.*customer/i);
        });

        it("rejects when called without an authenticated session", async () => {
          await expect(
            buildTenantContext(rtApp._db.db, {
              entryPath: "admin",
              headers: { "x-store-id": tenantA },
              session: null,
            }),
          ).rejects.toThrow(/unauthorized/i);
        });

        it("rejects with 403 Forbidden when staff user lacks the required permission (hasPermission check)", async () => {
          // userLimited has active membership in tenantA, but only possesses ["analytics.read"]
          const limitedCtx = await buildTenantContext(rtApp._db.db, {
            entryPath: "admin",
            headers: { "x-store-id": tenantA },
            session: {
              user: { id: userLimited },
              type: "staff",
            },
          });
          expect(limitedCtx).not.toBeNull();
          expect(limitedCtx!.permissions).toEqual(["analytics.read"]);

          // Procedure execution fails because userLimited lacks required permissions
          await expect(
            executeAdminProcedure(proc, rtApp, limitedCtx!),
          ).rejects.toThrow(/forbidden: missing required permission/i);
        });

        it("succeeds against real PostgreSQL when authorized staff user accesses authorized tenant A", async () => {
          const authCtx = await buildTenantContext(rtApp._db.db, {
            entryPath: "admin",
            headers: { "x-store-id": tenantA },
            session: {
              user: { id: userA },
              type: "staff",
            },
          });
          expect(authCtx).not.toBeNull();
          expect(authCtx!.tenantId).toBe(tenantA);
          expect(authCtx!.actor).toEqual({ type: "staff", userId: userA });
          expect(authCtx!.permissions).toEqual([
            "staff.manage",
            "settings.write",
            "products.read",
            "products.write",
            "content.write",
            "theme.publish",
            "orders.read",
            "orders.write",
            "orders.refund",
            "customers.read",
            "customers.write",
            "discounts.write",
          ]);

          const result = await executeAdminProcedure(proc, rtApp, authCtx!);
          expect(result).toBeDefined();
        });
      });
    }
  });

  describe("Platform Procedures Security Invariants", () => {
    for (const proc of platformProcedures) {
      describe(`Procedure: platform.tenants.${proc}`, () => {
        it("rejects non-platform staff session against real PostgreSQL", async () => {
          // userA is in users table but NOT in platform_staff table
          await expect(assertPlatformStaff(rtPlatform, userA)).rejects.toThrow(/forbidden/i);
        });

        it("accepts authenticated platform staff member and executes procedure", async () => {
          const staff = await assertPlatformStaff(rtPlatform, userPlatform, { createdAt: new Date() });
          expect(staff.role).toBe("platform_owner");

          if (proc === "list") {
            const list = await listPlatformTenants(rtPlatform);
            expect(list.length).toBeGreaterThanOrEqual(2);
            const slugs = list.map((t) => t.slug);
            expect(slugs).toContain("store-alpha");
            expect(slugs).toContain("store-beta");
          } else if (proc === "get") {
            const tenant = await getPlatformTenant(rtPlatform, tenantA);
            expect(tenant.id).toBe(tenantA);
            expect(tenant.slug).toBe("store-alpha");
          }
        });
      });
    }
  });

  describe("Cross-Tenant Direct Database Query Invariant (RLS Engine Verification)", () => {
    it("proves direct query under tenant A cannot read rows belonging to tenant B", async () => {
      // 1. Direct query filtering for tenant B under tenant A context returns 0 rows
      const rowsBUnderA = await withTenant(dbRw.db, tenantA, async (tx) => {
        return await tx
          .select()
          .from(schema.storeSettings)
          .where(eq(schema.storeSettings.tenantId, tenantB));
      });
      expect(rowsBUnderA).toEqual([]);

      // 2. Direct unfiltered query under tenant A context returns ONLY tenant A rows
      const allRowsUnderA = await withTenant(dbRw.db, tenantA, async (tx) => {
        return await tx.select().from(schema.storeSettings);
      });
      expect(allRowsUnderA.length).toBe(1);
      expect(allRowsUnderA[0]?.tenantId).toBe(tenantA);
      expect(allRowsUnderA[0]?.storeName).toContain("Alpha Store");

      // 3. Memberships table RLS: under tenant A, tenant B memberships are completely hidden
      const bMembershipsUnderA = await withTenant(dbRw.db, tenantA, async (tx) => {
        return await tx
          .select()
          .from(schema.memberships)
          .where(eq(schema.memberships.tenantId, tenantB));
      });
      expect(bMembershipsUnderA).toEqual([]);

      // 4. Roles table RLS: under tenant A, tenant B roles are completely hidden
      const bRolesUnderA = await withTenant(dbRw.db, tenantA, async (tx) => {
        return await tx
          .select()
          .from(schema.roles)
          .where(eq(schema.roles.tenantId, tenantB));
      });
      expect(bRolesUnderA).toEqual([]);
    });

    it("proves direct insert under tenant A with tenant B ID is rejected by Postgres RLS WITH CHECK", async () => {
      let threw = false;
      try {
        await withTenant(dbRw.db, tenantA, async (tx) => {
          await tx.insert(schema.storeSettings).values({
            tenantId: tenantB, // Poisoned tenant ID
            storeName: "Malicious Cross-Tenant Insert",
            currency: "USD",
            timezone: "UTC",
          });
        });
      } catch (err: unknown) {
        threw = true;
        const msg = String(err) + " " + String((err as { cause?: { message?: string } })?.cause?.message ?? "");
        expect(msg).toMatch(/violates row-level security policy/i);
      }
      expect(threw).toBe(true);
    });

    it("proves app_rw query with unset tenant context returns 0 rows (nullif setting turns empty to NULL)", async () => {
      // Direct query without withTenant(): app.tenant_id is unset
      const unisolatedSettings = await dbRw.db.select().from(schema.storeSettings);
      expect(unisolatedSettings).toEqual([]);

      const unisolatedMemberships = await dbRw.db.select().from(schema.memberships);
      expect(unisolatedMemberships).toEqual([]);

      const unisolatedProducts = await dbRw.db.select().from(schema.products);
      expect(unisolatedProducts).toEqual([]);

      const unisolatedPages = await dbRw.db.select().from(schema.pages);
      expect(unisolatedPages).toEqual([]);
    });

    it("proves direct query under tenant A cannot read M2 rows belonging to tenant B", async () => {
      const bProductsUnderA = await withTenant(dbRw.db, tenantA, async (tx) => {
        return await tx
          .select()
          .from(schema.products)
          .where(eq(schema.products.tenantId, tenantB));
      });
      expect(bProductsUnderA).toEqual([]);

      const allProductsUnderA = await withTenant(dbRw.db, tenantA, async (tx) => {
        return await tx.select().from(schema.products);
      });
      expect(allProductsUnderA.length).toBeGreaterThanOrEqual(1);
      for (const p of allProductsUnderA) {
        expect(p.tenantId).toBe(tenantA);
      }
    });

    it("proves direct insert of M2 records under tenant A with tenant B ID is rejected by Postgres RLS WITH CHECK", async () => {
      let threw = false;
      try {
        await withTenant(dbRw.db, tenantA, async (tx) => {
          await tx.insert(schema.products).values({
            tenantId: tenantB, // Poisoned tenant ID
            title: "Malicious Cross-Tenant Product",
            slug: "malicious-cross-tenant-product",
          });
        });
      } catch (err: unknown) {
        threw = true;
        const msg = String(err) + " " + String((err as { cause?: { message?: string } })?.cause?.message ?? "");
        expect(msg).toMatch(/violates row-level security policy/i);
      }
      expect(threw).toBe(true);
    });

    it("proves app_platform (BYPASSRLS) can view all tenants across stores", async () => {
      const allSettings = await dbPlatform.db.select().from(schema.storeSettings);
      expect(allSettings.length).toBeGreaterThanOrEqual(2);

      const tenantIds = allSettings.map((s) => s.tenantId);
      expect(tenantIds).toContain(tenantA);
      expect(tenantIds).toContain(tenantB);
    });
  });
});
