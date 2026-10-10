import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { schema } from "@bs/db";
import { startTestDb, type TestDb } from "@bs/db/test-env";
import { seedPlatformStaff } from "@bs/db/test-fixtures";
import { sql } from "drizzle-orm";
import {
  createRuntime,
  provisionTenant,
  type Runtime,
} from "../src/index.ts";
import {
  getPlatformIntegrationsOverview,
  getPlatformChannelStats,
  getPlatformChannelTransactions,
} from "../src/platform/integrations-hub.ts";
import { getPlatformStorageStats } from "../src/platform/storage-connections.ts";

let env: TestDb;
let rt: Runtime;
let staffUserId: string;
let tenantId: string;

beforeAll(async () => {
  env = await startTestDb();
  rt = createRuntime({ service: "platform", databaseUrl: env.as("app_platform"), poolMax: 4 });

  const staff = await seedPlatformStaff(rt._db.db, {
    email: "integrations-test@platform.test",
    role: "platform_admin",
  });
  staffUserId = staff.userId;

  const t = await provisionTenant(rt, {
    storeName: "Integrations Hub Test Store",
    slug: `int-hub-${Math.random().toString(36).slice(2, 7)}`,
    owner: { email: "owner@inthub.test", name: "Store Owner" },
    planCode: "growth",
    source: "platform_admin",
    actorUserId: staffUserId,
  });
  tenantId = t.tenantId;

  // Clean existing email logs from previous tests for clean count comparison
  await rt._db.db.delete(schema.platformEmailLog);

  // Seed sample email logs:
  // - 3 sent, 2 failed, 1 skipped in the last 6 hours (within 24h, 7d, 30d)
  // - 2 sent, 1 failed 3 days ago (within 7d, 30d)
  // - 4 sent, 2 failed 15 days ago (within 30d)
  // - 1 sent 40 days ago (outside 30d)
  const db = rt._db.db;

  // Within 6h
  for (let i = 0; i < 3; i++) {
    await db.insert(schema.platformEmailLog).values({
      tenantId,
      toEmail: `customer-recent-${i}@example.com`,
      template: "order_confirmation",
      status: "sent",
      providerMessageId: `msg-recent-sent-${i}`,
      createdAt: new Date(Date.now() - 2 * 60 * 60 * 1000), // 2h ago
    });
  }
  for (let i = 0; i < 2; i++) {
    await db.insert(schema.platformEmailLog).values({
      tenantId,
      toEmail: `customer-recent-fail-${i}@example.com`,
      template: "welcome_email",
      status: "failed",
      error: "SMTP connection refused",
      createdAt: new Date(Date.now() - 3 * 60 * 60 * 1000), // 3h ago
    });
  }
  await db.insert(schema.platformEmailLog).values({
    tenantId,
    toEmail: "customer-recent-skip@example.com",
    template: "password_reset",
    status: "skipped",
    error: "Mailer disabled in test mode",
    createdAt: new Date(Date.now() - 4 * 60 * 60 * 1000), // 4h ago
  });

  // 3 days ago
  for (let i = 0; i < 2; i++) {
    await db.insert(schema.platformEmailLog).values({
      tenantId,
      toEmail: `customer-3d-${i}@example.com`,
      template: "shipping_update",
      status: "sent",
      providerMessageId: `msg-3d-sent-${i}`,
      createdAt: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000),
    });
  }
  await db.insert(schema.platformEmailLog).values({
    tenantId,
    toEmail: "customer-3d-fail@example.com",
    template: "shipping_update",
    status: "failed",
    error: "Invalid recipient syntax",
    createdAt: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000),
  });

  // 15 days ago
  for (let i = 0; i < 4; i++) {
    await db.insert(schema.platformEmailLog).values({
      tenantId,
      toEmail: `customer-15d-${i}@example.com`,
      template: "abandoned_cart",
      status: "sent",
      providerMessageId: `msg-15d-sent-${i}`,
      createdAt: new Date(Date.now() - 15 * 24 * 60 * 60 * 1000),
    });
  }
  for (let i = 0; i < 2; i++) {
    await db.insert(schema.platformEmailLog).values({
      tenantId,
      toEmail: `customer-15d-fail-${i}@example.com`,
      template: "abandoned_cart",
      status: "failed",
      error: "Domain not found",
      createdAt: new Date(Date.now() - 15 * 24 * 60 * 60 * 1000),
    });
  }

  // 40 days ago
  await db.insert(schema.platformEmailLog).values({
    tenantId,
    toEmail: "customer-40d@example.com",
    template: "welcome_email",
    status: "sent",
    providerMessageId: "msg-40d-sent",
    createdAt: new Date(Date.now() - 40 * 24 * 60 * 60 * 1000),
  });
}, 180_000);

afterAll(async () => {
  await rt?.close();
  await env?.stop();
});

describe("Integrations Hub & Channel Stats (Phase 4 Plan 6.1-6.5)", () => {
  it("Email stats exactly equal direct SQL counts of platform_email_log for 24h, 7d, 30d", async () => {
    const db = rt._db.db;

    const ranges: Array<"24h" | "7d" | "30d"> = ["24h", "7d", "30d"];

    for (const range of ranges) {
      const stats = await getPlatformChannelStats(rt, staffUserId, {
        channel: "email",
        range,
      });

      const intervalSql =
        range === "24h"
          ? sql`interval '24 hours'`
          : range === "30d"
            ? sql`interval '30 days'`
            : sql`interval '7 days'`;

      // Direct SQL queries for the exact same interval
      const [sqlSent] = await db
        .select({ count: sql<string>`count(*)` })
        .from(schema.platformEmailLog)
        .where(
          sql`${schema.platformEmailLog.createdAt} >= now() - ${intervalSql} AND ${schema.platformEmailLog.status} = 'sent'`,
        );

      const [sqlFailed] = await db
        .select({ count: sql<string>`count(*)` })
        .from(schema.platformEmailLog)
        .where(
          sql`${schema.platformEmailLog.createdAt} >= now() - ${intervalSql} AND ${schema.platformEmailLog.status} = 'failed'`,
        );

      const [sqlSkipped] = await db
        .select({ count: sql<string>`count(*)` })
        .from(schema.platformEmailLog)
        .where(
          sql`${schema.platformEmailLog.createdAt} >= now() - ${intervalSql} AND ${schema.platformEmailLog.status} = 'skipped'`,
        );

      const directSent = Number(sqlSent?.count ?? 0);
      const directFailed = Number(sqlFailed?.count ?? 0);
      const directSkipped = Number(sqlSkipped?.count ?? 0);
      const directTotal = directSent + directFailed + directSkipped;

      expect(stats.sent).toBe(directSent);
      expect(stats.failed).toBe(directFailed);
      expect(stats.skipped).toBe(directSkipped);
      expect(stats.total).toBe(directTotal);

      // Verify daily sums match total counts
      const dailySentSum = stats.daily.reduce((acc, d) => acc + d.sent, 0);
      const dailyFailedSum = stats.daily.reduce((acc, d) => acc + d.failed, 0);
      const dailySkippedSum = stats.daily.reduce((acc, d) => acc + d.skipped, 0);

      expect(dailySentSum).toBe(directSent);
      expect(dailyFailedSum).toBe(directFailed);
      expect(dailySkippedSum).toBe(directSkipped);
    }
  });

  it("lists channel transactions with filters and never exposes bodies or passwords", async () => {
    // 1. All transactions
    const all = await getPlatformChannelTransactions(rt, staffUserId, {
      channel: "email",
      limit: 50,
    });
    expect(all.total).toBeGreaterThanOrEqual(15);
    expect(all.items.length).toBeGreaterThan(0);

    // Schema inspection: recipient, template, status, providerMessageId present, no body/password
    const item = all.items[0]!;
    expect(item).toHaveProperty("recipient");
    expect(item).toHaveProperty("template");
    expect(item).toHaveProperty("status");
    expect(item).toHaveProperty("createdAt");
    expect((item as Record<string, unknown>).body).toBeUndefined();
    expect((item as Record<string, unknown>).password).toBeUndefined();

    // 2. Filter: failedOnly
    const failedOnly = await getPlatformChannelTransactions(rt, staffUserId, {
      channel: "email",
      failedOnly: true,
    });
    expect(failedOnly.items.every((it) => it.status === "failed")).toBe(true);
    expect(failedOnly.total).toBe(5); // 2 recent + 1 3d + 2 15d

    // 3. Filter: template
    const templateFiltered = await getPlatformChannelTransactions(rt, staffUserId, {
      channel: "email",
      template: "abandoned_cart",
    });
    expect(templateFiltered.total).toBe(6);
    expect(templateFiltered.items.every((it) => it.template === "abandoned_cart")).toBe(true);

    // 4. Search filter
    const searchFiltered = await getPlatformChannelTransactions(rt, staffUserId, {
      channel: "email",
      search: "customer-recent-0",
    });
    expect(searchFiltered.total).toBe(1);
    expect(searchFiltered.items[0]?.recipient).toBe("customer-recent-0@example.com");
  });

  it("returns overview metrics covering channels, storage, and payments", async () => {
    // Heavy test files share one database in CI; other files leave SMS and WhatsApp providers behind.
    await rt._db.db.delete(schema.platformChannelProviders);
    const overview = await getPlatformIntegrationsOverview(rt, staffUserId);

    expect(overview.channels.email).toBeDefined();
    expect(overview.channels.email.sent7d).toBeGreaterThanOrEqual(5); // 3 recent + 2 from 3d ago
    expect(overview.channels.email.failed7d).toBeGreaterThanOrEqual(3); // 2 recent + 1 from 3d ago

    expect(overview.channels.sms.status).toBe("not_enrolled");
    expect(overview.channels.whatsapp.status).toBe("not_enrolled");

    expect(overview.storage).toBeDefined();
    expect(overview.storage.totalBytes).toBeGreaterThanOrEqual(0);
    expect(overview.payments.enabledProviders).toContain("razorpay");
  });

  it("storage stats return aggregate bytes and tenant breakdown", async () => {
    // Seed media record for tenant
    await rt._db.db.insert(schema.media).values({
      tenantId,
      storageKey: "test-stats-key.png",
      mime: "image/png",
      bytes: 1048576, // 1 MB
    });

    const stats = await getPlatformStorageStats(rt, staffUserId);
    expect(stats.totalBytes).toBeGreaterThanOrEqual(1048576);
    expect(stats.totalFiles).toBeGreaterThanOrEqual(1);

    const storeTenant = stats.topTenants.find((t) => t.tenantId === tenantId);
    expect(storeTenant).toBeDefined();
    expect(storeTenant?.bytes).toBeGreaterThanOrEqual(1048576);
  });
});
