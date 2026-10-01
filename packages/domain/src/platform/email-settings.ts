import { desc, eq, sql } from "drizzle-orm";
import { schema } from "@bs/db";
import { encryptSecret, decryptSecret } from "@bs/payments";
import type { Runtime } from "../runtime.ts";
import { assertPlatformStaff, assertRoleAtLeast, writePlatformAudit, type AuditMeta } from "../platform-services.ts";
import {
  loadPlatformEmailSettings,
  sendPlatformEmail,
} from "../system/platform-mailer.ts";

export interface UpdateEmailSettingsInput {
  provider: string;
  host: string;
  port: number;
  secureMode: "starttls" | "ssl";
  username: string;
  password?: string | undefined;
  fromEmail: string;
  fromName: string;
  replyTo?: string | null | undefined;
  enabled: boolean;
}

/**
 * Gets the current platform email settings. Never returns the password!
 * Returns passwordConfigured and optionally passwordLastFour.
 */
export async function getPlatformEmailSettings(
  rt: Runtime,
  platformStaffUserId: string,
) {
  await assertPlatformStaff(rt, platformStaffUserId);
  const db = rt._db.db;

  const row = await loadPlatformEmailSettings(db);
  if (!row) {
    return {
      provider: "zoho_zeptomail",
      host: "smtp.zeptomail.in",
      port: 587,
      secureMode: "starttls" as const,
      username: "emailapikey",
      passwordConfigured: false,
      passwordLastFour: null,
      fromEmail: "no-reply@gobs.cloud",
      fromName: "Brand Sewa",
      replyTo: null,
      enabled: false,
      lastTestAt: null,
      lastTestStatus: null,
      lastTestError: null,
      updatedAt: undefined,
    };
  }

  let passwordLastFour: string | null = null;
  if (row.passwordCiphertext && row.passwordIv) {
    try {
      const decrypted = decryptSecret({
        ciphertext: row.passwordCiphertext,
        iv: row.passwordIv,
      });
      if (decrypted && decrypted.length >= 4) {
        passwordLastFour = decrypted.slice(-4);
      }
    } catch {
      // Decrypt error
    }
  }

  return {
    provider: row.provider,
    host: row.host,
    port: row.port,
    secureMode: (row.secureMode === "ssl" ? "ssl" : "starttls") as "starttls" | "ssl",
    username: row.username,
    passwordConfigured: Boolean(row.passwordCiphertext && row.passwordIv),
    passwordLastFour,
    fromEmail: row.fromEmail,
    fromName: row.fromName,
    replyTo: row.replyTo ?? null,
    enabled: row.enabled,
    lastTestAt: row.lastTestAt ? row.lastTestAt.toISOString() : null,
    lastTestStatus: row.lastTestStatus ?? null,
    lastTestError: row.lastTestError ?? null,
    updatedAt: row.updatedAt ? row.updatedAt.toISOString() : undefined,
  };
}

/**
 * Updates platform email settings. Only platform_admin or platform_owner.
 * Password is encrypted with AES-256-GCM.
 * Writes platform audit log.
 */
export async function updatePlatformEmailSettings(
  rt: Runtime,
  platformStaffUserId: string,
  input: UpdateEmailSettingsInput,
  meta?: AuditMeta,
) {
  const staff = await assertPlatformStaff(rt, platformStaffUserId);
  assertRoleAtLeast(staff.role, "platform_admin", "update email settings");

  const db = rt._db.db;

  await db.transaction(async (tx) => {
    const existing = await tx
      .select()
      .from(schema.platformEmailSettings)
      .where(eq(schema.platformEmailSettings.id, "default"))
      .limit(1);

    const prev = existing[0];
    let passwordCiphertext = prev?.passwordCiphertext ?? null;
    let passwordIv = prev?.passwordIv ?? null;
    let keyVersion = prev?.keyVersion ?? 1;

    if (input.password && input.password.trim().length > 0) {
      const encrypted = encryptSecret(input.password.trim());
      passwordCiphertext = encrypted.ciphertext;
      passwordIv = encrypted.iv;
      keyVersion = encrypted.keyVersion;
    }

    const replyToClean = input.replyTo && input.replyTo.trim() ? input.replyTo.trim() : null;

    await tx
      .insert(schema.platformEmailSettings)
      .values({
        id: "default",
        provider: input.provider,
        host: input.host,
        port: input.port,
        secureMode: input.secureMode,
        username: input.username,
        passwordCiphertext,
        passwordIv,
        keyVersion,
        fromEmail: input.fromEmail,
        fromName: input.fromName,
        replyTo: replyToClean,
        enabled: input.enabled,
        updatedBy: platformStaffUserId,
        updatedAt: sql`now()`,
      })
      .onConflictDoUpdate({
        target: schema.platformEmailSettings.id,
        set: {
          provider: input.provider,
          host: input.host,
          port: input.port,
          secureMode: input.secureMode,
          username: input.username,
          ...(input.password && input.password.trim().length > 0
            ? { passwordCiphertext, passwordIv, keyVersion }
            : {}),
          fromEmail: input.fromEmail,
          fromName: input.fromName,
          replyTo: replyToClean,
          enabled: input.enabled,
          updatedBy: platformStaffUserId,
          updatedAt: sql`now()`,
        },
      });

    // Write audit log (password omitted)
    await writePlatformAudit(
      tx,
      platformStaffUserId,
      "email_settings.update",
      "platform_email_settings",
      "default",
      null,
      {
        provider: input.provider,
        host: input.host,
        port: input.port,
        secureMode: input.secureMode,
        username: input.username,
        passwordUpdated: Boolean(input.password && input.password.trim().length > 0),
        fromEmail: input.fromEmail,
        fromName: input.fromName,
        replyTo: replyToClean,
        enabled: input.enabled,
      },
      meta,
    );
  });

  return { ok: true };
}

/**
 * Sends a test email to the specified address. Updates last_test_* in settings.
 */
export async function sendPlatformTestEmail(
  rt: Runtime,
  platformStaffUserId: string,
  toEmail: string,
  meta?: AuditMeta,
) {
  const staff = await assertPlatformStaff(rt, platformStaffUserId);
  assertRoleAtLeast(staff.role, "platform_admin", "send test email");

  const db = rt._db.db;

  const result = await sendPlatformEmail(
    db,
    {
      to: toEmail,
      subject: "Test transactional email from Brand Sewa (Zoho ZeptoMail)",
      html: `
        <div style="font-family: sans-serif; padding: 20px;">
          <h2>Test email delivered successfully!</h2>
          <p>This email confirms that your platform-wide SMTP settings (Zoho ZeptoMail) are configured correctly and active.</p>
          <p>Sent by staff member: <strong>${toEmail}</strong></p>
          <p style="color: #666; font-size: 12px; margin-top: 30px;">Brand Sewa Platform Transactional Mailer</p>
        </div>
      `,
      text: "Test email delivered successfully!\n\nThis email confirms that your platform-wide SMTP settings (Zoho ZeptoMail) are configured correctly and active.\n\nBrand Sewa Platform Transactional Mailer",
      template: "system_test_email",
    },
    { bypassRateLimit: true },
  );

  const testStatus = result.status === "sent" ? "success" : "failed";
  const testError = result.error ?? null;

  await db.transaction(async (tx) => {
    await tx
      .update(schema.platformEmailSettings)
      .set({
        lastTestAt: sql`now()`,
        lastTestStatus: testStatus,
        lastTestError: testError,
      })
      .where(eq(schema.platformEmailSettings.id, "default"));

    await writePlatformAudit(
      tx,
      platformStaffUserId,
      "email_settings.test",
      "platform_email_settings",
      "default",
      null,
      {
        toEmail,
        status: testStatus,
        error: testError,
      },
      meta,
    );
  });

  return {
    ok: testStatus === "success",
    status: testStatus,
    error: testError ?? undefined,
    messageId: result.providerMessageId,
  };
}

/**
 * Lists recent deliveries from platform_email_log.
 */
export async function listRecentEmailDeliveries(
  rt: Runtime,
  platformStaffUserId: string,
  options?: { failedOnly?: boolean | undefined; limit?: number | undefined },
) {
  await assertPlatformStaff(rt, platformStaffUserId);
  const db = rt._db.db;

  const limit = options?.limit ?? 50;

  const query = db
    .select({
      id: schema.platformEmailLog.id,
      tenantId: schema.platformEmailLog.tenantId,
      toEmail: schema.platformEmailLog.toEmail,
      template: schema.platformEmailLog.template,
      status: schema.platformEmailLog.status,
      providerMessageId: schema.platformEmailLog.providerMessageId,
      error: schema.platformEmailLog.error,
      createdAt: schema.platformEmailLog.createdAt,
    })
    .from(schema.platformEmailLog);

  if (options?.failedOnly) {
    query.where(eq(schema.platformEmailLog.status, "failed"));
  }

  query.orderBy(desc(schema.platformEmailLog.createdAt)).limit(limit);

  const rows = await query;
  return rows.map((r) => ({
    ...r,
    createdAt: r.createdAt.toISOString(),
  }));
}
