import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { createDb, type DbHandle, schema } from "@bs/db";
import { bootstrapRoles } from "@bs/db/bootstrap";
import { runMigrations } from "@bs/db/migrate";
import { createHmac } from "node:crypto";
import { eq } from "drizzle-orm";
import {
  createRuntime,
  type Runtime,
  provisionTenant,
  handlePlatformBillingWebhook,
  RazorpaySubscriptionProvider,
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

describe("B4: Billing Webhook Idempotency & Validation", () => {
  it("delivers 3 identical signed realistic payloads (no event id in body) and asserts exactly one invoice and one subscription change", async () => {
    // 1. Provision a test tenant on starter plan
    const slug = "webhook-test-store";
    const provisionResult = await provisionTenant(rtPlatform, {
      storeName: "Webhook Test Store",
      slug,
      owner: {
        email: "merchant@webhooktest.com",
        name: "Webhook Merchant",
      },
      planCode: "starter",
    });

    const tenantId = provisionResult.tenantId;

    // 2. Prepare realistic Razorpay subscription.charged webhook payload with NO event_id and NO id in body
    const webhookSecret = "whsec_test_secret_1234567890123456";
    const subId = "sub_real_test_12345";

    // Set provider subscription id on the tenant's subscription record
    await platformDb.db
      .update(schema.subscriptions)
      .set({ providerSubscriptionId: subId })
      .where(eq(schema.subscriptions.tenantId, tenantId));

    const payloadObj = {
      entity: "event",
      account_id: "acc_test_platform",
      event: "subscription.charged",
      contains: ["subscription", "payment"],
      payload: {
        subscription: {
          entity: {
            id: subId,
            plan_id: "plan_growth_monthly",
            customer_id: "cust_test_1",
            status: "active",
            current_start: Math.floor(Date.now() / 1000),
            current_end: Math.floor(Date.now() / 1000) + 30 * 24 * 3600,
            notes: {
              tenant_id: tenantId,
            },
          },
        },
        payment: {
          entity: {
            id: "pay_test_payment_999",
            amount: 249900,
            currency: "INR",
            status: "captured",
            method: "upi",
          },
        },
      },
      created_at: Math.floor(Date.now() / 1000),
    };

    const rawBody = JSON.stringify(payloadObj);
    const signature = createHmac("sha256", webhookSecret).update(rawBody).digest("hex");

    const provider = new RazorpaySubscriptionProvider({
      keyId: "rzp_test_key",
      keySecret: "rzp_test_secret",
      webhookSecret,
    });

    // 3. Deliver 3 identical signed payloads sequentially (simulating 3 retries without X-Razorpay-Event-Id header)
    const res1 = await handlePlatformBillingWebhook(rtPlatform, {
      rawBody,
      signature,
      provider,
    });
    expect(res1.received).toBe(true);
    expect(res1.duplicate).toBeFalsy();

    const res2 = await handlePlatformBillingWebhook(rtPlatform, {
      rawBody,
      signature,
      provider,
    });
    expect(res2.received).toBe(true);
    expect(res2.duplicate).toBe(true);

    const res3 = await handlePlatformBillingWebhook(rtPlatform, {
      rawBody,
      signature,
      provider,
    });
    expect(res3.received).toBe(true);
    expect(res3.duplicate).toBe(true);

    // 4. Assert exactly ONE invoice was created
    const invoices = await platformDb.db
      .select()
      .from(schema.platformInvoices)
      .where(eq(schema.platformInvoices.tenantId, tenantId));
    expect(invoices).toHaveLength(1);
    expect(invoices[0]!.amountPaise).toBe(249900);
  });

  it("rejects subscription.charged when payment entity is missing", async () => {
    const webhookSecret = "whsec_test_secret_1234567890123456";
    const payloadNoPayment = {
      entity: "event",
      event: "subscription.charged",
      payload: {
        subscription: {
          entity: {
            id: "sub_no_payment",
            notes: { tenant_id: "0199a000-0000-7000-8000-000000000001" },
          },
        },
        // payment entity is missing!
      },
    };
    const rawBody = JSON.stringify(payloadNoPayment);
    const signature = createHmac("sha256", webhookSecret).update(rawBody).digest("hex");

    const provider = new RazorpaySubscriptionProvider({
      keyId: "rzp_test_key",
      keySecret: "rzp_test_secret",
      webhookSecret,
    });

    await expect(
      handlePlatformBillingWebhook(rtPlatform, {
        rawBody,
        signature,
        provider,
      })
    ).rejects.toThrow(/payment entity missing/i);
  });
});
