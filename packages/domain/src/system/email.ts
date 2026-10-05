import { eq, sql, and } from "drizzle-orm";
import { type Db, withTenant, schema } from "@bs/db";
import { renderEmail, type EmailData } from "./email-templates.ts";
import { loadEmailBrand, loadEmailOrder, mintOrderViewUrl } from "./email-context.ts";
import { sendPlatformEmail } from "./platform-mailer.ts";
import {
  EMAIL_CLASS,
  getTemplatePreferenceField,
  parseNotificationPreferences,
  type EmailClass,
} from "./email-classes.ts";

export interface SendEmailInput {
  tenantId: string;
  template: string;
  toEmail: string;
  subject: string;
  data?: Record<string, unknown>;
  eventRef?: string;
  eventKey?: string;
}

export interface SendEmailResult {
  logId: string;
  status: "sent" | "queued" | "skipped_killswitch" | "skipped_preference" | "skipped_consent" | "failed";
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
 * Transactional Email Dispatcher (AUTH-OVERHAUL-PLAN §3.5 / Settings Rebuild Phase 7 Slice 7A).
 * Dispatches transactional & security store emails through platform mailer.
 * - Evaluates store notification preferences AT EXECUTION TIME.
 * - Suppressed customer preferences log truthfully as `status: 'skipped'`, `suppressed_reason: 'preference_off'`.
 * - Security emails (password reset, account verify, etc.) ignore preferences completely.
 * - Marketing emails require current `subscribed` consent in customer_consent_events, otherwise logged as `skipped` / `consent_required`.
 * - Marketing emails include RFC 8058 List-Unsubscribe headers and footer links.
 */
export async function sendTransactionalEmail(
  db: Db,
  input: SendEmailInput,
): Promise<SendEmailResult> {
  const { tenantId, template, toEmail, subject, data = {}, eventRef, eventKey } = input;
  const emailClass: EmailClass = EMAIL_CLASS[template] ?? "transactional";

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
          channel: "email",
          eventRef: eventRef ?? null,
          eventKey: eventKey ?? null,
          suppressedReason: "kill_switch_active",
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

    // 2. Read store settings & evaluate notification preferences at execution time
    const [settingsRow] = await tx
      .select({
        notifications: schema.storeSettings.notifications,
      })
      .from(schema.storeSettings)
      .where(eq(schema.storeSettings.tenantId, tenantId))
      .limit(1);

    const preferences = parseNotificationPreferences(settingsRow?.notifications);

    // If customer-facing transactional email, check if preference is disabled
    const prefField = getTemplatePreferenceField(template);
    if (emailClass === "transactional" && prefField && prefField !== "accountSecurity") {
      const isEnabled = preferences.customer[prefField];
      if (!isEnabled) {
        const [skippedLog] = await tx
          .insert(schema.emailLog)
          .values({
            tenantId,
            template,
            toEmail,
            subject,
            status: "skipped",
            channel: "email",
            eventRef: eventRef ?? null,
            eventKey: eventKey ?? null,
            suppressedReason: "preference_off",
          })
          .returning({ id: schema.emailLog.id });

        if (!skippedLog) throw new Error("Failed to insert email_log entry");

        return {
          logId: skippedLog.id,
          status: "skipped_preference",
        };
      }
    }

    // 3. Marketing email verification: require subscribed consent
    let unsubscribeToken: string | undefined;
    if (emailClass === "marketing") {
      // Look up customer by email and check current consent
      const [cust] = await tx
        .select({
          id: schema.customers.id,
          acceptsMarketing: schema.customers.acceptsMarketing,
          marketingState: schema.customers.marketingState,
        })
        .from(schema.customers)
        .where(
          and(
            eq(schema.customers.tenantId, tenantId),
            eq(schema.customers.email, toEmail.trim().toLowerCase()),
          ),
        )
        .limit(1);

      const hasConsent = cust && cust.acceptsMarketing && cust.marketingState === "subscribed";
      if (!hasConsent) {
        const [skippedLog] = await tx
          .insert(schema.emailLog)
          .values({
            tenantId,
            template,
            toEmail,
            subject,
            status: "skipped",
            channel: "email",
            eventRef: eventRef ?? null,
            eventKey: eventKey ?? null,
            suppressedReason: "consent_required",
          })
          .returning({ id: schema.emailLog.id });

        if (!skippedLog) throw new Error("Failed to insert email_log entry");

        return {
          logId: skippedLog.id,
          status: "skipped_consent",
          error: "Customer has not consented to marketing emails",
        };
      }

      // Mint unsubscribe token for footer and headers
      const { mintUnsubscribeToken } = await import("../customers/unsubscribe.ts");
      unsubscribeToken = await mintUnsubscribeToken(tx, tenantId, cust.id);
    }

    // 4. Insert email_log entry as queued
    const [logEntry] = await tx
      .insert(schema.emailLog)
      .values({
        tenantId,
        template,
        toEmail,
        subject,
        status: "queued",
        channel: "email",
        eventRef: eventRef ?? null,
        eventKey: eventKey ?? null,
      })
      .returning({ id: schema.emailLog.id });

    if (!logEntry) {
      throw new Error("Failed to insert email_log entry");
    }

    // 5. Render email with brand and order context
    try {
      const brand = await loadEmailBrand(tx, tenantId);

      // Add unsubscribeUrl if marketing
      if (unsubscribeToken) {
        brand.unsubscribeUrl = `${brand.baseUrl}/unsubscribe/${unsubscribeToken}`;
      }

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

      // Resolve display name and reply-to from notification preferences (customer mail only)
      const isCustomerMail = template !== "staff_order_created";
      const fromName = (isCustomerMail && preferences.sender.displayName)
        ? preferences.sender.displayName
        : brand.storeName;
      const replyTo = (isCustomerMail && preferences.sender.replyToEmail)
        ? preferences.sender.replyToEmail
        : (brand.supportEmail ?? undefined);

      // Construct RFC 8058 headers for marketing emails
      const headers: Record<string, string> = {};
      if (brand.unsubscribeUrl) {
        headers["List-Unsubscribe"] = `<${brand.unsubscribeUrl}>`;
        headers["List-Unsubscribe-Post"] = "List-Unsubscribe=One-Click";
      }

      // 6. Dispatch via platform mailer
      const platformResult = await sendPlatformEmail(db, {
        tenantId,
        to: toEmail,
        subject,
        html: rendered.html,
        text: rendered.text,
        fromName,
        replyTo,
        template,
        headers: Object.keys(headers).length > 0 ? headers : undefined,
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
