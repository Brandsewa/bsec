import { createHmac } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { createDb, type DbHandle, schema } from "@bs/db";
import { bootstrapRoles } from "@bs/db/bootstrap";
import { runMigrations } from "@bs/db/migrate";
import { eq } from "drizzle-orm";
import {
  createRuntime,
  type Runtime,
  provisionTenant,
  getTenantSubscription,
  changeTenantPlan,
  handlePlatformBillingWebhook,
  RazorpaySubscriptionProvider,
} from "../src/index.ts";

const PW = { owner: "o_test", rw: "rw_test", platform: "p_test" };
let container: StartedPostgreSqlContainer | undefined;
let superUrl: string;
let rwDb: DbHandle;
let platformDb: DbHandle;
let rt: Runtime;
let rtPlatform: Runtime;

const TEST_WEBHOOK_SECRET = "whsec_test_secret_platform_billing_12345";
const providerWithSecret = new RazorpaySubscriptionProvider({
  webhookSecret: TEST_WEBHOOK_SECRET,
});

function signPayload(payloadString: string, secret: string = TEST_WEBHOOK_SECRET): string {
  return createHmac("sha256", secret).update(payloadString).digest("hex");
}

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
  rtPlatform = createRuntime({ service: "platform", databaseUrl: as("app_platform", PW.platform), poolMax: 15 });
}, 180_000);

afterAll(async () => {
  await rwDb?.close();
  await platformDb?.close();
  await rt?.close();
  await rtPlatform?.close();
  await container?.stop();
});

describe("M8 Platform Merchant Subscriptions & Billing Lifecycle (ADR-014, PLAN §5.1, §6.4, §14)", () => {
  let tenantId: string;
  const testSubId = "sub_live_rzp_test_88192";

  it("provisions a store on 14-day trial and returns trial status and days remaining", async () => {
    const slug = "billing-store-01";
    const result = await provisionTenant(rtPlatform, {
      storeName: "Billing Store One",
      slug,
      planCode: "starter",
      owner: {
        email: "merchant.billing@example.com",
        name: "Billing Merchant",
        phone: "+919876543210",
        password: "SecurePassword123!",
      },
    });

    tenantId = result.tenantId;
    expect(tenantId).toBeDefined();

    const billingInfo = await getTenantSubscription(rtPlatform, tenantId);
    expect(billingInfo.subscription).not.toBeNull();
    expect(billingInfo.subscription?.status).toBe("trialing");
    expect(billingInfo.subscription?.interval).toBe("monthly");
    expect(billingInfo.isTrial).toBe(true);
    expect(billingInfo.daysLeftInTrial).toBeGreaterThanOrEqual(13);
    expect(billingInfo.plan?.code).toBe("starter");
    expect(billingInfo.invoices).toHaveLength(0);
  });

  it("rejects webhook with invalid signature with 400", async () => {
    const rawBody = JSON.stringify({ event: "subscription.charged", id: "evt_invalid_01" });
    const invalidSig = "bad_signature_000000000000000000000000000000000000000000000000000000";

    await expect(
      handlePlatformBillingWebhook(rtPlatform, {
        rawBody,
        signature: invalidSig,
        provider: providerWithSecret,
      }),
    ).rejects.toThrow("Invalid platform billing webhook signature");
  });

  it("processes subscription.charged webhook, activates subscription, sets tier and issues GST invoice", async () => {
    const payload = {
      entity: "event",
      account_id: "acc_test_platform",
      event: "subscription.charged",
      event_id: "evt_charged_0199a086_01",
      payload: {
        subscription: {
          entity: {
            id: testSubId,
            plan_id: "plan_starter_monthly",
            status: "active",
            current_start: Math.floor(Date.now() / 1000),
            current_end: Math.floor((Date.now() + 30 * 24 * 60 * 60 * 1000) / 1000),
            notes: {
              tenant_id: tenantId,
              plan_code: "starter",
            },
          },
        },
        payment: {
          entity: {
            id: "pay_test_platform_1122",
            amount: 99900,
            currency: "INR",
            status: "captured",
            method: "upi",
          },
        },
      },
    };

    const rawBody = JSON.stringify(payload);
    const signature = signPayload(rawBody);

    const result = await handlePlatformBillingWebhook(rtPlatform, {
      rawBody,
      signature,
      provider: providerWithSecret,
    });

    expect(result.received).toBe(true);
    expect(result.actionTaken).toBe("subscription_activated_and_invoiced");

    // Verify subscription state
    const billingInfo = await getTenantSubscription(rtPlatform, tenantId);
    expect(billingInfo.subscription?.status).toBe("active");
    expect(billingInfo.subscription?.providerSubscriptionId).toBe(testSubId);
    expect(billingInfo.isTrial).toBe(false);

    // Verify platform GST tax invoice
    expect(billingInfo.invoices).toHaveLength(1);
    const inv = billingInfo.invoices[0]!;
    expect(inv.number).toMatch(/^INV-\d{6}-[A-F0-9]{6}$/);
    expect(inv.amountPaise).toBe(99900);
    expect(inv.taxPaise).toBe(Math.round((99900 * 18) / 118));
    expect(inv.status).toBe("paid");

    // Verify size tier was updated to S
    const [tierRow] = await rtPlatform._db.db
      .select()
      .from(schema.tenantSizeTiers)
      .where(eq(schema.tenantSizeTiers.tenantId, tenantId))
      .limit(1);
    expect(tierRow?.tier).toBe("S");
  });

  it("processes duplicate webhook idempotently without issuing duplicate invoices", async () => {
    const payload = {
      entity: "event",
      account_id: "acc_test_platform",
      event: "subscription.charged",
      event_id: "evt_charged_0199a086_01", // Exact duplicate event ID
      payload: {
        subscription: {
          entity: {
            id: testSubId,
            status: "active",
            notes: { tenant_id: tenantId },
          },
        },
        payment: {
          entity: {
            amount: 99900,
          },
        },
      },
    };

    const rawBody = JSON.stringify(payload);
    const signature = signPayload(rawBody);

    const result = await handlePlatformBillingWebhook(rtPlatform, {
      rawBody,
      signature,
      provider: providerWithSecret,
    });

    expect(result.received).toBe(true);
    expect(result.duplicate).toBe(true);

    // Verify invoice count did NOT increase
    const billingInfo = await getTenantSubscription(rtPlatform, tenantId);
    expect(billingInfo.invoices).toHaveLength(1);
  });

  it("transitions subscription to past_due on subscription.halted", async () => {
    const payload = {
      entity: "event",
      account_id: "acc_test_platform",
      event: "subscription.halted",
      event_id: "evt_halted_0199a086_02",
      payload: {
        subscription: {
          entity: {
            id: testSubId,
            status: "halted",
          },
        },
      },
    };

    const rawBody = JSON.stringify(payload);
    const signature = signPayload(rawBody);

    const result = await handlePlatformBillingWebhook(rtPlatform, {
      rawBody,
      signature,
      provider: providerWithSecret,
    });

    expect(result.received).toBe(true);
    expect(result.actionTaken).toBe("subscription_past_due");

    const billingInfo = await getTenantSubscription(rtPlatform, tenantId);
    expect(billingInfo.subscription?.status).toBe("past_due");
  });

  it("transitions subscription to cancelled on subscription.cancelled", async () => {
    const payload = {
      entity: "event",
      account_id: "acc_test_platform",
      event: "subscription.cancelled",
      event_id: "evt_cancelled_0199a086_03",
      payload: {
        subscription: {
          entity: {
            id: testSubId,
            status: "cancelled",
          },
        },
      },
    };

    const rawBody = JSON.stringify(payload);
    const signature = signPayload(rawBody);

    const result = await handlePlatformBillingWebhook(rtPlatform, {
      rawBody,
      signature,
      provider: providerWithSecret,
    });

    expect(result.received).toBe(true);
    expect(result.actionTaken).toBe("subscription_cancelled");

    const billingInfo = await getTenantSubscription(rtPlatform, tenantId);
    expect(billingInfo.subscription?.status).toBe("cancelled");
  });

  it("initiates plan upgrade to growth plan and updates subscription", async () => {
    // 1. Ensure growth plan has razorpayPlanIdYearly
    await platformDb.db
      .update(schema.plans)
      .set({ razorpayPlanIdYearly: "plan_rzp_growth_yr_123" })
      .where(eq(schema.plans.code, "growth"));

    const mockProvider = {
      isConfigured: () => true,
      createSubscription: async () => ({
        providerSubscriptionId: "sub_rzp_growth_yearly_999",
        status: "created",
      }),
      cancelSubscription: async () => ({ status: "cancelled" }),
      verifyWebhookSignature: () => true,
    };

    const result = await changeTenantPlan(rtPlatform, {
      tenantId,
      planCode: "growth",
      interval: "yearly",
      customerEmail: "merchant.billing@example.com",
      provider: mockProvider as any,
    });

    expect(result.plan.code).toBe("growth");
    expect(result.providerSubscriptionId).toBe("sub_rzp_growth_yearly_999");

    // Before payment webhook, interval is updated but plan remains until confirmed
    const billingInfoBefore = await getTenantSubscription(rtPlatform, tenantId);
    expect(billingInfoBefore.subscription?.interval).toBe("yearly");
    expect(billingInfoBefore.plan?.code).toBe("starter");

    // 2. Deliver subscription.charged webhook for the growth plan upgrade
    const payload = {
      entity: "event",
      account_id: "acc_test_platform",
      event: "subscription.charged",
      event_id: "evt_upgrade_growth_01",
      payload: {
        subscription: {
          entity: {
            id: "sub_rzp_growth_yearly_999",
            status: "active",
            notes: {
              tenant_id: tenantId,
              plan_code: "growth",
            },
          },
        },
        payment: {
          entity: {
            id: "pay_growth_1122",
            amount: 2499000,
            currency: "INR",
            status: "captured",
          },
        },
      },
    };
    const rawBody = JSON.stringify(payload);
    const signature = signPayload(rawBody);

    await handlePlatformBillingWebhook(rtPlatform, {
      rawBody,
      signature,
      provider: providerWithSecret,
    });

    const billingInfoAfter = await getTenantSubscription(rtPlatform, tenantId);
    expect(billingInfoAfter.plan?.code).toBe("growth");
    expect(billingInfoAfter.subscription?.status).toBe("active");
  });
});
