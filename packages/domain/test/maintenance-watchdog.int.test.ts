import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { schema, withTenant } from "@bs/db";
import { startTestDb, type TestDb } from "@bs/db/test-env";
import { createRuntime, executeMaintenanceWatchdogSweep, provisionTenant, type Runtime } from "../src/index.ts";

// The worker runs the sweep as app_rw. store_status is a tenant table under forced RLS, so the sweep must
// visit each tenant under its own context: a read without one sees nothing and the window silently lapses.
let env: TestDb;
let rtPlatform: Runtime;
let rtWorker: Runtime;
let tenantId: string;

async function setWindow(mode: string, startsInMin: number, endsInMin: number, before: string | null) {
  await withTenant(rtPlatform._db.db, tenantId, async (tx) => {
    const now = Date.now();
    const values = {
      mode,
      maintenanceStartsAt: new Date(now + startsInMin * 60_000),
      maintenanceEndsAt: new Date(now + endsInMin * 60_000),
      modeBeforeMaintenance: before,
    };
    const [existing] = await tx.select({ id: schema.storeStatus.id }).from(schema.storeStatus).where(eq(schema.storeStatus.tenantId, tenantId));
    if (existing) await tx.update(schema.storeStatus).set(values).where(eq(schema.storeStatus.id, existing.id));
    else await tx.insert(schema.storeStatus).values({ tenantId, ...values });
  });
}

async function readMode() {
  const [row] = await withTenant(rtPlatform._db.db, tenantId, (tx) =>
    tx.select({ mode: schema.storeStatus.mode }).from(schema.storeStatus).where(eq(schema.storeStatus.tenantId, tenantId)),
  );
  return row?.mode;
}

beforeAll(async () => {
  env = await startTestDb();
  rtPlatform = createRuntime({ service: "platform", databaseUrl: env.as("app_platform"), poolMax: 5 });
  rtWorker = createRuntime({ service: "worker", databaseUrl: env.as("app_rw"), poolMax: 5 });
  const slug = `watchdog-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  const t = await provisionTenant(rtPlatform, {
    storeName: slug,
    slug,
    owner: { email: `owner@${slug}.test`, name: "Owner" },
    planCode: "starter",
    source: "platform_admin",
  });
  tenantId = t.tenantId;
});

afterAll(async () => {
  await rtWorker?.close();
  await rtPlatform?.close();
  await env?.stop();
});

describe("maintenance watchdog sweep (as the worker role)", () => {
  it("starts a window that is due and restores the previous mode once it has passed", async () => {
    // Due: started a minute ago, ends in ten.
    await setWindow("live", -1, 10, null);
    const started = await executeMaintenanceWatchdogSweep(rtWorker._db.db);
    expect(started.startedCount).toBe(1);
    expect(await readMode()).toBe("maintenance");

    // Passed: the window ended a minute ago.
    await setWindow("maintenance", -10, -1, "live");
    const restored = await executeMaintenanceWatchdogSweep(rtWorker._db.db);
    expect(restored.restoredCount).toBe(1);
    expect(await readMode()).toBe("live");
  });

  it("leaves a window that has not started yet alone", async () => {
    await setWindow("live", 30, 60, null);
    const res = await executeMaintenanceWatchdogSweep(rtWorker._db.db);
    expect(res).toEqual({ restoredCount: 0, startedCount: 0 });
    expect(await readMode()).toBe("live");
  });
});
