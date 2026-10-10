import { sql } from "drizzle-orm";
import { withTenant, type Db } from "@bs/db";

export class QuotaExceededError extends Error {
  readonly status = 403;
  readonly quotaKey: string;
  readonly current: number;
  readonly limit: number;

  constructor(message: string, quotaKey: string, current: number, limit: number) {
    super(message);
    this.name = "QuotaExceededError";
    this.quotaKey = quotaKey;
    this.current = current;
    this.limit = limit;
  }
}

export type PlanQuotaKey =
  | "products"
  | "variants"
  | "staff_seats"
  | "storage_mb"
  | "media_file_mb"
  | "orders_month"
  | "emails_month"
  | "uncached_storefront_rpm"
  | "admin_api_rpm"
  | "custom_domains"
  | "installed_apps"
  | "exports_day"
  | "job_concurrency";

export interface QuotaResolution {
  limit: number;
  unit: string;
  enforcement: "hard" | "soft" | "notify";
  source: "override" | "tier" | "plan" | "default";
  tier: string;
}

export interface QuotaUsageItem {
  quotaKey: PlanQuotaKey;
  description: string;
  current: number;
  limit: number;
  unit: string;
  enforcement: "hard" | "soft" | "notify";
  percentUsed: number;
  source: "override" | "tier" | "plan" | "default";
  tier: string;
}

export interface TenantUsageReport {
  tenantId: string;
  tier: string;
  planCode: string | null;
  items: QuotaUsageItem[];
  warnings: string[];
}

export const DEFAULT_TIER_TABLE: Record<
  PlanQuotaKey,
  { unit: string; enforcement: "hard" | "soft" | "notify"; XS: number; S: number; M: number; L: number; desc: string }
> = {
  products: { unit: "count", enforcement: "hard", XS: 50, S: 500, M: 5000, L: 25000, desc: "Catalog products" },
  variants: { unit: "count", enforcement: "hard", XS: 200, S: 2000, M: 20000, L: 100000, desc: "Product variants" },
  staff_seats: { unit: "count", enforcement: "hard", XS: 2, S: 5, M: 15, L: 50, desc: "Staff seats" },
  storage_mb: { unit: "MB", enforcement: "hard", XS: 1024, S: 5120, M: 25600, L: 102400, desc: "Media storage" },
  media_file_mb: { unit: "MB", enforcement: "hard", XS: 5, S: 10, M: 20, L: 50, desc: "Max upload file size" },
  orders_month: { unit: "orders", enforcement: "soft", XS: 300, S: 3000, M: 20000, L: 1000000, desc: "Monthly orders" },
  emails_month: { unit: "emails", enforcement: "soft", XS: 2000, S: 15000, M: 80000, L: 300000, desc: "Monthly emails" },
  uncached_storefront_rpm: { unit: "rpm", enforcement: "hard", XS: 3000, S: 4500, M: 9000, L: 18000, desc: "Storefront RPM" },
  admin_api_rpm: { unit: "rpm", enforcement: "hard", XS: 600, S: 1200, M: 2400, L: 4800, desc: "Admin API RPM" },
  custom_domains: { unit: "domains", enforcement: "hard", XS: 0, S: 1, M: 3, L: 10, desc: "Custom domains" },
  installed_apps: { unit: "apps", enforcement: "hard", XS: 3, S: 10, M: 25, L: 100, desc: "Installed apps" },
  exports_day: { unit: "exports", enforcement: "hard", XS: 2, S: 5, M: 10, L: 20, desc: "Daily exports" },
  job_concurrency: { unit: "jobs", enforcement: "hard", XS: 4, S: 6, M: 8, L: 16, desc: "Job concurrency" },
};

/**
 * Resolves effective quota for a tenant following PLAN §6.1 / ADR-015 / ADR-025:
 * Hierarchy:
 * 1. Tenant Quota Override (if active and not expired)
 * 2. Tenant Size Tier (from normalised quota_tier_limits table, fallback to XS)
 * 3. Plan Limits (from active subscription/plan)
 * 4. Default Fallback (XS tier threshold from fallback table)
 */
export async function resolveEffectiveQuota(
  db: Db,
  tenantId: string,
  quotaKey: PlanQuotaKey,
): Promise<QuotaResolution> {
  const fallback = DEFAULT_TIER_TABLE[quotaKey];

  // 1. Check active override
  const overrideRes = await db.execute<{ value: number }>(sql`
    SELECT value FROM tenant_quota_overrides
    WHERE tenant_id = ${tenantId}
      AND quota_key = ${quotaKey}
      AND (expires_at IS NULL OR expires_at > now())
    LIMIT 1;
  `);

  // Fetch tenant tier (un-tiered stores default to generous L for backward compatibility; unknown assigned tiers fallback to XS)
  const tierRes = await db.execute<{ tier: string }>(sql`
    SELECT tier FROM tenant_size_tiers
    WHERE tenant_id = ${tenantId}
    LIMIT 1;
  `);
  const rawTier = tierRes.rows[0]?.tier?.trim() || "L";
  const tier = rawTier.toUpperCase();

  // Fetch quota definition metadata
  const defRes = await db.execute<{
    unit: string;
    enforcement: "hard" | "soft" | "notify";
    tier_xs: number;
    tier_s: number;
    tier_m: number;
    tier_l: number;
  }>(sql`
    SELECT unit, enforcement, tier_xs, tier_s, tier_m, tier_l
    FROM quota_definitions
    WHERE key = ${quotaKey}
    LIMIT 1;
  `);

  const unit = defRes.rows[0]?.unit ?? fallback.unit;
  const enforcement = defRes.rows[0]?.enforcement ?? fallback.enforcement;

  if (overrideRes.rows[0]?.value !== undefined) {
    return {
      limit: Number(overrideRes.rows[0].value),
      unit,
      enforcement,
      source: "override",
      tier,
    };
  }

  // 2. Check tenant size tier from normalised quota_tier_limits table
  try {
    const tierLimitRes = await db.execute<{ value: number }>(sql`
      SELECT value FROM quota_tier_limits
      WHERE UPPER(tier_code) = ${tier} AND quota_key = ${quotaKey}
      LIMIT 1;
    `);

    if (tierLimitRes.rows[0]?.value !== undefined) {
      const val = Number(tierLimitRes.rows[0].value);
      if (!isNaN(val) && val >= 0) {
        return {
          limit: val,
          unit,
          enforcement,
          source: "tier",
          tier,
        };
      }
    }

    // If tier not found or limit missing for this tier, fall back safely to XS tier
    const xsLimitRes = await db.execute<{ value: number }>(sql`
      SELECT value FROM quota_tier_limits
      WHERE UPPER(tier_code) = 'XS' AND quota_key = ${quotaKey}
      LIMIT 1;
    `);
    if (xsLimitRes.rows[0]?.value !== undefined) {
      const val = Number(xsLimitRes.rows[0].value);
      if (!isNaN(val) && val >= 0) {
        return {
          limit: val,
          unit,
          enforcement,
          source: "tier",
          tier: "XS",
        };
      }
    }
  } catch {
    // If quota_tier_limits table query fails, proceed to fallback
  }

  // Legacy fallback: check quota_definitions tier_xs/s/m/l
  if (defRes.rows[0]) {
    const colName = `tier_${tier.toLowerCase()}` as "tier_xs" | "tier_s" | "tier_m" | "tier_l";
    const tierLimit = Number(defRes.rows[0][colName] ?? defRes.rows[0].tier_xs);
    if (!isNaN(tierLimit) && tierLimit >= 0) {
      return {
        limit: tierLimit,
        unit,
        enforcement,
        source: "tier",
        tier,
      };
    }
  }

  // 3. Check Plan limits
  try {
    const planRes = await db.execute<{ limits: Record<string, number> | string }>(sql`
      SELECT p.limits
      FROM subscriptions s
      JOIN plans p ON p.id = s.plan_id
      WHERE s.tenant_id = ${tenantId}
        AND s.status IN ('active', 'trialing')
      ORDER BY s.created_at DESC
      LIMIT 1;
    `);
    if (planRes.rows[0]) {
      const rawLimits = planRes.rows[0].limits;
      const limits = typeof rawLimits === "string" ? JSON.parse(rawLimits) : rawLimits;
      if (limits && typeof limits[quotaKey] === "number") {
        return {
          limit: limits[quotaKey],
          unit,
          enforcement,
          source: "plan",
          tier,
        };
      }
    }
  } catch {
    // If plans/subscriptions tables not yet queryable, proceed to default
  }

  // 4. Default fallback: XS tier default threshold from fallback table
  const defaultLimit = fallback[tier as "XS" | "S" | "M" | "L"] ?? fallback.XS ?? fallback.L;
  return {
    limit: defaultLimit,
    unit,
    enforcement,
    source: "default",
    tier,
  };
}

/**
 * Hard enforcement check for catalog products creation (PLAN §6.1).
 * Blocks admin-side creation if limit is reached.
 */
export async function assertProductQuota(db: Db, tenantId: string): Promise<void> {
  const { limit } = await resolveEffectiveQuota(db, tenantId, "products");
  const countRes = await withTenant(db, tenantId, async (tx) => {
    return tx.execute<{ count: string }>(sql`
      SELECT COUNT(*)::text as count FROM products WHERE tenant_id = ${tenantId};
    `);
  });
  const current = parseInt(countRes.rows[0]?.count ?? "0", 10);
  if (current >= limit) {
    throw new QuotaExceededError(
      `Product creation quota exceeded: your current plan/tier limit is ${limit} products (currently ${current}). Please upgrade your tier or plan.`,
      "products",
      current,
      limit,
    );
  }
}

/**
 * Hard enforcement check for staff seat invitations (PLAN §6.1).
 */
export async function assertStaffQuota(db: Db, tenantId: string): Promise<void> {
  const { limit } = await resolveEffectiveQuota(db, tenantId, "staff_seats");
  const countRes = await withTenant(db, tenantId, async (tx) => {
    return tx.execute<{ count: string }>(sql`
      SELECT COUNT(*)::text as count FROM memberships WHERE tenant_id = ${tenantId} AND status = 'active';
    `);
  });
  const current = parseInt(countRes.rows[0]?.count ?? "0", 10);
  if (current >= limit) {
    throw new QuotaExceededError(
      `Staff seat quota exceeded: your current plan/tier limit is ${limit} active seats (currently ${current}).`,
      "staff_seats",
      current,
      limit,
    );
  }
}

/**
 * Hard enforcement check for custom domains addition (PLAN §6.1).
 */
export async function assertCustomDomainQuota(db: Db, tenantId: string): Promise<void> {
  const { limit } = await resolveEffectiveQuota(db, tenantId, "custom_domains");
  const countRes = await withTenant(db, tenantId, async (tx) => {
    return tx.execute<{ count: string }>(sql`
      SELECT COUNT(*)::text as count
      FROM domains
      WHERE tenant_id = ${tenantId}
        AND type = 'custom'
        AND status != 'removed';
    `);
  });
  const current = parseInt(countRes.rows[0]?.count ?? "0", 10);
  if (current >= limit) {
    throw new QuotaExceededError(
      `Custom domain quota exceeded: your current plan/tier limit allows ${limit} custom domains (currently ${current}).`,
      "custom_domains",
      current,
      limit,
    );
  }
}

/**
 * Generic hard enforcement quota assertion.
 */
export async function assertQuota(
  db: Db,
  tenantId: string,
  quotaKey: PlanQuotaKey,
  current: number,
): Promise<void> {
  const { limit, enforcement } = await resolveEffectiveQuota(db, tenantId, quotaKey);
  if (enforcement === "hard" && current >= limit) {
    throw new QuotaExceededError(
      `Quota exceeded for '${quotaKey}': limit is ${limit} (current: ${current})`,
      quotaKey,
      current,
      limit,
    );
  }
}


/**
 * Hard enforcement check for media file storage (PLAN §6.1).
 */
export async function assertStorageQuota(db: Db, tenantId: string, uploadSizeMb: number): Promise<void> {
  // 1. Max individual file size check
  const fileLimit = await resolveEffectiveQuota(db, tenantId, "media_file_mb");
  if (uploadSizeMb > fileLimit.limit) {
    throw new QuotaExceededError(
      `File size exceeds maximum upload limit of ${fileLimit.limit} MB (file size: ${uploadSizeMb.toFixed(1)} MB).`,
      "media_file_mb",
      Math.round(uploadSizeMb),
      fileLimit.limit,
    );
  }

  // 2. Total storage check
  const totalLimit = await resolveEffectiveQuota(db, tenantId, "storage_mb");
  const usageRes = await withTenant(db, tenantId, async (tx) => {
    return tx.execute<{ total_bytes: string }>(sql`
      SELECT COALESCE(SUM(bytes), 0)::text as total_bytes
      FROM media
      WHERE tenant_id = ${tenantId};
    `);
  });
  const totalMb = Math.round(parseInt(usageRes.rows[0]?.total_bytes ?? "0", 10) / (1024 * 1024));
  if (totalMb + uploadSizeMb > totalLimit.limit) {
    throw new QuotaExceededError(
      `Total media storage quota exceeded: limit is ${totalLimit.limit} MB (currently ${totalMb} MB).`,
      "storage_mb",
      totalMb,
      totalLimit.limit,
    );
  }
}

/**
 * Hard enforcement check for exports per day (PLAN §6.1).
 */
export async function assertExportQuota(db: Db, tenantId: string): Promise<void> {
  const { limit } = await resolveEffectiveQuota(db, tenantId, "exports_day");
  // Check rate limit key for exports today
  const key = `quota:exports:tenant:${tenantId}:${new Date().toISOString().slice(0, 10)}`;
  const countRes = await db.execute<{ count: string }>(sql`
    SELECT count FROM rate_limit_counters WHERE key = ${key} LIMIT 1;
  `);
  const current = countRes.rows[0] ? Number(countRes.rows[0].count) : 0;
  if (current >= limit) {
    throw new QuotaExceededError(
      `Daily export quota exceeded: limit is ${limit} exports per day (used ${current}).`,
      "exports_day",
      current,
      limit,
    );
  }
}

/**
 * Records soft quota event and emits warning notification (PLAN §6.1).
 * HARD INVARIANT: This function NEVER blocks checkout or order processing!
 */
export async function trackSoftQuotaUsage(
  db: Db,
  params: {
    tenantId: string;
    quotaKey: "orders_month" | "emails_month";
    current: number;
  },
): Promise<{ level: "pct_80" | "pct_100" | "ok"; notified: boolean }> {
  const { tenantId, quotaKey, current } = params;
  const { limit } = await resolveEffectiveQuota(db, tenantId, quotaKey);

  const pct = Math.round((current / limit) * 100);
  let targetLevel: "pct_80" | "pct_100" | null = null;
  if (pct >= 100) {
    targetLevel = "pct_100";
  } else if (pct >= 80) {
    targetLevel = "pct_80";
  }

  if (!targetLevel) {
    return { level: "ok", notified: false };
  }

  // Deduplicate event within the current calendar month
  const monthStart = new Date();
  monthStart.setDate(1);
  monthStart.setHours(0, 0, 0, 0);

  const existing = await db.execute<{ id: string }>(sql`
    SELECT id FROM quota_events
    WHERE tenant_id = ${tenantId}
      AND quota_key = ${quotaKey}
      AND level = ${targetLevel}
      AND created_at >= ${monthStart.toISOString()}
    LIMIT 1;
  `);

  if (!existing.rows[0]) {
    try {
      await db.execute(sql`
        INSERT INTO quota_events (id, tenant_id, quota_key, level, value, limit_value, notified_at, created_at)
        VALUES (
          uuidv7(),
          ${tenantId},
          ${quotaKey},
          ${targetLevel},
          ${current},
          ${limit},
          now(),
          now()
        );
      `);
      return { level: targetLevel, notified: true };
    } catch {
      // Invariant: soft quota event recording failure must NEVER break callers (checkout, etc.)
      return { level: targetLevel, notified: false };
    }
  }

  return { level: targetLevel, notified: false };
}

/**
 * Computes merchant-facing usage report for Settings > Plan and billing (PLAN §6.1).
 */
export async function getTenantUsageReport(db: Db, tenantId: string): Promise<TenantUsageReport> {
  const tierRes = await db.execute<{ tier: string }>(sql`
    SELECT tier FROM tenant_size_tiers WHERE tenant_id = ${tenantId} LIMIT 1;
  `);
  const tier = tierRes.rows[0]?.tier?.trim() || "XS";

  // Fetch plan
  const planRes = await db.execute<{ code: string }>(sql`
    SELECT p.code
    FROM subscriptions s
    JOIN plans p ON p.id = s.plan_id
    WHERE s.tenant_id = ${tenantId} AND s.status IN ('active', 'trialing')
    LIMIT 1;
  `);
  const planCode = planRes.rows[0]?.code ?? null;

  // Real database counts
  const [prodRes, varRes, staffRes, domRes, orderRes, mediaRes] = await withTenant(db, tenantId, async (tx) => {
    return Promise.all([
      tx.execute<{ count: string }>(sql`SELECT COUNT(*)::text as count FROM products WHERE tenant_id = ${tenantId};`),
      tx.execute<{ count: string }>(sql`SELECT COUNT(*)::text as count FROM variants WHERE tenant_id = ${tenantId};`),
      tx.execute<{ count: string }>(sql`SELECT COUNT(*)::text as count FROM memberships WHERE tenant_id = ${tenantId} AND status = 'active';`),
      tx.execute<{ count: string }>(sql`SELECT COUNT(*)::text as count FROM domains WHERE tenant_id = ${tenantId} AND type = 'custom' AND status != 'removed';`),
      tx.execute<{ count: string }>(sql`SELECT COUNT(*)::text as count FROM orders WHERE tenant_id = ${tenantId} AND created_at >= date_trunc('month', now());`),
      tx.execute<{ total: string }>(sql`SELECT COALESCE(SUM(bytes), 0)::text as total FROM media WHERE tenant_id = ${tenantId};`),
    ]);
  });

  const counts: Partial<Record<PlanQuotaKey, number>> = {
    products: parseInt(prodRes.rows[0]?.count ?? "0", 10),
    variants: parseInt(varRes.rows[0]?.count ?? "0", 10),
    staff_seats: parseInt(staffRes.rows[0]?.count ?? "0", 10),
    custom_domains: parseInt(domRes.rows[0]?.count ?? "0", 10),
    orders_month: parseInt(orderRes.rows[0]?.count ?? "0", 10),
    storage_mb: Math.round(parseInt(mediaRes.rows[0]?.total ?? "0", 10) / (1024 * 1024)),
    media_file_mb: 0,
    emails_month: 0,
    uncached_storefront_rpm: 0,
    admin_api_rpm: 0,
    installed_apps: 0,
    exports_day: 0,
    job_concurrency: 0,
  };

  const keys: PlanQuotaKey[] = [
    "products",
    "variants",
    "staff_seats",
    "storage_mb",
    "orders_month",
    "emails_month",
    "custom_domains",
  ];

  const items: QuotaUsageItem[] = [];
  const warnings: string[] = [];

  for (const key of keys) {
    const res = await resolveEffectiveQuota(db, tenantId, key);
    const current = counts[key] ?? 0;
    const percentUsed = Math.round((current / res.limit) * 100);
    const item: QuotaUsageItem = {
      quotaKey: key,
      description: DEFAULT_TIER_TABLE[key]?.desc ?? key,
      current,
      limit: res.limit,
      unit: res.unit,
      enforcement: res.enforcement,
      percentUsed,
      source: res.source,
      tier: res.tier,
    };
    items.push(item);

    if (percentUsed >= 80) {
      warnings.push(`You have reached ${percentUsed}% of your ${item.description} limit (${current}/${res.limit} ${res.unit}).`);
    }
  }

  return {
    tenantId,
    tier,
    planCode,
    items,
    warnings,
  };
}

/**
 * Nightly job evaluating tenants near limits (PLAN §6.1).
 * Recommends tier upgrade for stores > 80% usage for 30 days (recording only, no auto change).
 */
export async function runNightlyQuotaRecommendationsJob(db: Db): Promise<{
  inspectedTenants: number;
  recommendations: Array<{ tenantId: string; recommendedTier: string; reason: string }>;
}> {
  const tenantsRes = await db.execute<{ id: string; slug: string }>(sql`
    SELECT id, slug FROM tenants WHERE status IN ('active', 'trial');
  `);

  const recommendations: Array<{ tenantId: string; recommendedTier: string; reason: string }> = [];

  for (const row of tenantsRes.rows) {
    const report = await getTenantUsageReport(db, row.id);
    const overThreshold = report.items.filter((i) => i.percentUsed >= 80);
    if (overThreshold.length > 0) {
      const nextTierMap: Record<string, string> = { XS: "S", S: "M", M: "L", L: "Custom/Dedicated" };
      const nextTier = nextTierMap[report.tier] ?? "Dedicated";
      const reasons = overThreshold.map((o) => `${o.description}: ${o.current}/${o.limit} (${o.percentUsed}%)`).join(", ");

      const primaryViolation = overThreshold[0];
      if (primaryViolation) {
        // Record recommendation to platform audit log or quota event
        await db.execute(sql`
          INSERT INTO quota_events (id, tenant_id, quota_key, level, value, limit_value, notified_at, created_at)
          VALUES (
            uuidv7(),
            ${row.id},
            ${primaryViolation.quotaKey},
            'pct_80',
            ${primaryViolation.current},
            ${primaryViolation.limit},
            now(),
            now()
          );
        `);
      }

      recommendations.push({
        tenantId: row.id,
        recommendedTier: nextTier,
        reason: reasons,
      });
    }
  }

  return {
    inspectedTenants: tenantsRes.rows.length,
    recommendations,
  };
}
