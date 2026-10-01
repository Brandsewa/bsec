import { eq, and, sql } from "drizzle-orm";
import { type Db, withTenant, schema } from "@bs/db";
import { decryptSecret } from "@bs/payments";
import { renderEmail, type EmailData } from "./email-templates.ts";
import { loadEmailBrand, loadEmailOrder, mintOrderViewUrl } from "./email-context.ts";

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
    // If the kill switch flag exists and is marked killSwitch: true or defaultOn: true
    return Boolean(rows[0]?.killSwitch || rows[0]?.defaultOn);
  }
  return false;
}

/**
 * Transactional Email Dispatcher with Integration Kill Switch (PLAN §11.7, §5.10).
 * Handles sending transactional customer emails (order confirmation, shipping updates,
 * abandoned cart recovery, returns, refunds) and logs every attempt to email_log.
 * If resend/email is disabled via kill switch, gracefully logs and defers/skips without erroring.
 */
export async function sendTransactionalEmail(
  db: Db,
  input: SendEmailInput,
): Promise<SendEmailResult> {
  const { tenantId, template, toEmail, subject, data = {}, eventRef } = input;

  return await withTenant(db, tenantId, async (tx) => {
    // 1. Check integration kill switch for email provider
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

    // 2. Fetch email provider credentials if configured in tenant_secrets or env
    let apiKey: string | undefined = process.env.RESEND_API_KEY;
    try {
      const rows = await tx
        .select({
          keyName: schema.tenantSecrets.keyName,
          ciphertext: schema.tenantSecrets.ciphertext,
          iv: schema.tenantSecrets.iv,
        })
        .from(schema.tenantSecrets)
        .where(
          and(
            eq(schema.tenantSecrets.tenantId, tenantId),
            eq(schema.tenantSecrets.provider, "resend"),
          ),
        );

      for (const row of rows) {
        if (row.keyName === "api_key" || row.keyName === "apiKey") {
          apiKey = decryptSecret({ ciphertext: row.ciphertext, iv: row.iv });
        }
      }
    } catch {
      // Fallback to env
    }

    // 3. Insert email_log entry
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

    // 4. If no Resend API key is configured, mark as failed
    if (!apiKey) {
      const errorMsg = "No Resend API key configured";
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

    // 5. Dispatch real HTTP call to Resend
    try {
      // The content: the store's name and address, and (for order emails) the real order with a fresh view link.
      const brand = await loadEmailBrand(tx, tenantId);
      const emailData: EmailData = { ...data, cartUrl: `${brand.baseUrl}/cart` };
      const orderId = typeof data.orderId === "string" ? data.orderId : undefined;
      if (orderId) {
        const order = await loadEmailOrder(tx, tenantId, orderId);
        if (order) emailData.order = { ...order, orderUrl: await mintOrderViewUrl(tx, tenantId, orderId, brand.baseUrl) };
      }
      const rendered = renderEmail(template, brand, emailData, subject);

      // "Store name <orders@platform-domain>": the sending address is the platform's verified one, the name is the store's.
      const configuredFrom = process.env.RESEND_FROM_EMAIL ?? "orders@brandsewa.com";
      const fromEmail = configuredFrom.includes("<") ? configuredFrom : `${brand.storeName.replace(/["<>]/g, "")} <${configuredFrom}>`;
      const payload: Record<string, unknown> = {
        from: fromEmail,
        to: [toEmail],
        subject,
        html: rendered.html,
        text: rendered.text,
        ...(brand.supportEmail ? { reply_to: brand.supportEmail } : {}),
      };

      const res = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const errorText = await res.text();
        const errorMsg = `Resend API error: ${res.status} ${errorText}`;
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

      const resData = (await res.json()) as { id?: string };
      const providerId = resData.id ?? `resend_${logEntry.id.slice(0, 12)}`;

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

