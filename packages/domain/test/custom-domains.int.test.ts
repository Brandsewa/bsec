import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { createDb, type DbHandle, schema } from "@bs/db";
import { bootstrapRoles } from "@bs/db/bootstrap";
import { runMigrations } from "@bs/db/migrate";
import { eq, sql } from "drizzle-orm";
import {
  createRuntime,
  type Runtime,
  provisionTenant,
  addCustomDomain,
  verifyCustomDomain,
  setPrimaryDomain,
  removeCustomDomain,
  listTenantDomains,
  getOnboardingProgress,
  QuotaExceededError,
  type CustomDomainProvider,
  type CustomHostnameResult,
  type CustomHostnameStatusResult,
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

  // Seed Store 1 (store101.gobs.cloud) to verify non-regression
  const [store1Org] = await rwDb.db
    .insert(schema.organizations)
    .values({ name: "Store 101 Org" })
    .returning();
  const [store1Tenant] = await rwDb.db
    .insert(schema.tenants)
    .values({
      organizationId: store1Org!.id,
      slug: "store101",
      name: "Store 101",
      status: "active",
    })
    .returning();
  await rwDb.db.insert(schema.domains).values({
    tenantId: store1Tenant!.id,
    hostname: "store101.gobs.cloud",
    type: "platform_subdomain",
    isPrimary: true,
    status: "active",
  });
}, 180_000);

afterAll(async () => {
  await rwDb?.close();
  await platformDb?.close();
  await rt?.close();
  await container?.stop();
});

class MockCustomDomainProvider implements CustomDomainProvider {
  private activeHostnames = new Set<string>();

  setActive(hostname: string) {
    this.activeHostnames.add(hostname);
  }

  async createCustomHostname(
    hostname: string,
    opts?: { prevalidate?: boolean },
  ): Promise<CustomHostnameResult> {
    return {
      providerHostnameId: `cf_mock_${hostname.replace(/[^a-zA-Z0-9]/g, "_")}`,
      hostname,
      cnameTarget: "stores.gobs.cloud",
      ...(opts?.prevalidate
        ? {
            txtVerification: {
              name: `_cf-custom-hostname.${hostname}`,
              value: `bs-verify-token-${hostname}`,
            },
          }
        : {}),
      status: "awaiting_dns",
      sslStatus: opts?.prevalidate ? "pending_validation" : "initializing",
    };
  }

  async getCustomHostnameStatus(providerHostnameId: string): Promise<CustomHostnameStatusResult> {
    const isMockActive = Array.from(this.activeHostnames).some((h) =>
      providerHostnameId.includes(h.replace(/[^a-zA-Z0-9]/g, "_")),
    );

    if (isMockActive) {
      return {
        providerHostnameId,
        hostname: "",
        status: "active",
        sslStatus: "active",
      };
    }

    return {
      providerHostnameId,
      hostname: "",
      status: "awaiting_dns",
      sslStatus: "initializing",
    };
  }

  async deleteCustomHostname(): Promise<{ deleted: boolean }> {
    return { deleted: true };
  }
}

describe("M8 Custom Domains & Cloudflare for SaaS Integration (PLAN §8, ADR-007, ADR-017)", () => {
  let tenantId: string;
  let customDomainId: string;
  const mockProvider = new MockCustomDomainProvider();

  it("provisions a store on XS tier and checks custom domain quota (0 custom domains allowed on XS)", async () => {
    const slug = "domains-store-01";
    const result = await provisionTenant(rt, {
      storeName: "Domains Test Store",
      slug,
      planCode: "starter", // Initial plan defaults to XS size tier
      owner: {
        email: "merchant.domains@example.com",
        name: "Domain Merchant",
        phone: "+919876543211",
      },
    });

    tenantId = result.tenantId;
    expect(tenantId).toBeDefined();

    // Verify initial subdomain
    const domains = await listTenantDomains(rt, tenantId);
    expect(domains).toHaveLength(1);
    expect(domains[0]!.hostname).toBe(`${slug}.gobs.cloud`);
    expect(domains[0]!.isPrimary).toBe(true);
    expect(domains[0]!.status).toBe("active");

    // Tier XS has quota = 0 custom domains -> Adding custom domain must be blocked by QuotaExceededError
    await expect(
      addCustomDomain(rt, tenantId, {
        hostname: "shop.mybrand.in",
        provider: mockProvider,
      }),
    ).rejects.toThrow(QuotaExceededError);
  });

  it("upgrades store to S tier (1 custom domain allowed) and adds custom domain successfully", async () => {
    // Elevate store size tier to S (Growth/S tier allows 1 custom domain)
    await rt._db.db
      .update(schema.tenantSizeTiers)
      .set({ tier: "S", updatedAt: new Date() })
      .where(eq(schema.tenantSizeTiers.tenantId, tenantId));

    const domainRecord = await addCustomDomain(rt, tenantId, {
      hostname: "shop.mybrand.in",
      provider: mockProvider,
    });

    expect(domainRecord.hostname).toBe("shop.mybrand.in");
    expect(domainRecord.status).toBe("awaiting_dns");
    expect(domainRecord.isPrimary).toBe(false);
    expect(domainRecord.verification).toMatchObject({
      cname: "stores.gobs.cloud",
    });

    customDomainId = domainRecord.id;

    const list = await listTenantDomains(rt, tenantId);
    expect(list).toHaveLength(2);
  });

  it("enforces custom domain quota when attempting to add a second domain on S tier", async () => {
    await expect(
      addCustomDomain(rt, tenantId, {
        hostname: "another.mybrand.in",
        provider: mockProvider,
      }),
    ).rejects.toThrow(QuotaExceededError);
  });

  it("prevents setting an unverified/awaiting_dns domain as primary (PLAN §8 invariant)", async () => {
    // PLAN §8 Invariant: A domain can only become is_primary = true when its status is 'active'
    await expect(setPrimaryDomain(rt, tenantId, customDomainId)).rejects.toThrow(
      /Only active, verified domains can be designated as primary/,
    );
  });

  it("verifies custom domain with provider and transitions status to active and completes onboarding step", async () => {
    // Simulate DNS and Cloudflare verification completing
    mockProvider.setActive("shop.mybrand.in");

    const verified = await verifyCustomDomain(rt, tenantId, customDomainId, mockProvider);
    expect(verified.status).toBe("active");
    expect(verified.sslStatus).toBe("active");

    // Verify setup checklist step 'domain_connected' was marked complete
    const onboarding = await getOnboardingProgress(rt, {
      tenantId,
      storeStatus: "live",
      actor: { type: "system" },
      roles: [],
      permissions: [],
      requestId: "req_domain_test",
    });
    expect(onboarding.steps.domain_connected).toBe(true);
  });

  it("sets verified active custom domain as primary and clears primary on subdomain", async () => {
    const res = await setPrimaryDomain(rt, tenantId, customDomainId);
    expect(res.success).toBe(true);
    expect(res.primaryHostname).toBe("shop.mybrand.in");

    const domains = await listTenantDomains(rt, tenantId);
    const customDom = domains.find((d) => d.id === customDomainId);
    const platformSub = domains.find((d) => d.type === "subdomain" || d.type === "platform_subdomain");

    expect(customDom?.isPrimary).toBe(true);
    expect(platformSub?.isPrimary).toBe(false);
  });

  it("supports prevalidate_txt path with TXT ownership records on M tier", async () => {
    // Upgrade to Tier M (allows 3 custom domains)
    await rt._db.db
      .update(schema.tenantSizeTiers)
      .set({ tier: "M", updatedAt: new Date() })
      .where(eq(schema.tenantSizeTiers.tenantId, tenantId));

    const prevalDomain = await addCustomDomain(rt, tenantId, {
      hostname: "cutover.zerodowntime.com",
      prevalidateTxt: true,
      provider: mockProvider,
    });

    expect(prevalDomain.prevalidateTxt).toBe(true);
    expect(prevalDomain.verification?.txt?.name).toContain("_cf-custom-hostname");
    expect(prevalDomain.verification?.txt?.value).toBeDefined();

    // Clean up
    await removeCustomDomain(rt, tenantId, prevalDomain.id, mockProvider);
  });

  it("removes custom domain and automatically reassigns primary back to platform subdomain", async () => {
    const res = await removeCustomDomain(rt, tenantId, customDomainId, mockProvider);
    expect(res.success).toBe(true);

    const domains = await listTenantDomains(rt, tenantId);
    expect(domains).toHaveLength(1);
    expect(domains[0]!.type).toMatch(/subdomain/);
    expect(domains[0]!.isPrimary).toBe(true); // Restored as primary!
  });

  it("VERIFIES Store 1 (store101.gobs.cloud) non-regression", async () => {
    const store1Rows = await rt._db.db.execute<{
      hostname: string;
      is_primary: boolean;
      status: string;
    }>(sql`
      SELECT hostname, is_primary, status FROM domains WHERE hostname = 'store101.gobs.cloud' LIMIT 1;
    `);

    expect(store1Rows.rows).toHaveLength(1);
    const store1Domain = store1Rows.rows[0]!;
    expect(store1Domain.hostname).toBe("store101.gobs.cloud");
    expect(store1Domain.is_primary).toBe(true);
    expect(store1Domain.status).toBe("active");
  });
});
