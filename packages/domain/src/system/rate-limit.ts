import { type Db } from "@bs/db";
import { sql } from "drizzle-orm";

export class RateLimitExceededError extends Error {
  readonly status = 429;
  readonly retryAfter: number;
  readonly limit: number;
  readonly key: string;

  constructor(message: string, retryAfter: number, limit: number, key: string) {
    super(message);
    this.name = "RateLimitExceededError";
    this.retryAfter = retryAfter;
    this.limit = limit;
    this.key = key;
  }
}

export interface RateLimitResult {
  allowed: boolean;
  count: number;
  limit: number;
  remaining: number;
  retryAfter: number;
}

export interface CheckRateLimitOptions {
  key: string;
  limit: number;
  windowSeconds: number;
}

/**
 * Atomic guarded fixed-window rate limiter in Postgres (PLAN §14 / M7).
 * Atomically inserts or increments counter in `rate_limit_counters`.
 * Automatically resets expired windows without separate purge cron requirement.
 */
export async function checkRateLimit(
  db: Db,
  opts: CheckRateLimitOptions,
): Promise<RateLimitResult> {
  const { key, limit, windowSeconds } = opts;

  // Atomic guarded upsert: resets count to 1 if existing window expired, otherwise increments count
  const query = sql`
    INSERT INTO rate_limit_counters (key, count, expires_at, created_at, updated_at)
    VALUES (${key}, 1, now() + make_interval(secs => ${windowSeconds}), now(), now())
    ON CONFLICT (key) DO UPDATE
    SET count = CASE
      WHEN rate_limit_counters.expires_at <= now() THEN 1
      ELSE rate_limit_counters.count + 1
    END,
    expires_at = CASE
      WHEN rate_limit_counters.expires_at <= now() THEN now() + make_interval(secs => ${windowSeconds})
      ELSE rate_limit_counters.expires_at
    END,
    updated_at = now()
    RETURNING count, expires_at;
  `;

  const result = await db.execute<{ count: number; expires_at: string | Date }>(query);
  const row = result.rows[0];
  if (!row) {
    throw new Error("Failed to record rate limit counter");
  }

  const count = Number(row.count);
  const expiresAt = row.expires_at instanceof Date ? row.expires_at : new Date(row.expires_at);
  const now = Date.now();
  const retryAfter = Math.max(1, Math.ceil((expiresAt.getTime() - now) / 1000));
  const allowed = count <= limit;
  const remaining = Math.max(0, limit - count);

  return {
    allowed,
    count,
    limit,
    remaining,
    retryAfter,
  };
}

export type QuotaKey = "uncached_storefront_rpm" | "admin_api_rpm" | "job_concurrency";

/**
 * Generous starting quotas (PLAN §14 / M7):
 * Storefront default: 3,000 req/min (XS). Admin default: 600 req/min (XS).
 */
const DEFAULT_TIER_QUOTAS: Record<QuotaKey, { XS: number; S: number; M: number; L: number }> = {
  uncached_storefront_rpm: { XS: 3000, S: 4500, M: 9000, L: 18000 },
  admin_api_rpm: { XS: 600, S: 1200, M: 2400, L: 4800 },
  job_concurrency: { XS: 4, S: 6, M: 8, L: 16 },
};

/**
 * Extracts verified client IP behind reverse proxy (PLAN §14 / M7).
 * - Never trusts the first X-Forwarded-For hop (which can be client-forged).
 * - Takes the last hop added by trusted reverse proxy (Caddy / Coolify).
 * - Reads CF-Connecting-IP ONLY if TRUST_CLOUDFLARE=true is explicitly set.
 */
export function getClientIp(
  headers: Headers | Record<string, string | string[] | undefined>,
): string {
  const getHeader = (name: string): string | undefined => {
    if (typeof (headers as Headers).get === "function") {
      return (headers as Headers).get(name) ?? undefined;
    }
    const rec = headers as Record<string, string | string[] | undefined>;
    const val = rec[name] ?? rec[name.toLowerCase()];
    if (Array.isArray(val)) return val[0];
    return val ?? undefined;
  };

  // 1. Guarded Cloudflare check: only trust CF-Connecting-IP when explicitly configured
  if (process.env.TRUST_CLOUDFLARE === "true") {
    const cfIp = getHeader("cf-connecting-ip");
    if (cfIp && cfIp.trim()) {
      return cfIp.trim();
    }
  }

  // 2. Reverse proxy hop parsing: take the last untrusted hop
  const xForwardedFor = getHeader("x-forwarded-for");
  if (xForwardedFor) {
    const hops = xForwardedFor
      .split(",")
      .map((h) => h.trim())
      .filter(Boolean);
    const lastHop = hops[hops.length - 1];
    if (lastHop) {
      return lastHop;
    }
  }

  // 3. Fallback to X-Real-IP
  const realIp = getHeader("x-real-ip");
  if (realIp && realIp.trim()) {
    return realIp.trim();
  }

  return "127.0.0.1";
}

/**
 * Resolves effective quota for a tenant:
 * 1. Tenant Quota Override -> 2. Tenant Size Tier -> 3. Default Tier (XS)
 */
export async function resolveTenantQuota(
  db: Db,
  tenantId: string,
  quotaKey: QuotaKey,
): Promise<number> {
  // 1. Check override
  const overrideRes = await db.execute<{ value: number }>(sql`
    SELECT value FROM tenant_quota_overrides
    WHERE tenant_id = ${tenantId} AND quota_key = ${quotaKey}
    LIMIT 1;
  `);
  if (overrideRes.rows[0]?.value !== undefined) {
    return Number(overrideRes.rows[0].value);
  }

  // 2. Check tenant size tier
  const tierRes = await db.execute<{ tier: string }>(sql`
    SELECT tier FROM tenant_size_tiers
    WHERE tenant_id = ${tenantId}
    LIMIT 1;
  `);
  const tier = (tierRes.rows[0]?.tier?.toUpperCase() as "XS" | "S" | "M" | "L") || "XS";

  // 3. Check quota definitions table or fallback to default
  const defRes = await db.execute<{ tier_xs: number; tier_s: number; tier_m: number; tier_l: number }>(sql`
    SELECT tier_xs, tier_s, tier_m, tier_l FROM quota_definitions
    WHERE key = ${quotaKey}
    LIMIT 1;
  `);

  if (defRes.rows[0]) {
    const colName = `tier_${tier.toLowerCase()}` as "tier_xs" | "tier_s" | "tier_m" | "tier_l";
    return Number(defRes.rows[0][colName]);
  }

  return DEFAULT_TIER_QUOTAS[quotaKey][tier] ?? DEFAULT_TIER_QUOTAS[quotaKey].XS;
}

/**
 * Customer OTP Request Rate Limits (strictest):
 * - Minimum 60-second cooldown per phone number across all IPs (anti-spam)
 * - Per phone: 3 requests / 10 min (600s)
 * - Per IP: 5 requests / 10 min (600s)
 * - Per tenant: 50 requests / 10 min (600s)
 */
export async function checkCustomerOtpRequestLimit(
  db: Db,
  params: { tenantId: string; ip: string; phone: string },
): Promise<void> {
  const { tenantId, ip, phone } = params;

  // 1. Phone + IP 60s cooldown (anti-spam)
  const cooldownRes = await checkRateLimit(db, {
    key: `otp:cooldown:${tenantId}:${phone}:${ip}`,
    limit: 1,
    windowSeconds: 60,
  });
  if (!cooldownRes.allowed) {
    throw new RateLimitExceededError(
      `Please wait ${cooldownRes.retryAfter} seconds before requesting another OTP.`,
      cooldownRes.retryAfter,
      1,
      `otp:cooldown:${tenantId}:${phone}:${ip}`,
    );
  }

  // 1. IP check
  const ipRes = await checkRateLimit(db, {
    key: `otp:req:ip:${ip}`,
    limit: 5,
    windowSeconds: 600,
  });
  if (!ipRes.allowed) {
    throw new RateLimitExceededError(
      `Too many OTP requests from this IP. Please retry after ${ipRes.retryAfter} seconds.`,
      ipRes.retryAfter,
      ipRes.limit,
      `otp:req:ip:${ip}`,
    );
  }

  // 2. Phone check
  const phoneRes = await checkRateLimit(db, {
    key: `otp:req:phone:${tenantId}:${phone}`,
    limit: 3,
    windowSeconds: 600,
  });
  if (!phoneRes.allowed) {
    throw new RateLimitExceededError(
      `Too many OTP requests for this phone number. Please retry after ${phoneRes.retryAfter} seconds.`,
      phoneRes.retryAfter,
      phoneRes.limit,
      `otp:req:phone:${tenantId}:${phone}`,
    );
  }

  // 3. Tenant check
  const tenantRes = await checkRateLimit(db, {
    key: `otp:req:tenant:${tenantId}`,
    limit: 50,
    windowSeconds: 600,
  });
  if (!tenantRes.allowed) {
    throw new RateLimitExceededError(
      `Store OTP rate limit exceeded. Please retry after ${tenantRes.retryAfter} seconds.`,
      tenantRes.retryAfter,
      tenantRes.limit,
      `otp:req:tenant:${tenantId}`,
    );
  }
}

/**
 * Customer OTP Verify Rate Limits:
 * - Per phone: 5 attempts / 10 min (600s)
 * - Per IP: 15 attempts / 10 min (600s)
 * - Per tenant: 100 attempts / 10 min (600s)
 */
export async function checkCustomerOtpVerifyLimit(
  db: Db,
  params: { tenantId: string; ip: string; phone: string },
): Promise<void> {
  const { tenantId, ip, phone } = params;

  // 1. IP check
  const ipRes = await checkRateLimit(db, {
    key: `otp:verify:ip:${ip}`,
    limit: 15,
    windowSeconds: 600,
  });
  if (!ipRes.allowed) {
    throw new RateLimitExceededError(
      `Too many OTP verification attempts from this IP. Please retry after ${ipRes.retryAfter} seconds.`,
      ipRes.retryAfter,
      ipRes.limit,
      `otp:verify:ip:${ip}`,
    );
  }

  // 2. Phone check
  const phoneRes = await checkRateLimit(db, {
    key: `otp:verify:phone:${tenantId}:${phone}`,
    limit: 5,
    windowSeconds: 600,
  });
  if (!phoneRes.allowed) {
    throw new RateLimitExceededError(
      `Too many OTP verification attempts for this phone number. Please retry after ${phoneRes.retryAfter} seconds.`,
      phoneRes.retryAfter,
      phoneRes.limit,
      `otp:verify:phone:${tenantId}:${phone}`,
    );
  }

  // 3. Tenant check
  const tenantRes = await checkRateLimit(db, {
    key: `otp:verify:tenant:${tenantId}`,
    limit: 100,
    windowSeconds: 600,
  });
  if (!tenantRes.allowed) {
    throw new RateLimitExceededError(
      `Store OTP verification rate limit exceeded. Please retry after ${tenantRes.retryAfter} seconds.`,
      tenantRes.retryAfter,
      tenantRes.limit,
      `otp:verify:tenant:${tenantId}`,
    );
  }
}

/**
 * Password Reset Request Rate Limits (PLAN §4.1):
 * - Max 3 reset requests per 15 minutes per IP (900s)
 */
export async function checkPasswordResetRateLimit(
  db: Db,
  params: { ip: string },
): Promise<void> {
  const { ip } = params;
  const ipRes = await checkRateLimit(db, {
    key: `reset:req:ip:${ip}`,
    limit: 3,
    windowSeconds: 900,
  });
  if (!ipRes.allowed) {
    throw new RateLimitExceededError(
      `Too many password reset requests from this IP. Please retry after ${ipRes.retryAfter} seconds.`,
      ipRes.retryAfter,
      ipRes.limit,
      `reset:req:ip:${ip}`,
    );
  }
}

/**
 * Password Reset Confirm Rate Limits (PLAN §4.1):
 * - Max 5 attempts per 15 minutes per IP (900s)
 */
export async function checkResetPasswordConfirmRateLimit(
  db: Db,
  params: { ip: string },
): Promise<void> {
  const { ip } = params;
  const ipRes = await checkRateLimit(db, {
    key: `reset:confirm:ip:${ip}`,
    limit: 5,
    windowSeconds: 900,
  });
  if (!ipRes.allowed) {
    throw new RateLimitExceededError(
      `Too many password reset attempts from this IP. Please retry after ${ipRes.retryAfter} seconds.`,
      ipRes.retryAfter,
      ipRes.limit,
      `reset:confirm:ip:${ip}`,
    );
  }
}

/**
 * Customer Password Reset Request Rate Limits (PLAN §5.4):
 * - Per (tenant, IP): 5 requests / 15 min (900s)
 * - Per (tenant, email): 3 requests / 15 min (900s)
 */
export async function checkCustomerPasswordResetRateLimit(
  db: Db,
  params: { tenantId: string; ip: string; email: string },
): Promise<void> {
  const { tenantId, ip, email } = params;
  const ipRes = await checkRateLimit(db, {
    key: `cust:reset:ip:${tenantId}:${ip}`,
    limit: 5,
    windowSeconds: 900,
  });
  if (!ipRes.allowed) {
    throw new RateLimitExceededError(
      `Too many password reset requests from this network. Please retry after ${ipRes.retryAfter} seconds.`,
      ipRes.retryAfter,
      ipRes.limit,
      `cust:reset:ip:${tenantId}:${ip}`,
    );
  }

  const emailRes = await checkRateLimit(db, {
    key: `cust:reset:email:${tenantId}:${email.trim().toLowerCase()}`,
    limit: 3,
    windowSeconds: 900,
  });
  if (!emailRes.allowed) {
    throw new RateLimitExceededError(
      `Too many password reset requests for this email. Please retry after ${emailRes.retryAfter} seconds.`,
      emailRes.retryAfter,
      emailRes.limit,
      `cust:reset:email:${tenantId}:${email}`,
    );
  }
}

/**
 * Customer Registration Rate Limits (PLAN §5.4):
 * - Per (tenant, IP): 5 registrations / 15 min (900s)
 */
export async function checkCustomerRegisterRateLimit(
  db: Db,
  params: { tenantId: string; ip: string },
): Promise<void> {
  const { tenantId, ip } = params;
  const ipRes = await checkRateLimit(db, {
    key: `cust:reg:ip:${tenantId}:${ip}`,
    limit: 5,
    windowSeconds: 900,
  });
  if (!ipRes.allowed) {
    throw new RateLimitExceededError(
      `Too many registration attempts. Please retry after ${ipRes.retryAfter} seconds.`,
      ipRes.retryAfter,
      ipRes.limit,
      `cust:reg:ip:${tenantId}:${ip}`,
    );
  }
}

/**
 * Customer Login Rate Limits (PLAN §5.4):
 * - Per (tenant, IP): 10 attempts / 5 min (300s)
 * - Per (tenant, email): 5 attempts / 5 min (300s)
 */
export async function checkCustomerLoginRateLimit(
  db: Db,
  params: { tenantId: string; ip: string; email: string },
): Promise<void> {
  const { tenantId, ip, email } = params;
  const ipRes = await checkRateLimit(db, {
    key: `cust:login:ip:${tenantId}:${ip}`,
    limit: 10,
    windowSeconds: 300,
  });
  if (!ipRes.allowed) {
    throw new RateLimitExceededError(
      `Too many sign in attempts. Please retry after ${ipRes.retryAfter} seconds.`,
      ipRes.retryAfter,
      ipRes.limit,
      `cust:login:ip:${tenantId}:${ip}`,
    );
  }

  const emailRes = await checkRateLimit(db, {
    key: `cust:login:email:${tenantId}:${email.trim().toLowerCase()}`,
    limit: 5,
    windowSeconds: 300,
  });
  if (!emailRes.allowed) {
    throw new RateLimitExceededError(
      `Too many sign in attempts for this account. Please retry after ${emailRes.retryAfter} seconds.`,
      emailRes.retryAfter,
      emailRes.limit,
      `cust:login:email:${tenantId}:${email}`,
    );
  }
}

/**
 * Admin and Staff Login Rate Limits:
 * - Per IP: 10 attempts / 15 min (900s)
 * - Per email: 5 attempts / 15 min (900s)
 */
export async function checkAdminLoginLimit(
  db: Db,
  params: { ip: string; email: string },
): Promise<void> {
  const { ip, email } = params;

  const ipRes = await checkRateLimit(db, {
    key: `login:admin:ip:${ip}`,
    limit: 10,
    windowSeconds: 900,
  });
  if (!ipRes.allowed) {
    throw new RateLimitExceededError(
      `Too many login attempts from this IP. Please retry after ${ipRes.retryAfter} seconds.`,
      ipRes.retryAfter,
      ipRes.limit,
      `login:admin:ip:${ip}`,
    );
  }

  const emailRes = await checkRateLimit(db, {
    key: `login:admin:email:${email.toLowerCase().trim()}`,
    limit: 5,
    windowSeconds: 900,
  });
  if (!emailRes.allowed) {
    throw new RateLimitExceededError(
      `Too many login attempts for this account. Please retry after ${emailRes.retryAfter} seconds.`,
      emailRes.retryAfter,
      emailRes.limit,
      `login:admin:email:${email.toLowerCase().trim()}`,
    );
  }
}

/**
 * Webhook Rate Limits (PLAN §14 / M7):
 * - Per-provider + per-source-IP (300 requests / 60s default)
 * Enforced on unverified / forged requests to protect origin from DoS.
 */
export async function checkWebhookRateLimit(
  db: Db,
  params: { ip: string; provider: string },
): Promise<void> {
  const { ip, provider } = params;
  const key = `rate:webhook:${provider.toLowerCase()}:${ip}`;
  const provRes = await checkRateLimit(db, {
    key,
    limit: 300,
    windowSeconds: 60,
  });
  if (!provRes.allowed) {
    throw new RateLimitExceededError(
      `Webhook rate limit exceeded for provider ${provider} from this IP. Retry after ${provRes.retryAfter} seconds.`,
      provRes.retryAfter,
      provRes.limit,
      key,
    );
  }
}

/**
 * Uncached Storefront Request Rate Limit per Tenant (PLAN §14 quota table):
 * Default: 3,000 req/min (XS). Fail-open on database errors with loud warning log.
 */
export async function checkStorefrontRateLimit(
  db: Db,
  tenantId: string,
): Promise<RateLimitResult> {
  try {
    const limit = await resolveTenantQuota(db, tenantId, "uncached_storefront_rpm");
    const res = await checkRateLimit(db, {
      key: `rate:storefront:tenant:${tenantId}`,
      limit,
      windowSeconds: 60,
    });
    if (!res.allowed) {
      throw new RateLimitExceededError(
        `Storefront rate limit exceeded (${limit} req/min). Retry after ${res.retryAfter} seconds.`,
        res.retryAfter,
        res.limit,
        `rate:storefront:tenant:${tenantId}`,
      );
    }
    return res;
  } catch (err: unknown) {
    if (err instanceof RateLimitExceededError) {
      throw err;
    }
    console.warn(`[WARN] Storefront rate limit check failed for tenant ${tenantId}. Failing open. Error: ${err instanceof Error ? err.message : String(err)}`);
    return {
      allowed: true,
      count: 0,
      limit: 3000,
      remaining: 3000,
      retryAfter: 0,
    };
  }
}

/**
 * Admin / API Request Rate Limit per Tenant (PLAN §14 quota table):
 * Default: 600 req/min (XS).
 */
export async function checkAdminApiRateLimit(
  db: Db,
  tenantId: string,
): Promise<RateLimitResult> {
  const limit = await resolveTenantQuota(db, tenantId, "admin_api_rpm");
  const res = await checkRateLimit(db, {
    key: `rate:admin:tenant:${tenantId}`,
    limit,
    windowSeconds: 60,
  });
  if (!res.allowed) {
    throw new RateLimitExceededError(
      `Admin API rate limit exceeded (${limit} req/min). Retry after ${res.retryAfter} seconds.`,
      res.retryAfter,
      res.limit,
      `rate:admin:tenant:${tenantId}`,
    );
  }
  return res;
}

/**
 * Acquires an active job execution slot for a tenant against their `job_concurrency` quota.
 * Returns true if slot acquired, false if tenant has saturated their job concurrency ceiling.
 */
export async function acquireTenantJobSlot(
  db: Db,
  tenantId: string,
): Promise<boolean> {
  const ceiling = await resolveTenantQuota(db, tenantId, "job_concurrency");

  const query = sql`
    INSERT INTO tenant_active_jobs (tenant_id, active_count, updated_at)
    VALUES (${tenantId}, 1, now())
    ON CONFLICT (tenant_id) DO UPDATE
    SET active_count = tenant_active_jobs.active_count + 1, updated_at = now()
    WHERE tenant_active_jobs.active_count < ${ceiling}
    RETURNING active_count;
  `;

  const result = await db.execute<{ active_count: number }>(query);
  return result.rows.length > 0;
}

/**
 * Releases an active job execution slot for a tenant upon job completion.
 */
export async function releaseTenantJobSlot(
  db: Db,
  tenantId: string,
): Promise<void> {
  await db.execute(sql`
    UPDATE tenant_active_jobs
    SET active_count = GREATEST(0, active_count - 1), updated_at = now()
    WHERE tenant_id = ${tenantId};
  `);
}

/**
 * Prunes expired rate limit counters older than 1 hour (PLAN §14 / M7).
 * Prevents unbounded growth of rate_limit_counters table.
 */
export async function cleanExpiredRateLimits(db: Db): Promise<number> {
  const result = await db.execute<{ count: string }>(sql`
    WITH deleted AS (
      DELETE FROM rate_limit_counters
      WHERE expires_at < now() - INTERVAL '1 hour'
      RETURNING 1
    )
    SELECT count(*)::text as count FROM deleted;
  `);
  return parseInt(result.rows[0]?.count ?? "0", 10);
}

/**
 * Reaps stale tenant active job slots (PLAN §14 / M7).
 * If a worker crashed while holding a slot, resets active_count based on a 30-minute stale threshold.
 */
export async function reapStaleTenantJobSlots(
  db: Db,
  staleMinutes: number = 30,
): Promise<number> {
  const result = await db.execute<{ count: string }>(sql`
    WITH updated AS (
      UPDATE tenant_active_jobs
      SET active_count = 0, updated_at = now()
      WHERE updated_at < now() - make_interval(mins => ${staleMinutes})
        AND active_count > 0
      RETURNING 1
    )
    SELECT count(*)::text as count FROM updated;
  `);
  return parseInt(result.rows[0]?.count ?? "0", 10);
}

