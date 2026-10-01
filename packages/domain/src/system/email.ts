import { eq, sql } from "drizzle-orm";
import { type Db, withTenant, schema } from "@bs/db";
import { renderEmail, type EmailData } from "./email-templates.ts";
import { loadEmailBrand, loadEmailOrder, mintOrderViewUrl } from "./email-context.ts";
import { sendPlatformEmail } from "./platform-mailer.ts";

export interface SendEmailInput {
  tenantId: string;
  template: string;
  toEmail: string;
  subject: string;
  data?: Record<string, unknown>;
  eventRef?: string;
}

export interface SendEmailResult {
  logId: string;
  status: "sent" | "queued" | "skipped_killswitch" | "failed";
  providerId?: string | undefined;
  error?: string | undefined;
}

/**
 * Checks whether an integration kill switch is active (PLAN §11.7).
 * Flags: "kill_switch_email", "kill_switch_shipping", "kill_switch_payments", etc.
 */
export async function isIntegrationKilled(
  db: Db,
  integration: "email" | "shipping" | "payments",
): Promise<boolean> {
  const flagKey = `kill_switch_${integration}`;
  const rows = await db
    .select({
      killSwitch: schema.featureFlags.killSwitch,
      defaultOn: schema.featureFlags.defaultOn,
    })
    .from(schema.featureFlags)
    .where(eq(schema.featureFlags.key, flagKey))
    .limit(1);

  if (rows.length > 0) {
    return Boolean(rows[0]?.killSwitch || rows[0]?.defaultOn);
  }
  return false;
}

/**
 * Transactional Email Dispatcher (AUTH-OVERHAUL-PLAN §3.5).
 * Dispatches transactional store emails (order confirmation, shipping updates,
 * abandoned cart recovery, returns, refunds) through the platform-wide SMTP mailer (Zoho ZeptoMail).
 * From name is the store name; reply-to is the store's support email; from address is no-reply@gobs.cloud.
 * If mailer is disabled or unconfigured, logs and skips gracefully.
 */
export async function sendTransactionalEmail(
  db: Db,
  input: SendEmailInput,
): Promise<SendEmailResult> {
  const { tenantId, template, toEmail, subject, data = {}, eventRef } = input;

  return await withTenant(db, tenantId, async (tx) => {
    // 1. Check integration kill switch for email
    const emailDisabled = await isIntegrationKilled(db, "email");
    if (emailDisabled) {
      const [logged] = await tx
        .insert(schema.emailLog)
        .values({
          tenantId,
          template,
          toEmail,
          subject,
          status: "queued",
          eventRef: eventRef ?? null,
          error: "Email integration killed via kill switch (PLAN §11.7)",
        })
        .returning({ id: schema.emailLog.id });

      if (!logged) {
        throw new Error("Failed to insert email_log entry");
      }

      return {
        logId: logged.id,
        status: "skipped_killswitch",
        error: "Email integration killed via kill switch",
      };
    }

    // 2. Insert email_log entry
    const [logEntry] = await tx
      .insert(schema.emailLog)
      .values({
        tenantId,
        template,
        toEmail,
        subject,
        status: "queued",
        eventRef: eventRef ?? null,
      })
      .returning({ id: schema.emailLog.id });

    if (!logEntry) {
      throw new Error("Failed to insert email_log entry");
    }

    // 3. Render email with brand and order context
    try {
      const brand = await loadEmailBrand(tx, tenantId);
      const emailData: EmailData = { ...data, cartUrl: `${brand.baseUrl}/cart` };
      const orderId = typeof data.orderId === "string" ? data.orderId : undefined;
      if (orderId) {
        const order = await loadEmailOrder(tx, tenantId, orderId);
        if (order) {
          emailData.order = {
            ...order,
            orderUrl: await mintOrderViewUrl(tx, tenantId, orderId, brand.baseUrl),
          };
        }
      }
      const rendered = renderEmail(template, brand, emailData, subject);

      // 4. Dispatch via platform mailer
      const platformResult = await sendPlatformEmail(db, {
        tenantId,
        to: toEmail,
        subject,
        html: rendered.html,
        text: rendered.text,
        fromName: brand.storeName,
        replyTo: brand.supportEmail ?? undefined,
        template,
      });

      if (platformResult.status === "skipped") {
        const errorMsg = platformResult.error ?? "Email service not configured";
        await tx
          .update(schema.emailLog)
          .set({
            status: "failed",
            error: errorMsg,
          })
          .where(eq(schema.emailLog.id, logEntry.id));

        return {
          logId: logEntry.id,
          status: "failed",
          error: errorMsg,
        };
      }

      if (platformResult.status === "failed") {
        const errorMsg = platformResult.error ?? "Failed to send platform email";
        await tx
          .update(schema.emailLog)
          .set({
            status: "failed",
            error: errorMsg,
          })
          .where(eq(schema.emailLog.id, logEntry.id));

        return {
          logId: logEntry.id,
          status: "failed",
          error: errorMsg,
        };
      }

      const providerId = platformResult.providerMessageId ?? `smtp_${logEntry.id.slice(0, 12)}`;
      await tx
        .update(schema.emailLog)
        .set({
          status: "sent",
          providerId,
          sentAt: sql`now()`,
        })
        .where(eq(schema.emailLog.id, logEntry.id));

      return {
        logId: logEntry.id,
        status: "sent",
        providerId,
      };
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      await tx
        .update(schema.emailLog)
        .set({
          status: "failed",
          error: errorMsg,
        })
        .where(eq(schema.emailLog.id, logEntry.id));

      return {
        logId: logEntry.id,
        status: "failed",
        error: errorMsg,
      };
    }
  });
}

