/**
 * Integration Test: Real PostgreSQL 18 Storefront Integration & Tenant Isolation Suite.
 * Runs against a real PostgreSQL 18 instance (via Testcontainers or TEST_DATABASE_URL_SUPERUSER).
 *
 * Verifies across at least TWO distinct tenants (tenantA and tenantB):
 * 1. Store Status & Mode Isolation:
 *    - Setting tenantA to maintenance does not affect tenantB (live).
 *    - Evaluating storefront access for tenantA host returns mode: maintenance, while tenantB returns mode: live.
 *    - Bypass token generated for tenantA allows access to tenantA but fails on tenantB.
 *    - Store password set for tenantA cannot unlock tenantB.
 * 2. Catalog & Search Isolation:
 *    - Products, collections, categories created in tenantA are never returned in tenantB catalog listings or search queries.
 *    - Trigram and FTS search for a product title belonging to tenantA returns 0 results when executed under tenantB.
 *    - Price sorting (price_asc, price_desc) correctly queries variant prices only for the scoped tenant.
 *    - search_queries logged in tenantA are isolated to tenantA.
 * 3. Cart & Line Items Isolation:
 *    - Creating a cart in tenantA with token cartTokA cannot be retrieved or mutated under tenantB context.
 *    - Adding items to cartTokA in tenantA does not leak to tenantB.
 *    - RLS on carts and cart_items enforces that cross-tenant queries return 0 rows under PostgreSQL RLS roles (app_user / withTenant).
 * 4. SEO & Structured Data Isolation:
 *    - getStorefrontSeoSettings returns tenantA custom settings without affecting tenantB.
 *    - getStorefrontSitemapUrls returns only URLs belonging to that tenant.
 * 5. Newsletter Subscribers Isolation:
 *    - Subscribing the same email user@example.com in tenantA and tenantB succeeds independently (unique constraint is (tenant_id, email)).
 *    - Subscribing in tenantA does not appear in tenantB subscribers list.
 * 6. Block Document Render Pipeline:
 *    - Render page block document verifying migrateBlockDocument + validateBlockDocument upgrades and renders safely.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { eq } from "drizzle-orm";
import {
  createDb,
  schema,
  withTenant,
  type DbHandle,
} from "@bs/db";
import { bootstrapRoles } from "@bs/db/bootstrap";
import { runMigrations } from "@bs/db/migrate";
import {
  migrateBlockDocument,
  validateBlockDocument,
  renderBlockDocument,
  registerBlockMigration,
  clearBlockMigrations,
  type BlockDocument,
} from "@bs/blocks";
import {
  createRuntime,
  evaluateStorefrontAccess,
  verifyStorefrontPassword,
  hashStorePassword,
  hashBypassToken,
  getStorefrontProduct,
  getStorefrontCollection,
  getStorefrontCategory,
  searchStorefrontProducts,
  getOrCreateCart,
  addToCart,
  updateCartItemQuantity,
  clearCart,
  subscribeNewsletter,
  getStorefrontSeoSettings,
  getStorefrontSitemapUrls,
  generateRobotsTxt,
  generateSitemapXml,
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

describe("Storefront Integration & Tenant Isolation Suite (Real PostgreSQL 18)", () => {
  // All IDs in this file use the 0199a0f1-... prefix (isolation.int.test.ts uses 0199a000-...):
  // in CI every *.int.test.ts file shares one Postgres service container
  // (TEST_DATABASE_URL_SUPERUSER) rather than a per-file Testcontainers instance, so hardcoded
  // fixture IDs must not collide across files. Give any new *.int.test.ts file its own prefix too.
  const orgId = "0199a0f1-0000-7000-8000-0000000000f1";
  const tenantA = "0199a0f1-0000-7000-8000-000000000010";
  const tenantB = "0199a0f1-0000-7000-8000-000000000020";

  const hostA = "store-alpha.test";
  const hostB = "store-beta.test";

  const bypassTokenA = "bypass-secret-alpha-12345";
  const bypassTokenB = "bypass-secret-beta-67890";
  const passwordA = "AlphaStorePassword!2026";
  const passwordB = "BetaStorePassword!2026";

  const userA = "0199a0f1-0000-7000-8000-000000000100";
  const userB = "0199a0f1-0000-7000-8000-000000000200";

  // Product & Catalog IDs for Tenant A
  const productA1 = "0199a0f1-0000-7000-8000-000000000a01";
  const variantA1Cheap = "0199a0f1-0000-7000-8000-000000000a02";
  const productA2 = "0199a0f1-0000-7000-8000-000000000a03";
  const variantA2Expensive = "0199a0f1-0000-7000-8000-000000000a04";
  const collectionA = "0199a0f1-0000-7000-8000-000000000a05";
  const categoryA = "0199a0f1-0000-7000-8000-000000000a06";
  const pageA = "0199a0f1-0000-7000-8000-000000000a07";

  // Product & Catalog IDs for Tenant B
  const productB1 = "0199a0f1-0000-7000-8000-000000000b01";
  const variantB1 = "0199a0f1-0000-7000-8000-000000000b02";
  const collectionB = "0199a0f1-0000-7000-8000-000000000b05";
  const categoryB = "0199a0f1-0000-7000-8000-000000000b06";
  const pageB = "0199a0f1-0000-7000-8000-000000000b07";

  let rtApp: Runtime;
  let dbRw: DbHandle;

  let ctxA: TenantContext;
  let ctxB: TenantContext;

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
      DELETE FROM users WHERE id IN ('${userA}', '${userB}');
    `);
    await pgClient.query("SET session_replication_role = 'origin'");
    await pgClient.end();

    // 3. Connect runtime and db handle as app_rw
    rtApp = createRuntime({ service: "web", databaseUrl: as("app_rw", PW.rw), poolMax: 5 });
    dbRw = createDb(as("app_rw", PW.rw));

    ctxA = {
      tenantId: tenantA,
      storeStatus: "live",
      actor: { type: "anonymous" },
      roles: [],
      permissions: [],
      requestId: "req-alpha-001",
    };
    ctxB = {
      tenantId: tenantB,
      storeStatus: "live",
      actor: { type: "anonymous" },
      roles: [],
      permissions: [],
      requestId: "req-beta-001",
    };

    // 4. Seed Organization, Tenants, and Domains. Creating organizations and tenants is a platform/self-service act:
    // the tenant runtime (app_rw) is deliberately not allowed to, so this fixture uses the superuser.
    const dbSuper = createDb(superUrl, { max: 1 });
    await dbSuper.db.insert(schema.organizations).values({
      id: orgId,
      name: "Storefront Test Org",
    });

    await dbSuper.db.insert(schema.tenants).values([
      {
        id: tenantA,
        slug: "storefront-alpha",
        name: "Store Alpha",
        organizationId: orgId,
        status: "active",
      },
      {
        id: tenantB,
        slug: "storefront-beta",
        name: "Store Beta",
        organizationId: orgId,
        status: "active",
      },
    ]);

    await dbSuper.db.insert(schema.domains).values([
      {
        tenantId: tenantA,
        hostname: hostA,
        isPrimary: true,
        status: "active",
      },
      {
        tenantId: tenantB,
        hostname: hostB,
        isPrimary: true,
        status: "active",
      },
    ]);

    await dbSuper.db.insert(schema.users).values([
      { id: userA, email: "admin@alpha.test", name: "Admin Alpha" },
      { id: userB, email: "admin@beta.test", name: "Admin Beta" },
    ]);
    await dbSuper.close();

    // 5. Seed Tenant A initial store settings and lifecycle status
    await withTenant(dbRw.db, tenantA, async (tx) => {
      await tx.insert(schema.storeSettings).values({
        tenantId: tenantA,
        storeName: "Alpha Storefront",
        currency: "INR",
        timezone: "Asia/Kolkata",
      });

      await tx.insert(schema.storeStatus).values({
        tenantId: tenantA,
        mode: "live",
        headline: "Welcome to Alpha Store",
        bypassTokenHash: hashBypassToken(bypassTokenA),
        passwordHash: await hashStorePassword(passwordA),
        retryAfterMinutes: 30,
      });

      await tx.insert(schema.seoSettings).values({
        tenantId: tenantA,
        indexingEnabled: true,
        titleTemplate: "%s | Alpha Official",
        defaultMetaDescription: "Welcome to Alpha Storefront official catalog",
        twitterHandle: "@storealpha",
      });

      // Categories and Collections
      await tx.insert(schema.categories).values({
        id: categoryA,
        tenantId: tenantA,
        name: "Alpha Keyboards",
        slug: "alpha-keyboards",
        position: 1,
      });

      await tx.insert(schema.collections).values({
        id: collectionA,
        tenantId: tenantA,
        title: "Alpha Featured Collection",
        slug: "alpha-featured",
        published: true,
        sortOrder: "manual",
      });

      // Products & Variants (A1: Cheap, A2: Expensive)
      await tx.insert(schema.products).values([
        {
          id: productA1,
          tenantId: tenantA,
          title: "Alpha Mechanical Switch Pro",
          slug: "alpha-mechanical-switch-pro",
          status: "published",
          shortDescription: "Ultra responsive mechanical switches",
        },
        {
          id: productA2,
          tenantId: tenantA,
          title: "Alpha Custom Aluminum Keyboard",
          slug: "alpha-custom-aluminum-keyboard",
          status: "published",
          shortDescription: "High-end anodized mechanical keyboard",
        },
      ]);

      await tx.insert(schema.variants).values([
        {
          id: variantA1Cheap,
          tenantId: tenantA,
          productId: productA1,
          sku: "ALPHA-SW-01",
          title: "Red Linear 70x",
          price: 1500n, // 15.00
          trackInventory: false,
        },
        {
          id: variantA2Expensive,
          tenantId: tenantA,
          productId: productA2,
          sku: "ALPHA-KB-99",
          title: "Space Gray / Gateron Ink",
          price: 19900n, // 199.00
          trackInventory: false,
        },
      ]);

      // Category and Collection Associations
      await tx.insert(schema.productCategories).values([
        { tenantId: tenantA, categoryId: categoryA, productId: productA1, position: 1 },
        { tenantId: tenantA, categoryId: categoryA, productId: productA2, position: 2 },
      ]);

      await tx.insert(schema.collectionProducts).values([
        { tenantId: tenantA, collectionId: collectionA, productId: productA1, position: 1 },
        { tenantId: tenantA, collectionId: collectionA, productId: productA2, position: 2 },
      ]);

      // Pages
      await tx.insert(schema.pages).values({
        id: pageA,
        tenantId: tenantA,
        title: "About Alpha",
        slug: "about-alpha",
        type: "standard",
        status: "published",
      });
    });

    // 6. Seed Tenant B initial store settings and lifecycle status
    await withTenant(dbRw.db, tenantB, async (tx) => {
      await tx.insert(schema.storeSettings).values({
        tenantId: tenantB,
        storeName: "Beta Storefront",
        currency: "EUR",
        timezone: "Europe/Berlin",
      });

      await tx.insert(schema.storeStatus).values({
        tenantId: tenantB,
        mode: "live",
        headline: "Welcome to Beta Store",
        bypassTokenHash: hashBypassToken(bypassTokenB),
        passwordHash: await hashStorePassword(passwordB),
        retryAfterMinutes: 60,
      });

      await tx.insert(schema.seoSettings).values({
        tenantId: tenantB,
        indexingEnabled: true,
        titleTemplate: "%s | Beta Store Europe",
        defaultMetaDescription: "Exclusive European items from Beta",
        twitterHandle: "@storebeta",
      });

      // Categories and Collections
      await tx.insert(schema.categories).values({
        id: categoryB,
        tenantId: tenantB,
        name: "Beta Artisan Caps",
        slug: "beta-artisan-caps",
        position: 1,
      });

      await tx.insert(schema.collections).values({
        id: collectionB,
        tenantId: tenantB,
        title: "Beta Limited Drops",
        slug: "beta-limited-drops",
        published: true,
        sortOrder: "manual",
      });

      // Product & Variant
      await tx.insert(schema.products).values({
        id: productB1,
        tenantId: tenantB,
        title: "Beta Resin Artisan Dragon Keycap",
        slug: "beta-resin-artisan-dragon-keycap",
        status: "published",
        shortDescription: "Handcrafted resin artisan keycap",
      });

      await tx.insert(schema.variants).values({
        id: variantB1,
        tenantId: tenantB,
        productId: productB1,
        sku: "BETA-DRAGON-01",
        title: "Ruby Red Edition",
        price: 8500n, // 85.00
        trackInventory: false,
      });

      await tx.insert(schema.productCategories).values({
        tenantId: tenantB,
        categoryId: categoryB,
        productId: productB1,
        position: 1,
      });

      await tx.insert(schema.collectionProducts).values({
        tenantId: tenantB,
        collectionId: collectionB,
        productId: productB1,
        position: 1,
      });

      // Pages
      await tx.insert(schema.pages).values({
        id: pageB,
        tenantId: tenantB,
        title: "About Beta",
        slug: "about-beta",
        type: "standard",
        status: "published",
      });
    });
  }, 180_000);

  afterAll(async () => {
    await rtApp?.close();
    await dbRw?.close();
    await container?.stop();
  });

  describe("1. Store Status & Mode Isolation", () => {
    it("setting tenantA to maintenance does not affect tenantB (live)", async () => {
      // Set Tenant A to maintenance mode
      await withTenant(dbRw.db, tenantA, async (tx) => {
        await tx
          .update(schema.storeStatus)
          .set({ mode: "maintenance", messageJson: "Alpha undergoing scheduled upgrade" })
          .where(eq(schema.storeStatus.tenantId, tenantA));
      });

      // Evaluating storefront access for tenantA host returns mode: maintenance (503)
      const accessA = await evaluateStorefrontAccess(rtApp, hostA);
      expect(accessA.allowed).toBe(false);
      expect(accessA.httpStatus).toBe(503);
      expect(accessA.mode).toBe("maintenance");
      expect(accessA.reason).toBe("maintenance");
      expect(accessA.tenantId).toBe(tenantA);
      expect(accessA.retryAfterSeconds).toBe(30 * 60);

      // Evaluating storefront access for tenantB host still returns mode: live (200)
      const accessB = await evaluateStorefrontAccess(rtApp, hostB);
      expect(accessB.allowed).toBe(true);
      expect(accessB.httpStatus).toBe(200);
      expect(accessB.mode).toBe("live");
      expect(accessB.tenantId).toBe(tenantB);
    });

    it("bypass token generated for tenantA allows access to tenantA but fails on tenantB", async () => {
      // Accessing tenantA with its valid bypass token passes even in maintenance
      const bypassOnA = await evaluateStorefrontAccess(rtApp, hostA, {
        previewToken: bypassTokenA,
      });
      expect(bypassOnA.allowed).toBe(true);
      expect(bypassOnA.isBypass).toBe(true);
      expect(bypassOnA.httpStatus).toBe(200);

      // Switch Tenant B to maintenance to test cross-tenant bypass failure
      await withTenant(dbRw.db, tenantB, async (tx) => {
        await tx
          .update(schema.storeStatus)
          .set({ mode: "maintenance" })
          .where(eq(schema.storeStatus.tenantId, tenantB));
      });

      // Using tenantA's bypass token on tenantB MUST fail and remain blocked in maintenance
      const bypassAToB = await evaluateStorefrontAccess(rtApp, hostB, {
        previewToken: bypassTokenA,
      });
      expect(bypassAToB.allowed).toBe(false);
      expect(bypassAToB.isBypass).toBeUndefined();
      expect(bypassAToB.httpStatus).toBe(503);

      // Using tenantB's own bypass token on tenantB succeeds
      const bypassBToB = await evaluateStorefrontAccess(rtApp, hostB, {
        previewToken: bypassTokenB,
      });
      expect(bypassBToB.allowed).toBe(true);
      expect(bypassBToB.isBypass).toBe(true);

      // Reset tenantB back to live
      await withTenant(dbRw.db, tenantB, async (tx) => {
        await tx
          .update(schema.storeStatus)
          .set({ mode: "live" })
          .where(eq(schema.storeStatus.tenantId, tenantB));
      });
    });

    it("store password set for tenantA cannot unlock tenantB", async () => {
      // Set Tenant A to password protected mode
      await withTenant(dbRw.db, tenantA, async (tx) => {
        await tx
          .update(schema.storeStatus)
          .set({ mode: "password" })
          .where(eq(schema.storeStatus.tenantId, tenantA));
      });

      // Set Tenant B to password protected mode
      await withTenant(dbRw.db, tenantB, async (tx) => {
        await tx
          .update(schema.storeStatus)
          .set({ mode: "password" })
          .where(eq(schema.storeStatus.tenantId, tenantB));
      });

      // Verify via verifyStorefrontPassword service
      const verifyAWithA = await verifyStorefrontPassword(rtApp, ctxA, passwordA);
      expect(verifyAWithA.success).toBe(true);

      const verifyBWithA = await verifyStorefrontPassword(rtApp, ctxB, passwordA);
      expect(verifyBWithA.success).toBe(false);

      const verifyBWithB = await verifyStorefrontPassword(rtApp, ctxB, passwordB);
      expect(verifyBWithB.success).toBe(true);

      // Verify via evaluateStorefrontAccess cookie/password parameter
      const accessBlocked = await evaluateStorefrontAccess(rtApp, hostB, {
        password: passwordA, // cross-tenant password attempt
      });
      expect(accessBlocked.allowed).toBe(false);
      expect(accessBlocked.reason).toBe("password_required");

      const accessUnlocked = await evaluateStorefrontAccess(rtApp, hostB, {
        password: passwordB, // correct password for tenantB
      });
      expect(accessUnlocked.allowed).toBe(true);
      expect(accessUnlocked.isPasswordUnlocked).toBe(true);

      // Restore both tenants to live for subsequent catalog/search tests
      await withTenant(dbRw.db, tenantA, async (tx) => {
        await tx.update(schema.storeStatus).set({ mode: "live" }).where(eq(schema.storeStatus.tenantId, tenantA));
      });
      await withTenant(dbRw.db, tenantB, async (tx) => {
        await tx.update(schema.storeStatus).set({ mode: "live" }).where(eq(schema.storeStatus.tenantId, tenantB));
      });
    });
  });

  describe("2. Catalog & Search Isolation", () => {
    it("products, collections, categories created in tenantA are never returned in tenantB catalog listings", async () => {
      // Product slug retrieval
      const prodAUnderA = await getStorefrontProduct(rtApp, ctxA, "alpha-mechanical-switch-pro");
      expect(prodAUnderA).not.toBeNull();
      expect(prodAUnderA?.id).toBe(productA1);

      const prodAUnderB = await getStorefrontProduct(rtApp, ctxB, "alpha-mechanical-switch-pro");
      expect(prodAUnderB).toBeNull();

      // Collection retrieval
      const colAUnderA = await getStorefrontCollection(rtApp, ctxA, "alpha-featured");
      expect(colAUnderA).not.toBeNull();
      expect(colAUnderA?.collection.id).toBe(collectionA);
      expect(colAUnderA?.products.items.length).toBe(2);

      const colAUnderB = await getStorefrontCollection(rtApp, ctxB, "alpha-featured");
      expect(colAUnderB).toBeNull();

      // Category retrieval
      const catAUnderA = await getStorefrontCategory(rtApp, ctxA, "alpha-keyboards");
      expect(catAUnderA).not.toBeNull();
      expect(catAUnderA?.category.id).toBe(categoryA);
      expect(catAUnderA?.products.items.length).toBe(2);

      const catAUnderB = await getStorefrontCategory(rtApp, ctxB, "alpha-keyboards");
      expect(catAUnderB).toBeNull();
    });

    it("trigram and FTS search for a product title belonging to tenantA returns 0 results when executed under tenantB", async () => {
      // FTS search for "Mechanical Switch" in tenantA finds productA1
      const searchUnderA = await searchStorefrontProducts(rtApp, ctxA, "Mechanical Switch");
      expect(searchUnderA.total).toBeGreaterThanOrEqual(1);
      expect(searchUnderA.items.some((i) => i.id === productA1)).toBe(true);

      // Exact same query executed under tenantB returns 0 items
      const searchUnderB = await searchStorefrontProducts(rtApp, ctxB, "Mechanical Switch");
      expect(searchUnderB.total).toBe(0);
      expect(searchUnderB.items).toEqual([]);

      // Trigram fuzzy match for "Aluminium Keybrd" in tenantA finds productA2
      const trigramUnderA = await searchStorefrontProducts(rtApp, ctxA, "Aluminium Keybrd");
      expect(trigramUnderA.total).toBeGreaterThanOrEqual(1);
      expect(trigramUnderA.items.some((i) => i.id === productA2)).toBe(true);

      // Trigram query executed under tenantB returns 0 items
      const trigramUnderB = await searchStorefrontProducts(rtApp, ctxB, "Aluminium Keybrd");
      expect(trigramUnderB.total).toBe(0);
      expect(trigramUnderB.items).toEqual([]);
    });

    it("price sorting (price_asc, price_desc) correctly queries variant prices only for the scoped tenant", async () => {
      // Under Tenant A, Collection A has A1 (price: 1500) and A2 (price: 19900)
      const ascA = await getStorefrontCollection(rtApp, ctxA, "alpha-featured", { sort: "price_asc" });
      expect(ascA).not.toBeNull();
      expect(ascA?.products.items.length).toBe(2);
      expect(ascA?.products.items[0]!.id).toBe(productA1); // 1500
      expect(ascA?.products.items[1]!.id).toBe(productA2); // 19900

      const descA = await getStorefrontCollection(rtApp, ctxA, "alpha-featured", { sort: "price_desc" });
      expect(descA).not.toBeNull();
      expect(descA?.products.items.length).toBe(2);
      expect(descA?.products.items[0]!.id).toBe(productA2); // 19900
      expect(descA?.products.items[1]!.id).toBe(productA1); // 1500

      // Under Tenant B, Collection B has only B1 (price: 8500)
      const ascB = await getStorefrontCollection(rtApp, ctxB, "beta-limited-drops", { sort: "price_asc" });
      expect(ascB).not.toBeNull();
      expect(ascB?.products.items.length).toBe(1);
      expect(ascB?.products.items[0]!.id).toBe(productB1);
    });

    it("search_queries logged in tenantA are isolated to tenantA", async () => {
      // Execute a unique search query under tenantA
      const uniqueQuery = "special-isolated-query-alpha";
      await searchStorefrontProducts(rtApp, ctxA, uniqueQuery);

      // Verify the log entry exists under tenantA
      const queriesInA = await withTenant(dbRw.db, tenantA, async (tx) => {
        return await tx
          .select()
          .from(schema.searchQueries)
          .where(eq(schema.searchQueries.query, uniqueQuery));
      });
      expect(queriesInA.length).toBe(1);
      expect(queriesInA[0]!.tenantId).toBe(tenantA);

      // Verify the query does NOT exist when querying under tenantB
      const queriesInB = await withTenant(dbRw.db, tenantB, async (tx) => {
        return await tx
          .select()
          .from(schema.searchQueries)
          .where(eq(schema.searchQueries.query, uniqueQuery));
      });
      expect(queriesInB.length).toBe(0);
    });
  });

  describe("3. Cart & Line Items Isolation", () => {
    let cartTokA: string;

    it("creating a cart in tenantA with token cartTokA cannot be retrieved or mutated under tenantB context", async () => {
      // 1. Create a cart in Tenant A
      const cartA = await getOrCreateCart(rtApp, ctxA);
      expect(cartA.id).toBeDefined();
      expect(cartA.token).toBeDefined();
      cartTokA = cartA.token;

      // 2. Add an item to cartTokA in tenantA
      const updatedCartA = await addToCart(rtApp, ctxA, {
        token: cartTokA,
        variantId: variantA1Cheap,
        quantity: 2,
      });
      expect(updatedCartA.itemCount).toBe(2);
      expect(updatedCartA.items.length).toBe(1);
      expect(updatedCartA.items[0]!.variantId).toBe(variantA1Cheap);

      // 3. Attempting to retrieve cartTokA under tenantB context fails to find tenantA's cart
      // getOrCreateCart creates a new fresh empty cart if token is not found in tenantB
      const cartLookupUnderB = await getOrCreateCart(rtApp, ctxB, cartTokA);
      // Because cartTokA belongs to tenantA, RLS hides it from tenantB.
      // Hence getOrCreateCart treats it as non-existent and allocates a brand new token!
      expect(cartLookupUnderB.token).not.toBe(cartTokA);
      expect(cartLookupUnderB.items).toEqual([]);

      // 4. Attempting to add an item to cartTokA directly under tenantB context throws "Cart not found"
      await expect(
        addToCart(rtApp, ctxB, {
          token: cartTokA,
          variantId: variantB1,
          quantity: 1,
        }),
      ).rejects.toThrow(/Cart not found/i);

      // 5. Attempting to update or clear cartTokA under tenantB context throws "Cart not found"
      await expect(
        updateCartItemQuantity(rtApp, ctxB, {
          token: cartTokA,
          itemId: updatedCartA.items[0]!.id,
          quantity: 5,
        }),
      ).rejects.toThrow(/Cart not found/i);

      await expect(clearCart(rtApp, ctxB, cartTokA)).rejects.toThrow(/Cart not found/i);
    });

    it("adding items to cartTokA in tenantA does not leak to tenantB", async () => {
      // Tenant B creates its own cart
      const cartB = await getOrCreateCart(rtApp, ctxB);
      expect(cartB.token).toBeDefined();
      expect(cartB.token).not.toBe(cartTokA);

      // Add item to Tenant B's cart
      const updatedCartB = await addToCart(rtApp, ctxB, {
        token: cartB.token,
        variantId: variantB1,
        quantity: 1,
      });
      expect(updatedCartB.itemCount).toBe(1);
      expect(updatedCartB.items[0]!.variantId).toBe(variantB1);

      // Verify Tenant A's cart is unaltered and contains only A items
      const cartAVerify = await getOrCreateCart(rtApp, ctxA, cartTokA);
      expect(cartAVerify.itemCount).toBe(2);
      expect(cartAVerify.items.length).toBe(1);
      expect(cartAVerify.items[0]!.variantId).toBe(variantA1Cheap);
    });

    it("RLS on carts and cart_items enforces that cross-tenant queries return 0 rows under app_rw withTenant", async () => {
      // Direct query from tenantB attempting to read tenantA's carts
      const leakedCarts = await withTenant(dbRw.db, tenantB, async (tx) => {
        return await tx
          .select()
          .from(schema.carts)
          .where(eq(schema.carts.tenantId, tenantA));
      });
      expect(leakedCarts).toEqual([]);

      // Direct query from tenantB attempting to read tenantA's cart_items
      const leakedCartItems = await withTenant(dbRw.db, tenantB, async (tx) => {
        return await tx
          .select()
          .from(schema.cartItems)
          .where(eq(schema.cartItems.tenantId, tenantA));
      });
      expect(leakedCartItems).toEqual([]);

      // Direct insert into carts under tenantB with tenantA's ID is rejected by Postgres RLS
      let threw = false;
      try {
        await withTenant(dbRw.db, tenantB, async (tx) => {
          await tx.insert(schema.carts).values({
            token: "malicious-cart-token",
            tenantId: tenantA, // Spoofed tenant ID
            currency: "USD",
            status: "active",
          });
        });
      } catch (err: unknown) {
        threw = true;
        const msg = String(err) + " " + String((err as { cause?: { message?: string } })?.cause?.message ?? "");
        expect(msg).toMatch(/violates row-level security policy/i);
      }
      expect(threw).toBe(true);
    });
  });

  describe("4. SEO & Structured Data Isolation", () => {
    it("getStorefrontSeoSettings returns tenantA custom settings without affecting tenantB", async () => {
      const seoA = await getStorefrontSeoSettings(rtApp, ctxA);
      expect(seoA.titleTemplate).toBe("%s | Alpha Official");
      expect(seoA.defaultMetaDescription).toBe("Welcome to Alpha Storefront official catalog");
      expect(seoA.twitterHandle).toBe("@storealpha");

      const seoB = await getStorefrontSeoSettings(rtApp, ctxB);
      expect(seoB.titleTemplate).toBe("%s | Beta Store Europe");
      expect(seoB.defaultMetaDescription).toBe("Exclusive European items from Beta");
      expect(seoB.twitterHandle).toBe("@storebeta");
    });

    it("getStorefrontSitemapUrls returns only URLs belonging to that tenant", async () => {
      const sitemapUrlsA = await getStorefrontSitemapUrls(rtApp, ctxA, hostA);
      const locsA = sitemapUrlsA.map((u) => u.loc);

      // Check tenantA entities are present
      expect(locsA).toContain(`https://${hostA}`);
      expect(locsA).toContain(`https://${hostA}/products/alpha-mechanical-switch-pro`);
      expect(locsA).toContain(`https://${hostA}/products/alpha-custom-aluminum-keyboard`);
      expect(locsA).toContain(`https://${hostA}/collections/alpha-featured`);
      expect(locsA).toContain(`https://${hostA}/categories/alpha-keyboards`);
      expect(locsA).toContain(`https://${hostA}/pages/about-alpha`);

      // Verify ZERO tenantB URLs leaked into tenantA's sitemap
      expect(locsA.some((l) => l.includes("beta"))).toBe(false);

      const sitemapUrlsB = await getStorefrontSitemapUrls(rtApp, ctxB, hostB);
      const locsB = sitemapUrlsB.map((u) => u.loc);

      // Check tenantB entities are present
      expect(locsB).toContain(`https://${hostB}`);
      expect(locsB).toContain(`https://${hostB}/products/beta-resin-artisan-dragon-keycap`);
      expect(locsB).toContain(`https://${hostB}/collections/beta-limited-drops`);
      expect(locsB).toContain(`https://${hostB}/categories/beta-artisan-caps`);
      expect(locsB).toContain(`https://${hostB}/pages/about-beta`);

      // Verify ZERO tenantA URLs leaked into tenantB's sitemap
      expect(locsB.some((l) => l.includes("alpha"))).toBe(false);

      // Verify XML generation
      const xml = generateSitemapXml(sitemapUrlsA);
      expect(xml).toContain('<?xml version="1.0" encoding="UTF-8"?>');
      expect(xml).toContain("<urlset");
      expect(xml).toContain(`https://${hostA}/products/alpha-mechanical-switch-pro`);
    });

    it("generateRobotsTxt respects indexing and tenant host configuration", async () => {
      const seoA = await getStorefrontSeoSettings(rtApp, ctxA);
      const robotsA = generateRobotsTxt(seoA, "live", hostA);
      expect(robotsA).toContain(`Sitemap: https://${hostA}/sitemap.xml`);
      expect(robotsA).toContain("Disallow: /cart");
      expect(robotsA).toContain("User-agent: GPTBot\nDisallow: /");
    });
  });

  describe("5. Newsletter Subscribers Isolation", () => {
    const sharedEmail = "collector@mechanical-keyboards.test";

    it("subscribing the same email in tenantA and tenantB succeeds independently (unique constraint is (tenant_id, email))", async () => {
      // Subscribe sharedEmail in Tenant A
      const subA = await subscribeNewsletter(rtApp, ctxA, {
        email: sharedEmail,
        source: "footer_alpha",
      });
      expect(subA.success).toBe(true);

      // Subscribe same sharedEmail in Tenant B
      const subB = await subscribeNewsletter(rtApp, ctxB, {
        email: sharedEmail,
        source: "popup_beta",
      });
      expect(subB.success).toBe(true);

      // Verify both subscribers exist in database in their respective tenant partition
      const rowsA = await withTenant(dbRw.db, tenantA, async (tx) => {
        return await tx
          .select()
          .from(schema.newsletterSubscribers)
          .where(eq(schema.newsletterSubscribers.email, sharedEmail));
      });
      expect(rowsA.length).toBe(1);
      expect(rowsA[0]!.tenantId).toBe(tenantA);
      expect(rowsA[0]!.source).toBe("footer_alpha");

      const rowsB = await withTenant(dbRw.db, tenantB, async (tx) => {
        return await tx
          .select()
          .from(schema.newsletterSubscribers)
          .where(eq(schema.newsletterSubscribers.email, sharedEmail));
      });
      expect(rowsB.length).toBe(1);
      expect(rowsB[0]!.tenantId).toBe(tenantB);
      expect(rowsB[0]!.source).toBe("popup_beta");
    });

    it("subscribing in tenantA does not appear in tenantB subscribers list", async () => {
      const alphaOnlyEmail = "alpha-exclusive@store.test";
      await subscribeNewsletter(rtApp, ctxA, {
        email: alphaOnlyEmail,
      });

      // Query from Tenant B context: must return 0 rows
      const rowsUnderB = await withTenant(dbRw.db, tenantB, async (tx) => {
        return await tx
          .select()
          .from(schema.newsletterSubscribers)
          .where(eq(schema.newsletterSubscribers.email, alphaOnlyEmail));
      });
      expect(rowsUnderB).toEqual([]);
    });
  });

  describe("6. Block Document Render Pipeline", () => {
    it("renders page block document verifying migrateBlockDocument + validateBlockDocument upgrades and renders safely", () => {
      // 1. Setup a custom block migration for testing version upgrades (v0 -> v1)
      registerBlockMigration("Hero", 0, (props: Record<string, unknown>) => {
        const { legacyHeadline, ...rest } = props;
        return {
          ...rest,
          title: typeof legacyHeadline === "string" ? legacyHeadline : "Migrated Title",
        };
      });

      const oldDoc: BlockDocument = {
        version: 1,
        blocks: [
          {
            id: "hero-blk-1",
            type: "Hero",
            version: 0,
            props: {
              legacyHeadline: "Old Hero Headline",
              subtitle: "Subheading text",
            },
          },
          {
            id: "rich-text-1",
            type: "RichText",
            version: 1,
            props: {
              content: "<p>Safe text <script>alert('xss')</script></p>",
            },
          },
          {
            id: "hidden-banner-1",
            type: "Banner",
            version: 1,
            hidden: true,
            props: {
              text: "Secret hidden promo code",
            },
          },
        ],
      };

      // 2. Migrate block document
      const migrated = migrateBlockDocument(oldDoc);
      const migratedHero = migrated.blocks.find((b) => b.id === "hero-blk-1");
      expect(migratedHero?.version).toBe(1);
      expect(migratedHero?.props.title).toBe("Old Hero Headline");

      // 3. Validate block document and ensure RichText is sanitized
      const validated = validateBlockDocument(migrated);
      expect(validated.success).toBe(true);
      if (validated.success) {
        const richBlock = validated.data.blocks.find((b) => b.id === "rich-text-1");
        expect(richBlock?.props.content).not.toContain("<script>");
        expect(richBlock?.props.content).toContain("<p>Safe text </p>");
      }

      // 4. Render block document: ensures hidden blocks are omitted and sanitized output is rendered
      const renderResult = renderBlockDocument(oldDoc);
      expect(renderResult.success).toBe(true);
      expect(renderResult.blocks.length).toBe(2); // hidden-banner-1 excluded
      expect(renderResult.blocks.some((b) => b.id === "hidden-banner-1")).toBe(false);
      expect(renderResult.blocks.some((b) => b.id === "hero-blk-1")).toBe(true);

      // Clean up migration registry
      clearBlockMigrations();
    });
  });
});
