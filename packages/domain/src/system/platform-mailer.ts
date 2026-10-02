import nodemailer, { type Transporter } from "nodemailer";
import { type Db, schema } from "@bs/db";
import { decryptSecret } from "@bs/payments";
import { eq, sql } from "drizzle-orm";
import { checkRateLimit, RateLimitExceededError } from "./rate-limit.ts";

export interface SendPlatformEmailInput {
  tenantId?: string | null | undefined;
  to: string;
  subject: string;
  html: string;
  text: string;
  fromName?: string | undefined;
  replyTo?: string | null | undefined;
  template: string;
}

export type PlatformEmailStatus = "sent" | "failed" | "skipped";

export interface SendPlatformEmailResult {
  status: PlatformEmailStatus;
  providerMessageId?: string | undefined;
  error?: string | undefined;
  logId?: string | undefined;
}

/** Transport factory for nodemailer. Allows injecting a mock/fake transport in tests. */
export type TransportFactory = (config: {
  host: string;
  port: number;
  secure: boolean;
  auth: { user: string; pass: string };
  connectionTimeout?: number;
  greetingTimeout?: number;
  socketTimeout?: number;
}) => Transporter;

let customTransportFactory: TransportFactory | null = null;

export function setPlatformEmailTransportFactory(factory: TransportFactory | null): void {
  customTransportFactory = factory;
}

function defaultTransportFactory(config: {
  host: string;
  port: number;
  secure: boolean;
  auth: { user: string; pass: string };
  connectionTimeout?: number;
  greetingTimeout?: number;
  socketTimeout?: number;
}): Transporter {
  return nodemailer.createTransport({
    pool: true,
    host: config.host,
    port: config.port,
    secure: config.secure,
    auth: config.auth,
    connectionTimeout: config.connectionTimeout ?? 10_000,
    greetingTimeout: config.greetingTimeout ?? 10_000,
    socketTimeout: config.socketTimeout ?? 20_000,
  });
}

/** Sanitizes any secret strings from error messages before logging or returning */
export function sanitizeError(error: unknown, secretToScrub?: string): string {
  if (!error) return "Unknown error";
  let msg = error instanceof Error ? error.message : String(error);
  if (secretToScrub && secretToScrub.length > 2) {
    msg = msg.replaceAll(secretToScrub, "[REDACTED]");
  }
  // Also scrub typical password/token patterns if present
  msg = msg.replace(/(password|token|secret|authorization)=[^&\s]+/gi, "$1=[REDACTED]");
  // Truncate to reasonable length for storage
  if (msg.length > 1000) {
    msg = msg.slice(0, 1000) + "... (truncated)";
  }
  return msg;
}

/**
 * Loads platform email settings.
 */
export async function loadPlatformEmailSettings(db: Db) {
  const [row] = await db
    .select()
    .from(schema.platformEmailSettings)
    .where(eq(schema.platformEmailSettings.id, "default"))
    .limit(1);
  return row ?? null;
}

/**
 * Checks rate limits for sending platform emails (anti-mail bombing):
 * - Max 5 reset mails per recipient per hour (3600s)
 * - Max 20 reset mails per IP per hour (if ip is provided)
 */
export async function checkEmailRateLimits(
  db: Db,
  params: { toEmail: string; ip?: string | undefined; template?: string | undefined },
): Promise<void> {
  const { toEmail, ip, template } = params;
  const isAuthOrReset = template?.includes("reset") || template?.includes("password");

  if (isAuthOrReset) {
    const emailRes = await checkRateLimit(db, {
      key: `email:limit:to:${toEmail.toLowerCase().trim()}`,
      limit: 5,
      windowSeconds: 3600,
    });
    if (!emailRes.allowed) {
      throw new RateLimitExceededError(
        `Too many email requests for this address. Please retry after ${emailRes.retryAfter} seconds.`,
        emailRes.retryAfter,
        emailRes.limit,
        `email:limit:to:${toEmail.toLowerCase().trim()}`,
      );
    }

    if (ip) {
      const ipRes = await checkRateLimit(db, {
        key: `email:limit:ip:${ip}`,
        limit: 20,
        windowSeconds: 3600,
      });
      if (!ipRes.allowed) {
        throw new RateLimitExceededError(
          `Too many email requests from this network. Please retry after ${ipRes.retryAfter} seconds.`,
          ipRes.retryAfter,
          ipRes.limit,
          `email:limit:ip:${ip}`,
        );
      }
    }
  }
}

/**
 * Dispatches an email through the platform-wide SMTP transactional mailer (AUTH-OVERHAUL-PLAN §3.2).
 */
export async function sendPlatformEmail(
  db: Db,
  input: SendPlatformEmailInput,
  options?: { ip?: string | undefined; bypassRateLimit?: boolean },
): Promise<SendPlatformEmailResult> {
  const { tenantId, to, subject, html, text, fromName, replyTo, template } = input;

  // 1. Check rate limits unless explicitly bypassed
  if (!options?.bypassRateLimit) {
    try {
      await checkEmailRateLimits(db, { toEmail: to, ip: options?.ip, template });
    } catch (err) {
      const errMsg = sanitizeError(err);
      // Log failed rate limit
      try {
        await db.insert(schema.platformEmailLog).values({
          tenantId: tenantId ?? null,
          toEmail: to,
          template,
          status: "failed",
          error: errMsg,
        });
      } catch {
        // Ignore log write failure
      }
      return { status: "failed", error: errMsg };
    }
  }

  // 2. Load platform email settings
  const settings = await loadPlatformEmailSettings(db);

  if (!settings || !settings.enabled) {
    const reason = !settings ? "Email service not configured" : "Email service disabled";
    try {
      const [logRow] = await db
        .insert(schema.platformEmailLog)
        .values({
          tenantId: tenantId ?? null,
          toEmail: to,
          template,
          status: "skipped",
          error: reason,
        })
        .returning({ id: schema.platformEmailLog.id });
      return { status: "skipped", error: reason, logId: logRow?.id };
    } catch {
      return { status: "skipped", error: reason };
    }
  }

  // 3. Decrypt SMTP password
  let password = "";
  if (settings.passwordCiphertext && settings.passwordIv) {
    try {
      password = decryptSecret({
        ciphertext: settings.passwordCiphertext,
        iv: settings.passwordIv,
      });
    } catch {
      const errMsg = "Failed to decrypt email credentials";
      try {
        const [logRow] = await db
          .insert(schema.platformEmailLog)
          .values({
            tenantId: tenantId ?? null,
            toEmail: to,
            template,
            status: "failed",
            error: errMsg,
          })
          .returning({ id: schema.platformEmailLog.id });
        return { status: "failed", error: errMsg, logId: logRow?.id };
      } catch {
        return { status: "failed", error: errMsg };
      }
    }
  }

  // 4. Construct transport & sender
  const isSecure = settings.secureMode === "ssl" || settings.port === 465;
  const transportFactory = customTransportFactory ?? defaultTransportFactory;

  const transport = transportFactory({
    host: settings.host,
    port: settings.port,
    secure: isSecure,
    auth: {
      user: settings.username,
      pass: password,
    },
    connectionTimeout: 10_000,
    socketTimeout: 20_000,
  });

  const senderDisplayName = fromName ?? settings.fromName ?? "Brand Sewa";
  const senderEmail = settings.fromEmail ?? "no-reply@gobs.cloud";
  const formattedFrom = `"${senderDisplayName.replace(/["<>]/g, "")}" <${senderEmail}>`;

  // 5. Send with 1 retry on transient error
  let providerMessageId: string | undefined;
  let lastError: unknown;

  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const resolvedReplyTo = replyTo ?? settings.replyTo ?? undefined;
      const mailOptions: Record<string, unknown> = {
        from: formattedFrom,
        to,
        subject,
        html,
        text,
        replyTo: resolvedReplyTo,
        reply_to: resolvedReplyTo,
      };
      const info = (await transport.sendMail(mailOptions as unknown as Parameters<typeof transport.sendMail>[0])) as { messageId?: string } | undefined;
      providerMessageId = info?.messageId;
      lastError = null;
      break;
    } catch (err) {
      lastError = err;
      // If error is 4xx or connection timeout, retry once
      const isTransient =
        err &&
        typeof err === "object" &&
        ("responseCode" in err ? Number((err as { responseCode: unknown }).responseCode) < 500 : true);
      if (attempt === 1 && isTransient) {
        continue;
      }
      break;
    }
  }

  if (lastError) {
    const sanitized = sanitizeError(lastError, password);
    try {
      const [logRow] = await db
        .insert(schema.platformEmailLog)
        .values({
          tenantId: tenantId ?? null,
          toEmail: to,
          template,
          status: "failed",
          error: sanitized,
        })
        .returning({ id: schema.platformEmailLog.id });
      return { status: "failed", error: sanitized, logId: logRow?.id };
    } catch {
      return { status: "failed", error: sanitized };
    }
  }

  // Success: write log
  try {
    const [logRow] = await db
      .insert(schema.platformEmailLog)
      .values({
        tenantId: tenantId ?? null,
        toEmail: to,
        template,
        status: "sent",
        providerMessageId: providerMessageId ?? null,
      })
      .returning({ id: schema.platformEmailLog.id });
    return { status: "sent", providerMessageId, logId: logRow?.id };
  } catch {
    return { status: "sent", providerMessageId };
  }
}

/**
 * 90-day retention prune job for platform_email_log (PLAN §3.1).
 * Deletes log entries older than retentionDays (default: 90 days).
 */
export async function prunePlatformEmailLogs(
  db: Db,
  retentionDays: number = 90,
): Promise<{ deletedCount: number }> {
  const days = Math.max(1, Math.floor(retentionDays));
  const result = await db.execute(
    sql`DELETE FROM platform_email_log WHERE created_at < NOW() - (${days} || ' days')::INTERVAL RETURNING id`,
  );
  const rows = (result as unknown as { rows?: unknown[] })?.rows ?? (Array.isArray(result) ? result : []);
  return { deletedCount: rows.length };
}
