import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { createDb } from "@bs/db";
import { startTestDb, type TestDb } from "@bs/db/test-env";
import { STORE_PERMISSIONS } from "@bs/auth";
import { enableTenantFlags } from "./helpers/feature-flags.ts";
import { createRuntime, provisionTenant, type Jobs, type Runtime, type TenantContext } from "../src/index.ts";
import { createLazyJobSender } from "../src/system/job-sender.ts";
import { cancelScheduledMaintenance, scheduleMaintenance } from "../src/storefront/lifecycle.ts";

/**
 * The web service enqueues background jobs through a send-only pg-boss client (`createLazyJobSender`). Real Postgres:
 * the job really lands in `pgboss.job`, it starts a moment later (so the worker never looks for an uncommitted row),
 * and a queue problem never fails the caller.
 */
describe("web job queue (real Postgres)", () => {
  let env: TestDb;
  let rtPlatform: Runtime;
  let tenantId: string;
  let ownerId: string;

  beforeAll(async () => {
    env = await startTestDb();
    rtPlatform = createRuntime({ service: "platform", databaseUrl: env.as("app_platform"), poolMax: 4 });
    const t = await provisionTenant(rtPlatform, {
      storeName: "Web Queue Store",
      slug: `web-queue-${Date.now()}`,
      owner: { email: `owner-${Date.now()}@web-queue.test`, name: "Owner" },
      planCode: "starter",
      source: "platform_admin",
    });
    tenantId = t.tenantId;
    ownerId = t.ownerId;
    await enableTenantFlags(rtPlatform._db.db, tenantId, ["settings.maintenance"]);
  });

  afterAll(async () => {
    await rtPlatform?.close();
  });

  it("sends a real job that the worker will pick up shortly, as the web app's app_rw role", async () => {
    const sender = createLazyJobSender(env.as("app_rw"), { startAfterSeconds: 2 });
    expect(sender.isRunning()).toBe(true);

    const marker = `web-queue-${Date.now()}`;
    const id = await sender.send("order.created", { tenantId, orderId: marker });
    expect(typeof id).toBe("string");

    const reader = createDb(env.as("app_rw"), { max: 1, applicationName: "web-queue-test" });
    try {
      const res = await reader.db.execute<{ state: string; delay_s: string }>(sql`
        select state, extract(epoch from (start_after - created_on))::text as delay_s
        from pgboss.job where name = 'order.created' and data->>'orderId' = ${marker}
      `);
      const row = res.rows[0];
      expect(row?.state).toBe("created");
      // Starts about 2 seconds after it was sent, not at once
      expect(Number(row?.delay_s)).toBeGreaterThanOrEqual(1);
      expect(Number(row?.delay_s)).toBeLessThanOrEqual(4);
    } finally {
      await reader.close();
      await sender.stop();
    }
    expect(sender.isRunning()).toBe(false);
  });

  it("never fails the caller when the queue is unreachable: it logs and returns null", async () => {
    const logged: string[] = [];
    const sender = createLazyJobSender("postgres://nobody:none@127.0.0.1:1/none", {
      log: (message) => void logged.push(message),
    });
    await expect(sender.send("order.created", { tenantId, orderId: "x" })).resolves.toBeNull();
    expect(logged.some((m) => m.includes("order.created"))).toBe(true);
    await sender.close();
  });

  it("scheduling a maintenance window queues nothing: the watchdog starts and ends it on schedule", async () => {
    const sent: string[] = [];
    const jobs: Jobs = {
      isRunning: () => true,
      stop: async () => undefined,
      send: async (queue) => {
        sent.push(queue);
        return "job";
      },
    };
    const rt = createRuntime({ service: "web", databaseUrl: env.as("app_rw"), poolMax: 4, jobs });
    try {
      const ctx: TenantContext = {
        tenantId,
        storeStatus: "live",
        actor: { type: "staff", userId: ownerId },
        roles: ["owner", "store_owner"],
        permissions: STORE_PERMISSIONS,
        requestId: "test-web-queue",
      };
      const win = {
        startsAt: new Date(Date.now() + 3_600_000).toISOString(),
        endsAt: new Date(Date.now() + 7_200_000).toISOString(),
      };
      const status = await scheduleMaintenance(rt, ctx, win);
      // `maintenance.start` acts immediately when it runs, so it must not be queued for a future window
      expect(sent.filter((q) => q.startsWith("maintenance."))).toEqual([]);
      expect(status.mode).not.toBe("maintenance");
      await cancelScheduledMaintenance(rt, ctx);
    } finally {
      await rt.close();
    }
  });
});
