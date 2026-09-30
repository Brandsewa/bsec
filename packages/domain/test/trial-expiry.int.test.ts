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
  runTrialExpirySweep,
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
}, 180_000);

afterAll(async () => {
  await rwDb?.close();
  await platformDb?.close();
  await rt?.close();
  await rtPlatform?.close();
  await container?.stop();
});

describe("M8 Trial Lifecycle & Sweep Job (PLAN §6.4, §14)", () => {
  it("transitions expired trialing subscriptions to past_due while leaving active and non-expired trials untouched", async () => {
    // 1. Provision Store A (Trial expired)
    const storeA = await provisionTenant(rtPlatform, {
      storeName: "Trial Expired Store",
      slug: "trial-expired-store",
      owner: {
        email: "owner.expired@example.com",
        name: "Expired Owner",
      },
    });

    // Manually set current_period_end in the past (e.g. 2 days ago)
    const twoDaysAgo = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000);
    await platformDb.db
      .update(schema.subscriptions)
      .set({ currentPeriodEnd: twoDaysAgo })
      .where(eq(schema.subscriptions.id, storeA.subscriptionId));

    // 2. Provision Store B (Trial active, expires in 12 days)
    const storeB = await provisionTenant(rtPlatform, {
      storeName: "Trial Active Store",
      slug: "trial-active-store",
      owner: {
        email: "owner.active@example.com",
        name: "Active Owner",
      },
    });

    // 3. Provision Store C (Paid active subscription)
    const storeC = await provisionTenant(rtPlatform, {
      storeName: "Paid Active Store",
      slug: "paid-active-store",
      owner: {
        email: "owner.paid@example.com",
        name: "Paid Owner",
      },
    });
    await platformDb.db
      .update(schema.subscriptions)
      .set({ status: "active", currentPeriodEnd: twoDaysAgo })
      .where(eq(schema.subscriptions.id, storeC.subscriptionId));

    // Execute trial expiry sweep using platform privileges
    const result = await runTrialExpirySweep(platformDb.db);

    expect(result.expired).toBeGreaterThanOrEqual(1);
    expect(result.expiredSubscriptionIds).toContain(storeA.subscriptionId);
    expect(result.expiredSubscriptionIds).not.toContain(storeB.subscriptionId);
    expect(result.expiredSubscriptionIds).not.toContain(storeC.subscriptionId);

    // Verify database state
    const [subA] = await platformDb.db
      .select()
      .from(schema.subscriptions)
      .where(eq(schema.subscriptions.id, storeA.subscriptionId));
    expect(subA?.status).toBe("past_due");

    const [subB] = await platformDb.db
      .select()
      .from(schema.subscriptions)
      .where(eq(schema.subscriptions.id, storeB.subscriptionId));
    expect(subB?.status).toBe("trialing");

    const [subC] = await platformDb.db
      .select()
      .from(schema.subscriptions)
      .where(eq(schema.subscriptions.id, storeC.subscriptionId));
    expect(subC?.status).toBe("active");
  });
});
