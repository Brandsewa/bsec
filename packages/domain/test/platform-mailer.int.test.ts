import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { schema } from "@bs/db";
import { startTestDb, type TestDb } from "@bs/db/test-env";
import { seedPlatformStaff } from "@bs/db/test-fixtures";
import { createRuntime, type Runtime } from "../src/index.ts";
import {
  getPlatformEmailSettings,
  updatePlatformEmailSettings,
  sendPlatformTestEmail,
  listRecentEmailDeliveries,
} from "../src/platform/email-settings.ts";
import {
  sendPlatformEmail,
  setPlatformEmailTransportFactory,
  prunePlatformEmailLogs,
} from "../src/system/platform-mailer.ts";
import { decryptSecret } from "@bs/payments";
import { eq } from "drizzle-orm";
import type { Transporter } from "nodemailer";

let env: TestDb;
let rt: Runtime;
let admin: { userId: string };
let support: { userId: string };

const sentMails: Array<Record<string, unknown>> = [];

beforeAll(async () => {
  env = await startTestDb();
  rt = createRuntime({ service: "platform", databaseUrl: env.as("app_platform"), poolMax: 4 });

  const runId = Math.random().toString(36).slice(2, 7);
  await seedPlatformStaff(rt._db.db, { email: `owner-${runId}@mailer.test`, role: "platform_owner" });
  admin = await seedPlatformStaff(rt._db.db, { email: `admin-${runId}@mailer.test`, role: "platform_admin" });
  support = await seedPlatformStaff(rt._db.db, { email: `support-${runId}@mailer.test`, role: "platform_support" });
}, 180_000);

afterAll(async () => {
  await rt?.close();
  await env?.stop();
});

beforeEach(() => {
  sentMails.length = 0;
  setPlatformEmailTransportFactory((config) => {
    return {
      sendMail: async (opts: Record<string, unknown>) => {
        sentMails.push({ ...opts, _config: config });
        return { messageId: `msg_${sentMails.length}` };
      },
    } as unknown as Transporter;
  });
});

describe("platform email settings and mailer (Phase A real database)", () => {
  it("settings stored encrypted: ciphertext does not equal password and decrypt roundtrips", async () => {
    const rawToken = "zeptomail_secret_token_1234567890";
    await updatePlatformEmailSettings(
      rt,
      admin.userId,
      {
        provider: "zoho_zeptomail",
        host: "smtp.zeptomail.in",
        port: 587,
        secureMode: "starttls",
        username: "emailapikey",
        password: rawToken,
        fromEmail: "no-reply@bcom.si",
        fromName: "Brand Sewa",
        replyTo: "support@bcom.si",
        enabled: true,
      },
    );

    // Verify in database directly
    const [row] = await rt._db.db
      .select()
      .from(schema.platformEmailSettings)
      .where(eq(schema.platformEmailSettings.id, "default"));

    expect(row).toBeDefined();
    expect(row!.passwordCiphertext).not.toBe(rawToken);
    expect(row!.passwordCiphertext).toBeTruthy();
    expect(row!.passwordIv).toBeTruthy();

    // Decrypt round-trip
    const decrypted = decryptSecret({
      ciphertext: row!.passwordCiphertext!,
      iv: row!.passwordIv!,
    });
    expect(decrypted).toBe(rawToken);

    // getPlatformEmailSettings NEVER returns the raw token
    const view = await getPlatformEmailSettings(rt, support.userId);
    expect(view.passwordConfigured).toBe(true);
    expect(view.passwordLastFour).toBe("7890");
    const rawRecord = view as unknown as Record<string, unknown>;
    expect(rawRecord.password).toBeUndefined();
    expect(rawRecord.passwordCiphertext).toBeUndefined();
  });

  it("support staff cannot update email settings (RBAC)", async () => {
    await expect(
      updatePlatformEmailSettings(
        rt,
        support.userId,
        {
          provider: "zoho_zeptomail",
          host: "smtp.zeptomail.in",
          port: 587,
          secureMode: "starttls",
          username: "emailapikey",
          fromEmail: "no-reply@bcom.si",
          fromName: "Brand Sewa",
          enabled: true,
        },
      ),
    ).rejects.toThrow(/requires the platform_admin role or higher/i);
  });

  it("sendPlatformTestEmail sends email and records test status and audit row", async () => {
    const testRecipient = "owner@test.com";
    const result = await sendPlatformTestEmail(rt, admin.userId, testRecipient);

    expect(result.ok).toBe(true);
    expect(result.status).toBe("success");
    expect(sentMails).toHaveLength(1);
    expect(sentMails[0]!.to).toBe(testRecipient);
    expect(String(sentMails[0]!.from)).toContain("no-reply@bcom.si");

    // Check last_test_* in database
    const [settings] = await rt._db.db
      .select()
      .from(schema.platformEmailSettings)
      .where(eq(schema.platformEmailSettings.id, "default"));
    expect(settings!.lastTestStatus).toBe("success");
    expect(settings!.lastTestAt).toBeTruthy();

    // Check delivery log
    const deliveries = await listRecentEmailDeliveries(rt, support.userId);
    expect(deliveries.length).toBeGreaterThanOrEqual(1);
    expect(deliveries[0]!.toEmail).toBe(testRecipient);
    expect(deliveries[0]!.status).toBe("sent");
  });

  it("when email service is disabled, sendPlatformEmail skips gracefully and logs skipped", async () => {
    await rt._db.db
      .update(schema.platformEmailSettings)
      .set({ enabled: false })
      .where(eq(schema.platformEmailSettings.id, "default"));

    const result = await sendPlatformEmail(
      rt._db.db,
      {
        to: "recipient@test.com",
        subject: "Order confirmed",
        html: "<p>Order</p>",
        text: "Order",
        template: "order_confirmation",
      },
    );

    expect(result.status).toBe("skipped");
    expect(result.error).toContain("Email service disabled");

    // Check log recorded 'skipped'
    const deliveries = await listRecentEmailDeliveries(rt, support.userId);
    const skippedLog = deliveries.find((d) => d.toEmail === "recipient@test.com");
    expect(skippedLog).toBeDefined();
    expect(skippedLog!.status).toBe("skipped");

    // Re-enable for other tests
    await rt._db.db
      .update(schema.platformEmailSettings)
      .set({ enabled: true })
      .where(eq(schema.platformEmailSettings.id, "default"));
  });

  it("sanitizes password/secrets if SMTP error occurs", async () => {
    const token = "secret_zepto_mail_token_abc";
    await updatePlatformEmailSettings(
      rt,
      admin.userId,
      {
        provider: "zoho_zeptomail",
        host: "smtp.zeptomail.in",
        port: 587,
        secureMode: "starttls",
        username: "emailapikey",
        password: token,
        fromEmail: "no-reply@bcom.si",
        fromName: "Brand Sewa",
        enabled: true,
      },
    );

    setPlatformEmailTransportFactory(() => ({
      sendMail: async () => {
        throw new Error(`Authentication failed with token ${token} on server`);
      },
    } as unknown as Transporter));

    const result = await sendPlatformEmail(
      rt._db.db,
      {
        to: "fail@test.com",
        subject: "Failing test",
        html: "<p>Failing</p>",
        text: "Failing",
        template: "test_failure",
      },
      { bypassRateLimit: true },
    );

    expect(result.status).toBe("failed");
    expect(result.error).not.toContain(token);
    expect(result.error).toContain("[REDACTED]");
  });

  it("prunePlatformEmailLogs deletes logs older than 90 days and leaves recent logs", async () => {
    // Insert an old log (91 days ago) and a recent log (10 days ago) directly
    const [oldRow] = await rt._db.db
      .insert(schema.platformEmailLog)
      .values({
        toEmail: "old@test.com",
        template: "order_confirmation",
        status: "sent",
        createdAt: new Date(Date.now() - 91 * 24 * 60 * 60 * 1000),
      })
      .returning({ id: schema.platformEmailLog.id });

    const [recentRow] = await rt._db.db
      .insert(schema.platformEmailLog)
      .values({
        toEmail: "recent@test.com",
        template: "order_confirmation",
        status: "sent",
        createdAt: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000),
      })
      .returning({ id: schema.platformEmailLog.id });

    // Run prune job for 90 days
    const pruneRes = await prunePlatformEmailLogs(rt._db.db, 90);
    expect(pruneRes.deletedCount).toBeGreaterThanOrEqual(1);

    // Old row should be gone
    const [remainingOld] = await rt._db.db
      .select()
      .from(schema.platformEmailLog)
      .where(eq(schema.platformEmailLog.id, oldRow!.id));
    expect(remainingOld).toBeUndefined();

    // Recent row should still exist
    const [remainingRecent] = await rt._db.db
      .select()
      .from(schema.platformEmailLog)
      .where(eq(schema.platformEmailLog.id, recentRow!.id));
    expect(remainingRecent).toBeDefined();
    expect(remainingRecent!.toEmail).toBe("recent@test.com");
  });
});
