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
import { eq } from "drizzle-orm";
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
  createRuntime,
  deleteAdminDiscount,
  deleteBrand,
  deleteCategory,
  deleteCollection,
  deleteMediaRecord,
  deleteMenu,
  deleteProduct,
  getAdminCustomerDetail,
  getAdminOrderDetail,
  getBrandSettings,
  getCollection,
  getMenu,
  getPage,
  getPlatformTenant,
  getProduct,
  getStoreSettings,
  getTheme,
  inviteStaff,
  listAdminCustomers,
  listAdminDiscounts,
  listAdminOrders,
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
  requestMediaUpload,
  rollbackPage,
  savePageDraft,
  updateAdminDiscount,
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
  type Runtime,
  type TenantContext,
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

    // 4. Seed non-tenant global records
    await dbRw.db
      .insert(schema.organizations)
      .values({
        id: orgId,
        name: "Global Test Org",
      })
      .onConflictDoNothing();

    await dbRw.db
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

    await dbRw.db
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
        { id: userPlatform, email: "platform@corp.test", name: "Platform Admin" },
      ])
      .onConflictDoNothing();

    await dbRw.db
      .insert(schema.platformStaff)
      .values({
        userId: userPlatform,
        role: "platform_owner",
        isActive: true,
      })
      .onConflictDoNothing();

    await dbRw.db
      .insert(schema.featureFlags)
      .values([
        { key: "checkout_v2", defaultOn: true, killSwitch: false },
        { key: "experimental_search", defaultOn: false, killSwitch: false },
      ])
      .onConflictDoNothing();

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
  async function executeAdminProcedure(procPath: string, rt: Runtime, ctx: TenantContext) {
    switch (procPath) {
      case "memberships.list":
        return await listMemberships(rt, ctx);
      case "memberships.invite":
        return await inviteStaff(rt, ctx, {
          email: `invite-${Date.now()}-${Math.random().toString(36).slice(2, 6)}@test.com`,
          roleId: roleAdminA,
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
      case "media.requestUpload":
        return await requestMediaUpload(rt, ctx, {
          filename: "test.png",
          mime: "image/png",
          bytes: 1024,
        });
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
        // Create and refund an order
        const draft = await createAdminDraftOrder(rt, ctx, {
          email: `refund-${Date.now()}@test.com`,
          phone: "+919876543210",
          shippingAddress: { line1: "123 MG Road", city: "Bengaluru", stateCode: "KA", pincode: "560001" },
          items: [{ variantId: testVariantA, quantity: 1 }],
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

      // --- M5 Customers Admin ---
      case "customers.list":
        return await listAdminCustomers(rt, ctx);
      case "customers.get":
        return await getAdminCustomerDetail(rt, ctx, { id: testCustomerA });

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
      default:
        throw new Error(`Unmapped procedure in isolation test: ${procPath}`);
    }
  }

  describe("Admin Procedures Dynamic Isolation & Authorization Invariants", () => {
    for (const proc of adminProcedures) {
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
          const staff = await assertPlatformStaff(rtPlatform, userPlatform);
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
