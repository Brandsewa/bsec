import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { createDb, type DbHandle, schema } from "@bs/db";
import { bootstrapRoles } from "@bs/db/bootstrap";
import { runMigrations } from "@bs/db/migrate";
import { and, eq, sql } from "drizzle-orm";
import {
  createRuntime,
  type Runtime,
  type TenantContext,
  provisionTenant,
  addCustomDomain,
  verifyCustomDomain,
  sweepPendingCustomDomains,
  setPrimaryDomain,
  removeCustomDomain,
  listTenantDomains,
  getOnboardingProgress,
  QuotaExceededError,
  lookupDomainIdForProbe,
  type RoutingDeps,
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
let rtPlatform: Runtime;

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
  rtPlatform = createRuntime({ service: "platform", databaseUrl: as("app_platform", PW.platform), poolMax: 5 });

  // Seed Store 1 (store101.bcom.si) to verify non-regression
  const [store1Org] = await platformDb.db
    .insert(schema.organizations)
    .values({ name: "Store 101 Org" })
    .returning();
  const [store1Tenant] = await platformDb.db
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
    hostname: "store101.bcom.si",
    type: "platform_subdomain",
    isPrimary: true,
    status: "active",
  });
}, 180_000);

afterAll(async () => {
  await rwDb?.close();
  await platformDb?.close();
  await rt?.close();
  await rtPlatform?.close();
  await container?.stop();
});

const NO_RECORD = () => Promise.reject(Object.assign(new Error("ENODATA"), { code: "ENODATA" }));
const TARGETS = { cname: "stores.bcom.si", a: ["104.21.59.175", "172.67.182.4"], aaaa: [] as string[] };

/** DNS answers with a given A record set, and an HTTP probe that asks the real database which domain owns the host. */
function routingDeps(opts: { a?: string[]; probe?: "real" | "fail" } = {}): RoutingDeps {
  const a = opts.a ?? ["104.21.59.175"];
  return {
    targets: TARGETS,
    resolver: {
      resolve4: async () => (a.length ? a : await NO_RECORD()),
      resolve6: NO_RECORD,
      resolveCname: NO_RECORD,
    },
    fetchImpl: async (url) => {
      if (opts.probe === "fail") return { status: 502, text: async () => "" };
      const id = await lookupDomainIdForProbe(rwDb.db, new URL(url).hostname);
      return { status: id ? 200 : 404, text: async () => JSON.stringify({ domainId: id }) };
    },
  };
}

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
      cnameTarget: "stores.bcom.si",
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
    const result = await provisionTenant(rtPlatform, {
      storeName: "Domains Test Store",
      slug,
      planCode: "starter",
      owner: {
        email: "merchant.domains@example.com",
        name: "Domain Merchant",
        phone: "+919876543211",
      },
    });

    tenantId = result.tenantId;
    expect(tenantId).toBeDefined();

    // A Starter store is provisioned on tier S (1 custom domain). Drop it to XS, the tier a lapsed trial gets.
    await platformDb.db
      .update(schema.tenantSizeTiers)
      .set({ tier: "XS", updatedAt: new Date() })
      .where(eq(schema.tenantSizeTiers.tenantId, tenantId));

    // Verify initial subdomain
    const domains = await listTenantDomains(rt, tenantId);
    expect(domains).toHaveLength(1);
    expect(domains[0]!.hostname).toBe(`${slug}.bcom.si`);
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
    await platformDb.db
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
      cname: "stores.bcom.si",
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

    const verified = await verifyCustomDomain(rt, tenantId, customDomainId, mockProvider, routingDeps());
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
    await platformDb.db
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

  it("registers a domain saved while the provider was unconfigured, then the sweep activates it", async () => {
    const unconfigured: CustomDomainProvider = {
      isConfigured: () => false,
      createCustomHostname: async (hostname) => ({ providerHostnameId: null, hostname, status: "requested", sslStatus: "not_configured" }),
      getCustomHostnameStatus: async (id) => ({ providerHostnameId: id, hostname: "", status: "requested", sslStatus: "not_configured" }),
      deleteCustomHostname: async () => ({ deleted: true }),
    };
    const saved = await addCustomDomain(rt, tenantId, { hostname: "late.setup-example.com", provider: unconfigured });
    expect(saved.status).toBe("requested");
    expect(saved.cfCustomHostnameId).toBeNull();

    const configured = new MockCustomDomainProvider();
    (configured as CustomDomainProvider).isConfigured = () => true;

    // First pass registers it with the provider and records the DNS target.
    const first = await sweepPendingCustomDomains(rwDb.db, { provider: configured });
    expect(first.checked).toBeGreaterThanOrEqual(1);
    const [registered] = await rwDb.db.select().from(schema.domains).where(eq(schema.domains.id, saved.id));
    expect(registered?.cfCustomHostnameId).toBe("cf_mock_late_setup_example_com");
    expect((registered?.verification as { cname?: string } | null)?.cname).toBe("stores.bcom.si");

    // Once DNS and SSL are done at the provider, the next pass activates it without the merchant doing anything.
    configured.setActive("late.setup-example.com");
    await sweepPendingCustomDomains(rwDb.db, { provider: configured, routingDeps: routingDeps() });
    const [active] = await rwDb.db.select().from(schema.domains).where(eq(schema.domains.id, saved.id));
    expect(active?.status).toBe("active");

    await removeCustomDomain(rt, tenantId, saved.id, configured);
  });

  it("sweep does nothing while the provider is unconfigured", async () => {
    const off: CustomDomainProvider = {
      isConfigured: () => false,
      createCustomHostname: async () => { throw new Error("must not be called"); },
      getCustomHostnameStatus: async () => { throw new Error("must not be called"); },
      deleteCustomHostname: async () => ({ deleted: true }),
    };
    expect(await sweepPendingCustomDomains(rwDb.db, { provider: off })).toEqual({ checked: 0, changed: 0 });
  });

  describe("routing: Cloudflare 'active' is not enough (darjeelinghoney.com incident)", () => {
    async function addPending(hostname: string, provider: MockCustomDomainProvider) {
      const added = await addCustomDomain(rt, tenantId, { hostname, prevalidateTxt: true, provider });
      provider.setActive(hostname);
      return added;
    }

    it("keeps a domain out of 'active' while its DNS has no record, and names the problem", async () => {
      const provider = new MockCustomDomainProvider();
      const d = await addPending("norecord.brand-one.com", provider);
      const res = await verifyCustomDomain(rt, tenantId, d.id, provider, routingDeps({ a: [] }));
      expect(res.sslStatus).toBe("active");
      expect(res.status).toBe("awaiting_dns");
      expect(res.routingStatus).toBe("dns_missing");
      await removeCustomDomain(rt, tenantId, d.id, provider);
    });

    it("reports 'dns_wrong' and the addresses seen when the domain points at a parking page", async () => {
      const provider = new MockCustomDomainProvider();
      const d = await addPending("parked.brand-two.com", provider);
      const res = await verifyCustomDomain(rt, tenantId, d.id, provider, routingDeps({ a: ["84.32.84.32"] }));
      expect(res.status).toBe("awaiting_dns");
      expect(res.routingStatus).toBe("dns_wrong");
      expect(res.routingDetail?.a).toEqual(["84.32.84.32"]);
      await removeCustomDomain(rt, tenantId, d.id, provider);
    });

    it("stays pending when DNS points at us but the site does not answer yet", async () => {
      const provider = new MockCustomDomainProvider();
      const d = await addPending("slow.brand-three.com", provider);
      const res = await verifyCustomDomain(rt, tenantId, d.id, provider, routingDeps({ probe: "fail" }));
      expect(res.status).toBe("awaiting_dns");
      expect(res.routingStatus).toBe("dns_ok");
      expect(res.routingDetail?.probe).toBe("failed");
      await removeCustomDomain(rt, tenantId, d.id, provider);
    });

    it("becomes active only when DNS and the HTTP probe both pass; later failures degrade it after 3 checks, with audit rows", async () => {
      const provider = new MockCustomDomainProvider();
      const d = await addPending("good.brand-four.com", provider);
      const ok = await verifyCustomDomain(rt, tenantId, d.id, provider, routingDeps());
      expect(ok.status).toBe("active");
      expect(ok.routingStatus).toBe("reachable");

      const broken = routingDeps({ a: [] });
      const first = await verifyCustomDomain(rt, tenantId, d.id, provider, broken);
      const second = await verifyCustomDomain(rt, tenantId, d.id, provider, broken);
      expect(first.status).toBe("active");
      expect(second.status).toBe("active");
      const third = await verifyCustomDomain(rt, tenantId, d.id, provider, broken);
      expect(third.status).toBe("degraded");
      expect(third.routingDetail?.failures).toBe(3);

      const [degradedAudit] = await platformDb.db
        .select()
        .from(schema.auditLogs)
        .where(and(eq(schema.auditLogs.tenantId, tenantId), eq(schema.auditLogs.action, "domain.degraded"), eq(schema.auditLogs.targetId, d.id)));
      expect(degradedAudit?.actorType).toBe("system");

      // A degraded domain is still resolvable by the host resolver (it is not removed) and recovers by itself.
      const back = await verifyCustomDomain(rt, tenantId, d.id, provider, routingDeps());
      expect(back.status).toBe("active");
      expect(back.routingDetail?.failures).toBe(0);
      const [recoveredAudit] = await platformDb.db
        .select()
        .from(schema.auditLogs)
        .where(and(eq(schema.auditLogs.tenantId, tenantId), eq(schema.auditLogs.action, "domain.recovered"), eq(schema.auditLogs.targetId, d.id)));
      expect(recoveredAudit).toBeDefined();
      await removeCustomDomain(rt, tenantId, d.id, provider);
    });

    it("sweep re-checks only active domains that were not checked in the last day", async () => {
      const provider = new MockCustomDomainProvider();
      const d = await addPending("daily.brand-five.com", provider);
      await verifyCustomDomain(rt, tenantId, d.id, provider, routingDeps());
      const fresh = await sweepPendingCustomDomains(rwDb.db, { provider, routingDeps: routingDeps({ a: [] }) });
      const [still] = await rwDb.db.select().from(schema.domains).where(eq(schema.domains.id, d.id));
      expect(still?.status).toBe("active");
      expect(still?.routingStatus).toBe("reachable");
      expect(fresh.checked).toBe(0);

      await rwDb.db.update(schema.domains).set({ routingCheckedAt: new Date(Date.now() - 25 * 3_600_000) }).where(eq(schema.domains.id, d.id));
      const stale = await sweepPendingCustomDomains(rwDb.db, { provider, routingDeps: routingDeps({ a: [] }) });
      expect(stale.checked).toBe(1);
      const [after] = await rwDb.db.select().from(schema.domains).where(eq(schema.domains.id, d.id));
      expect(after?.routingStatus).toBe("dns_missing");
      expect((after?.routingDetail as { failures: number }).failures).toBe(1);
      await removeCustomDomain(rt, tenantId, d.id, provider);
    });

    it("probe lookup answers for a domain in any status and never for an unknown host", async () => {
      const provider = new MockCustomDomainProvider();
      const d = await addPending("probe.brand-six.com", provider);
      expect(d.status).not.toBe("active");
      expect(await lookupDomainIdForProbe(rwDb.db, "Probe.Brand-Six.com:443")).toBe(d.id);
      expect(await lookupDomainIdForProbe(rwDb.db, "unknown.nowhere-example.com")).toBeNull();
      await removeCustomDomain(rt, tenantId, d.id, provider);
      expect(await lookupDomainIdForProbe(rwDb.db, "probe.brand-six.com")).toBeNull();
    });
  });

  it("removes custom domain and automatically reassigns primary back to platform subdomain", async () => {
    const res = await removeCustomDomain(rt, tenantId, customDomainId, mockProvider);
    expect(res.success).toBe(true);

    const domains = await listTenantDomains(rt, tenantId);
    expect(domains).toHaveLength(1);
    expect(domains[0]!.type).toMatch(/subdomain/);
    expect(domains[0]!.isPrimary).toBe(true); // Restored as primary!
  });

  function ctxFor(tId: string, perms: string[] = ["domains.manage", "settings.read"]): TenantContext {
    return {
      tenantId: tId,
      storeStatus: "live",
      actor: { type: "staff", userId: "0199a000-0000-7000-8000-000000000001" },
      roles: ["store_owner"],
      permissions: perms,
      requestId: "req-domain-test",
    };
  }

  it("enforces permissions and writes audit logs for domain mutations", async () => {
    const adminCtx = ctxFor(tenantId, ["domains.manage", "settings.read"]);
    const deniedCtx = ctxFor(tenantId, ["analytics.read"]);

    // Permission checks
    await expect(listTenantDomains(rt, deniedCtx)).rejects.toThrow(/Forbidden/);
    await expect(addCustomDomain(rt, deniedCtx, { hostname: "denied.example.com", provider: mockProvider })).rejects.toThrow(/Forbidden/);

    // List with settings.read
    const listRes = await listTenantDomains(rt, adminCtx);
    expect(listRes).toBeDefined();

    // Add with domains.manage
    const added = await addCustomDomain(rt, adminCtx, {
      hostname: "audit.example.com",
      provider: mockProvider,
    });
    expect(added.hostname).toBe("audit.example.com");

    // Check audit log for domain.add
    const [addAudit] = await platformDb.db
      .select()
      .from(schema.auditLogs)
      .where(and(eq(schema.auditLogs.tenantId, tenantId), eq(schema.auditLogs.action, "domain.add"), eq(schema.auditLogs.targetId, added.id)));
    expect(addAudit).toBeDefined();
    expect(addAudit?.targetType).toBe("custom_domain");
    expect(JSON.stringify(addAudit?.diff)).not.toContain("cfCustomHostnameId");
    expect(JSON.stringify(addAudit?.diff)).not.toContain("providerHostnameId");

    // Verify denial and success
    await expect(verifyCustomDomain(rt, deniedCtx, added.id, mockProvider)).rejects.toThrow(/Forbidden/);
    mockProvider.setActive("audit.example.com");
    const verified = await verifyCustomDomain(rt, adminCtx, added.id, mockProvider, routingDeps());
    expect(verified.status).toBe("active");

    const [verifyAudit] = await platformDb.db
      .select()
      .from(schema.auditLogs)
      .where(and(eq(schema.auditLogs.tenantId, tenantId), eq(schema.auditLogs.action, "domain.verify"), eq(schema.auditLogs.targetId, added.id)));
    expect(verifyAudit).toBeDefined();
    expect(JSON.stringify(verifyAudit?.diff)).not.toContain("cfCustomHostnameId");

    // Set primary denial and success
    await expect(setPrimaryDomain(rt, deniedCtx, added.id)).rejects.toThrow(/Forbidden/);
    const primRes = await setPrimaryDomain(rt, adminCtx, added.id);
    expect(primRes.success).toBe(true);

    const [primAudit] = await platformDb.db
      .select()
      .from(schema.auditLogs)
      .where(and(eq(schema.auditLogs.tenantId, tenantId), eq(schema.auditLogs.action, "domain.set_primary"), eq(schema.auditLogs.targetId, added.id)));
    expect(primAudit).toBeDefined();

    // Remove denial and success
    await expect(removeCustomDomain(rt, deniedCtx, added.id, mockProvider)).rejects.toThrow(/Forbidden/);
    await removeCustomDomain(rt, adminCtx, added.id, mockProvider);

    const [removeAudit] = await platformDb.db
      .select()
      .from(schema.auditLogs)
      .where(and(eq(schema.auditLogs.tenantId, tenantId), eq(schema.auditLogs.action, "domain.remove"), eq(schema.auditLogs.targetId, added.id)));
    expect(removeAudit).toBeDefined();
  });

  it("strictly refuses to remove or verify the platform subdomain", async () => {
    const adminCtx = ctxFor(tenantId, ["domains.manage", "settings.read"]);
    const domains = await listTenantDomains(rt, adminCtx);
    const platformSub = domains.find((d) => d.type === "subdomain" || d.type === "platform_subdomain");
    expect(platformSub).toBeDefined();

    await expect(removeCustomDomain(rt, adminCtx, platformSub!.id, mockProvider)).rejects.toThrow(
      "Cannot remove the default platform subdomain for the store."
    );
    await expect(verifyCustomDomain(rt, adminCtx, platformSub!.id, mockProvider)).rejects.toThrow(
      "Cannot verify or modify the default platform subdomain."
    );
  });

  it("VERIFIES Store 1 (store101.bcom.si) non-regression", async () => {
    const store1Rows = await rt._db.db.execute<{
      hostname: string;
      is_primary: boolean;
      status: string;
    }>(sql`
      SELECT hostname, is_primary, status FROM domains WHERE hostname = 'store101.bcom.si' LIMIT 1;
    `);

    expect(store1Rows.rows).toHaveLength(1);
    const store1Domain = store1Rows.rows[0]!;
    expect(store1Domain.hostname).toBe("store101.bcom.si");
    expect(store1Domain.is_primary).toBe(true);
    expect(store1Domain.status).toBe("active");
  });
});
