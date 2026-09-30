import { sql } from "drizzle-orm";
import type { Db } from "@bs/db";

const DISPOSABLE_DOMAINS = new Set([
  "mailinator.com",
  "guerrillamail.com",
  "tempmail.com",
  "10minutemail.com",
  "trashmail.com",
  "yopmail.com",
  "sharklasers.com",
  "dispostable.com",
  "getairmail.com",
  "fakemailgenerator.com",
  "throwawaymail.com",
  "temp-mail.org",
  "mytemp.email",
  "crazymailing.com",
]);

/**
 * Validates that an email is not from a known temporary or disposable email provider (PLAN §7).
 */
export function isDisposableEmail(email: string): boolean {
  if (!email || !email.includes("@")) return false;
  const parts = email.trim().toLowerCase().split("@");
  if (parts.length !== 2) return false;
  const domain = parts[1];
  if (!domain) return false;
  return DISPOSABLE_DOMAINS.has(domain);
}

export interface TurnstileVerificationResult {
  success: boolean;
  verified: boolean;
  hostname?: string | undefined;
  reason?: string | undefined;
  errorCodes?: string[] | undefined;
}

/**
 * Cloudflare Turnstile Captcha verification provider adapter (PLAN §7 / ADR-008).
 * Honest provider adapter:
 * - If TURNSTILE_SECRET_KEY is not configured, logs diagnostic and passes in unverified dev mode.
 * - If configured, executes live HTTP verification against Cloudflare siteverify endpoint.
 */
export async function verifyTurnstileToken(
  token?: string,
  remoteIp?: string,
): Promise<TurnstileVerificationResult> {
  const secretKey = process.env.TURNSTILE_SECRET_KEY?.trim();

  // If Turnstile is unconfigured, do not fake live verification
  if (!secretKey) {
    return {
      success: true,
      verified: false,
      reason: "turnstile_not_configured",
    };
  }

  if (!token) {
    return {
      success: false,
      verified: false,
      reason: "Missing Turnstile verification response token",
    };
  }

  try {
    const formData = new URLSearchParams();
    formData.append("secret", secretKey);
    formData.append("response", token);
    if (remoteIp) {
      formData.append("remoteip", remoteIp);
    }

    const response = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
      method: "POST",
      body: formData,
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      signal: AbortSignal.timeout(5000),
    });

    if (!response.ok) {
      return {
        success: false,
        verified: false,
        reason: `Turnstile API responded with HTTP status ${response.status}`,
      };
    }

    const result = (await response.json()) as {
      success: boolean;
      hostname?: string;
      "error-codes"?: string[];
    };

    if (result.success) {
      return {
        success: true,
        verified: true,
        hostname: result.hostname,
      };
    } else {
      return {
        success: false,
        verified: false,
        errorCodes: result["error-codes"],
        reason: "Captcha challenge verification failed. Please try again.",
      };
    }
  } catch (err: unknown) {
    return {
      success: false,
      verified: false,
      reason: err instanceof Error ? err.message : "Error communicating with Turnstile verification service",
    };
  }
}

/**
 * Abuse Protection: Enforces maximum 3 active trial stores per user email (PLAN §7).
 */
export async function assertTrialStoreLimit(db: Db, email: string): Promise<void> {
  const normalizedEmail = email.trim().toLowerCase();

  const countRes = await db.execute<{ count: string }>(sql`
    SELECT COUNT(DISTINCT t.id)::text as count
    FROM tenants t
    JOIN users u ON u.id = t.owner_user_id
    WHERE LOWER(u.email) = ${normalizedEmail}
      AND t.status IN ('active', 'trial', 'provisioning');
  `);

  const currentStores = parseInt(countRes.rows[0]?.count ?? "0", 10);
  if (currentStores >= 3) {
    throw new Error(
      `Trial store limit reached: an account may own a maximum of 3 trial stores (currently ${currentStores}). Please upgrade an existing store to create more.`,
    );
  }
}

/**
 * Abuse Protection: Rate limits signup attempts per IP (5/hr) and per email (3/hr) (PLAN §7, §14).
 */
export async function checkSignupRateLimit(
  db: Db,
  ip: string,
  email?: string,
): Promise<{ allowed: boolean; retryAfter?: number }> {
  const now = new Date();
  const currentHour = Math.floor(now.getTime() / (3600 * 1000));
  const expiresAt = new Date((currentHour + 1) * 3600 * 1000);

  // 1. IP rate limit: max 5 signups per hour
  const ipKey = `rate:signup:ip:${ip.replace(/[^a-zA-Z0-9.:]/g, "")}:${currentHour}`;
  const ipRes = await db.execute<{ count: number }>(sql`
    INSERT INTO rate_limit_counters (key, count, expires_at, created_at, updated_at)
    VALUES (${ipKey}, 1, ${expiresAt.toISOString()}, now(), now())
    ON CONFLICT (key) DO UPDATE SET count = rate_limit_counters.count + 1, updated_at = now()
    RETURNING count;
  `);

  if ((ipRes.rows[0]?.count ?? 0) > 5) {
    const retryAfter = Math.max(1, Math.ceil((expiresAt.getTime() - now.getTime()) / 1000));
    return { allowed: false, retryAfter };
  }

  // 2. Email rate limit: max 3 signups per hour
  if (email) {
    const normEmail = email.trim().toLowerCase();
    const emailKey = `rate:signup:email:${normEmail}:${currentHour}`;
    const emailRes = await db.execute<{ count: number }>(sql`
      INSERT INTO rate_limit_counters (key, count, expires_at, created_at, updated_at)
      VALUES (${emailKey}, 1, ${expiresAt.toISOString()}, now(), now())
      ON CONFLICT (key) DO UPDATE SET count = rate_limit_counters.count + 1, updated_at = now()
      RETURNING count;
    `);

    if ((emailRes.rows[0]?.count ?? 0) > 3) {
      const retryAfter = Math.max(1, Math.ceil((expiresAt.getTime() - now.getTime()) / 1000));
      return { allowed: false, retryAfter };
    }
  }

  return { allowed: true };
}
