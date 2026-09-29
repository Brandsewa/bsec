import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { createDb, type DbHandle } from "@bs/db";
import { bootstrapRoles } from "@bs/db/bootstrap";
import { runMigrations } from "@bs/db/migrate";
import {
  createRuntime,
  type Runtime,
  getSystemMetrics,
} from "../src/index.ts";

const PW = { owner: "o_test", rw: "rw_test", platform: "p_test" };
let container: StartedPostgreSqlContainer | undefined;
let superUrl: string;
let rwDb: DbHandle;
let rt: Runtime;

function as(role: "app_owner" | "app_rw" | "app_platform", password: string): string {
  const u = new URL(superUrl);
  u.username = role;
  u.password = password;
  return u.toString();
}

// Unique fixture prefix for M7 monitoring tests: 0199a073
const orgId = "0199a073-0000-7000-8000-000000000000";
const tenantAId = "0199a073-0000-7000-8000-000000000001";
const tenantBId = "0199a073-0000-7000-8000-000000000002";
const tenantCId = "0199a073-0000-7000-8000-000000000003";

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
  rt = createRuntime({ service: "web", databaseUrl: as("app_rw", PW.rw), poolMax: 15 });

  const pgClient = new (await import("pg")).default.Client({ connectionString: superUrl });
  await pgClient.connect();
  await pgClient.query(`
    INSERT INTO organizations (id, name) VALUES ('${orgId}', 'Monitoring Org') ON CONFLICT DO NOTHING;
    INSERT INTO tenants (id, organization_id, slug, name)
    VALUES
      ('${tenantAId}', '${orgId}', 'mon-store-a', 'Monitoring Store A'),
      ('${tenantBId}', '${orgId}', 'mon-store-b', 'Monitoring Store B'),
      ('${tenantCId}', '${orgId}', 'mon-store-c', 'Monitoring Store C')
    ON CONFLICT DO NOTHING;
    DELETE FROM rate_limit_counters WHERE key LIKE '%0199a073%';
  `);
  await pgClient.end();
}, 180_000);

afterAll(async () => {
  await rwDb?.close();
  await rt?.close();
  await container?.stop();
});

describe("PLAN §14 Monitoring Signals & Saturation Thresholds (Milestone M7)", () => {
  it("collects system metrics and evaluates baseline signals as healthy", async () => {
    const report = await getSystemMetrics(rt, {
      simulatedP95Ms: 180, // healthy latency
    });

    expect(report.timestamp).toBeDefined();
    expect(report.signals).toBeDefined();
    expect(report.signals.cpu.value).toBeGreaterThanOrEqual(0);
    expect(report.signals.ram.value).toBeGreaterThanOrEqual(0);
    expect(report.signals.dbConnections.value).toBeGreaterThanOrEqual(0);
    expect(report.signals.uncachedP95.value).toBe(180);
    expect(report.signals.uncachedP95.status).toBe("ok");
    expect(report.details.db.activeConnections).toBeGreaterThan(0);
    expect(report.details.memory.heapUsedBytes).toBeGreaterThan(0);
  });

  it("detects Uncached p95 SLA warning (> 400ms) and scale trigger (> 500ms)", async () => {
    // 1. Warning case (420 ms)
    const warningReport = await getSystemMetrics(rt, {
      simulatedP95Ms: 420,
    });
    expect(warningReport.signals.uncachedP95.status).toBe("warning");
    expect(warningReport.signals.uncachedP95.action).toContain("Uncached p95 > 400 ms");
    expect(warningReport.activeAlerts).toContain("UncachedP95LatencyWarning");

    // 2. Scale trigger case (540 ms)
    const scaleReport = await getSystemMetrics(rt, {
      simulatedP95Ms: 540,
    });
    expect(scaleReport.signals.uncachedP95.status).toBe("scale_trigger");
    expect(scaleReport.signals.uncachedP95.action).toContain("500 ms SLA violated");
    expect(scaleReport.activeAlerts).toContain("UncachedP95LatencyScaleTrigger");
    expect(scaleReport.overallStatus).toBe("scale_trigger");
  });

  it("calculates single store load share and detects noisy neighbour warning (>20%) and scale trigger (>25%)", async () => {
    // Seed rate limit counter entries to simulate request load across 3 stores:
    // Store A: 70 requests (70% of 100) -> Noisy Neighbour Trigger!
    // Store B: 20 requests (20%)
    // Store C: 10 requests (10%)
    const pg = new (await import("pg")).default.Client({ connectionString: superUrl });
    await pg.connect();
    await pg.query(`
      DELETE FROM rate_limit_counters;
      INSERT INTO rate_limit_counters (key, count, expires_at)
      VALUES
        ('rate:storefront:tenant:${tenantAId}', 70, now() + interval '10 minutes'),
        ('rate:storefront:tenant:${tenantBId}', 20, now() + interval '10 minutes'),
        ('rate:storefront:tenant:${tenantCId}', 10, now() + interval '10 minutes');
    `);
    await pg.end();

    const report = await getSystemMetrics(rt);

    expect(report.signals.singleStoreLoadShare.value).toBe(70);
    expect(report.signals.singleStoreLoadShare.status).toBe("scale_trigger");
    expect(report.signals.singleStoreLoadShare.topTenantId).toBe(tenantAId);
    expect(report.activeAlerts).toContain("SingleStoreLoadShareScaleTrigger");
    expect(report.signals.singleStoreLoadShare.action).toContain("consumes 70% of platform traffic");

    // Verify per-tenant detail breakdown
    const tenantBreakdown = report.details.tenants;
    expect(tenantBreakdown.length).toBe(3);
    const storeA = tenantBreakdown.find((t) => t.tenantId === tenantAId);
    expect(storeA?.sharePercent).toBe(70);
    expect(storeA?.requestCount).toBe(70);
  });

  it("returns null for uncached p95 when telemetry is absent instead of fabricating 180ms", async () => {
    const report = await getSystemMetrics(rt);
    expect(report.signals.uncachedP95.value).toBeNull();
    expect(report.signals.uncachedP95.status).toBe("ok");
  });

  it("reports DBUnreachable and scale_trigger status if database query fails", async () => {
    const badRt = {
      ...rt,
      _db: {
        db: {
          execute: async () => {
            throw new Error("Connection refused");
          },
        },
      },
    } as unknown as Runtime;

    const report = await getSystemMetrics(badRt);
    expect(report.overallStatus).toBe("scale_trigger");
    expect(report.signals.dbConnections.status).toBe("scale_trigger");
    expect(report.activeAlerts).toContain("DBUnreachable");
  });

  it("respects custom threshold overrides for specialized environments", async () => {
    const report = await getSystemMetrics(rt, {
      simulatedP95Ms: 250,
      customThresholds: {
        uncachedP95: { warning: 200, scaleTrigger: 300 }, // stricter SLO for premium tier
      },
    });

    expect(report.signals.uncachedP95.status).toBe("warning");
    expect(report.signals.uncachedP95.warningThreshold).toBe(200);
    expect(report.signals.uncachedP95.scaleTriggerThreshold).toBe(300);
  });
});
