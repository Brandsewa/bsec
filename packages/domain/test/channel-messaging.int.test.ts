import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sql, eq } from "drizzle-orm";
import { schema } from "@bs/db";
import { startTestDb, type TestDb } from "@bs/db/test-env";
import { seedPlatformStaff } from "@bs/db/test-fixtures";
import {
  createRuntime,
  type Runtime,
  createPlatformChannelProvider,
  updatePlatformChannelProvider,
  deletePlatformChannelProvider,
  setDefaultPlatformChannelProvider,
  testPlatformChannelProvider,
  listPlatformChannelProviders,
  getPlatformChannelStats,
} from "../src/index.ts";
import { handleMaintenanceCleanupJob } from "../src/jobs.ts";
import { pino } from "pino";

let env: TestDb;
let rt: Runtime;
let staffId: string;

beforeAll(async () => {
  env = await startTestDb();
  rt = createRuntime({
    service: "platform",
    databaseUrl: env.as("app_platform"),
    poolMax: 5,
  });
  const staff = await seedPlatformStaff(rt._db.db, {
    email: "messaging-admin@platform.test",
    role: "platform_admin",
  });
  staffId = staff.userId;
}, 120_000);

afterAll(async () => {
  await rt?.close();
  await env?.stop();
});

describe("platform channel messaging (Zoho CPaaS SMS & WhatsApp, Real DB)", () => {
  it("creates provider with encrypted credentials, never returning plaintext secret", async () => {
    const provider = await createPlatformChannelProvider(rt, staffId, {
      channel: "sms",
      provider: "zoho_cpaas",
      displayName: "Zoho SMS Production",
      secret: "super-secret-zoho-cpaas-token-12345",
      config: {
        senderKey: "BRANDSEWA",
        entityId: "1101550000000001",
        templateMap: { otp: "TMPL_OTP_99" },
      },
      enabled: false,
      isDefault: true,
    });

    expect(provider.id).toBeDefined();
    expect(provider.channel).toBe("sms");
    expect(provider.provider).toBe("zoho_cpaas");
    expect(provider.hasSecret).toBe(true);
    expect(provider.isDefault).toBe(true);
    expect(provider.enabled).toBe(false);

    // Verify plaintext secret NEVER leaks in output
    expect(JSON.stringify(provider)).not.toContain("super-secret-zoho-cpaas-token-12345");

    // Inspect database directly to ensure AES-256-GCM ciphertext at rest
    const [row] = await rt._db.db
      .select()
      .from(schema.platformChannelProviders)
      .where(eq(schema.platformChannelProviders.id, provider.id));

    expect(row).toBeDefined();
    expect(row!.secretCiphertext).toBeDefined();
    expect(row!.secretCiphertext).not.toBe("super-secret-zoho-cpaas-token-12345");
    expect(row!.secretIv).toBeDefined();
    expect(row!.secretKeyVersion).toBe(1);
  });

  it("refuses enabling a provider without credentials", async () => {
    // Cannot create enabled: true without credentials
    await expect(
      createPlatformChannelProvider(rt, staffId, {
        channel: "sms",
        provider: "zoho_cpaas",
        displayName: "Zoho SMS Unconfigured",
        enabled: true,
      }),
    ).rejects.toThrow(/without credentials/i);

    // Create disabled provider without credentials
    const provider = await createPlatformChannelProvider(rt, staffId, {
      channel: "sms",
      provider: "zoho_cpaas",
      displayName: "Zoho SMS Unconfigured",
      enabled: false,
    });

    expect(provider.hasSecret).toBe(false);

    // Attempting to update enabled: true without supplying credentials must fail
    await expect(
      updatePlatformChannelProvider(rt, staffId, {
        id: provider.id,
        enabled: true,
      }),
    ).rejects.toThrow(/without credentials/i);
  });

  it("switches default provider atomically for the same channel", async () => {
    const p1 = await createPlatformChannelProvider(rt, staffId, {
      channel: "whatsapp",
      provider: "zoho_cpaas",
      displayName: "WhatsApp Primary",
      isDefault: true,
    });
    expect(p1.isDefault).toBe(true);

    const p2 = await createPlatformChannelProvider(rt, staffId, {
      channel: "whatsapp",
      provider: "zoho_cpaas",
      displayName: "WhatsApp Backup",
      isDefault: true,
    });
    expect(p2.isDefault).toBe(true);

    // Verify p1 is no longer default
    const providers = await listPlatformChannelProviders(rt, staffId, "whatsapp");
    const foundP1 = providers.find((p) => p.id === p1.id);
    const foundP2 = providers.find((p) => p.id === p2.id);
    expect(foundP1?.isDefault).toBe(false);
    expect(foundP2?.isDefault).toBe(true);

    // Setting p1 back to default
    await setDefaultPlatformChannelProvider(rt, staffId, p1.id);
    const updated = await listPlatformChannelProviders(rt, staffId, "whatsapp");
    expect(updated.find((p) => p.id === p1.id)?.isDefault).toBe(true);
    expect(updated.find((p) => p.id === p2.id)?.isDefault).toBe(false);

    // Delete p2
    const delRes = await deletePlatformChannelProvider(rt, staffId, p2.id);
    expect(delRes.success).toBe(true);
    const afterDelete = await listPlatformChannelProviders(rt, staffId, "whatsapp");
    expect(afterDelete.some((p) => p.id === p2.id)).toBe(false);
  });

  it("refuses diagnostic test send when test template key is not configured", async () => {
    const provider = await createPlatformChannelProvider(rt, staffId, {
      channel: "sms",
      provider: "zoho_cpaas",
      displayName: "Zoho SMS Without Test Template",
      secret: "fake-test-token",
      config: { senderKey: "TEST_SND" },
    });

    const testRes = await testPlatformChannelProvider(rt, staffId, {
      id: provider.id,
      to: "+91 98765 43210",
    });

    expect(testRes.ok).toBe(false);
    expect(testRes.error).toMatch(/test template key is not configured/i);
  });

  it("diagnostic test send writes strictly masked log to platform_message_log when test template is configured", async () => {
    const provider = await createPlatformChannelProvider(rt, staffId, {
      channel: "sms",
      provider: "zoho_cpaas",
      displayName: "Zoho SMS Test Sender",
      secret: "fake-test-token",
      config: { senderKey: "TEST_SND", testTemplateKey: "DLT_TEST_MSG_01" },
    });

    const testRes = await testPlatformChannelProvider(rt, staffId, {
      id: provider.id,
      to: "+91 98765 43210",
    });

    expect(testRes).toBeDefined();

    // Query platform_message_log
    const logs = await rt._db.db
      .select()
      .from(schema.platformMessageLog)
      .where(eq(schema.platformMessageLog.provider, "zoho_cpaas"));

    expect(logs.length).toBeGreaterThanOrEqual(1);
    const latest = logs[logs.length - 1]!;

    // ZERO full phone number retention
    expect(latest.toMasked).toBe("********3210");
    expect(latest.toMasked).not.toContain("98765");

    // ZERO body, ZERO OTP in the database
    expect((latest as Record<string, unknown>).body).toBeUndefined();
    expect((latest as Record<string, unknown>).otp).toBeUndefined();
    expect(latest.template).toBe("test_message");

    // Provider record reflects test execution
    const [updatedRow] = await rt._db.db
      .select()
      .from(schema.platformChannelProviders)
      .where(eq(schema.platformChannelProviders.id, provider.id));

    expect(updatedRow).toBeDefined();
    expect(updatedRow!.lastTestAt).toBeDefined();
    expect(updatedRow!.lastTestStatus).toBeDefined();
  });

  it("the 15-minute maintenance pass job prunes platform_message_log older than 90 days", async () => {
    const oldDate = new Date(Date.now() - 95 * 24 * 60 * 60 * 1000);
    const recentDate = new Date();

    // Insert old record
    const [oldMsg] = await rt._db.db.insert(schema.platformMessageLog).values({
      channel: "sms",
      toMasked: "+91••••••9991",
      template: "old_notice",
      provider: "zoho_cpaas",
      status: "sent",
      createdAt: oldDate,
    }).returning({ id: schema.platformMessageLog.id });

    // Insert recent record
    const [recentMsg] = await rt._db.db.insert(schema.platformMessageLog).values({
      channel: "sms",
      toMasked: "+91••••••9992",
      template: "recent_notice",
      provider: "zoho_cpaas",
      status: "sent",
      createdAt: recentDate,
    }).returning({ id: schema.platformMessageLog.id });

    const stats = await handleMaintenanceCleanupJob(rt._db.db, pino({ level: "silent" }));
    expect(stats.prunedMessageLogs).toBeGreaterThanOrEqual(1);

    // Verify recent record still exists
    const remaining = await rt._db.db
      .select()
      .from(schema.platformMessageLog)
      .where(eq(schema.platformMessageLog.id, recentMsg!.id));
    expect(remaining.length).toBe(1);

    // Verify old record was purged
    const purged = await rt._db.db
      .select()
      .from(schema.platformMessageLog)
      .where(eq(schema.platformMessageLog.id, oldMsg!.id));
    expect(purged.length).toBe(0);
  });

  it("channel stats count strictly equals direct SQL count", async () => {
    // Insert known records for WhatsApp
    const now = new Date();
    await rt._db.db.insert(schema.platformMessageLog).values([
      {
        channel: "whatsapp",
        toMasked: "+91••••••1111",
        template: "t1",
        provider: "zoho_cpaas",
        status: "sent",
        createdAt: now,
      },
      {
        channel: "whatsapp",
        toMasked: "+91••••••2222",
        template: "t2",
        provider: "zoho_cpaas",
        status: "failed",
        error: "Invalid recipient",
        createdAt: now,
      },
    ]);

    const stats = await getPlatformChannelStats(rt, staffId, { channel: "whatsapp", range: "7d" });
    const res = await rt._db.db.execute<{ count: string }>(
      sql`SELECT count(*)::text as count FROM platform_message_log WHERE channel = 'whatsapp'`,
    );

    const directCount = parseInt(res.rows[0]!.count, 10);
    expect(stats.total).toBe(directCount);
  });
});
