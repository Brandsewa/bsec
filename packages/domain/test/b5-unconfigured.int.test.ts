import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq, desc } from "drizzle-orm";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { createDb, type DbHandle, schema } from "@bs/db";
import { bootstrapRoles } from "@bs/db/bootstrap";
import { runMigrations } from "@bs/db/migrate";
import {
  createRuntime,
  type Runtime,
  provisionTenant,
  changeTenantPlan,
  cancelTenantSubscription,
  RazorpaySubscriptionProvider,
  type SubscriptionBillingProvider,
  addCustomDomain,
  CloudflareCustomDomainProvider,
} from "../src/index.ts";

const PW = { owner: "o_test", rw: "rw_test", platform: "p_test" };
let container: StartedPostgreSqlContainer | undefined;
let superUrl: string;
let platformDb: DbHandle;
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
  platformDb = createDb(as("app_platform", PW.platform), { max: 10 });
  rtPlatform = createRuntime({ service: "platform", databaseUrl: as("app_platform", PW.platform), poolMax: 10 });
}, 180_000);

afterAll(async () => {
  await platformDb?.close();
  await rtPlatform?.close();
  await container?.stop();
});

describe("B5: Honest unconfigured providers (Razorpay & Cloudflare)", () => {
  it("changeTenantPlan and cancelSubscription reject with honest 'billing not configured' error when unconfigured", async () => {
    const slug = "unconfigured-billing-store";
    const provisionResult = await provisionTenant(rtPlatform, {
      storeName: "Unconfigured Billing Store",
      slug,
      owner: { email: "owner@unconf.com", name: "Unconfigured Owner" },
      planCode: "starter",
    });

    const tenantId = provisionResult.tenantId;
    const unconfiguredProvider = new RazorpaySubscriptionProvider({
      keyId: "",
      keySecret: "",
      webhookSecret: "",
    });

    // 1. changeTenantPlan must throw "billing not configured"
    await expect(
      changeTenantPlan(rtPlatform, {
        tenantId,
        planCode: "growth",
        interval: "monthly",
        customerEmail: "owner@unconf.com",
        provider: unconfiguredProvider,
      })
    ).rejects.toThrow(/billing is not configured/i);

    // 2. cancelSubscription must throw "billing not configured"
    await expect(
      cancelTenantSubscription(rtPlatform, tenantId, unconfiguredProvider)
    ).rejects.toThrow(/billing is not configured/i);
  });

  it("addCustomDomain keeps domain in 'requested' with 'not configured' status when Cloudflare is unconfigured", async () => {
    const slug = "unconfigured-cf-store";
    const provisionResult = await provisionTenant(rtPlatform, {
      storeName: "Unconfigured CF Store",
      slug,
      owner: { email: "owner@unconfcf.com", name: "CF Owner" },
      planCode: "growth",
    });

    const tenantId = provisionResult.tenantId;
    const unconfiguredProvider = new CloudflareCustomDomainProvider({
      apiToken: "",
      zoneId: "",
    });

    const domainRecord = await addCustomDomain(rtPlatform, tenantId, {
      hostname: "shop.honestdomain.org",
      provider: unconfiguredProvider,
    });

    // Domain must stay in requested and show "not configured", no fabricated TXT or CNAME
    expect(domainRecord.status).toBe("requested");
    expect(domainRecord.sslStatus).toBe("not_configured");
    expect(domainRecord.verification).toBeNull();
    expect(domainRecord.cfCustomHostnameId).toBeNull();
  });

  it("configured mode fails clearly when Razorpay plan ID is missing, and applies plan change only after webhook confirms", async () => {
    const slug = "conf-billing-store";
    const provisionResult = await provisionTenant(rtPlatform, {
      storeName: "Configured Billing Store",
      slug,
      owner: { email: "owner@confbill.com", name: "Conf Owner" },
      planCode: "starter",
    });
    const tenantId = provisionResult.tenantId;

    // Mock configured provider
    const configuredProvider: SubscriptionBillingProvider = {
      isConfigured: () => true,
      createSubscription: async () => ({
        providerSubscriptionId: "sub_real_12345",
        status: "created",
      }),
      cancelSubscription: async () => ({ status: "cancelled" }),
      verifyWebhookSignature: () => true,
    };

    // 1. Without razorpay_plan_id on the plans row, changeTenantPlan must fail clearly
    await expect(
      changeTenantPlan(rtPlatform, {
        tenantId,
        planCode: "pro",
        interval: "monthly",
        customerEmail: "owner@confbill.com",
        provider: configuredProvider,
      })
    ).rejects.toThrow(/has no Razorpay plan ID configured/i);

    // 2. Set razorpay_plan_id_monthly on the pro plan
    await platformDb.db
      .update(schema.plans)
      .set({ razorpayPlanIdMonthly: "plan_RzpProMonthly123" })
      .where(eq(schema.plans.code, "pro"));

    // 3. Call changeTenantPlan: it should succeed, but NOT change the active plan yet!
    const changeRes = await changeTenantPlan(rtPlatform, {
      tenantId,
      planCode: "pro",
      interval: "monthly",
      customerEmail: "owner@confbill.com",
      provider: configuredProvider,
    });
    expect(changeRes.providerSubscriptionId).toBe("sub_real_12345");

    // Verify DB: existing subscription still has starter planId, NOT pro!
    const [subBeforeWebhook] = await platformDb.db
      .select()
      .from(schema.subscriptions)
      .where(eq(schema.subscriptions.tenantId, tenantId))
      .orderBy(desc(schema.subscriptions.createdAt))
      .limit(1);

    const [starterPlan] = await platformDb.db
      .select()
      .from(schema.plans)
      .where(eq(schema.plans.code, "starter"))
      .limit(1);
    expect(subBeforeWebhook!.planId).toBe(starterPlan!.id);
  });
});


