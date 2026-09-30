import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { createDb, type DbHandle, schema } from "@bs/db";
import { bootstrapRoles } from "@bs/db/bootstrap";
import { runMigrations } from "@bs/db/migrate";
import { sql } from "drizzle-orm";
import {
  createRuntime,
  type Runtime,
  provisionTenant,
  normalizeSubdomainSlug,
  validateSubdomainFormat,
  reserveSubdomain,
} from "../src/index.ts";

const PW = { owner: "o_test", rw: "rw_test", platform: "p_test" };
let container: StartedPostgreSqlContainer | undefined;
let superUrl: string;
let rwDb: DbHandle;
let platformDb: DbHandle;
let rt: Runtime;

function as(role: "app_owner" | "app_rw" | "app_platform", password: string): string {
  const u = new URL(superUrl);
  u.username = role;
  u.password = password;
  return u.toString();
}

beforeAll(async () => {
  if (process.env.TEST_DATABASE_URL_SUPERUSER) {
    superUrl = process.env.TEST_DATABASE_URL_SUPERUSER;
  } else {
    container = await new PostgreSqlContainer("postgres:18").withReuse().start();
    superUrl = container.getConnectionUri();
  }
  await bootstrapRoles(superUrl, PW);
  await runMigrations(as("app_owner", PW.owner));
  rwDb = createDb(as("app_rw", PW.rw), { max: 15 });
  platformDb = createDb(as("app_platform", PW.platform), { max: 5 });
  rt = createRuntime({ service: "web", databaseUrl: as("app_rw", PW.rw), poolMax: 15 });
}, 180_000);

afterAll(async () => {
  await rwDb?.close();
  await platformDb?.close();
  await rt?.close();
  await container?.stop();
});

describe("M8 Atomic Tenant Provisioning Engine (PLAN §5.1, §6.4, §7 / ADR-016)", () => {
  it("provisions a complete store with all required relational records in a single atomic transaction under 60 seconds", async () => {
    const slug = "artisan-crafts-83";
    const startTime = Date.now();

    // Optionally reserve slug beforehand to test reservation cleanup
    await reserveSubdomain(rt._db.db, slug);

    const result = await provisionTenant(rt, {
      storeName: "Artisan Crafts Studio",
      slug,
      owner: {
        email: "founder@artisancrafts.in",
        name: "Aarav Sharma",
        password: "SuperSecurePassword123!",
        phone: "+919876543210",
      },
      planCode: "growth",
      themeTemplate: "starter-minimal",
      currency: "INR",
      timezone: "Asia/Kolkata",
      source: "self_service",
    });

    const durationMs = Date.now() - startTime;
    // PLAN §7 exit bar: under 60 seconds server time
    expect(durationMs).toBeLessThan(60_000);

    expect(result.slug).toBe(slug);
    expect(result.hostname).toBe(`${slug}.gobs.cloud`);
    expect(result.storeUrl).toBe(`https://${slug}.gobs.cloud`);
    expect(result.adminUrl).toBe("https://admin.gobs.cloud");
    expect(result.tenantId).toBeDefined();
    expect(result.organizationId).toBeDefined();
    expect(result.ownerId).toBeDefined();
    expect(result.subscriptionId).toBeDefined();

    // Verify Organization and Tenant
    const [tenant] = await rt._db.db
      .select()
      .from(schema.tenants)
      .where(sql`id = ${result.tenantId}`);
    expect(tenant).toBeDefined();
    expect(tenant!.name).toBe("Artisan Crafts Studio");
    expect(tenant!.slug).toBe(slug);
    expect(tenant!.status).toBe("active");
    expect(tenant!.currency).toBe("INR");
    expect(tenant!.timezone).toBe("Asia/Kolkata");

    // Verify Platform Subdomain Record
    const domains = await rt._db.db
      .select()
      .from(schema.domains)
      .where(sql`tenant_id = ${result.tenantId}`);
    expect(domains).toHaveLength(1);
    expect(domains[0]!.hostname).toBe(`${slug}.gobs.cloud`);
    expect(domains[0]!.type).toBe("subdomain");
    expect(domains[0]!.isPrimary).toBe(true);
    expect(domains[0]!.status).toBe("active");

    // Verify Owner User & Password Account
    const [user] = await rt._db.db
      .select()
      .from(schema.users)
      .where(sql`id = ${result.ownerId}`);
    expect(user).toBeDefined();
    expect(user!.email).toBe("founder@artisancrafts.in");
    expect(user!.name).toBe("Aarav Sharma");
    expect(user!.phone).toBe("+919876543210");
    expect(user!.emailVerified).toBe(true);

    const accounts = await rt._db.db
      .select()
      .from(schema.accounts)
      .where(sql`user_id = ${result.ownerId} AND provider_id = 'credential'`);
    expect(accounts).toHaveLength(1);
    expect(accounts[0]!.password).toBeDefined();
    expect(accounts[0]!.password!.length).toBeGreaterThan(20);

    // Verify Roles & Store Owner Membership (using platformDb to bypass RLS for verification)
    const roles = await platformDb.db
      .select()
      .from(schema.roles)
      .where(sql`tenant_id = ${result.tenantId}`);
    const ownerRole = roles.find((r) => r.name === "store_owner");
    const adminRole = roles.find((r) => r.name === "store_admin");
    expect(ownerRole).toBeDefined();
    expect(adminRole).toBeDefined();
    expect(ownerRole!.isSystem).toBe(true);

    const memberships = await platformDb.db
      .select()
      .from(schema.memberships)
      .where(sql`tenant_id = ${result.tenantId} AND user_id = ${result.ownerId}`);
    expect(memberships).toHaveLength(1);
    expect(memberships[0]!.roleId).toBe(ownerRole!.id);
    expect(memberships[0]!.status).toBe("active");

    // Verify Store Settings with COD default
    const [settings] = await platformDb.db
      .select()
      .from(schema.storeSettings)
      .where(sql`tenant_id = ${result.tenantId}`);
    expect(settings).toBeDefined();
    expect(settings!.storeName).toBe("Artisan Crafts Studio");
    expect(settings!.checkout).toMatchObject({
      cod: { enabled: true, feePaise: 0 },
    });

    // Verify Warehouse Location
    const locations = await platformDb.db
      .select()
      .from(schema.locations)
      .where(sql`tenant_id = ${result.tenantId}`);
    expect(locations).toHaveLength(1);
    expect(locations[0]!.name).toBe("Main Warehouse");
    expect(locations[0]!.isDefault).toBe(true);

    // Verify India Shipping Zone & Rates
    const zones = await platformDb.db
      .select()
      .from(schema.shippingZones)
      .where(sql`tenant_id = ${result.tenantId}`);
    expect(zones).toHaveLength(1);
    expect(zones[0]!.name).toContain("India");

    const rates = await platformDb.db
      .select()
      .from(schema.shippingRates)
      .where(sql`tenant_id = ${result.tenantId}`);
    expect(rates.length).toBeGreaterThanOrEqual(2);
    const flatRate = rates.find((r) => r.rateType === "flat");
    const freeRate = rates.find((r) => r.rateType === "free_above_threshold");
    expect(flatRate?.pricePaise).toBe(9900); // ₹99
    expect(freeRate?.thresholdPaise).toBe(99900); // ₹999

    // Verify Size Tier Allocation (Growth Plan -> S Tier)
    const tiers = await platformDb.db
      .select()
      .from(schema.tenantSizeTiers)
      .where(sql`tenant_id = ${result.tenantId}`);
    expect(tiers).toHaveLength(1);
    expect(tiers[0]!.tier).toBe("S");

    // Verify Subscription (14-day trialing)
    const [sub] = await platformDb.db
      .select()
      .from(schema.subscriptions)
      .where(sql`id = ${result.subscriptionId}`);
    expect(sub).toBeDefined();
    expect(sub!.tenantId).toBe(result.tenantId);
    expect(sub!.status).toBe("trialing");
    expect(sub!.provider).toBe("razorpay");
    expect(new Date(sub!.currentPeriodEnd!).getTime()).toBeGreaterThan(Date.now() + 13 * 24 * 3600 * 1000);

    // Verify Onboarding Progress
    const [onboarding] = await platformDb.db
      .select()
      .from(schema.onboardingProgress)
      .where(sql`tenant_id = ${result.tenantId}`);
    expect(onboarding).toBeDefined();
    expect(onboarding!.steps).toMatchObject({
      store_created: true,
      product_added: false,
      payment_configured: false,
      domain_connected: false,
      first_order_received: false,
    });

    // Verify Starter Theme & Pages
    const themes = await platformDb.db
      .select()
      .from(schema.themes)
      .where(sql`tenant_id = ${result.tenantId}`);
    expect(themes).toHaveLength(1);
    expect(themes[0]!.templateCode).toBe("starter-minimal");
    expect(themes[0]!.status).toBe("published");

    const pages = await platformDb.db
      .select()
      .from(schema.pages)
      .where(sql`tenant_id = ${result.tenantId}`);
    const homePage = pages.find((p) => p.type === "home");
    const aboutPage = pages.find((p) => p.slug === "about");
    expect(homePage).toBeDefined();
    expect(homePage?.publishedVersionId).toBeDefined();
    expect(aboutPage).toBeDefined();
    expect(aboutPage?.publishedVersionId).toBeDefined();

    // Verify Menus
    const menus = await platformDb.db
      .select()
      .from(schema.menus)
      .where(sql`tenant_id = ${result.tenantId}`);
    expect(menus.some((m) => m.handle === "header")).toBe(true);
    expect(menus.some((m) => m.handle === "footer")).toBe(true);

    // Verify slug reservation was cleaned up
    const reservations = await rt._db.db
      .select()
      .from(schema.slugReservations)
      .where(sql`slug = ${slug}`);
    expect(reservations).toHaveLength(0);

    // Verify Platform Audit Log
    const auditLogs = await rt._db.db
      .select()
      .from(schema.platformAuditLogs)
      .where(sql`tenant_id = ${result.tenantId} AND action = 'tenant.provisioned'`);
    expect(auditLogs).toHaveLength(1);
    expect(auditLogs[0]!.diff).toMatchObject({
      slug,
      planCode: "growth",
      source: "self_service",
    });
  });

  it("rolls back entirely if provisioning encounters an error (zero orphaned records)", async () => {
    const slug = "rollback-store-83";

    // First create a conflicting store with this slug
    await provisionTenant(rt, {
      storeName: "Conflict First Store",
      slug,
      owner: {
        email: "first@rollback.local",
        name: "First Owner",
      },
    });

    const preTenantsCount = (
      await rt._db.db.execute<{ count: string }>(sql`SELECT count(*) FROM tenants;`)
    ).rows[0]!.count;

    // Attempting to provision again with same slug must fail
    await expect(
      provisionTenant(rt, {
        storeName: "Conflict Second Store",
        slug,
        owner: {
          email: "second@rollback.local",
          name: "Second Owner",
        },
      }),
    ).rejects.toThrow(/already registered/);

    const postTenantsCount = (
      await rt._db.db.execute<{ count: string }>(sql`SELECT count(*) FROM tenants;`)
    ).rows[0]!.count;

    // Total tenant count should not have increased
    expect(postTenantsCount).toBe(preTenantsCount);

    // No orphaned user or domain created for second owner
    const secondUser = await rt._db.db
      .select()
      .from(schema.users)
      .where(sql`email = 'second@rollback.local'`);
    expect(secondUser).toHaveLength(0);
  });

  it("rejects reserved subdomains and malformed slugs", async () => {
    // Reserved slug
    await expect(
      provisionTenant(rt, {
        storeName: "Admin System",
        slug: "admin",
        owner: {
          email: "admin@badslug.local",
          name: "Bad Slug Admin",
        },
      }),
    ).rejects.toThrow(/reserved/);

    // Invalid format (too short, spaces, uppercase normalization)
    const normalized = normalizeSubdomainSlug("  My--Store-Test  ");
    expect(normalized).toBe("my-store-test");

    const checkShort = validateSubdomainFormat("ab");
    expect(checkShort.valid).toBe(false);

    const checkDash = validateSubdomainFormat("-invalid");
    expect(checkDash.valid).toBe(false);
  });
});
